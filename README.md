# QQgfbot

QQ 机器人平台（基于 QQ 开放平台官方 API + NapCat 双通道），带 Web 管理面板与群内 Python/PHP 插件体系。

> 项目在 4.2.59 基线归档到 GitHub。当前版本：**4.2.59**。

## 功能总览

- **QQ 官方 API 机器人** + **NapCat 协议接入**，本地运行
- **Web 管理面板**：机器人管理、部署终端、系统设置（含「更新系统配置」「服务端接收」区块）、插件管理、授权体系
- **群内插件体系**：`.js` / `.py` / `.php` 三类插件，支持上传、在线编辑、热重载；内置「更新系统」「多功能菜单」等插件
- **更新发布链路**：更新包经 `update-config.json`（多源）发布，服务器端 / 面板「服务端接收」/ 群内「更新系统」统一消费

## 目录结构

| 目录 | 说明 |
|------|------|
| `src/` | 后端源码（`server.ts` 入口，`admin/` 面板路由，`api/` bot 接口，`plugin/` 插件引擎） |
| `dist/` | 编译产物（`npm run build`，仓库不跟踪，随更新包发布） |
| `plugins/` | 群内插件（js/py/php）与 `php_helpers.php` 插件运行库 |
| `docs/` | 开发与使用文档（Python 插件开发文档、终端开发与使用文档等） |
| `update-config.json` | 云端更新配置（版本/下载地址/镜像列表/更新内容），**发版时更新** |
| `scripts/` | 部署辅助脚本 |
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

构建产物的 node_modules 为 **GitHub 官方 ubuntu runner（x64）** 下 `npm prune --omit=dev` 的生产依赖，适合 x64 Linux 服务器；
**ARM 服务器**（如树莓派/部分 armbian 盒子）建议在设备本地打包，或拉取源码后自行 `npm ci --omit=dev && npm run build`。

## 更新发布流程（AI / 开发者维护）

1. 修改代码 → `npm run build` → `npm test` 通过 → git push
2. 按需提升 `package.json` version → 同步更新 `update-config.json`：
   - `version`：新版本号
   - `patchUrl` / `fullUrl`：`https://github.com/lzyzyzq/QQgfbot/releases/download/<tag>/qqbot-card-editor-patch-<版本>.zip` 等
   - `mirrors`：GitHub 加速镜像（ghfast/ghproxy 等）+ 8091 备用源，保留同版本 URL
   - `changeLog`：本轮更新内容（每行一条）
3. `git tag v<版本>` 并 push → `release.yml` 自动构建并挂载 zip 到 Release
4. 服务器端/面板即可接收：

### 服务器如何更新（三选一，共用 update-config.json）

- **面板「服务端接收」**：系统设置 → 更新系统配置 → 服务端接收 →「接收补丁包 / 接收全量包」（云端源自动按 主源→加速镜像→备用源 切换）
- **群内「更新系统」插件**：发送「检查更新」→「更新补丁 / 更新全量」（同源切换）
- **终端直更**（任意服务器）：
  ```
  cd /var/www/php && wget -O patch-4.2.59.zip <补丁URL> && unzip -o patch-4.2.59.zip && pm2 restart qqbot
  ```

## 下载加速说明（GitHub 在国内网络环境）

GitHub Release 直连/`raw.githubusercontent.com` 在国内可能慢或不通，更新链路默认按序自动切换：

1. **GitHub Release 主源**：`https://github.com/lzyzyzq/QQgfbot/releases/download/<tag>/<zip>`
2. **GitHub 加速镜像**（`update-config.json` 的 `mirrors` 中列出，可随时增删）：
   - `https://ghfast.top/https://github.com/...`
   - `https://ghproxy.net/https://github.com/...`
3. **8091 备用源**（当前开发预览服务器）

> 公共加速服务（ghfast/ghproxy 等）由第三方提供，域名可能变化或不可用；
> 若全部失效，可在面板「更新配置远程地址」或 `update-config.json` 中自行维护可用镜像。
> 服务器在无法直连 `raw.githubusercontent.com` 时，`update-config.json` 读取也会自动尝试 `raw.gitmirror.com` 与 8091 镜像。

## 授权说明

源码归档仅供自用/授权部署。运行需自行配置 QQ 开放平台凭据、管理面板授权体系与服务器环境（参考 `deploy*.sh`）。
