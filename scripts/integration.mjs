import { runTests, resolveCliArgsFromVSCodeExecutablePath } from '@vscode/test-electron';
import { execFileSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:net';
import { checkReviewUi } from './check-review-ui.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const locale = process.env.REQUIREMENT_TEST_LOCALE || 'en';
const executable = process.env.VSCODE_EXECUTABLE_PATH || '/Applications/Visual Studio Code.app/Contents/MacOS/Code';
execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: project, stdio: 'inherit' });
// macOS UNIX socket paths have a small limit; keep the isolated profile path short.
const fixture = fs.realpathSync(fs.mkdtempSync(path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'req-vscode-')));
const languagePack = { 'zh-cn': 'MS-CEINTL.vscode-language-pack-zh-hans', de: 'MS-CEINTL.vscode-language-pack-de' }[locale];
if (languagePack) {
  // VS Code falls back to English unless its own UI language pack is installed.
  // Install it only in the isolated test profile, never in the user's VS Code profile.
  const [cli, ...args] = resolveCliArgsFromVSCodeExecutablePath(executable, { reuseMachineInstall: true });
  execFileSync(cli, [...args, '--user-data-dir', path.join(fixture, 'profile'), '--extensions-dir', path.join(fixture, 'extensions'),
    '--install-extension', languagePack], { stdio: 'inherit' });
  // A CLI install does not populate languagepacks.json. Let the isolated workbench
  // register the pack once; localization is resolved before extension scanning.
  const bootstrap = spawn(executable, ['--user-data-dir', path.join(fixture, 'profile'),
    '--extensions-dir', path.join(fixture, 'extensions'), '--locale', locale,
    '--skip-welcome', '--skip-release-notes', '--disable-updates', '--new-window'], { stdio: 'ignore' });
  const closed = new Promise(resolve => bootstrap.once('exit', resolve));
  try {
    const deadline = Date.now() + 45000;
    while (true) {
      try {
        const packs = JSON.parse(fs.readFileSync(path.join(fixture, 'profile/languagepacks.json'), 'utf8'));
        if (packs[locale]?.translations?.vscode) break;
      } catch {}
      if (bootstrap.exitCode !== null || Date.now() > deadline) throw new Error('VS Code did not register the test language pack.');
      await delay(100);
    }
  } finally {
    bootstrap.kill();
    await closed;
  }
}
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
const repositories = [];
for (const name of ['api', 'web']) {
  const source = path.join(fixture, name);
  fs.mkdirSync(source, { recursive: true });
  git(source, 'init', '-b', 'gray');
  git(source, 'config', 'user.name', 'Review Test');
  git(source, 'config', 'user.email', 'review@example.invalid');
  fs.writeFileSync(path.join(source, 'review.txt'), 'base\n');
  git(source, 'add', '.');
  git(source, 'commit', '-m', 'test fixture');
  repositories.push(source);
  for (const demand of name === 'api' ? ['review-a', 'review-b'] : ['review-a']) {
    const repository = path.join(fixture, '.worktrees', demand, name);
    git(source, 'worktree', 'add', '-b', `feat/${demand}`, repository);
    repositories.push(repository);
  }
}
fs.writeFileSync(path.join(fixture, 'api/review.txt'), 'main workspace change\n');
const alpha = path.join(fixture, '.worktrees/review-a/api');
fs.writeFileSync(path.join(alpha, 'aggregate.txt'), 'baseline\n');
fs.writeFileSync(path.join(alpha, 'deleted.txt'), 'one\ntwo\nthree\n');
git(alpha, 'add', '.'); git(alpha, 'commit', '-m', 'aggregate baseline');
fs.writeFileSync(path.join(alpha, 'aggregate.txt'), 'selected first\n');
fs.writeFileSync(path.join(alpha, 'new.txt'), 'new selected\nsecond\n');
fs.unlinkSync(path.join(alpha, 'deleted.txt'));
git(alpha, 'add', '.'); git(alpha, 'commit', '-m', 'selected first');
const firstReviewCommit = git(alpha, 'rev-parse', 'HEAD');
fs.writeFileSync(path.join(alpha, 'skipped.txt'), 'not selected\n');
git(alpha, 'add', '.'); git(alpha, 'commit', '-m', 'skip this commit');
fs.writeFileSync(path.join(alpha, 'aggregate.txt'), 'selected final\n');
git(alpha, 'add', '.'); git(alpha, 'commit', '-m', 'selected final');
const lastReviewCommit = git(alpha, 'rev-parse', 'HEAD');
fs.writeFileSync(path.join(alpha, 'review.txt'), 'staged\n');
git(alpha, 'add', 'review.txt');
fs.writeFileSync(path.join(alpha, 'review.txt'), 'unstaged\n');
fs.writeFileSync(path.join(alpha, '未跟踪 文件.txt'), 'untracked\n');
const beta = path.join(fixture, '.worktrees/review-b/api');
fs.writeFileSync(path.join(beta, 'review.txt'), 'another requirement\n');
const workspace = path.join(fixture, 'review.code-workspace');
fs.writeFileSync(workspace, JSON.stringify({
  folders: ['api', 'web'].map(name => ({ name: `review-a / ${name}`, path: `.worktrees/review-a/${name}` })),
  settings: {
    'requirementWorkspaces.root': '.worktrees',
    'git.autoRepositoryDetection': false,
    'git.detectWorktrees': false,
    'git.openRepositoryInParentFolders': 'never',
    'git.autofetch': false,
    'scm.alwaysShowRepositories': true,
    'scm.repositories.selectionMode': 'multiple',
    'window.newWindowProfile': 'Default',
  },
}, null, 2));
fs.writeFileSync(path.join(fixture, 'fixture.json'), JSON.stringify({ repositories, reviewHashes: [lastReviewCommit, firstReviewCommit] }));
console.log(`Isolated VS Code test fixture: ${fixture}`);
const port = await new Promise(resolve => {
  const server = createServer();
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
});
const testing = runTests({
  vscodeExecutablePath: executable,
  extensionDevelopmentPath: project,
  extensionTestsPath: path.join(project, 'dist/integration.cjs'),
  extensionTestsEnv: { REQUIREMENT_TEST_FIXTURE: fixture, REQUIREMENT_TEST_LOCALE: locale },
  launchArgs: [workspace, '--user-data-dir', path.join(fixture, 'profile'), '--extensions-dir', path.join(fixture, 'extensions'),
    '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-telemetry', '--disable-updates', `--remote-debugging-port=${port}`, '--locale', locale],
});
await Promise.all([testing, checkReviewUi(port, fixture, locale)]);
console.log(fs.readFileSync(path.join(fixture, 'result.json'), 'utf8'));
