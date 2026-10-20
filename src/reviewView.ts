import { t } from './i18n';
import * as vscode from 'vscode';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CommitReview, listCommits, type ReviewCommit, type ReviewFile } from './commitReview';
import type { GitApi } from './gitApi';
import { reviewHtml } from './reviewHtml';

const VIEW = 'requirementWorkspaces.commitReview';
const SCHEME = 'worktree-review';
interface FileNode { session: string; file: ReviewFile; index: number }
interface Session { review: CommitReview; cache: Map<string, Buffer> }

export interface ReviewApi {
  createReview(repository: string, hashes: readonly string[]): Promise<CommitReview>;
  getReview(): CommitReview | undefined;
  openReviewFile(index: number): Promise<void>;
}

export class ReviewView implements vscode.WebviewViewProvider, vscode.FileSystemProvider, vscode.Disposable, ReviewApi {
  private readonly fileChanges = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.fileChanges.event;
  private view: vscode.WebviewView | undefined;
  private readonly sessions = new Map<string, Session>();
  private current: string | undefined;
  private readonly subscriptions: vscode.Disposable[];
  private busy = false;

  constructor(private readonly git: GitApi) {
    this.subscriptions = [this.fileChanges,
      vscode.window.registerWebviewViewProvider(VIEW, this),
      vscode.workspace.registerFileSystemProvider(SCHEME, this, { isCaseSensitive: true, isReadonly: true }),
      vscode.commands.registerCommand('requirementWorkspaces.reviewCommits', (node?: { repository?: { path: string } }) =>
        this.choose(node?.repository?.path).catch(showError)),
      vscode.commands.registerCommand('requirementWorkspaces.openReviewFile', (node: FileNode) => this.open(node).catch(showError)),
      vscode.commands.registerCommand('requirementWorkspaces.clearReview', () => { this.current = undefined; this.render(); }),
    ];
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    this.subscriptions.push(
      view.onDidDispose(() => { if (this.view === view) this.view = undefined; }),
      view.webview.onDidReceiveMessage((message: unknown) => {
        if (!message || typeof message !== 'object') return;
        const data = message as { type?: string; session?: string; index?: number };
        if (data.type === 'choose') void this.choose().catch(showError);
        if (data.type === 'open' && typeof data.session === 'string' && Number.isSafeInteger(data.index)) {
          const file = this.sessions.get(data.session)?.review.files[data.index!];
          if (file) void this.open({ session: data.session, file, index: data.index! }).catch(showError);
        }
      }),
    );
    this.render();
  }

  getReview(): CommitReview | undefined { return this.current ? this.sessions.get(this.current)?.review : undefined; }

  async createReview(repository: string, hashes: readonly string[]): Promise<CommitReview> {
    if (this.busy) throw new Error(t('A review is being generated. Please wait.'));
    this.busy = true;
    try {
      const review = await vscode.window.withProgress({ location: { viewId: VIEW }, title: t('Combining selected commits…') },
        () => CommitReview.create(repository, hashes));
      const id = randomUUID();
      this.sessions.set(id, { review, cache: new Map() });
      this.current = id;
      this.render();
      await vscode.commands.executeCommand(`${VIEW}.focus`);
      if (!review.files.length) void vscode.window.showInformationMessage(t('The selected commits have no net changes.'));
      return review;
    } finally { this.busy = false; }
  }

  private render(): void {
    if (!this.view) return;
    const review = this.getReview();
    this.view.description = review ? `${path.basename(review.repository)} · +${review.stats.additions} −${review.stats.deletions}` : undefined;
    this.view.webview.html = reviewHtml(review, this.current, randomUUID());
  }

  private uri(node: FileNode, side: 'before' | 'after'): vscode.Uri {
    const name = side === 'before' ? node.file.beforePath : node.file.afterPath;
    return vscode.Uri.from({ scheme: SCHEME, authority: node.session, path: `/${side}/${name}`, query: String(node.index) });
  }

  async openReviewFile(index: number): Promise<void> {
    const file = this.getReview()?.files[index];
    if (!this.current || !file) throw new Error(t('The review file no longer exists.'));
    await this.open({ session: this.current, file, index });
  }

  private async open(node: FileNode): Promise<void> {
    await vscode.commands.executeCommand('vscode.diff', this.uri(node, 'before'), this.uri(node, 'after'),
      t('{0} (Commit Review)', node.file.afterPath), { preview: true });
  }

  private async choose(repository?: string): Promise<void> {
    if (!repository) {
      const choice = await vscode.window.showQuickPick(this.git.repositories.map(repo => ({
        label: path.basename(repo.rootUri.fsPath), description: repo.state.HEAD?.name, detail: repo.rootUri.fsPath,
      })), { title: t('Select a repository to review') });
      if (!choice) return;
      repository = choice.detail;
    }
    const hashes = await this.pickCommits(repository);
    if (!hashes?.length) return;
    await this.createReview(repository, hashes);
  }

  private async pickCommits(repository: string): Promise<string[] | undefined> {
    const initial = await listCommits(repository);
    if (!initial.length) { void vscode.window.showInformationMessage(t('This repository has no commits to review.')); return; }
    interface CommitItem extends vscode.QuickPickItem { commit: ReviewCommit }
    return new Promise(resolve => {
      const picker = vscode.window.createQuickPick<CommitItem>();
      picker.canSelectMany = true;
      picker.matchOnDescription = true;
      picker.matchOnDetail = true;
      picker.ignoreFocusOut = true;
      picker.title = t('{0} · Select commits to review', path.basename(repository));
      picker.placeholder = t('Press Space to select and Enter to review. Shows HEAD’s first-parent history; merges are compared to their first parent.');
      const more: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('history'), tooltip: t('Load 200 earlier commits') };
      picker.buttons = initial.length === 200 ? [more] : [];
      const items = (commits: ReviewCommit[]): CommitItem[] => commits.map(commit => ({
        label: `${commit.hash.slice(0, 8)} ${commit.subject}`,
        description: `${commit.date.slice(0, 10)} · ${commit.author}${commit.parents.length > 1 ? ' · merge' : ''}`,
        detail: commit.hash, commit,
      }));
      picker.items = items(initial);
      const existing = this.getReview();
      if (existing?.repository === repository) picker.selectedItems = picker.items.filter(item => existing.commits.some(commit => commit.hash === item.commit.hash));
      let settled = false;
      const subscriptions = [
        picker.onDidAccept(() => {
          if (!picker.selectedItems.length) { picker.placeholder = t('Select at least one commit, then press Enter.'); return; }
          settled = true;
          resolve(picker.selectedItems.map(item => item.commit.hash));
          picker.hide();
        }),
        picker.onDidHide(() => {
          if (!settled) resolve(undefined);
          subscriptions.forEach(subscription => subscription.dispose()); picker.dispose();
        }),
        picker.onDidTriggerButton(async () => {
          if (picker.busy) return;
          picker.busy = true;
          try {
            const commits = await listCommits(repository, 200, picker.items.length);
            const selected = picker.selectedItems;
            picker.items = [...picker.items, ...items(commits)];
            picker.selectedItems = selected;
            if (commits.length < 200) picker.buttons = [];
          } catch (error) { showError(error); }
          finally { picker.busy = false; }
        }),
      ];
      picker.show();
    });
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const session = this.sessions.get(uri.authority);
    const index = Number(uri.query);
    const side = uri.path.startsWith('/before/') ? 'before' : uri.path.startsWith('/after/') ? 'after' : undefined;
    if (!session || !Number.isSafeInteger(index) || index < 0 || !session.review.files[index] || !side) throw vscode.FileSystemError.FileNotFound(uri);
    const key = `${side}/${index}`;
    let bytes = session.cache.get(key);
    if (!bytes) { bytes = await session.review.readFile(session.review.files[index], side); session.cache.set(key, bytes); }
    return bytes;
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    return { type: vscode.FileType.File, size: (await this.readFile(uri)).byteLength, ctime: 0, mtime: 0, permissions: vscode.FilePermission.Readonly };
  }
  watch(): vscode.Disposable { return new vscode.Disposable(() => {}); }
  readDirectory(): [string, vscode.FileType][] { return []; }
  createDirectory(): never { throw vscode.FileSystemError.NoPermissions(t('Commit Review is read-only.')); }
  writeFile(): never { throw vscode.FileSystemError.NoPermissions(t('Commit Review is read-only.')); }
  delete(): never { throw vscode.FileSystemError.NoPermissions(t('Commit Review is read-only.')); }
  rename(): never { throw vscode.FileSystemError.NoPermissions(t('Commit Review is read-only.')); }

  dispose(): void {
    this.subscriptions.forEach(subscription => subscription.dispose());
    for (const session of this.sessions.values()) void session.review.dispose().catch(() => {});
    this.sessions.clear();
  }
}

function showError(error: unknown): void {
  void vscode.window.showErrorMessage(`worktree manage: ${error instanceof Error ? error.message : String(error)}`);
}
