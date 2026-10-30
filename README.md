# GWM — worktree manage

[English](README.md) | [简体中文](README.zh-CN.md)

Review multiple Git repositories grouped by requirement in VS Code. Choose a requirement in the **worktree manage** tree, then inspect its repositories with VS Code's built-in Source Control and diff editors. Select commits to review their combined net changes in one file list.

## Install v1.0.9

Requires **VS Code 1.100 or later**, Git available on `PATH`, and the built-in **Git** extension enabled. Node.js is only needed to build from source.

1. Download [gwm-1.0.9.vsix](https://github.com/coconutLatte/gwm/raw/refs/tags/v1.0.9/releases/v1.0.9/gwm-1.0.9.vsix).
2. In VS Code, open **Extensions**, click **… → Install from VSIX…**, and select the downloaded file.
3. Run **Developer: Reload Window** from the Command Palette if prompted.

Or install from a terminal:

```sh
code --install-extension ./gwm-1.0.9.vsix --force
```

Packages and SHA-256 checksums are stored under [`releases/v1.0.9/`](releases/v1.0.9/). To verify a downloaded package on macOS, put `SHA256SUMS` beside it and run `shasum -a 256 -c SHA256SUMS`; on Linux use `sha256sum -c SHA256SUMS`.

## 1. Prepare the directory structure

GWM scans exactly **worktree parent folder / requirement / repository**:

```text
workspace/
├── gwm.code-workspace
├── service-api/                  # Original repository
├── web-app/                      # Original repository
└── .worktrees/                   # Select this as the worktree parent folder
    ├── feature-a/                # Requirement
    │   ├── service-api/          # Git worktree or ordinary repository
    │   └── web-app/
    └── feature-b/
        └── service-api/
```

Each requirement can contain a different set of repositories. Linked worktrees (`.git` files) and ordinary repositories (`.git` directories) are supported. Hidden directories, symbolic links and deeper nested repositories are skipped.

**GWM does not create worktrees.** Create or arrange them first. For example, run these commands from the `workspace/` directory to create a requirement with two repositories:

```sh
git -C service-api worktree add -b feature/feature-a ../.worktrees/feature-a/service-api
git -C web-app worktree add -b feature/feature-a ../.worktrees/feature-a/web-app
```

Git creates the target directories at the paths you specify; `.worktrees` is a naming convention. To use an existing branch, omit `-b` and put the branch name after the target path. A branch already checked out in another worktree must be freed before Git can use it here.

## 2. Open a saved VS Code workspace

Copy [`examples/gwm.code-workspace`](examples/gwm.code-workspace) into your own `workspace/` directory, next to `.worktrees/`. Open the copied file through **File → Open Workspace from File…**. Paths in the example are relative to the copied workspace file.

The example configures the worktree parent and limits automatic Git discovery, so unrelated requirements stay out of Source Control:

```json
{
  "folders": [{ "path": "." }],
  "settings": {
    "requirementWorkspaces.root": ".worktrees",
    "git.autoRepositoryDetection": false,
    "git.detectWorktrees": false,
    "git.openRepositoryInParentFolders": "never",
    "scm.alwaysShowRepositories": true,
    "scm.repositories.selectionMode": "multiple"
  }
}
```

If using an existing saved workspace, add these settings to its `settings` object. `requirementWorkspaces.root` accepts an absolute path or a path relative to the `.code-workspace` file.

You can also open the workspace folder directly with `code .`. Put the same Git discovery settings in the repository's `.vscode/settings.json`; automatic worktree discovery remains disabled while GWM opens only the repositories required by the selected main workspace or requirement.

## 3. Select a parent folder and review a requirement

1. Open **Source Control** in the Activity Bar, then expand **worktree manage**.
2. If needed, click the folder button (**Select Worktree Parent Folder**) and choose `.worktrees/` itself. Choose the folder containing all requirements, rather than an individual requirement or repository. Other parent folder names work too.
3. Click **feature-a**. Explorer loads its repositories, and native Source Control shows their staged, unstaged and untracked changes. Expand the requirement to see repository names and branches.
4. Click a file in native **Changes** or **Staged Changes** to open its normal Git diff.
5. Click another requirement to change the visible repository group. Use **Refresh Requirements** if the tree needs updating after directory changes.

When no root is configured or selected, GWM looks for `.worktrees` from the open folders and their ancestors. The root selected through the folder button is remembered for the workspace; a nonempty `requirementWorkspaces.root` setting takes priority.

### Delete a worktree

Right-click a requirement in the **worktree manage** tree and choose **Delete Worktree**. GWM asks for confirmation, switches to the main workspace when needed, removes linked Git worktree metadata, and deletes that requirement directory. Close or save files under the worktree before deleting it; uncommitted changes in the deleted directory are not recoverable.

### Return to the main repositories

Click **Main Workspace · workspace** at the top of the tree, the home button, or run **worktree manage: Return to Main Workspace**. Explorer returns to the folder above the worktree parent; Source Control shows Git repositories directly inside that folder. With the example above, these are `service-api/` and `web-app/`.

Switching requirements changes workspace folders and the visible native Git repositories. Branches stay as they are; it does not run checkout, move changes, save unsaved editors or alter the Git index. Native Source Control's own editing, staging and commit commands remain available if you use them.

## 4. Review selected commits together

1. Expand a requirement and click the compare button next to a repository (**Select Commits for Combined Review**). Alternatively, run that command from the Command Palette and choose a repository.
2. Check the commits you want to review, then press **Enter**. Use **Space** to toggle a commit. The second line shows the date, author and full commit hash, independently of the title above. Search by hash, subject or author. The history button loads 200 earlier commits at a time.
3. Open **Commit Review** under Source Control. It shows the combined **net** additions and deletions, plus the file list. Click a row to open a read-only native diff.

| Marker | Meaning |
| --- | --- |
| `M` | Modified file |
| `U` | Added file |
| `D` | Deleted file; its name is struck through |
| `R` | Renamed file |

Each file has its own line counts. Binary files are labeled and excluded from text line totals. Colors follow the current VS Code theme. **Clear Commit Review** clears the current file list.

### What is included

Only checked commits are included, even when they are nonadjacent. Unchecked commits between them are excluded. Selected changes are applied in history order, starting from the earliest selected commit's parent. Repeated changes to a file are combined, and changes that cancel each other disappear from the net result.

If a selected commit depends on a skipped commit and cannot be applied independently, GWM asks you to include the dependency; it keeps the previous successful review. Uncommitted changes, staged changes and unsaved editor buffers are excluded from this review. Native **Changes** continues to show uncommitted work separately.

The picker follows the current HEAD's **first-parent history**. A merge commit is compared with its first parent, so selecting it includes the changes it brought in. A root commit is compared with an empty tree.

Review data uses a temporary Git object directory and index. It does not create commits, branches or worktrees in the source repository. Existing review diffs remain readable when switching requirements or generating another review during the session. After reloading the window, generate the review again.

## Display language

The UI follows the VS Code display language: **English** and **Simplified Chinese** are included; other languages fall back to English. Run **Configure Display Language**, install the VS Code language pack if needed, and restart as prompted. Repository names, branch names, commit subjects and `M/U/D/R` markers keep their original text.

## Troubleshooting

- **No requirements appear:** choose the parent containing `requirement/repository` directories; check that each repository has a valid `.git` marker. GWM scans only these two levels.
- **Source Control shows other requirements:** use the saved workspace and Git discovery settings above, then select the desired requirement again.
- **The main workspace shows unexpected repositories:** main mode always scans direct child repositories of the folder above the selected parent. Choose a parent whose location matches your intended layout.
- **A combined review fails:** include skipped commits that the selected changes depend on, or review a smaller set of commits.

## Development and packaging

Requires Node.js **22+**, npm and Git. GUI integration tests also require a local VS Code installation.

```sh
npm ci
npm run type-check
npm test
npm run test:integration
REQUIREMENT_TEST_LOCALE=zh-cn npm run test:integration
REQUIREMENT_TEST_LOCALE=de npm run test:integration
npm run package
```

Integration tests use temporary repositories, worktrees and isolated VS Code profiles. They verify native SCM isolation, staged/unstaged changes, unsaved editors, combined diffs, rendered status letters and line counts. `zh-cn` tests Chinese; `de` tests English fallback. Language tests download official VS Code language packs into the isolated test profile. On macOS the test runner detects the standard VS Code installation; otherwise set `VSCODE_EXECUTABLE_PATH` to the editor executable.

The source is split into directory discovery (`catalog.ts`), native SCM navigation (`extension.ts`, `gitApi.ts`), commit aggregation (`commitReview.ts`), review UI and virtual files (`reviewView.ts`, `reviewHtml.ts`), and localization (`i18n.ts`, `package.nls*.json`, `l10n/`). Builds check translation coverage and placeholders.

`package.json` is the version source for packaging; keep its version and `package-lock.json` in sync. `npm run package` builds `releases/v<version>/gwm-<version>.vsix` and `SHA256SUMS` automatically. Commit the source, documentation and matching package, then tag the commit `v<version>`. Generated JavaScript and dependencies are excluded from Git; VSIX packages exclude tests, examples and previous packages. The extension identifier is `Lip9527.requirement-workspaces`. When migrating from the earlier `lip-local.requirement-workspaces` builds, install the new package and uninstall the old extension, then reload the window. Enable only one of them at a time.

See [CHANGELOG.md](CHANGELOG.md) for release notes. This repository currently retains all rights (`UNLICENSED`).

## Marketplace publishing

The package is configured for publisher **Lip9527**. As of October 2026, Visual Studio Marketplace has not yet exposed the trusted-publishing configuration page for repository and workflow policies; Microsoft reports that this backend is still being tested. The workflow therefore supports both the currently available PAT path and the future OIDC path.

After the policy is configured, pushing a matching release tag publishes automatically:

```sh
git tag v1.0.9
git push origin v1.0.9
```

To publish now, create an Azure DevOps PAT with the **Marketplace (Manage)** scope, then store it as the GitHub Actions secret `VSCE_PAT`. No repository variable is needed for this default mode. If no publishing credential is configured, the workflow still runs the checks, builds the VSIX and uploads it as an artifact, but skips the Marketplace upload.

When Microsoft enables trusted publishing for the publisher, configure `coconutLatte/gwm` and `.github/workflows/publish.yml` in Marketplace, create a repository variable `MARKETPLACE_AUTH=oidc`, and the workflow will switch to short-lived GitHub OIDC credentials without changing the publish command.

The workflow runs type checks and tests, packages the version stored in `package.json`, publishes the matching VSIX, and uploads the package as a workflow artifact. The **Publish VS Code Extension** workflow can also be started manually with an existing tag. Marketplace installation updates usually become visible within a few minutes.

Release notes are read from [CHANGELOG.md](CHANGELOG.md). Keep each version’s first section focused on user-visible behavior and include the release date.
