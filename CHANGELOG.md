# Changelog / 更新日志

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
