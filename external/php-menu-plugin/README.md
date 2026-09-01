# 分类菜单插件（PHP）v1.0.0

收到 `menu` / `菜单` 指令时，按 **管理 / 娱乐 / 实用** 三类展示已启用指令。

## 打包内容

| 文件 | 说明 |
|------|------|
| `plugin.json` | 插件清单（`entry: Main.php`） |
| `Main.php` | PHP 入口 |
| `README.md` | 本文档 |

## 消息事件输入（四种方式全兼容）

| 方式 | 说明 |
|------|------|
| 环境变量 | `PLUGIN_MSG` / `MSG_CONTENT` / `CONTENT` / `MESSAGE`，事件信息经 `MSG_TYPE`/`GROUP_OPENID`/`USER_OPENID`/`MSG_ID`/`BOT_APPID`；整体事件 JSON 可用 `PLUGIN_EVENT_JSON` |
| Webhook POST | `php://input` 的 JSON 或表单 body（字段兼容 content/message/msg/text 及 group_openid/user_openid/msg_id/bot_appid 等常见命名） |
| stdin 管道 | 平台以子进程执行入口并把消息事件 JSON 写入 stdin |
| CLI 参数 | `--content "菜单" [--type group]` 或 `--event '{"content":"菜单"}'` |

回复：HTTP 模式输出 JSON 响应，CLI/stdin 模式输出 `{ reply, type, content }` JSON（`--text` 输出纯文本便于调试）。

## 指令清单数据源（三级 fallback）

1. **平台插件列表 API**：环境变量 `PLUGIN_PLATFORM_API`（可选 `PLUGIN_API_TOKEN`，Bearer 鉴权）
2. **本机后端 API**：`PLUGIN_LOCAL_API`，默认 `http://127.0.0.1:{PORT}/api/plugins`（兼容 qq-bot-platform 的 `/api/plugins` 数组返回）
3. **内置静态清单**：Main.php 内 `STATIC_PLUGINS`（已结合 qq-bot-platform 现有 16 个插件）

数据源返回的插件若含 `enabled` 字段，默认只展示已启用项（`show_only_enabled`）。含 `category` 字段时直接使用，否则按插件名/命令/描述关键词归类到 管理 / 娱乐 / 实用。

## 配置

优先级：环境变量 > `plugin.json` 的 `config` 字段。

| 环境变量 | plugin.json config | 默认 | 说明 |
|----------|--------------------|------|------|
| `PORT` | `port` | `3000` | 本机后端端口（动态端口，与服务器运行端口一致） |
| `PLUGIN_PLATFORM_API` | `platform_api` | `''` | 平台插件列表 API |
| `PLUGIN_LOCAL_API` | `local_api` | `http://127.0.0.1:{PORT}/api/plugins` | 本机后端 API |
| `PLUGIN_API_TOKEN` | `api_token` | `''` | API Bearer Token |
| - | `triggers` | `["menu","菜单"]` | 触发指令 |
| - | `match_mode` | `exact` | `exact` 精确 / `contains` 包含 |
| - | `categories` | `["管理","娱乐","实用"]` | 分类顺序 |
| - | `show_only_enabled` | `true` | 只展示已启用项 |

## 本地测试

```bash
# CLI 参数
php Main.php --content "菜单" --text

# stdin 管道（事件 JSON）
echo '{"content":"menu","type":"group","group_openid":"g1","user_openid":"u1"}' | php Main.php

# 环境变量
PLUGIN_MSG=菜单 php Main.php

# 帮助
php Main.php --help
```

## 输出示例

```
📌 分类菜单（管理 / 娱乐 / 实用）
━━━━━━━━━━━━━━━━
🔧 管理
  ├ 主菜单 - 开机/关机/全景/主菜单
  ├ 开关机控制 - 开机/关机/获取授权码/登录
  ├ 系统设置 - 功能开关/定时任务
  └ 群管理工具 - 禁言/解禁/踢人/全部解禁
🎮 娱乐
  ├ 娱乐中心 - 笑话/运势/骰子/猜数字
  └ 问候插件 - 入群/退群问候
🛠 实用
  ├ 签到系统 - 签到/积分/个人信息
  ├ 关键词回复 - 关键词自动回复
  └ 实用工具 - 日常小工具
━━━━━━━━━━━━━━━━
📩 发送「主菜单」返回主界面
```
