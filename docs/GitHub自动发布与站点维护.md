# GitHub 自动发布与站点维护指南

本文说明 QQgfbot 的**自动发布 / 站点自动更新 / 评论区**怎么运作、怎么设置、需要你提供什么。
一句话：**日常只改代码 + 提交 GitHub；站点（版本列表/补丁列表/插件下载/评论区）和服务器更新源全部自动同步**，无需手动维护网站。

## 一、它怎么"一直自动提交进去 GitHub"

三条自动化流水线（`.github/workflows/`）：

| 工作流 | 触发 | 自动做什么 |
|---|---|---|
| `site.yml`（本站点刷新） | push main / push `v*` tag / Release 发布完成 / 每天 UTC 03:17 / 手动运行 | 运行 `scripts/site-gen.mjs` 重新生成 `releases.json`（全部版本+下载地址）、`releases.html`（版本/补丁列表）、`downloads.html`（补丁/插件下载），**有变化就自动 commit 回 main** → GitHub Pages 自动重建 |
| `release.yml`（发版） | push `v*` tag | 自动构建补丁包/全量包 zip 并挂到对应 GitHub Release |
| `ci.yml`（质量门） | push main / PR | 类型检查 + 编译 + 41 项单元测试 |

> 由 `GITHUB_TOKEN` 自动提交的 commit **不会**再次触发工作流（GitHub 官方防递归），站点数据提交不会造成死循环。

站点四个文件全部在 main 仓库根，GitHub Pages 直接静态发布：
`https://lzyzyzq.github.io/QQgfbot/`（README 首页）、`/releases.html`（版本列表）、`/downloads.html`（补丁/插件下载）、`/update-config.json`（服务器自动更新配置）。

## 二、服务器端"自动测速择优"

改代码后服务器接收更新不再固定顺序，而是对候选源做 HEAD 测速、**哪边快先用哪边**，全部失败才按序兜底：

- 拉取 `update-config.json`（检查更新）与补丁/全量包：唯一源 **AI 服务器 8091**（用户指定；GitHub 仅作代码仓库/Release 发布，机器人不从 GitHub 拉更新）
- `update-config.json` 里 `mirrors` 可自行增删，服务器无需改代码

实现位置：`src/admin/routes/system.ts` 的 `speedRank()` / `headLatency()`；仅改源码后需 `npm run build` 并重启服务生效（面板前端改动免编译）。

## 三、你需要设置/提供的东西（一次性）

### 1. 评论区 Giscus（Giscus 是把你站点评论区存进 GitHub Discussions 的官方推荐方案）

必须**你本人在 GitHub 网页端操作**（需要仓库管理权限）：

1. 打开仓库 **Settings → General → 拉到最底 Features → 勾选 Discussions**（Enable Discussions）。
2. 打开 <https://github.com/apps/giscus> → Install → 选择授权给 `lzyzyzq/QQgfbot`（Install 到该仓库）。
3. 打开 <https://giscus.app>，填入 `lzyzyzq/QQgfbot`，选一个分类（建议 `Announcements`），页脚会生成一段带 `data-repo-id` / `data-category-id` 的代码。
4. 把两个 ID 填进仓库根 `site-config.json` 的 `giscus` 段（`enabled: true` + `repoId` + `categoryId`），提交 push 即可。也可以直接把这串 giscus 代码发给我，我帮你填好。

### 2. Actions 写权限（自动提交必须）

仓库 **Settings → Actions → General → Workflow permissions** 选 **Read and write permissions**（默认只读的话 `site.yml` 无法自动提交）。`release.yml` 上传 Release 资产也依赖该权限，历史发版正常说明通常已放开；若曾关闭则需勾选。

### 3. GitHub Pages 配置确认

仓库 **Settings → Pages → Build and deployment → Source** 选 **Deploy from a branch**、Branch=`main` `/ (root)`（当前已在运行，确认即可，无需改动）。加评论/新页面后无需任何手动操作。

### 4. 推送/发版凭据（当前工作环境已有 git 凭据助手可 push）

- **自动发版**无需额外提供：打 tag 由本环境 `git push origin v4.2.60` 触发，CI 在 GitHub 服务器上构建，不需要你的服务器。
- 若要在**普通服务器上**接收更新，也不需要任何 GitHub 凭据：拉的是公开 Pages/Release。
- 若希望本环境在**推送失败时**能自助重连，提供一个对 `lzyzyzq/QQgfbot` 有写权限的 **GitHub Personal Access Token（Fine-grained，仓库 Contents: read/write）** 也行；不给也照常工作。

## 四、日常发版流程（更新插件 / 更新版本）

1. 改代码 / 改插件 / 改 `broadcast/` → 本环境 `git push` main（自动触发站点刷新 + CI 质量门）。
2. 要发新版本时：
   - 提升 `package.json` 的 `version`（如 `4.2.60`）；
   - 更新根 `update-config.json`：`version`、`patchUrl/fullUrl`（新版本）、`mirrors`（保留同版本 URL 模板）、`changeLog`（每行一条，会自动显示在站点"最新版本更新内容"和服务器"检查更新"）；
   - 小体积插件/文档包（如 `douyin-scraper.zip`）会随 main 入库并直接从 **GitHub Pages** 提供下载；
   - `git tag v4.2.60 && git push origin v4.2.60` → `release.yml` 自动把 patch/full zip 挂到 Release → `site.yml` 自动刷新站点版本列表 → 服务器"检查更新/接收补丁"即可看到新版本并按最快源下载。
3. 不想打正式 tag 时，直接 `workflow_dispatch` 运行 `site.yml` 也能刷新站点列表（例如手动补挂资产后）。

## 五、常见问题

- **站点 404 / 没更新**：确认第 3 步 Pages Source=main/root；推 main 后 GitHub Pages 自动重建约需 1 分钟。
- **`site.yml` 自动提交失败**：确认第 2 步 Actions 为 Read and write。
- **评论区不显示**：仓库未开 Discussions，或 giscus 未 Install 到该仓库，或 `site-config.json` 没填 `repoId/categoryId`。
- **更新源很慢**：服务器在公网把下载源全测一遍即可，可在面板"更新系统配置"留空远程地址使用默认源清单，或自维护 `update.config_url` / `update-config.json`。
