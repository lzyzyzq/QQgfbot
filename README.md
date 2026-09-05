# QQgfbot

QQ 机器人平台（基于 QQ 开放平台官方 API + NapCat 双通道），带 Web 管理面板与群内 Python/PHP 插件体系。

> 说明：站点首页是自动生成的 [index.html](https://lzyzyzq.github.io/QQgfbot/) 更新门户（标题「空空爱追剧」），本文件是项目说明文档，仓库首页展示。
> 项目在 4.2.59 基线归档到 GitHub。当前版本：**4.2.69**。

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
- **GitHub 绑定**（`plugins/GitHub绑定.js`）：群内「绑定GitHub 用户名」把 QQ 绑定到 GitHub 账号（公开 API 校验），供公开流水挂名/昵称展示
- **充值积分系统**（`plugins/充值系统.js`）：群内「我要充值 / 查积分 / 我的订单」，付款后「付款完成 单号」，主人「确认充值 单号」人工放行到账（配合微信/支付宝经营收款码）；积分以 `ctx.storage` 持久化并暴露 add/deduct 方法供其它功能扣费
- **AI 唱歌**（`plugins/AI唱歌.js` + `tools/ai-sing-server/`）：群内「AI唱 歌名」→ 调本地 RVC 换声服务（纯 CPU/ARM 也可跑，20 秒片段约 1-4 分钟）→ 语音条发回；音色模型 `.pth` 放入换声服务 models 目录即用
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

## 更新源说明（8091 唯一）

机器人运行时的**更新配置、补丁包、版本列表、系统广播**统一只从 AI 服务器 8091 拉取：

- 云端配置：`https://8091-6f61dc7363389b7a.monkeycode-ai.online/update-config.json`
- 补丁包：同域名 `qqbot-card-editor-patch-<版本>.zip`
- 版本列表 / 广播：`releases.json`、`broadcast/broadcast.json`（与 update-config 同域名）

GitHub（lzyzyzq.github.io/QQgfbot）仅作**代码仓库与 Release 发布**（人可浏览下载，内容第一时间自动同步），机器人不再从 GitHub 拉取更新。

> 面板「更新配置远程地址」（configUrl）填上述 8091 域名即可；8091 映射工作区根目录，发布流程把最新包写入工作区即同步上线。

## 授权说明

源码归档仅供自用/授权部署。运行需自行配置 QQ 开放平台凭据、管理面板授权体系与服务器环境（参考 `deploy*.sh`）。
