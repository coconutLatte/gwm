# Changelog / 更新日志

## 1.10.1 — 2026-10-30

### Fixed / 修复

- Updated the VS Code extension publisher used by GitHub Actions OIDC publishing.
- 更新 GitHub Actions OIDC 发布使用的 VS Code 扩展发布工具版本。

## 1.10.0 — 2026-10-30

### Changed / 调整

- Test release for GitHub Actions OIDC publishing and GitHub Release automation.
- 用于验证 GitHub Actions OIDC 发布和 GitHub Release 自动发布的测试版本。

## 1.0.9 — 2026-10-30

### Changed / 调整

- Added a second modal confirmation before a worktree is permanently deleted.
- 删除 Worktree 前增加第二次弹窗确认。

## 1.0.8 — 2026-10-30

### Added / 新增

- Added a confirmed **Delete Worktree** action to requirement nodes. It cleans linked Git worktree metadata and removes the selected requirement directory.
- 在需求节点右键菜单中新增带确认的“删除 Worktree”，会清理关联 Git worktree 元数据并删除选中的需求目录。

## 1.0.7 — 2026-10-30

### Fixed / 修复

- Rebuilt the SCM visible repository set through the public workspace configuration API so stale single-repository state is cleared reliably.
- 改用 VS Code 公共工作区配置 API 重建源代码管理的可见仓库集合，可靠清除残留的单仓库状态。

## 1.0.6 — 2026-10-30

### Fixed / 修复

- Restored multiple repository selection when a previous failed reset left VS Code in single-repository mode.
- 修复此前重置失败导致 VS Code 残留单仓库模式、需求下多个仓库无法同时显示的问题。

## 1.0.5 — 2026-10-30

### Fixed / 修复

- Waited for VS Code to apply each SCM selection-mode change before applying the next one, preventing the visible repository set from collapsing to one repository after reload.
- 等待 VS Code 完成每次源代码管理选择模式切换后再执行下一步，避免重载后可见仓库集合被收缩为一个仓库。

## 1.0.4 — 2026-10-30

### Fixed / 修复

- Restored all repositories in the selected requirement to native Source Control when VS Code had a stale multi-repository visibility selection.
- 修复 VS Code 保留过期的多仓库可见性选择时，当前需求的部分仓库未显示在原生源代码管理中的问题。

## 1.0.3 — 2026-10-21

### Fixed / 修复

- Fixed VS Code becoming unresponsive when opening a multi-repository directory with `code .` while linked worktrees were discovered automatically.
- Preserved Source Control isolation without repeatedly closing and reopening the same worktree.

- 修复直接使用 `code .` 打开多仓库目录并启用 worktree 自动发现时，VS Code 卡死或无响应的问题。
- 在保留源代码管理隔离能力的同时，避免反复关闭并重新打开同一个 worktree。

### Improved / 改进

- Coalesced high-frequency Git state and tree updates to reduce UI work in large workspaces.
- Documented direct-folder opening alongside the saved-workspace workflow.

- 合并高频 Git 状态与目录树刷新，降低大型工作区的界面负载。
- 补充直接打开工作区目录的使用说明，同时保留原有 `.code-workspace` 工作流。

## 1.0.2

- Configure the Marketplace publisher as `Lip9527` and update workspace recommendations and integration tests.
- Document the migration from the earlier local publisher and the manual Marketplace upload process.

- Marketplace 发布者设为 `Lip9527`，同步工作区推荐和集成测试。
- 补充旧本地发布者的迁移说明，以及 Marketplace 手动上传流程。

## 1.0.1

- Move commit dates and authors to the second line beside the full commit hash, keeping them visible when commit titles are long.

- 提交日期和作者移到第二行，与完整 commit 号并列，避免被长标题挤出可见区域。

## 1.0.0

First version published to this repository. Earlier local builds (0.x) are consolidated into this release.

- Browse worktrees grouped by requirement, with each requirement containing multiple Git repositories.
- Switch between requirements and the main workspace using VS Code's native Source Control and diff editors.
- Review the combined net changes of selected commits, including nonadjacent selections that exclude skipped commits.
- Show total and per-file added/deleted lines, M/U/D/R status letters and strikethrough deleted filenames.
- Follow the VS Code display language: English and Simplified Chinese, with English fallback.
- Add bilingual documentation, a portable workspace example and versioned VSIX packaging with SHA-256 checksums.

本仓库首次发布版本；此前本地 0.x 版本统一归入此版本。

- 按需求浏览 worktree，每个需求包含多个 Git 仓库。
- 在需求与主工作区之间切换，使用 VS Code 原生源代码管理及 diff 编辑器。
- 汇总勾选提交的净改动，支持不连续选择并排除未勾选的中间提交。
- 展示总计及各文件增删行数、M/U/D/R 状态字母、删除文件名划线。
- 跟随 VS Code 显示语言，支持英文与简体中文，其他语言回退英文。
- 提供中英文文档、通用工作区示例，以及含 SHA-256 校验值的版本化 VSIX 安装包。
