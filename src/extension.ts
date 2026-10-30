import { t, configureLocalization } from './i18n';
import * as vscode from 'vscode';
import * as path from 'node:path';
import { scanRequirements, scanRepositories, samePaths, findWorktreeRoot, type Requirement, type RequirementRepository } from './catalog';
import { changedFileCount, type GitApi, type GitExtension, type GitRepository } from './gitApi';
import { ReviewView, type ReviewApi } from './reviewView';
import { repositoryVisibilityResetCommands } from './scmVisibility';

const VIEW = 'requirementWorkspaces.requirements';
const PREFIX = 'requirementWorkspaces';
// NUL cannot occur in a directory name, so it cannot collide with a requirement.
const MAIN = '\0main';
interface WorkspaceGroup extends Requirement { main?: true }
type Node = { kind: 'requirement'; requirement: WorkspaceGroup }
  | { kind: 'repository'; requirement: WorkspaceGroup; repository: RequirementRepository };

export interface NavigatorApi {
  getRequirements(): readonly Requirement[];
  getActiveRequirement(): string | undefined;
  selectRequirement(name: string): Promise<void>;
  selectMainWorkspace(): Promise<void>;
  isMainWorkspaceActive(): boolean;
  refresh(): Promise<void>;
}

class Navigator implements vscode.TreeDataProvider<Node>, vscode.Disposable, NavigatorApi {
  private readonly changes = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changes.event;
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly repositorySubscriptions = new Map<string, vscode.Disposable>();
  private readonly ignoredRepositories = new Set<string>();
  private readonly tree: vscode.TreeView<Node>;
  private readonly statusBar: vscode.StatusBarItem;
  private watchers: vscode.Disposable[] = [];
  private root: string | undefined;
  private requirements: Requirement[] = [];
  private main: WorkspaceGroup | undefined;
  private active: string | undefined;
  private scoped = false;
  private selecting = false;
  private reconciling = false;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private renderTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshQueue: Promise<void> = Promise.resolve();
  private reconcileQueue: Promise<void> = Promise.resolve();

  constructor(private readonly context: vscode.ExtensionContext, private readonly git: GitApi) {
    this.tree = vscode.window.createTreeView(VIEW, { treeDataProvider: this, showCollapseAll: true });
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
    this.statusBar.command = `${PREFIX}.choose`;
    this.subscriptions.push(this.tree, this.statusBar, this.changes);
    for (const repository of git.repositories) this.watchRepository(repository);
    this.subscriptions.push(
      git.onDidOpenRepository(repository => {
        this.watchRepository(repository);
        this.scheduleRender();
        const root = path.resolve(repository.rootUri.fsPath);
        if (this.scoped && !this.selecting && !this.reconciling && !this.ignoredRepositories.has(root)) {
          void this.scheduleReconcile().catch(showError);
        }
      }),
      git.onDidCloseRepository(repository => {
        this.repositorySubscriptions.get(repository.rootUri.fsPath)?.dispose();
        this.repositorySubscriptions.delete(repository.rootUri.fsPath);
        this.scheduleRender();
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        if (!this.selecting) void this.refresh().catch(showError);
      }),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration(`${PREFIX}.root`)) void this.refresh().catch(showError);
      }),
      vscode.window.onDidChangeWindowState(state => {
        if (state.focused) this.scheduleRefresh();
      }),
      vscode.commands.registerCommand(`${PREFIX}.refresh`, () => this.refresh().catch(showError)),
      vscode.commands.registerCommand(`${PREFIX}.chooseRoot`, () => this.chooseRoot().catch(showError)),
      vscode.commands.registerCommand(`${PREFIX}.choose`, () => this.choose().catch(showError)),
      vscode.commands.registerCommand(`${PREFIX}.selectMain`, () => this.selectMainWorkspace().catch(showError)),
      vscode.commands.registerCommand(`${PREFIX}.select`, (node: Node | string) => {
        const name = typeof node === 'string' ? node : node.requirement.name;
        return this.selectRequirement(name).catch(showError);
      }),
    );
  }

  async initialize(): Promise<void> {
    await this.refresh();
  }

  getRequirements(): readonly Requirement[] { return this.requirements; }
  getActiveRequirement(): string | undefined { return this.active === MAIN ? undefined : this.active; }
  isMainWorkspaceActive(): boolean { return this.active === MAIN; }
  selectMainWorkspace(): Promise<void> { return this.selectRequirement(MAIN); }

  private groups(): WorkspaceGroup[] { return this.main ? [this.main, ...this.requirements] : this.requirements; }
  private groupId(group: WorkspaceGroup): string { return group.main ? MAIN : group.name; }
  private workspacePaths(group: WorkspaceGroup): string[] {
    return group.main ? [group.path] : group.repositories.map(repository => repository.path);
  }

  private selectionCommand(group: WorkspaceGroup): vscode.Command {
    return group.main
      ? { command: `${PREFIX}.selectMain`, title: t('Return to Main Workspace') }
      : { command: `${PREFIX}.select`, title: t('View Requirement Changes'), arguments: [group.name] };
  }

  getChildren(node?: Node): Node[] {
    if (!node) return this.groups().map(requirement => ({ kind: 'requirement', requirement }));
    if (node.kind === 'repository') return [];
    return node.requirement.repositories.map(repository => ({ kind: 'repository', requirement: node.requirement, repository }));
  }

  getTreeItem(node: Node): vscode.TreeItem {
    const selected = this.groupId(node.requirement) === this.active;
    if (node.kind === 'requirement') {
      const requirement = node.requirement;
      const item = new vscode.TreeItem(requirement.main ? t('Main Workspace · {0}', requirement.name) : requirement.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.id = requirement.path;
      item.contextValue = requirement.main ? 'mainWorkspace' : 'requirement';
      item.iconPath = new vscode.ThemeIcon(selected ? 'pass-filled' : requirement.main ? 'home' : 'folder-library', selected ? new vscode.ThemeColor('charts.green') : undefined);
      const repositories = requirement.repositories.map(repository => this.loaded(repository.path));
      const count = repositories.reduce((sum, repository) => sum + (repository ? changedFileCount(repository) : 0), 0);
      item.description = `${selected ? t('Current · ') : ''}${t('{0} repositories', requirement.repositories.length)}${selected ? ` · ${t('{0} changed files', count)}` : ''}`;
      item.tooltip = `${requirement.path}\n${requirement.main ? t('Return to the main folder and view changes in its direct child repositories.') : t('Load this requirement’s repositories and review them in native Source Control.')}`;
      item.command = this.selectionCommand(requirement);
      return item;
    }
    const repository = node.repository;
    const loaded = this.loaded(repository.path);
    const item = new vscode.TreeItem(repository.name, vscode.TreeItemCollapsibleState.None);
    item.id = repository.path;
    item.contextValue = 'requirementRepository';
    item.iconPath = new vscode.ThemeIcon('repo');
    const branch = loaded?.state.HEAD?.name ?? repository.branch;
    item.description = `${branch}${loaded && selected ? ` · ${t('{0} changes', changedFileCount(loaded))}` : ''}`;
    item.tooltip = repository.path;
    item.command = this.selectionCommand(node.requirement);
    return item;
  }

  refresh(): Promise<void> {
    this.refreshQueue = this.refreshQueue.catch(() => {}).then(() => this.doRefresh());
    return this.refreshQueue;
  }

  private async doRefresh(): Promise<void> {
    if (this.disposed) return;
    const configured = vscode.workspace.getConfiguration(PREFIX).get<string>('root', '').trim();
    const folders = vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) ?? [];
    const base = vscode.workspace.workspaceFile?.scheme === 'file'
      ? path.dirname(vscode.workspace.workspaceFile.fsPath) : folders[0];
    const selectedRoot = this.context.workspaceState.get<string>('worktreeRoot');
    const root = configured
      ? (path.isAbsolute(configured) ? configured : base ? path.resolve(base, configured) : undefined)
      : selectedRoot ?? await findWorktreeRoot(folders);
    if (root !== this.root) {
      this.root = root;
      this.watchers.forEach(watcher => watcher.dispose());
      this.watchers = [];
      if (root) {
        for (const [directory, pattern] of [[root, '*'], [root, '*/*/.git'], [path.dirname(root), '*'], [path.dirname(root), '*/.git']]) {
          const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(directory, pattern));
          watcher.onDidCreate(() => this.scheduleRefresh());
          watcher.onDidDelete(() => this.scheduleRefresh());
          this.watchers.push(watcher);
        }
      }
    }
    try {
      this.requirements = root ? await scanRequirements(root) : [];
      this.main = root ? {
        main: true, name: path.basename(path.dirname(root)), path: path.dirname(root),
        repositories: await scanRepositories(path.dirname(root)),
      } : undefined;
      this.tree.message = root && !this.requirements.length ? t('No requirement repositories yet. You can view the main workspace.') : undefined;
    } catch (error) {
      this.requirements = [];
      this.main = undefined;
      this.tree.message = t('Cannot read the requirement folder: {0}', String(error));
      this.scoped = false;
      this.active = undefined;
      this.render();
      throw error;
    }
    const match = this.groups().find(group => samePaths(folders, this.workspacePaths(group)));
    const active = match ? this.groupId(match) : undefined;
    if (active !== this.active) this.ignoredRepositories.clear();
    this.active = active;
    // Filter only when workspace folders match a known main or requirement group.
    this.scoped = Boolean(match);
    this.render();
    if (this.scoped) await this.scheduleReconcile();
  }

  private loaded(root: string): GitRepository | undefined {
    return this.git.repositories.find(repository => path.resolve(repository.rootUri.fsPath) === path.resolve(root));
  }

  private watchRepository(repository: GitRepository): void {
    const root = repository.rootUri.fsPath;
    this.repositorySubscriptions.get(root)?.dispose();
    this.repositorySubscriptions.set(root, repository.state.onDidChange(() => this.scheduleRender()));
  }

  private scheduleRender(): void {
    if (this.disposed) return;
    clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => this.render(), 50);
  }

  private render(): void {
    if (this.disposed) return;
    const label = this.active === MAIN ? t('Main Workspace') : this.active;
    this.tree.description = this.selecting ? t('Loading…') : label ?? '';
    this.changes.fire(undefined);
    if (this.root) {
      this.statusBar.text = `$(folder-library) worktree manage: ${label ?? t('Select a requirement')}`;
      this.statusBar.tooltip = t('Switch workspace or requirement; review changes in native Source Control');
      this.statusBar.show();
    } else this.statusBar.hide();
  }

  private scheduleRefresh(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.refresh().catch(showError); }, 250);
  }

  private scheduleReconcile(): Promise<void> {
    this.reconcileQueue = this.reconcileQueue.catch(() => {}).then(() => this.reconcileGit());
    return this.reconcileQueue;
  }

  private async reconcileGit(): Promise<void> {
    const requirement = this.groups().find(group => this.groupId(group) === this.active);
    if (!this.scoped || !requirement || this.disposed) return;
    const wanted = new Set(requirement.repositories.map(repository => path.resolve(repository.path)));
    this.reconciling = true;
    try {
      for (const repository of [...this.git.repositories]) {
        const root = path.resolve(repository.rootUri.fsPath);
        if (!wanted.has(root)) {
          // Remember repositories closed by this filter. VS Code's automatic discovery may
          // reopen them immediately; that event must not start another reconcile cycle.
          this.ignoredRepositories.add(root);
          // Native command: closes only the SCM view; does not change files, index or refs.
          await vscode.commands.executeCommand('git.close', repository.rootUri);
        }
      }
      for (const repository of requirement.repositories) {
        if (!this.loaded(repository.path)) {
          // Explicitly reopen a repository previously closed in the SCM view.
          await vscode.commands.executeCommand('git.openRepository', repository.path);
        }
      }
      const selectionMode = vscode.workspace.getConfiguration('scm.repositories').get<string>('selectionMode', 'multiple');
      for (const command of repositoryVisibilityResetCommands(selectionMode)) {
        await vscode.commands.executeCommand(command);
      }
    } finally {
      this.reconciling = false;
    }
    this.render();
  }

  async selectRequirement(name: string): Promise<void> {
    if (this.selecting) return;
    this.selecting = true;
    this.render();
    try {
      // Revalidate paths just before selection, including folders removed since the last refresh.
      await this.refreshQueue.catch(() => {});
      if (!this.root) throw new Error(t('Select the worktree parent folder first.'));
      const fresh = await scanRequirements(this.root);
      const mainRoot = path.dirname(this.root);
      const main: WorkspaceGroup = {
        main: true, name: path.basename(mainRoot), path: mainRoot, repositories: await scanRepositories(mainRoot),
      };
      const requirement: WorkspaceGroup | undefined = name === MAIN ? main : fresh.find(requirement => requirement.name === name);
      if (!requirement) throw new Error(t('Requirement no longer exists or has no repositories: {0}', name));
      this.requirements = fresh;
      this.main = main;
      this.ignoredRepositories.clear();
      await this.context.workspaceState.update('worktreeRoot', this.root);
      const current = vscode.workspace.workspaceFolders ?? [];
      const target = this.workspacePaths(requirement);
      if (!samePaths(current.map(folder => folder.uri.fsPath), target)) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { listener.dispose(); reject(new Error(t('Workspace folder switch timed out. Refresh and try again.'))); }, 15000);
          const listener = vscode.workspace.onDidChangeWorkspaceFolders(() => {
            const paths = vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) ?? [];
            if (samePaths(paths, target)) {
              clearTimeout(timer); listener.dispose(); resolve();
            }
          });
          const accepted = vscode.workspace.updateWorkspaceFolders(0, current.length,
            ...target.map(directory => ({
              name: requirement.main ? requirement.name : `${requirement.name} / ${path.basename(directory)}`, uri: vscode.Uri.file(directory),
            })));
          if (!accepted) {
            clearTimeout(timer); listener.dispose(); reject(new Error(t('VS Code did not accept the workspace folder update.')));
          }
        });
      }
      this.active = name;
      this.scoped = true;
      await this.scheduleReconcile();
      // Status reads feed the existing native SCM UI, including staged and unstaged resources.
      await Promise.all(requirement.repositories.map(repository => this.loaded(repository.path)?.status()));
      await vscode.commands.executeCommand('workbench.view.scm');
      this.render();
    } finally {
      this.selecting = false;
      this.render();
    }
  }

  private async choose(): Promise<void> {
    await this.refresh();
    const selection = await vscode.window.showQuickPick(this.groups().map(requirement => ({
      label: requirement.main ? t('Main Workspace · {0}', requirement.name) : requirement.name,
      id: this.groupId(requirement),
      description: `${t('{0} repositories', requirement.repositories.length)}${this.groupId(requirement) === this.active ? t(' · Current') : ''}`,
      detail: requirement.path,
    })), { title: t('Select the main workspace or a requirement to review') });
    if (selection) await this.selectRequirement(selection.id);
  }

  private async chooseRoot(): Promise<void> {
    const choice = await vscode.window.showOpenDialog({
      title: t('Select Worktree Parent Folder'), canSelectFiles: false,
      canSelectFolders: true, canSelectMany: false,
      defaultUri: this.root ? vscode.Uri.file(this.root) : undefined,
    });
    if (!choice?.[0]) return;
    const requirements = await scanRequirements(choice[0].fsPath);
    if (!requirements.length) {
      void vscode.window.showInformationMessage(t('No Git repositories found in the requirement/repository folder structure.'));
      return;
    }
    await this.context.workspaceState.update('worktreeRoot', choice[0].fsPath);
    if (vscode.workspace.workspaceFile) {
      await vscode.workspace.getConfiguration(PREFIX).update('root', choice[0].fsPath, vscode.ConfigurationTarget.Workspace);
    }
    await this.refresh();
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    clearTimeout(this.renderTimer);
    this.watchers.forEach(watcher => watcher.dispose());
    this.repositorySubscriptions.forEach(subscription => subscription.dispose());
    this.subscriptions.forEach(subscription => subscription.dispose());
  }
}

function showError(error: unknown): void {
  void vscode.window.showErrorMessage(`worktree manage: ${error instanceof Error ? error.message : String(error)}`);
}

export async function activate(context: vscode.ExtensionContext): Promise<NavigatorApi & ReviewApi> {
  configureLocalization(vscode.env.language, (message, ...args) => vscode.l10n.t(message, ...args));
  const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!extension) throw new Error(t('Enable the built-in VS Code Git extension to continue.'));
  const git = (await extension.activate()).getAPI(1);
  const navigator = new Navigator(context, git);
  const review = new ReviewView(git);
  context.subscriptions.push(navigator, review);
  await navigator.initialize().catch(showError);
  return Object.assign(navigator, {
    createReview: review.createReview.bind(review),
    getReview: review.getReview.bind(review),
    openReviewFile: review.openReviewFile.bind(review),
  } satisfies ReviewApi);
}
