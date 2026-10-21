# GWM — worktree manage

[English](README.md) | [简体中文](README.zh-CN.md)

在 VS Code 中按需求管理多个 Git 仓库的查看范围。通过 **worktree manage** 需求树选择需求，再用 VS Code 内置源代码管理和 diff 编辑器查看各仓库的改动；也可以勾选多个提交，在同一份文件列表里 review 它们合并后的净改动。

## 安装 v1.0.3

需要 **VS Code 1.100 及以上版本**、可通过 `PATH` 调用的 Git，以及已启用的 VS Code 内置 **Git** 扩展。直接安装插件不需要 Node.js；从源码构建时才需要。

1. 下载 [gwm-1.0.3.vsix](https://github.com/coconutLatte/gwm/raw/refs/tags/v1.0.3/releases/v1.0.3/gwm-1.0.3.vsix)。
2. 打开 VS Code 的**扩展**面板，点击 **… → 从 VSIX 安装…**，选择下载的文件。
3. 如有提示，在命令面板执行 **开发人员: 重新加载窗口（Developer: Reload Window）**。

也可以通过终端安装：

```sh
code --install-extension ./gwm-1.0.3.vsix --force
```

安装包与 SHA-256 校验值统一放在 [`releases/v1.0.3/`](releases/v1.0.3/)。需要校验时，将 `SHA256SUMS` 与安装包放在同一目录，macOS 执行 `shasum -a 256 -c SHA256SUMS`，Linux 执行 `sha256sum -c SHA256SUMS`。

## 1. 准备目录结构

插件按固定的 **worktree 父目录 / 需求 / 仓库** 两层结构扫描：

```text
workspace/
├── gwm.code-workspace
├── service-api/                  # 原始仓库
├── web-app/                      # 原始仓库
└── .worktrees/                   # 选择这里作为 worktree 父目录
    ├── feature-a/                # 一个需求
    │   ├── service-api/          # Git worktree 或普通仓库
    │   └── web-app/
    └── feature-b/
        └── service-api/
```

每个需求可以包含不同数量的仓库。支持 `.git` 为文件的关联 worktree，也支持 `.git` 为目录的普通仓库；忽略隐藏目录、符号链接和更深层的嵌套仓库。

**插件不负责创建 worktree**，需要先准备目录。下面以一个需求包含两个仓库为例，从 `workspace/` 目录执行：

```sh
git -C service-api worktree add -b feature/feature-a ../.worktrees/feature-a/service-api
git -C web-app worktree add -b feature/feature-a ../.worktrees/feature-a/web-app
```

Git 会在命令指定的位置创建目录；`.worktrees` 只是约定名称。若使用已有分支，去掉 `-b`，将分支名放在目标路径后面。已有分支若正在其他 worktree 中检出，需要先解除该占用，Git 才能将它用于这里。

## 2. 打开保存好的 VS Code 工作区

将 [`examples/gwm.code-workspace`](examples/gwm.code-workspace) 复制到自己的 `workspace/` 目录，与 `.worktrees/` 放在同一层。通过 **文件 → 从文件打开工作区…** 打开复制后的文件。示例中的相对路径以复制后的工作区文件为基准。

示例同时配置父目录并限制 Git 自动发现范围，避免其他需求的仓库混入源代码管理：

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

已有保存好的工作区时，将这些设置合入它的 `settings` 即可。`requirementWorkspaces.root` 支持绝对路径，也支持相对 `.code-workspace` 文件的路径。

也可以直接在工作区目录执行 `code .`。把相同的 Git 发现设置写入仓库的 `.vscode/settings.json` 后，自动 worktree 发现保持关闭，插件只打开当前主工作区或所选需求需要的仓库。

## 3. 选择父目录并查看需求改动

1. 点击活动栏的**源代码管理**，展开 **worktree manage**。
2. 如需指定目录，点击顶部文件夹按钮 **“选择worktree父目录”**，选择 `.worktrees/` 本身，即包含所有需求的父目录，不要选某个具体需求或仓库。父目录也可以使用其他名称。
3. 点击 **feature-a**。Explorer 载入这个需求的仓库；原生源代码管理显示它们的已暂存、未暂存和未跟踪改动。展开需求节点可查看仓库名与分支。
4. 点击原生 **“更改”** 或 **“暂存的更改”** 中的文件，用常规 Git diff 查看代码。
5. 点击其他需求即可切换仓库查看范围。新增或删除目录后，如列表未及时更新，可点击 **“刷新需求”**。

没有配置或手动选择父目录时，插件会从已打开的目录及其上级查找 `.worktrees`。通过文件夹按钮选择的目录会为当前工作区保存；非空的 `requirementWorkspaces.root` 设置优先级更高。

### 返回主目录下的仓库

点击需求树顶部 **“主工作区 · workspace”**、工具栏的房子按钮，或执行命令 **“worktree manage: 返回主工作区”**。Explorer 会回到 worktree 父目录的上一层；源代码管理显示这一层的直接子仓库。上面的示例中，对应 `service-api/` 和 `web-app/`。

切换需求会替换工作区文件夹并切换原生 Git 的可见仓库。各仓库保留原分支；切换过程不执行 checkout、不搬移改动、不保存未保存的编辑器，也不改变 Git 暂存区。原生源代码管理自身的编辑、暂存和提交功能仍可按需使用。

## 4. 勾选多个提交，查看整体改动

1. 展开需求，在某个仓库右侧点击对比按钮 **“勾选提交并汇总 Review”**；也可以在命令面板执行同名命令，再选择仓库。
2. 勾选要 review 的 commit，按 **Enter** 确认；可用**空格**切换勾选状态。第二行显示日期、作者及完整 commit 号，不受上一行标题长度影响。支持按 hash、标题或作者筛选，顶部历史按钮每次加载更早的 200 个提交。
3. 在源代码管理下的 **“提交汇总 Review”** 查看总增加/删除行数及最终净改动文件。点击文件行，在原生只读 diff 中查看前后差异。

| 标记 | 含义 |
| --- | --- |
| `M` | 修改 |
| `U` | 新增 |
| `D` | 删除，文件名同时划线 |
| `R` | 重命名 |

每个文件也会显示增删行数；二进制文件单独标记，不计入文本行数。颜色跟随当前 VS Code 主题。点击 **“清除提交汇总”** 可清空当前文件列表。

### 汇总范围与计算规则

只汇总勾选的提交。即使选择不连续，中间未勾选的提交也会被排除。汇总从最早勾选提交的父提交开始，按历史顺序应用勾选项；同一文件的多次修改合并展示，相互抵消的改动不会出现在最终净改动中。

如果某个勾选提交依赖被跳过的提交，无法独立应用时会提示补选依赖，并保留上一次成功的汇总。未提交改动、暂存改动和编辑器未保存内容均不参与汇总；原生 **“更改”** 仍独立展示未提交的工作内容。

提交选择器展示当前 HEAD 的**第一父链**。Merge commit 按它与第一父提交的差异计算，因此选择 merge commit 会包含它合入的改动。根提交与空目录树比较。

汇总使用临时 Git 对象目录和暂存区，不在源仓库中创建提交、分支或 worktree。同一次会话中，切换需求或生成新汇总后，已打开的旧汇总 diff 仍可读取；重新加载窗口后需要重新生成汇总。

## 界面语言

插件跟随 VS Code 显示语言，内置**英文和简体中文**，其他语言回退英文。在命令面板执行 **Configure Display Language（配置显示语言）**，按提示安装 VS Code 语言包并重启。仓库名、分支名、commit 标题及 `M/U/D/R` 标记保留原文。

## 常见问题

- **看不到需求：** 选择包含“需求/仓库”结构的父目录，确认每个仓库有有效的 `.git` 标记；插件只扫描这两层。
- **源代码管理混入其他需求：** 使用保存好的工作区及上面的 Git 发现设置，再重新选择目标需求。
- **返回主工作区后仓库不符合预期：** 主工作区固定为所选父目录的上一层，只扫描该层的直接子仓库；请确认父目录在预期位置。
- **汇总失败：** 补选依赖的中间提交，或缩小本次 review 的提交范围。

## 开发与打包

需要 Node.js **22+**、npm 和 Git；运行界面集成测试还需要本机安装 VS Code。

```sh
npm ci
npm run type-check
npm test
npm run test:integration
REQUIREMENT_TEST_LOCALE=zh-cn npm run test:integration
REQUIREMENT_TEST_LOCALE=de npm run test:integration
npm run package
```

集成测试使用临时仓库、worktree 及隔离的 VS Code 用户目录，验证原生 SCM 隔离、暂存/未暂存改动、未保存编辑器、汇总 diff，以及实际界面的状态标记和增删行数。`zh-cn` 验证中文，`de` 验证英文回退；语言测试会在隔离目录下载官方语言包。macOS 默认使用标准安装位置的 VS Code；其他位置或系统通过 `VSCODE_EXECUTABLE_PATH` 指定编辑器可执行文件。

源码按目录发现（`catalog.ts`）、原生 SCM 导航（`extension.ts`、`gitApi.ts`）、提交汇总（`commitReview.ts`）、汇总界面与虚拟文件（`reviewView.ts`、`reviewHtml.ts`）、国际化（`i18n.ts`、`package.nls*.json`、`l10n/`）划分。构建会检查翻译覆盖和参数占位符。

打包版本以 `package.json` 为准，并与 `package-lock.json` 保持同步。`npm run package` 自动生成 `releases/v<版本>/gwm-<版本>.vsix` 和 `SHA256SUMS`。发布时一并提交源码、文档和对应安装包，再为该提交打 `v<版本>` 标签。Git 不跟踪生成的 JavaScript 和依赖目录；安装包排除测试、示例及历史安装包。当前插件标识为 `Lip9527.requirement-workspaces`。从早期 `lip-local.requirement-workspaces` 版本迁移时，安装新包并卸载旧插件，然后重新加载窗口；两者只启用一个。

版本记录见 [CHANGELOG.md](CHANGELOG.md)。仓库当前保留所有权利（`UNLICENSED`）。

## 发布到 Marketplace

安装包已配置发布者 **Lip9527**。截至 2026 年 10 月，Visual Studio Marketplace 尚未向发布者开放用于配置 repository/workflow 的 trusted publishing 页面；微软说明该后端仍在测试。因此工作流同时支持当前可用的 PAT 方式和未来的 OIDC 方式。

策略配置完成后，推送与 `package.json` 版本一致的 release tag 即可自动发布：

```sh
git tag v1.0.3
git push origin v1.0.3
```

当前发布需要创建具有 **Marketplace (Manage)** 权限、可访问 **All accessible organizations** 的 Azure DevOps PAT，并保存为 GitHub Actions secret `VSCE_PAT`。默认方式不需要设置仓库变量。

微软开放 trusted publishing 后，在 Marketplace 中配置仓库 `coconutLatte/gwm` 和工作流 `.github/workflows/publish.yml`，再创建仓库变量 `MARKETPLACE_AUTH=oidc`。工作流会自动改用短期 GitHub OIDC 凭据，无需修改发布命令。

工作流会执行类型检查和测试，打包 `package.json` 对应版本，发布 VSIX，并把安装包上传为 Actions artifact。也可以在 **Publish VS Code Extension** 工作流中手动输入已有 tag 启动。Marketplace 通常会在几分钟内展示新版本。

版本说明从 [CHANGELOG.md](CHANGELOG.md) 读取。每个版本的第一段应聚焦用户可感知的行为变化，并写明发布日期。
