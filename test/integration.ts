import * as vscode from 'vscode';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { NavigatorApi } from '../src/extension';
import type { GitExtension, GitRepository } from '../src/gitApi';
import type { ReviewApi } from '../src/reviewView';

async function eventually(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 20000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

function snapshot(repository: string): object {
  const git = (...args: string[]) => execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8' });
  return {
    head: git('rev-parse', 'HEAD'), branch: git('symbolic-ref', 'HEAD'),
    refs: git('show-ref'), status: git('status', '--porcelain=v1', '-uall'),
    staged: git('diff', '--cached', '--binary'), unstaged: git('diff', '--binary'),
    index: fs.readFileSync(path.resolve(repository, git('rev-parse', '--git-path', 'index').trim())).toString('base64'),
    files: fs.readdirSync(repository).filter(name => name !== '.git').sort().map(name => [name, fs.readFileSync(path.join(repository, name)).toString('base64')]),
  };
}

export async function run(): Promise<void> {
  const fixture = process.env.REQUIREMENT_TEST_FIXTURE;
  assert.ok(fixture, 'Run using npm run test:integration');
  const { repositories, reviewHashes } = JSON.parse(fs.readFileSync(path.join(fixture, 'fixture.json'), 'utf8')) as { repositories: string[]; reviewHashes: string[] };
  // Git status can refresh index metadata; stabilize it before taking the byte snapshot.
  repositories.forEach(repository => execFileSync('git', ['-C', repository, 'status', '--porcelain']));
  const before = repositories.map(snapshot);
  const navigator = await vscode.extensions.getExtension<NavigatorApi & ReviewApi>('lip-local.requirement-workspaces')!.activate();
  const locale = process.env.REQUIREMENT_TEST_LOCALE ?? 'en';
  assert.equal(vscode.env.language.toLowerCase(), locale.toLowerCase(), 'The extension must use the VS Code UI locale');
  const manifest = vscode.extensions.getExtension('lip-local.requirement-workspaces')!.packageJSON;
  assert.equal(manifest.contributes.views.scm[1].name, locale === 'zh-cn' ? '提交汇总 Review' : 'Commit Review');
  const git = (await vscode.extensions.getExtension<GitExtension>('vscode.git')!.activate()).getAPI(1);
  const alpha = path.join(fixture, '.worktrees/review-a/api');
  const web = path.join(fixture, '.worktrees/review-a/web');
  const beta = path.join(fixture, '.worktrees/review-b/api');
  const roots = () => git.repositories.map(repository => repository.rootUri.fsPath).sort();
  const find = (root: string): GitRepository => git.repositories.find(repository => repository.rootUri.fsPath === root)!;
  await eventually(() => roots().join() === [alpha, web].sort().join(), 'Native SCM did not load the initial requirement');
  assert.deepEqual(navigator.getRequirements().map(item => [item.name, item.repositories.length]), [['review-a', 2], ['review-b', 1]]);
  assert.equal(navigator.getActiveRequirement(), 'review-a');
  await find(alpha).status();
  assert.equal(find(alpha).state.HEAD?.name, 'feat/review-a');
  assert.equal(find(alpha).state.indexChanges.length, 1);
  const unstagedPaths = () => new Set([...find(alpha).state.workingTreeChanges, ...find(alpha).state.untrackedChanges].map(change => change.uri.fsPath));
  assert.deepEqual(unstagedPaths(), new Set([path.join(alpha, 'review.txt'), path.join(alpha, '未跟踪 文件.txt')]));

  const alphaFile = vscode.Uri.file(path.join(alpha, 'review.txt'));
  await vscode.commands.executeCommand('git.openChange', alphaFile);
  const diff = () => vscode.window.tabGroups.all.flatMap(group => group.tabs)
    .map(tab => tab.input).find((input): input is vscode.TabInputTextDiff => input instanceof vscode.TabInputTextDiff && input.modified.fsPath === alphaFile.fsPath);
  await eventually(() => Boolean(diff()), 'Native Git did not open a diff editor');
  assert.equal(diff()!.original.scheme, 'git');
  const original = await vscode.workspace.openTextDocument(diff()!.original);
  assert.equal(original.getText(), 'staged\n', 'Unstaged diff must compare against the staged content');

  const document = await vscode.workspace.openTextDocument(alphaFile);
  const editor = await vscode.window.showTextDocument(document);
  await editor.edit(edit => edit.insert(new vscode.Position(1, 0), 'unsaved buffer\n'));
  assert.ok(document.isDirty);

  const review = await navigator.createReview(alpha, reviewHashes);
  assert.deepEqual(review.files.map(file => file.afterPath), ['aggregate.txt', 'deleted.txt', 'new.txt'], 'Skipped commits must not be part of aggregate review');
  assert.deepEqual(review.stats, { additions: 3, deletions: 4, binaryFiles: 0 });
  assert.equal(review.commits.length, 2);
  fs.writeFileSync(path.join(fixture, 'ui-ready'), 'ready');
  await eventually(() => fs.existsSync(path.join(fixture, 'ui-result.json')), 'Rendered review UI verification timed out');
  const uiResult = JSON.parse(fs.readFileSync(path.join(fixture, 'ui-result.json'), 'utf8'));
  assert.equal(uiResult.ok, true, uiResult.error);
  // The UI check clicks the deleted file; confirm it opens its native diff with an empty right side.
  await eventually(() => vscode.window.tabGroups.all.flatMap(group => group.tabs).some(tab =>
    tab.input instanceof vscode.TabInputTextDiff && tab.input.modified.scheme === 'worktree-review' && tab.input.modified.path.endsWith('/deleted.txt')), 'Clicking a deleted row did not open its diff');
  await navigator.openReviewFile(0);
  const reviewDiff = () => vscode.window.tabGroups.all.flatMap(group => group.tabs).map(tab => tab.input)
    .find((input): input is vscode.TabInputTextDiff => input instanceof vscode.TabInputTextDiff && input.modified.scheme === 'worktree-review');
  await eventually(() => Boolean(reviewDiff()), 'Aggregate native diff editor did not open');
  const left = await vscode.workspace.openTextDocument(reviewDiff()!.original);
  const right = await vscode.workspace.openTextDocument(reviewDiff()!.modified);
  assert.equal(left.getText(), 'baseline\n'); assert.equal(right.getText(), 'selected final\n');
  assert.ok((await vscode.workspace.fs.stat(reviewDiff()!.modified)).permissions! & vscode.FilePermission.Readonly);
  await assert.rejects(async () => { await vscode.workspace.fs.writeFile(reviewDiff()!.modified, Buffer.from('not allowed')); }, /只读|permission|read.?only/i);
  assert.ok(document.isDirty);
  // A failed review keeps the previous result available.
  await assert.rejects(navigator.createReview(alpha, ['0'.repeat(40)]), /第一父链|first-parent/);
  assert.equal(navigator.getReview(), review);
  await navigator.selectRequirement('review-b');
  await eventually(() => roots().join() === beta, 'Inactive repositories leaked into native SCM after selection');
  assert.equal(navigator.getActiveRequirement(), 'review-b');
  assert.deepEqual(vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath), [beta]);
  assert.ok(!document.isClosed && document.isDirty, 'Switching must preserve an unsaved editor');
  assert.equal(document.getText(), 'unstaged\nunsaved buffer\n');
  assert.equal(fs.readFileSync(alphaFile.fsPath, 'utf8'), 'unstaged\n');
  assert.equal((await vscode.workspace.openTextDocument(reviewDiff()!.modified)).getText(), 'selected final\n', 'An old aggregate diff must remain readable after switching requirements');

  // Even an explicitly reopened foreign repository must be removed from the selected SCM scope.
  await vscode.commands.executeCommand('git.openRepository', alpha);
  await eventually(() => roots().join() === beta, 'A reopened inactive repository was not filtered');
  await navigator.selectRequirement('review-a');
  await eventually(() => roots().join() === [alpha, web].sort().join(), 'Previously closed repositories did not reopen');
  assert.equal(find(alpha).state.indexChanges.length, 1);
  assert.deepEqual(unstagedPaths(), new Set([path.join(alpha, 'review.txt'), path.join(alpha, '未跟踪 文件.txt')]));
  await assert.rejects(navigator.selectRequirement('missing-requirement'), /不存在|no longer exists/);
  assert.equal(navigator.getActiveRequirement(), 'review-a');
  assert.ok(document.isDirty);

  // Main mode restores the parent folder in Explorer and only its direct repos in native SCM.
  await vscode.commands.executeCommand('requirementWorkspaces.selectMain');
  const mainApi = path.join(fixture, 'api');
  const mainWeb = path.join(fixture, 'web');
  await eventually(() => roots().join() === [mainApi, mainWeb].sort().join(), 'Main workspace did not restore direct repositories');
  assert.deepEqual(vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath), [fixture]);
  assert.ok(navigator.isMainWorkspaceActive());
  assert.equal(navigator.getActiveRequirement(), undefined);
  assert.equal(find(mainApi).state.HEAD?.name, 'gray');
  await find(mainApi).status();
  assert.deepEqual(find(mainApi).state.workingTreeChanges.map(change => change.uri.fsPath), [path.join(mainApi, 'review.txt')]);
  await navigator.refresh();
  assert.ok(navigator.isMainWorkspaceActive(), 'Refresh must recognize the parent workspace selection');
  await vscode.commands.executeCommand('git.openRepository', beta);
  await eventually(() => roots().join() === [mainApi, mainWeb].sort().join(), 'Main SCM leaked a linked worktree');
  assert.ok(!document.isClosed && document.isDirty);
  assert.equal(document.getText(), 'unstaged\nunsaved buffer\n');
  await navigator.selectRequirement('review-b');
  await eventually(() => roots().join() === beta, 'Cannot return from main workspace to a requirement');
  assert.ok(!navigator.isMainWorkspaceActive());
  assert.equal(navigator.getActiveRequirement(), 'review-b');
  assert.ok(document.isDirty);
  const after = repositories.map(snapshot);
  assert.deepEqual(after, before, 'Review operations modified files, staged changes, refs or repository status');
  fs.writeFileSync(path.join(fixture, 'result.json'), JSON.stringify({
    locale: vscode.env.language,
    passed: ['requirement discovery', 'native SCM isolation', 'staged/unstaged/untracked groups', 'native diff against index',
      'unsaved editor preservation', 'reopen filtering', 'round-trip selection', 'invalid selection protection',
      'restore main parent folder and direct-repo Changes', 'main selection survives refresh', 'main/requirement isolation and return',
      'nonadjacent commit aggregate excludes skipped commits', 'native aggregate diff is read-only', 'aggregate diff survives requirement switch',
      'net additions/deletions totals', 'rendered M/U/D badges and deleted filename strikethrough', 'file row click opens native diff',
      'manifest and webview follow VS Code language',
      'repository content/index/refs unchanged'],
  }, null, 2));
}
