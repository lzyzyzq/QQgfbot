# src/ - 后端源码

QQ Bot Platform 服务端核心代码，TypeScript + Node.js。

## 目录结构

```
src/
  api/            REST API 路由（Express）
    auth.ts         认证（登录/密码修改）
    auth-codes.ts   授权码管理
    bot.ts          机器人控制（启动/停止/状态）
    files.ts        文件管理（上传/下载/删除/回收站）
    groups.ts       群组管理（成员列表/禁言/踢出）
    index.ts        全局单例（PluginEngine 注册）
    log.ts          日志查看
    plugin.ts       插件管理（创建/编辑/ZIP上传/WebUI服务）
    time-offset.ts  时间偏移配置

  core/          核心模块
    bot.ts          QQ Bot API 封装（发送消息/群管理/成员）
    event-bus.ts    事件总线（插件监听/派发）
    webhook.ts      Webhook 接收/验证/分发

  db/            数据库层
    index.ts        SQLite 初始化/迁移/config CRUD
    seed.ts         种子数据（示例插件）

  plugin/        插件引擎
    engine.ts       插件生命周期管理（加载/启用/禁用/互调）
    sandbox.ts      插件沙箱（VM 安全执行）
    types.ts        类型定义（Plugin/PluginContext/BotAPI）

  middleware/     中间件
    auth.ts         Bearer Token 认证

  utils/         工具函数
    logger.ts       日志系统
```

## 关键技术决策

- **数据库**: SQLite (better-sqlite3)，WAL 模式
- **插件沙箱**: Node.js `vm` 模块，隔离 `process.env`
- **ZIP 插件**: `import()` 动态加载，无需沙箱
- **群成员**: QQ API 无直接查询接口，通过事件+消息追踪本地 DB
- **消息去重**: 每次发送自动生成唯一 `msg_id`
