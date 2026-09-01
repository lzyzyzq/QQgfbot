# QQ Bot 管理平台 - 开发文档

## 项目概述

基于 Node.js + TypeScript 的 QQ Bot 管理平台，支持**多机器人接入**、插件系统、权限管理、群管功能和 Web 管理面板。内置 `context.identity` 身份体系，同一用户可在多个机器人下绑定不同 OpenID。

## 技术栈

- **运行时**: Node.js v22
- **语言**: TypeScript (服务端) + JavaScript (插件)
- **数据库**: SQLite (better-sqlite3)
- **Web框架**: Express.js
- **QQ接入**: QQ 开放平台官方 API (webhook 模式)，支持多 App 机器人
- **插件端口**: 本地 API 端口由 `process.env.PORT` 决定（默认 3000），插件内自动适配

## 项目结构

```
/workspace/
├── src/                    # TypeScript 源码
│   ├── server.ts           # 主入口（启动时同步 config → BotRegistry）
│   ├── core/               # 核心模块
│   │   ├── bot.ts          # Bot API 封装
│   │   ├── webhook.ts      # Webhook 接收器（多机器人、记录 bot_id）
│   │   ├── napcat.ts       # 群成员查询（按 bot_id 过滤）
│   │   └── event-bus.ts    # 事件总线
│   ├── admin/              # 管理面板
│   │   ├── middleware.ts   # 认证中间件
│   │   ├── routes/         # 管理路由
│   │   └── web/            # 前端页面
│   ├── api/                # API 端点（bot API / 授权码 / 用户绑定）
│   ├── plugin/             # 插件引擎
│   │   ├── engine.ts       # 插件管理器
│   │   ├── sandbox.ts      # 沙箱执行器
│   │   └── types.ts        # 类型定义（含 PluginIdentity）
│   ├── db/                 # 数据库层
│   └── utils/              # 工具函数
├── plugins/                # 插件文件 (.js)
├── dist/                   # 编译输出
├── data/                   # 运行时数据
│   ├── bot.db              # SQLite 数据库（含 user_mappings/group_members 多机器人表）
│   └── admin.json          # 管理员持久化（面板账号，与 QQ 绑定）
├── docs/                   # 开发文档
│   ├── CQ码参考.md         # CQ码规范
│   ├── go-cqhttp-API参考.md # OneBot API
│   └── README.md           # 本文档
├── external/               # 外部工具
│   └── NapCatQQ/           # NapCatQQ Bot框架
└── web/                    # 旧版 Vue SPA (未使用)
```

## 开发命令

```bash
# 编译 TypeScript
npx tsc

# 启动服务
node dist/server.js

# JS 语法检查
node --check plugins/xxx.js

# 数据库查询
node -e "var db=require('better-sqlite3')('/workspace/data/bot.db'); ..."
```

## 架构设计

### 消息流

```
QQ平台(多机器人) → Webhook(记录 bot_id) → WebhookManager → EventBus → PluginEngine → 插件处理
```

Webhook 收到消息时按 `bot.app_id` 识别机器人，群成员表 `group_members` 按 `bot_id` 维度记录成员，同一 QQ 在不同机器人下拥有各自的 OpenID。

### 事件总线

| 事件 | 说明 |
|------|------|
| `message.group` | 群消息 |
| `message.c2c` | 私聊消息 |
| `message.guild` | 频道消息 |
| `plugin.enabled` | 插件启用 |
| `plugin.disabled` | 插件停用 |
| `plugin.error` | 插件错误 |

### 插件系统

插件为沙箱执行的 JS 文件，导出格式：

```javascript
module.exports = {
  manifest: { id: 'xxx', name: 'xxx', version: '1.0.0' },
  onLoad: function(ctx) { /* 加载时 */ },
  onEnable: function(ctx) { /* 启用时 */ },
  onDisable: function(ctx) { /* 停用时 */ },
  methods: { /* 公开方法 */ }
}
```

### 权限模型

| 角色 | 说明 |
|------|------|
| super (超级主人) | 所有权限 |
| master (小主人) | 管理机器人 |
| member (会员) | 上传插件待审核 |

### 多机器人身份统一（ctx.identity）

平台维护 `user_mappings` 表，支持**一个 QQ 号绑定多个机器人的 OpenID**（每个记录含 `bot_id`）。插件内通过 `ctx.identity` 跨机器人识别同一用户：

| 方法 | 说明 |
|------|------|
| `ctx.identity.getQQ(openid)` | OpenID → 绑定的 QQ 号（无绑定返回 null） |
| `ctx.identity.getOpenids(qq)` | QQ 号 → 所有已绑定 OpenID（含 bot_id） |
| `ctx.identity.isSameUser(openidA, openidB)` | 两个 OpenID 是否属于同一 QQ 用户 |

权限判断（`isSuper`/`isMaster`/`isMember`）内部先经 `isSameUser` 归一化 OpenID，再比对 `config.super_master_id`，实现跨机器人权限一致。详见 `plugins/README.md`。

### 面板授权码登录（OpenID 串联）

机器人私聊发送「登录 / 登录链接 / 获取授权码 / 获取登录信息」时，插件调用后端拼接用户名 + 授权码生成面板登录链接回复用户。流程：

```
私聊命令 → GET /api/bot/panel-info（面板地址）
         → GET /api/bot/auth-codes/login-info?openid=xxx（用户名+授权码）
         → 回复「登录链接：面板地址/登录?username=QQ号&code=授权码」
```

面板授权码登录会按 OpenID→QQ→admin.json 真实用户名校验，登录成功后 OpenID 自动绑定到该管理员账号。

### BotRegistry 与配置同步

`config` 表中 `bot.app_id` / `bot.app_secret` 描述机器人凭据。服务启动时自动读取并写入 `BotRegistry`（新增或更新 + 置为 running），管理面板仪表盘据此展示机器人列表与状态。多个机器人配置时分别注册为不同实例。

## QQ Bot API 内联键盘限制

- 最多 **5 行**
- 每行最多 **5 个按钮**
- 超出限制返回 HTTP 400

## NapCatQQ 集成

NapCatQQ 是一个基于 NTQQ 的 Bot 协议端实现，位于 `external/NapCatQQ/`。

### 与当前项目的关系

- **当前项目**: QQ Bot 管理平台（管理面板 + 插件系统）
- **NapCatQQ**: QQ 连接层（替代心月互联 webhook 的另一种连接方式）

### 部署 NapCatQQ

```bash
cd external/NapCatQQ
pnpm install
pnpm build:shell
pnpm build:framework
pnpm build:webui
```

详见 `external/NapCatQQ/README.md`

## 常见问题

### 插件不响应消息
检查插件 `enabled=1`，数据库: `SELECT id,name,enabled FROM plugins`；确认消息是否命中该机器人的群/私聊，且 `switch.*` 相关功能开关为开。

### 权限不足
检查 `config` 表中 `super_master_id` 设置；确认判断用的 OpenID 已通过 `ctx.identity` 绑定 QQ（跨机器人时 `isSameUser` 归一化）。

### 键盘发送失败 (HTTP 400)
检查行数 ≤ 5，每行按钮数 ≤ 5

### 面板授权码登录失败
授权码需先由超级主人生成；登录时按 OpenID→QQ→admin.json 用户名匹配，未绑定或用户名不符会返回失败。管理员可在「用户管理」页查看/绑定 OpenID。

### 本地 API 端口不匹配
插件内 `callLocalApi` 自动读取 `process.env.PORT`（默认 3000），服务器以 3100 运行时无需改插件。
