# QQgfbot

QQ 机器人平台（基于 QQ 开放平台官方 API + NapCat 双通道），带 Web 管理面板与群内 Python/PHP 插件体系。

> 说明：站点首页是自动生成的 [index.html](https://lzyzyzq.github.io/QQgfbot/) 更新门户（标题「空空爱追剧」），本文件是项目说明文档，仓库首页展示。
> 项目在 4.2.59 基线归档到 GitHub。当前版本：**4.2.60**。

## 版本与下载（GitHub Pages 站点，自动刷新）

- [首页更新门户](https://lzyzyzq.github.io/QQgfbot/)：空空爱追剧 · 当前版本 / 更新内容 / 下载导航 / 留言板
- [版本列表 / 补丁列表](https://lzyzyzq.github.io/QQgfbot/releases.html)：每个 Release 版本的补丁包、全量包与加速镜像/备用源一键下载
- [补丁 / 插件下载](https://lzyzyzq.github.io/QQgfbot/downloads.html)：插件与文档包（GitHub Pages 与 8091 双通道）
- 首页与各列表页底部附 Giscus 评论区（评论存 GitHub Discussions，GitHub 登录可见/可评，见 `docs/GitHub自动发布与站点维护.md`）
- 页面由 `scripts/site-gen.mjs` 生成，GitHub Actions（`site.yml`：push main / 发 tag / Release 发布 / 每日定时）自动刷新并提交回 main

## 功能总览

- **QQ 官方 API 机器人** + **NapCat 协议接入**，本地运行
- **Web 管理面板**：机器人管理、部署终端、系统设置（含「更新系统配置」「服务端接收」区块）、插件管理、授权体系
- **群内插件体系**：`.js` / `.py` / `.php` 三类插件，支持上传、在线编辑、热重载；内置「更新系统」「多功能菜单」等插件
- **GitHub 云端广播中心**：`broadcast/broadcast.json` 定义广播任务（文本/图片、全部群/单一群/目标群、固定文本或 API 抓内容、每天时间/间隔定时），面板与群内「云端广播」命令均可查看与执行，`broadcast/README.md` 见任务格式
- **更新发布链路**：更新包经 `update-config.json`（多源）发布，服务器端 / 面板「服务端接收」/ 群内「更新系统」统一消费

## 目录结构

| 目录 | 说明 |
|------|------|
| `src/` | 后端源码（`server.ts` 入口，`admin/` 面板路由，`api/` bot 接口，`plugin/` 插件引擎） |
| `dist/` | 编译产物（`npm run build`，仓库不跟踪，随更新包发布） |
| `plugins/` | 群内插件（js/py/php）与 `php_helpers.php` 插件运行库 |
| `docs/` | 开发与使用文档（Python 插件开发文档、终端开发与使用文档等） |
| `update-config.json` | 云端更新配置（版本/下载地址/镜像列表/更新内容），**发版时更新** |
| `broadcast/` | GitHub 云端广播任务定义（`broadcast.json` 目录 + 单文件任务，面板/群内「云端广播」读取） |
| `releases.json` / `releases.html` / `downloads.html` | GitHub Pages 站点自动生成的版本/补丁/插件列表（勿手改） |
| `site-config.json` | 站点配置（镜像清单、Giscus 评论 ID、插件下载清单） |
| `scripts/` | 部署辅助脚本；`site-gen.mjs` 为站点生成脚本（被 `site.yml` 调用） |
| `deploy*.sh` | 服务器部署脚本（armbian/nginx 等） |

## 本地开发

```bash
npm install        # 安装依赖
npm run dev        # ts-node 开发运行
npm run build      # tsc 编译到 dist/
npm test           # vitest 单元测试
npm start          # node dist/server.js 运行
```

## GitHub Actions（.github/workflows）

| 工作流 | 触发 | 作用 |
|--------|------|------|
| `ci.yml` | push main / PR | 类型检查 + 编译 + 41 项单元测试 |
| `release.yml` | push `v*` tag | 自动构建补丁包与全量包 zip，上传到对应 GitHub Release |
| `manual-build.yml` | 手动触发 | 选择 tag（留空=最新 v*）构建并附加全量包（可选补丁） |
| `site.yml` | push main / `v*` tag / Release 发布 / 每日定时 / 手动 | 自动刷新站点版本/补丁/插件列表并提交回 main（GitHub Pages 实时更新） |

构建产物的 node_modules 为 **GitHub 官方 ubuntu runner（x64）** 下 `npm prune --omit=dev` 的生产依赖，适合 x64 Linux 服务器；
**ARM 服务器**（如树莓派/部分 armbian 盒子）建议在设备本地打包，或拉取源码后自行 `npm ci --omit=dev && npm run build`。

## 更新发布流程（AI / 开发者维护）

1. 修改代码 → `npm run build` → `npm test` 通过 → git push（`site.yml` 自动刷新站点列表）
2. 按需提升 `package.json` version → 同步更新 `update-config.json`：
   - `version`：新版本号
   - `patchUrl` / `fullUrl`：`https://github.com/lzyzyzq/QQgfbot/releases/download/<tag>/qqbot-card-editor-patch-<版本>.zip` 等
   - `mirrors`：GitHub 加速镜像（ghfast/ghproxy 等）+ 8091 备用源 + GitHub Pages 门户，保留同版本 URL
   - `changeLog`：本轮更新内容（每行一条，站点与"检查更新"自动展示）
3. `git tag v<版本>` 并 push → `release.yml` 自动构建挂载 zip → `site.yml` 自动把新版本刷进站点版本列表
4. 服务器端/面板即可接收（会自动对 GitHub Pages / GitHub Release / 加速镜像 / 8091 测速择优下载）：

### 服务器如何更新（三选一，共用 update-config.json）

- **面板「服务端接收」**：系统设置 → 更新系统配置 → 服务端接收 →「接收补丁包 / 接收全量包」（对 GitHub Release / GitHub Pages / 加速镜像 / 8091 自动测速择优下载，失败自动切源）
- **群内「更新系统」插件**：发送「检查更新」→「更新补丁 / 更新全量」（同源切换）
- **终端直更**（任意服务器）：
  ```
  cd /var/www/php && wget -O patch-4.2.60.zip <补丁URL> && unzip -o patch-4.2.60.zip && pm2 restart qqbot
  ```

## 下载加速说明（GitHub Pages / 镜像 / AI 服务器自动择优）

服务器端拉取 `update-config.json`、补丁包、全量包前会先对各候选源 **HEAD 测速**，**哪边快先用哪边**，全部不可用再按序兜底切换：

1. **GitHub Pages 门户**：`https://lzyzyzq.github.io/QQgfbot/update-config.json`（全球 CDN，更新配置/插件直接由 Pages 提供）
2. **GitHub Release 主源**：`https://github.com/lzyzyzq/QQgfbot/releases/download/<tag>/<zip>`
3. **GitHub 加速镜像**（`update-config.json` 的 `mirrors` 中列出，可随时增删）：
   - `https://ghfast.top/https://github.com/...`
   - `https://ghproxy.net/https://github.com/...`
4. **8091 备用源**（AI 开发服务器，与 Release 资产同文件）

> 测速逻辑在 `src/admin/routes/system.ts`（`speedRank`/`headLatency`），对每个源超时 5 秒自动跳过；
> 公共加速服务（ghfast/ghproxy 等）由第三方提供，域名可能变化或不可用；
> 可在面板「更新配置远程地址」或 `update-config.json` 中自行维护可用镜像清单。

## 授权说明

源码归档仅供自用/授权部署。运行需自行配置 QQ 开放平台凭据、管理面板授权体系与服务器环境（参考 `deploy*.sh`）。
