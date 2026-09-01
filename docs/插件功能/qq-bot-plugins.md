# qq-bot-plugins（QQ机器人插件套装）功能说明

> DB 插件ID：`6a562134-e0f3-404b-8b02-031918e63bd0` ｜ 类型：zip ｜ 版本：v4.1.0 ｜ 作者：511742399 ｜ 状态：活跃
> 目录：`plugins/qq-bot-plugins/` ｜ 入口：`index.js`

## 架构总览

```
index.js（主路由）→ 子菜单模块（showMenu）→ 子子菜单模块（handleCommand）
```

主入口只做路由分发，不含子菜单渲染逻辑。`onEnable` 加载 15 个子模块并注册事件监听：
- 消息事件：`message.guild` / `message.c2c`（私聊）/ `message.group`（群聊）→ `handlePower`
- 成员事件：`group.member.add` → `handleMemberJoin`，`group.member.remove` → `handleMemberLeave`
- 后台：`mods.scheduler.start()` 启动定时任务调度器

主菜单 12 个入口（按钮模式 4 行）：`娱乐功能`、`实用功能`、`授权功能` ｜ `系统功能`、`设置功能`、`DIC设置` ｜ `群管系统`、`系统菜单`、`帮助` ｜ `赞助`、`拉我进群`、`作者`。所有子菜单键盘末尾追加「🏠 返回主菜单」。

## 命令路由表（handlePower）

以下命令表只匹配一次，命中即路由：

| 命令表 | 命令 |
|--------|------|
| SUB_MENUS | 娱乐功能/娱乐、实用功能/实用、授权功能/授权、系统功能/系统、设置功能/设置、DIC设置/dic设置、群管系统/群管 |
| ENT_CMDS | 今日运势、掷骰子、猜拳、选择、随机数、今天吃什么、今日人品、仙逆、抽老婆、抽老公、扫雷、敲木鱼、开心农场、去钓鱼、笑话、讲笑话、猜数字 |
| UTIL_CMDS | 每日备注、每日打卡、设置昵称、查询天气、个人信息 |
| AUTH_CMDS | 获取激活码、激活授权码 |
| SYS_TOOL_CMDS | 在线时间、版本、更新日志、查巡 |
| SYS_SETTING_CMDS | 设置定时关机、整点提醒、撤回信息、管理频道、管理频道人员、发布群公告 |
| DIC_CMDS | 开启dic回复、关闭dic回复、写入dic、设置底部广告、模式设置 |
| GROUP_CMDS | 开启群全禁、关闭群全禁、禁言、解禁、踢人 |
| CHECKIN_CMDS | 签到、补签、补签确认、签到排行、积分排行 |

系统菜单命令：`开机`、`关机`、`设置主人`、`主人列表`、`整点报时/报时`、`面板授权码登录`、`全局模式/切换全局模式`、`按钮模式`、`文字模式`

handleAuthCode 路由（授权码与 QQ 绑定 + 用户管理）：`绑定`（私聊）、`绑定QQ [QQ号]`、`用户管理/管理用户/用户列表`、`新增用户`、`修改用户`、`删除用户`、`生成激活码`、`授权码列表`、`删除授权码`、`修改授权码`、`激活授权码/激活码`

定时推送路由：`定时推送`、`定时任务列表/定时列表`、`定时推送 X`、`定时播报`、`定时开关`、`每日早报`、`每日晚报`、`生日提醒`、`间隔推送`、`定时任务`

功能开关路由：`功能开关`、`开关:key`

底部功能：`帮助`、`赞助/赞助广告`、`作者/作者QQ`、`拉我进群`

自动回复兜底（放最后）：`keywords` → `dictionary` → `greeting`

## 超级主人用户管理（走后端 admin.json，与面板同源）

命令不读插件 storage，而是以 `operator=<超级主人OpenID>` 调后端：
- 用户列表：`GET /api/bot/admin-users?operator=`
- 新增用户：`POST /api/bot/admin-users`（body 含 username/qq/openid/nickname/role，角色经 mapRole 映射 super_master|master|member）
- 修改用户：`PUT /api/bot/admin-users/{username}`
- 删除用户：`DELETE /api/bot/admin-users/{username}?operator=`
- 绑定 QQ：`POST /api/bot/bind-qq`（body: openid/qq_number/nickname，任何人绑定一次）
- 激活码：`/api/bot/auth-codes*` 系列（生成/列表/删除/修改/verify），激活成功由 `grantRoleToUser` 写入插件 storage 权限列表

## 数据存储（插件级 ctx.storage）

| Key | 说明 |
|-----|------|
| `super_master_id` | `{id, qqId, added_at}`，仅一个超级主人 |
| `mini_masters` | 小主人数组 `{id, qqId, activated, activated_at}` |
| `members` | 会员数组 |
| `global_mode` | `'button'/'text'` |
| `chime_enabled` | 报时开关（后端 `switch.chime` 存在时以后端为准） |
| `chime_interval` | 报时间隔分钟数（默认 60） |

## 权限控制

| 权限 | 适用命令 |
|------|---------|
| 超级主人（isSuper） | 面板授权码登录、用户管理、新增/修改/删除用户、生成激活码、授权码列表/删除/修改 |
| 主人（isMaster=超主或已激活小主人） | 开机、关机、整点报时、全局模式、设置主人 |
| 任何人 | 绑定QQ、激活授权码（仅限群聊）、主菜单、底部功能、自动回复 |

## 子模块清单

### auth.js — 授权子菜单
- 「授权功能」菜单（🔑获取激活码、🔓激活授权码）；`获取激活码` 引导联系超级主人；`激活授权码 [码]` 仅群聊可用
- 调 `POST /api/bot/auth-codes/verify`，`grantRole` 写插件 storage 权限
- 读 `footer_ad_授权功能`

### checkin.js — 签到 v2.1.0
- 「签到」：同天去重，积分 = `10 + min(连续,30)*2`；「补签」20 积分两段式确认（`补签确认`）；排行占位
- storage：`sign_date_`/`sign_streak_`/`sign_points_`/`sign_pending_user_`（按 userId）

### dic.js — DIC 管理子菜单
- 「DIC设置」菜单；`开启/关闭dic回复`（写 `dic_enabled`）；`写入dic 关键词|回复内容`（上限 500 条）；`设置底部广告`；`模式设置`
- storage：`dic_enabled`、`dic_entries`、`footer_ad_DIC设置`

### dictionary.js — 词典自动回复
- 被兜底链路调用，无命令。从 `dic_entries` 子串匹配回复，受 `dic_enabled` 控制

### entertainment.js — 娱乐中心子菜单
- 13 项娱乐（今日运势/掷骰子 NdM±K/猜拳/选择/随机数/今天吃什么/今日人品/仙逆/抽老婆抽老公/扫雷/敲木鱼/开心农场/去钓鱼/笑话/猜数字）
- 游戏状态存内存 `ctx._guess[userId]`；读 `footer_ad_娱乐功能`

### greeting.js — 问候
- 精确匹配：你好/hello/hi/早上好/晚安/晚上好

### groupadmin.js — 群管子菜单
- 「群管系统」菜单；`开启/关闭群全禁`（`muteAll`）、`禁言 @用户 [分钟]`、`解禁`、`踢人`；全部需 isMaster

### keywords.js — 关键词自动回复
- 从 storage `keywords`（多行 `关键词|回复内容`）子串匹配回复

### permissions.js — 权限共享模块
- 定义 `getSuperId/isSuper/getMinis/getMembers/isMaster`，被其他模块复用

### schedule.js — 定时推送命令层
- 创建/删除/启停后端任务：`定时播报 创建`（报时/天气/早报/晚报/文本）、`定时开关 创建`、`定时任务列表`、`定时任务 删除/启停`、`每日早报/晚报`（改 switches）、`生日提醒`、`间隔推送`
- 数据：`birthday_reminders`、`interval_push`（插件侧）；任务本体走 `/api/bot/schedule-tasks`

### scheduler.js — 定时调度执行层
- 每 15 秒 tick，轮询 `GET /api/bot/schedule-tasks`（30s 缓存）；toggle 任务到点 `POST /api/bot/switches`；broadcast 任务按 contentType 门控（chime/weather_report/morning_report/evening_report/broadcast）+ 固定时间/间隔触发，构建内容（报时/天气/早报晚报/文本）群发
- 外部调用：`/api/bot/schedule-tasks`、`/api/bot/switches`、`/api/bot/groups`、`/api/bot/weather`

### switches.js — 功能开关子菜单
- 「功能开关」拉取开关列表渲染菜单（✅/⏸）；`开关:key` 切换（需 isMaster）；状态走后端 `/api/bot/switches`

### systemsettings.js — 系统设置子菜单
- 「设置功能」菜单；`设置定时关机 [HH:MM|关闭]`、`整点提醒`、`撤回信息`（占位）、`管理频道/频道人员`（占位）、`发布群公告`；全部需 isMaster
- storage：`shutdown_time`、`hourly_remind`

### systemtools.js — 系统工具子菜单
- 「系统功能」菜单；`在线时间`（/api/bot/uptime）、`版本`（/api/bot/version）、`更新日志`（/api/bot/changelog）、`查巡`（敏感词 `bad_words`，添加/删除需主人）

### utility.js — 实用工具子菜单（含个人信息富媒体）
- 「实用功能」菜单（📝每日备注、✅每日打卡、✏️设置昵称、🌤查询天气、👤个人信息）
- 每日备注（`note_{userId}`）、每日打卡（`daily_checkin_`/`checkin_streak_`）、设置昵称（`nickname_{userId}`）
- 查询天气：`GET /api/bot/weather?city=`，失败回退随机模拟
- 个人信息：`GET /api/bot/userinfo?user_openid=&group_openid=`，拼 Markdown（头像/群名/昵称/QQ号/OpenID/权限/授权/打卡/备注），有头像时用 `sendGroupMarkdownWithImage`（富媒体上传 QQ 群文件，`__AVATAR__` 占位替换）；权限判定优先级：插件主人系统 → 面板角色 `panel_role` → 激活码角色 `auth_role`

## 数据存储两轨总结

- **插件级**（ctx.storage）：权限、签到、备注、昵称、词典、敏感词、底部广告、模式等
- **后端级**（`127.0.0.1:3000/api/bot/*`）：admin-users、auth-codes、schedule-tasks、switches、groups、userinfo、weather、uptime、version、changelog、panel-login —— 与网页面板同源、重启不丢失

## 维护提示
- 主路由新增命令时，需同时更新对应命令表（SUB_MENUS/ENT_CMDS/UTIL_CMDS 等）与路由分支。
- 子模块功能文件（utility.js 等）可在插件管理页「文件」直接编辑，保存后自动重载该 zip 插件（见面板 ZIP 插件编辑功能）。
- 修改 index.js 或新增子模块后，通过面板「重启机器人」或 zip 文件保存重载生效。
