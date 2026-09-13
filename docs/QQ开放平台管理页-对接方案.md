# QQ 开放平台管理页 对接方案

> 参考站点：`https://v1-bot.18years.ink/open-platform.html`
> 目标：在本项目后台面板中新增类似的「QQ 开放平台」管理页，支持扫码或手动填写开发者登录态，统一管理机器人基础信息、成员、Ark 模板、域名报备、IP 白名单、事件订阅、Webhook、沙箱、可用范围、密钥/Token、官方语料与高级接口。
> 状态：分析完成，待落地实现。

## 1. 参考实现分析

### 1.1 交互模型

1. 选择机器人（下拉框，来自该站点的 `/api/bots`）。
2. 开发者登录态（三选一）：
   - 扫码登录（手机 QQ 扫码，轮询确认）；
   - 手动填写 `uin`（QQ 号）/ `developerId`（`quid`）/ `ticket`（`qticket`）；
   - 粘贴整段 q.qq.com Cookie，前端正则解析出上述三项。
3. 登录态保存在浏览器 `localStorage`，键 `op_session`。
4. 选择机器人 + 完成登录后，按标签页加载数据。
5. 写操作（改配置）需要再扫一次码二次确认，返回 `qrcode` 票据后随请求提交。

### 1.2 页面标签与功能

| 标签 | data-tab | 功能 | 主要动作 |
|---|---|---|---|
| 基础信息 | `info` | 机器人基础资料 | 专用接口 `info` |
| 成员列表 | `members` | 开发者团队成员 | 专用接口 `members` |
| Ark 模板 | `tpl` | 消息模板增删查 | 专用接口 `msg-tpl`、`msg-tpl/delete` |
| 域名报备 | `ark` | Ark/域名报备 URL 管理 | `ark_url.query`、`ark_url.check`、`ark_url.modify` |
| IP 白名单 | `ips` | 回调/接口 IP 白名单 | `white_ip.query`、`white_ip.update` |
| 事件订阅 | `event` | 订阅的事件类型 | `event.list`、`event.modify` |
| 回调 Webhook | `webhook` | 回调地址与 Webhook | `callback.query`、`callback.modify`、`callback.get_webhook`、`callback.set_webhook`、`callback.check_webhook`、`callback.check_icp`、`callback.webhook_whitelist` |
| 沙箱管理 | `sandbox` | 沙箱场景与名单 | `sandbox.query`、`sandbox.add`、`sandbox.del`、`sandbox.get_creator_uin` |
| 可用范围 | `scope` | 群/频道可用范围与模式 | `scope.mode.query`、`scope.mode.switch`、`scope.query`、`scope.add`、`scope.del` |
| 群/频道 | `groups` | 已授权群与频道清单 | `group.list`、`guild.list` |
| 密钥/Token | `token` | AccessToken/AppSecret 重置 | `access_token_ttl.query`、`dev_info.query`、专用 `reset-credentials` |
| 官方语料 | `corpus` | 官方语料库查询 | `corpus.status`、`corpus.list`、`corpus.search` |
| 高级接口 | `advanced` | 其余 CGI 动作 | `/api/open-platform/cgi-actions` 动态列出 |

### 1.3 参考站点自建后端接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/open-platform/qrcode/create` | 创建二维码，body `{type:'login'|'auth', app_id?, uin?, developerId?, ticket?}` |
| POST | `/api/open-platform/qrcode/check` | 轮询/确认扫码，body `{qrcode, uin?, developerId?, ticket?}` |
| GET | `/api/open-platform/cgi-actions` | 列出全部可用 CGI 动作 |
| GET | `/api/bots/:id/open-platform/info` | 基础信息（query 带登录态） |
| GET | `/api/bots/:id/open-platform/members` | 成员列表（含 `app_type`） |
| GET | `/api/bots/:id/open-platform/msg-tpl` | Ark 模板列表（`start`/`limit`） |
| POST | `/api/bots/:id/open-platform/msg-tpl/delete` | 删除模板（`tplid`、`qrcode`） |
| POST | `/api/bots/:id/open-platform/cgi` | 通用 CGI，body `{action, params, uin, developerId, ticket}` |
| POST | `/api/bots/:id/open-platform/reset-credentials` | 重置 AppSecret/AccessToken |

### 1.4 登录态字段与来源

| 字段 | 来源 | 说明 |
|---|---|---|
| `uin` | Cookie `quin` / `uin` | 开发者 QQ 号 |
| `developerId` | Cookie `quid` | 开发者 ID |
| `ticket` | Cookie `qticket` | 登录票据 |
| `qrcode` | 写操作扫码返回 | 高危操作票据，随 CGI 参数提交 |

### 1.5 登录态来源模式（本项目实现，四选一，均支持）

`openPlatform.config.login.mode` 决定开放平台页如何取得开发者登录态：

| mode | 含义 | 交互 | 是否需要上游端点 |
|---|---|---|---|
| `manual` | 手动填写（默认） | 粘贴 q.qq.com 控制台 Cookie 或三要素 | 否（仅业务动作需要） |
| `panel` | 复用面板已有 QQ 登录 | 「一键登录 / NapCat 扫码」确认 QQ 号后自动预填 `uin`，再补 `developerId`/`ticket` | 否 |
| `custom` | 自建扫码适配器 | 指向用户此前做好的 q.qq.com 扫码实现 | 是（`login.create` / `login.check`） |
| `builtin` | 内置 q.qq.com 扫码 | 直接用配置的 q.qq.com 官方扫码端点 | 是（`login.create` / `login.check`） |

字段映射（应对上游返回结构差异）：

- `login.qrcodeMap`：`{ url, token, status, done }`，点路径读取二维码地址、轮询票据、状态与完成标志。
- `login.sessionMap`：`{ uin, developerId, ticket }`，把上游确认结果归一化为会话三要素。
- 未配置 `login.create/check` 时回退到 `endpoints['qrcode.create'/'qrcode.check']`。

新增辅助接口（面板 `admin_token` 鉴权，非超级主人也仅能读自己的信息）：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/open-platform/login-config` | 返回当前 `login.mode` 与说明（不含敏感值） |
| GET | `/api/open-platform/session/panel-qq` | 返回当前面板账号绑定的 QQ 号 / OpenID，供预填 `uin` |

## 2. 关键技术判断

- 上述功能**不属于官方开放平台 OpenAPI**（`bot.q.qq.com/wiki` 只覆盖消息收发、群管等），而是 `q.qq.com` 开发者控制台内部接口。
- 参考站点是自建后端对这些内部接口做了封装；其 `/api/open-platform/cgi-actions` 需登录，无法直接复用。
- 因此本项目实现必须引入**上游适配器层**：把「动作名」映射到「上游 HTTP 请求」，端点与参数映射可配置、可随官方改动单独调整，业务路由与页面保持稳定。
- 安全约束：开发者登录态属于高敏凭据，必须服务端存储并脱敏回显，禁止写入日志与前端可读位置。

## 3. 本项目架构设计

### 3.1 分层

```
页面 open-platform.html
   │  fetch /api/open-platform/*  (面板 admin_token 鉴权)
   ▼
路由 src/admin/routes/open-platform.ts
   │  会话读写、参数校验、审计日志、按机器人鉴权
   ▼
适配器 src/core/open-platform.ts
   │  action -> 上游请求（baseUrl + endpoint 映射 + session + qrcode）
   ▼
上游 QQ 开放平台控制台接口
```

### 3.2 上游适配器配置

存于全局 config，键 `openPlatform.config`，JSON：

```json
{
  "baseUrl": "https://q.qq.com",
  "endpoints": {
    "ark_url.query":          { "method": "GET",  "path": "/cgi/...", "query": ["qrcode"] },
    "ark_url.check":          { "method": "POST", "path": "/cgi/..." },
    "white_ip.query":         { "method": "GET",  "path": "/cgi/...", "query": ["qrcode"] },
    "event.list":             { "method": "GET",  "path": "/cgi/...", "query": ["qrcode"] },
    "callback.query":         { "method": "GET",  "path": "/cgi/...", "query": ["qrcode"] }
  },
  "sessionHeaders": { "Cookie": "quin={uin}; quid={developerId}; qticket={ticket}" },
  "login": {
    "mode": "custom",
    "create": { "method": "POST", "path": "/api/qr/create" },
    "check":  { "method": "POST", "path": "/api/qr/check" },
    "qrcodeMap":  { "url": "data.qr_url", "token": "data.qr_id", "status": "data.state", "done": "data.scanned" },
    "sessionMap": { "uin": "data.pass.uin", "developerId": "data.pass.quid", "ticket": "data.pass.qticket" }
  }
}
```

- `endpoints` 未配置的动作，适配器返回 `{ ok:false, code:'NOT_CONFIGURED', error:'上游接口未配置：<action>', hint:'…' }`，页面在弹窗内给出明确提示与「改用手动填写 / 去配置上游」入口。
- 认证方式通过 `sessionHeaders` 模板注入，兼容 Cookie 或 Header 两种上游形态。
- 扫码端点优先取 `login.create` / `login.check`，缺省回退 `endpoints['qrcode.create'/'qrcode.check']`。
- `login.qrcodeMap` / `login.sessionMap` 用点路径适配任意上游返回结构，无需改代码。

### 3.3 会话存储

- 路由 `POST /api/open-platform/session` 保存 `{uin, developerId, ticket}` 到全局 config `openPlatform.session`。
- `GET /api/open-platform/session` 仅返回脱敏值（如 `uin` 保留前 3 后 2，`ticket` 返回 `***`）。
- `DELETE /api/open-platform/session` 清除。
- 仅超级主人或机器人归属者可读写。

### 3.4 页面接入

- 新增独立页 `src/admin/web/open-platform.html`（复用 `menu-editor.html` 的独立页模式，避免改动体积庞大的 `index.html`）。
- 在 `index.html` 侧边栏新增入口：`插件卡片 · 后台编辑器` 同级的「QQ 开放平台」，`window.open('/open-platform.html','_blank')`。
- 页面复用面板 `admin_token`（cookie 或 localStorage）调用 `/api/open-platform/*`。

## 4. 动作与页面映射（全量）

| 页面标签 | 动作 | 写操作需扫码 |
|---|---|---|
| 基础信息 | `info`（专用接口） | 否 |
| 成员列表 | `members`（专用接口） | 否 |
| Ark 模板 | `msg-tpl` / `msg-tpl/delete` | 删除需 |
| 域名报备 | `ark_url.query` / `ark_url.check` / `ark_url.modify` | 修改需 |
| IP 白名单 | `white_ip.query` / `white_ip.update` | 更新需 |
| 事件订阅 | `event.list` / `event.modify` | 修改需 |
| 回调 Webhook | `callback.query` / `callback.modify` / `callback.get_webhook` / `callback.set_webhook` / `callback.check_webhook` / `callback.check_icp` / `callback.webhook_whitelist` | 修改/设置需 |
| 沙箱管理 | `sandbox.query` / `sandbox.add` / `sandbox.del` / `sandbox.get_creator_uin` | 增删需 |
| 可用范围 | `scope.mode.query` / `scope.mode.switch` / `scope.query` / `scope.add` / `scope.del` | 切换/增删需 |
| 群/频道 | `group.list` / `guild.list` | 否 |
| 密钥/Token | `access_token_ttl.query` / `dev_info.query` / `reset-credentials` | 重置需 |
| 官方语料 | `corpus.status` / `corpus.list` / `corpus.search` | 否 |
| 高级接口 | 动态 `cgi-actions` | 视动作 |

## 5. 分阶段实施计划

| 阶段 | 内容 | 交付物 |
|---|---|---|
| P1 | 会话（扫码/手动）、上游适配器、基础信息、成员列表 | `open-platform.ts`、`routes/open-platform.ts`、`open-platform.html` 骨架 |
| P2 | 全部只读标签页（Ark/IP/事件/回调/沙箱/范围/群/Token/语料/高级） | 页面读能力 + 动作按钮 |
| P3 | 写操作 + 二维码二次确认 | 扫码票据流 |
| P4 | 上游端点映射补齐与联调 | `openPlatform.config` 实测配置 |

## 6. 安全与风控

- 登录态服务端存储、脱敏回显、不写日志、不返回给前端明文。
- 所有写操作走二维码二次确认，避免误改。
- 按机器人归属鉴权：非超级主人只能操作自己名下的机器人。
- 审计：每次 CGI 调用记录 `adminUser`、机器人、动作、结果（不记票据）。

## 7. 待确认事项

1. 上游 `q.qq.com` 控制台接口的具体端点与签名方式（决定 `openPlatform.config` 能否填实）。
2. 扫码登录的上游入口：是复用官方登录二维码，还是走控制台内部登录接口。
3. 是否需要支持多机器人分别保存登录态（同一开发者多机器人时）。
