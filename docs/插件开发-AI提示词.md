# 插件开发 AI 提示词（变量 / 调用全量）

> 用途：把本文件整体粘贴给任意 AI，即可让它按本平台约定生成可上传运行的 JS / PHP / Python 插件。
> 版本基准：框架 1.0.14。配套细节见 `docs/插件API帮助文档.md`、`docs/PHP插件开发文档.md`、`docs/Python插件开发文档.md`。
> 注意：本文件是「给 AI 的规格说明」，不要逐字复制到插件源码里。

## 0. 给 AI 的任务提示词（可直接复制）

```text
你是本 QQ 机器人平台的插件工程师。请阅读我随后粘贴的《插件开发 AI 提示词》，严格按其中的：
1) 插件目录与入口规范；2) 事件 data 字段；3) ctx / BotAPI / 引擎 API；4) PHP python 辅助函数；5) 外显与回复规范，
为我编写一个【语言：JS/PHP/Python】插件，功能是：【在这里描述功能】。
要求：
- 只输出插件源码文件内容（JS 用 module.exports，PHP 用 <?php，Python 用 NDJSON 主循环），不要输出解释。
- 所有回复必须走平台提供的发送能力；不要硬编码端口、机器人 QQ、真实 OpenID。
- 需要后端数据时调用 /api/bot/* 本地接口，不要直连外网 https。
- 若用到回复外显，统一用上下文 linkify/menuLink 或 PHP 外显()，不要手写 mqqapi。
- 生成后给出：文件名、放置路径、触发指令、权限要求、依赖（如 php-curl/php-gd）。
```

---

## 1. 平台与插件机制总览

- 三种语言插件共存，放置后引擎自动扫描注册：
  - **JS**：`plugins/*.js`（`module.exports` 导出插件对象）
  - **PHP**：`plugins/*.php`（排除 `php_helpers.php`）+ 子目录 `plugins/xxx/index.php`
  - **Python**：`plugins/*.py`（单文件）或 `plugins/xxx/xxx.py` + `plugins/xxx/__init__.py`（目录包）
- 助手库：`plugins/php_helpers.php` 会被**自动注入**到每个 PHP 插件源码前，无需 `require`。
- 词库插件：`plugins/词库/*.txt`（lzyqzb TXT 规则），由「娱乐群管」解析，见第 8 节。
- 加载/启停/按群门控：面板「插件管理」可启用、禁用、编辑、热重载；引擎按机器人分配 + 按群 switch 过滤。
- 超时：PHP 单次 8 秒；Python 常驻进程，启动握手 15 秒；JS 无硬超时但应避免阻塞。
- 上传：面板「插件管理 → 添加插件」上传 `.js/.php/.py`（或目录 zip），超级主人上传后自动加载。

### 目录约定

```
plugins/
├── 我的插件.js          # JS 单文件
├── 我的插件.php         # PHP 单文件
├── 我的插件.py          # Python 单文件
├── 我的目录插件/        # Python 目录包
│   ├── __init__.py      # 必须保留
│   └── 我的目录插件.py   # 入口优先「与目录同名.py」→ index.py → __main__.py → 任意 .py
└── 词库/                # lzyqzb TXT 词库
    └── 娱乐群管.txt
```

---

## 2. JS 插件开发

### 2.1 最小结构

```js
module.exports = {
  manifest: {
    id: 'mod-my-plugin',
    name: '我的插件',
    version: '1.0.0',
    description: '一句话描述',
    author: '作者标识'
  },
  onLoad: function (ctx) { /* 可选：加载时 */ },
  onEnable: function (ctx) {
    ctx.eventBus.on('message.group', async function (data) {
      // 处理群消息
    });
  },
  onDisable: function (ctx) { /* 可选 */ },
  onUnload: function (ctx) { /* 可选 */ },
  methods: { /* 供 ctx.engine.callPlugin('我的插件','方法名', ...) 调用 */ }
};
```

> 也支持中间件式写法：`module.exports = function (ctx, next) { ... }`，引擎会自动为标准插件并订阅三类消息事件。

### 2.2 事件总线（`ctx.eventBus.on / off`）

| 事件名 | 触发时机 | data 关键字段 |
|---|---|---|
| `message.group` | 收到群消息 | `id, content, author, groupId, channelId, timestamp, member_openid, botId` |
| `message.c2c` | 收到私聊消息 | `id, content, author, guildId?, timestamp, botId` |
| `message.guild` | 收到频道消息 | `id, content, author, channelId, guildId, timestamp, botId` |
| `group.member.add` | 群成员加入 | `groupId, memberOpenid/member_openid, botId` |
| `group.member.remove` | 群成员离开 | `groupId, memberOpenid/member_openid, botId` |
| `friend.add` | 被加好友 | `openid, botId` |
| `group.add` | 机器人被拉群 | `groupId, botId` |
| `bot.connected` / `bot.disconnected` | 连接状态 | — |
| `plugin.loaded` / `unloaded` / `enabled` / `disabled` / `error` | 插件生命周期 | — |

### 2.3 消息事件 data 全字段

| 字段 | 说明 |
|---|---|
| `data.id` | 消息 ID（可作被动回复 msgId） |
| `data.content` | 消息正文（已去 @） |
| `data.author.id` | 发送者 OpenID |
| `data.author.openid` | 发送者 OpenID（兼容字段） |
| `data.author.member_openid` | 群成员 OpenID |
| `data.author.qqId` | 真实 QQ 号（仅已识别时，5-12 位） |
| `data.author.username` | 发送者昵称 |
| `data.groupId` | 群 OpenID（群消息） |
| `data.channelId` | 频道/子频道 ID |
| `data.guildId` | 频道 ID（频道场景） |
| `data.member_openid` | 群成员 OpenID（群消息顶层） |
| `data.timestamp` | 消息时间戳 |
| `data.botId` | 机器人 AppID |

### 2.4 插件上下文 `ctx`

| 成员 | 说明 |
|---|---|
| `ctx.pluginId` | 当前插件实例 id |
| `ctx.bot` | BotAPI，见 2.6 |
| `ctx.eventBus` | `on / off`（引擎会按插件自动反注册，禁用/重载不再响应） |
| `ctx.logger` | `info / warn / error / debug` |
| `ctx.storage` | `get(key)` / `set(key,val)` / `delete(key)`，按插件隔离，跨消息持久 |
| `ctx.config` | 插件配置对象（面板写入） |
| `ctx.engine` | 引擎 API，见 2.7 |
| `ctx.identity` | 身份映射，见 2.5 |
| `ctx.data` | `data/database` 内文件读写：`readJSON(name,fallback)` / `writeJSON(name,obj)` / `remove(name)` / `readText(name,fallback)` |
| `ctx.link` | 外显工具，见 2.9 |

### 2.5 `ctx.identity`

| 方法 | 说明 |
|---|---|
| `getQQ(openid)` | OpenID → 绑定 QQ 号（无则 null） |
| `getOpenids(qq)` | QQ 号 → 全部 OpenID `[{openid, bot_id}]`（多机器人） |
| `getInfo(openid)` | OpenID → `{openid, qq_number, nickname}` |
| `isSameUser(openidA, openidB)` | 两个 OpenID 是否同一人（按 QQ 对比） |

### 2.6 `ctx.bot`（BotAPI 全量）

消息类：

| 方法 | 说明 |
|---|---|
| `sendMessage(channelId, content, msgId?)` | 发频道/通用消息 |
| `sendImageMessage(channelId, imageUrl, msgId?)` | 发图片消息 |
| `sendPrivateMessage(openid, content, msgId?)` | 发单聊文本 |
| `sendGroupMessage(groupOpenid, content, msgId?)` | 发群文本 |
| `sendKeyboardPrivate(openid, keyboard, msgId?)` | 私聊键盘 |
| `sendKeyboardGroup(groupOpenid, keyboard, msgId?)` | 群键盘 |
| `sendMarkdownPrivate(openid, md, templateId?, params?, msgId?)` | 私聊 Markdown |
| `sendMarkdownGroup(groupOpenid, md, templateId?, params?, msgId?)` | 群 Markdown |
| `sendGroupMarkdownWithImage(groupOpenid, md, imageUrl, msgId?)` | Markdown + 图片（头像卡） |
| `uploadGroupImage(groupOpenid, imageUrl)` | 上传群图片 → file_info |
| `uploadGroupImageBuffer(groupOpenid, buffer, filename?)` | 上传本地图片 buffer |
| `sendGroupImageMessage(groupOpenid, fileInfo, msgId?)` | 发送已上传图片 |
| `uploadGroupVoice(groupOpenid, audioUrl, filename?)` | 上传语音 URL（mp3/wav/ogg/silk） |
| `uploadGroupVoiceBuffer(groupOpenid, buffer, filename?)` | 上传本地语音 buffer |
| `sendGroupVoiceMessage(groupOpenid, fileInfo, msgId?)` | 发语音条（msg_type=7） |
| `textToSpeech(text, voice?)` | 微软 TTS → mp3 Buffer（失败 null） |
| `sendGroupInfoCard(groupOpenid, card, msgId?)` | 群信息卡 |
| `sendGroupDashboard(groupOpenid, msgId?)` | 群数据看板 |
| `sendMenuCard(groupOpenid, menu, msgId?)` | 图片菜单卡片 |

群管类：

| 方法 | 说明 |
|---|---|
| `muteMember(groupOpenid, memberOpenid, durationSecs)` | 禁言成员 |
| `unmuteMember(groupOpenid, memberOpenid)` | 解除禁言 |
| `updateMuteMember(groupOpenid, memberOpenid, durationSecs)` | 更新禁言到期 |
| `getRestrictChatSetting(groupOpenid)` | 查询群级禁言设置 |
| `kickMember(groupOpenid, memberOpenid, addBlacklist?, deleteMsgDays?)` | 踢人 |
| `deleteMessage(groupOpenid, messageId, hideTip?)` | 撤回消息 |
| `muteAll(groupOpenid, enable, durationSecs?)` | 全员禁言/解除 |
| `setAnnouncement(groupOpenid, content)` / `deleteAnnouncement(groupOpenid, id)` | 群公告 |
| `getAnnouncements(groupOpenid)` | 群公告列表 |
| `getJoinRequests(groupOpenid)` | 入群申请列表 |

群/成员信息类：

| 方法 | 说明 |
|---|---|
| `getGroupInfo(groupOpenid)` | 群基础信息（群名/头像/成员数/简介等），无权限 null |
| `getGroupBotState(groupOpenid)` | 机器人角色/接收设置 |
| `getGroupMembers(groupOpenid)` | 群成员数组（含 openid/昵称），失败空数组 |
| `getStatus()` | 机器人状态字符串 |

频道管理（频道 v1）：

| 方法 | 说明 |
|---|---|
| `getGuilds()` / `getGuildDetail(guildId)` | 频道列表 / 详情 |
| `getChannels(guildId)` / `getChannelDetail(channelId)` / `getChannelMembers(channelId)` | 子频道 |
| `deleteChannelMessage(channelId, messageId)` | 撤回频道消息 |
| `setChannelUserPermission(channelId, userId, bit, add)` | 修改子频道权限 |
| `getChannelMessages(channelId, pageSize?)` | 子频道消息列表 |
| `createChannel(guildId, {name,type?,parent_id?})` / `modifyChannel(channelId,{name})` / `deleteChannel(channelId)` | 增改删子频道 |
| `getGuildMembers(guildId, limit?, after?)` / `removeGuildMember(guildId, userId)` / `muteGuildMember(guildId, userId, seconds)` | 频道成员 |
| `createChannelAnnounce(channelId, messageId)` / `deleteChannelAnnounce(channelId, messageId|'all')` | 子频道公告 |
| `getGuildAnnounces(guildId)` / `createGuildAnnounce(guildId, channelId, messageId, announceType?)` / `deleteGuildAnnounce(guildId, messageId|'all')` | 频道全局公告 |
| `getGuildMember(guildId, userId)` / `getGuildRoles(guildId)` / `createGuildRole(guildId,name)` / `updateGuildRole(guildId,roleId,name)` / `deleteGuildRole(guildId,roleId)` / `createGuildRoleMember(guildId,roleId,userId)` / `deleteGuildRoleMember(guildId,roleId,userId)` | 成员 / 身份组 |
| `getThreads(channelId, pageSize?)` / `getThreadDetail(channelId, threadId)` / `postThread(channelId,title,content,format?)` / `deleteThread(channelId, threadId)` | 论坛帖子 |

菜单/面板（服务端 v2）：

| 方法 | 说明 |
|---|---|
| `getGlobalMenu()` / `setGlobalMenu(payload)` | 全局自定义菜单 |
| `getPanels()` / `createPanel(payload)` / `getPanelDetail(panelId)` / `updatePanel(panelId,payload)` / `deletePanel(panelId)` / `updatePanelTarget(panelId,payload)` | 指令面板 |

> 兼容别名（中间件插件可用）：`getGuildChannels/getChannel/getChannelById/createGuildChannel/postChannel/patchChannel/updateChannel/removeChannel/deleteGuildChannel/retractChannelMessage/announceChannel/createChannelAnnouncement/announceGuild/createGuildAnnouncement/kickGuildMember/getMembers/getAnnounces`。

### 2.7 `ctx.engine`（PluginEngineAPI 全量）

| 方法 | 说明 |
|---|---|
| `callPlugin(name, method, ...args)` | 跨插件调用方法 |
| `findPluginByName(name)` | 名称 → 插件 id |
| `getPluginStorage(target, key)` | 跨插件读 storage |
| `enable(id)` / `disable(id)` / `reload(id)` | 启停/重载插件 |
| `enableAllExcept(id)` / `disableAllExcept(id)` / `isAllOthersEnabled(id)` / `isAllOthersDisabled(id)` | 批量开关 |
| `getPluginConfig(id)` / `setPluginConfig(id, key, value)` | 插件配置读写 |
| `getGlobalMode()` / `setGlobalMode(mode)` | 全局模式 `text / button / text_link / image` |
| `getLinkMode()` / `setLinkMode(mode)` | 全局外显开关 `on / off` |
| `menuLink(label, item)` / `linkify(text, cmd)` | 生成外显链接 |
| `getPanelBaseUrl()` / `buildClickUrl(groupOpenid, userOpenid, action)` | 面板地址 / 点击落地页 |
| `getBotName()` / `getBotNameById(botId)` | 机器人昵称 |
| `getGroupName(gid)` / `getGroupNumber(gid)` | 群名 / 数字群号 |
| `getConfigValue(key)` / `setConfigValue(key, value)` | 全局 config 读写 |
| `getVariable(name)` / `setVariable(name, value)` / `listVariables()` | 全局用户自定义变量 |
| `listAssignedPlugins(botId)` | 该机器人已分配插件 |
| `setPluginGroupMode(pluginId, groupId, mode)` / `getPluginGroupMode(pluginId, groupId)` | 插件按群门控 `allow / deny / null` |
| `getGroupMemberRole(groupId, memberOpenid)` | 成员角色 `owner/admin/member/user` |
| `findGroupOwner(groupId)` | 群主 `{openid, qq_id, nickname, role}` |
| `getUserProfile(openid, limit?)` | 用户聚合资料 |
| `getGroupProfile(groupId, limit?)` | 群聚合资料 |
| `bindUserQQ(openid, qq, nickname?, botId?, groupId?)` / `unbindUser(openid, groupId?)` | OpenID↔QQ 绑定 |
| `bindGroupNumber(groupOpenid, groupNumber, name?, botId?, memberCount?)` / `unbindGroupNumber(groupOpenid, groupNumber?)` | 群号绑定 |
| `getGroupMemberAvatar(groupId, openid)` | 群成员头像 URL |
| `resolveOpenidByQq(qq)` / `getGroupMemberOpenidByNickname(groupId, nickname)` | 反查 OpenID |
| `renderCard(pluginName?, data?, opts?)` / `sendCard(pluginName?, data?, opts?)` | 统一渲染/发送卡片 |
| `renderMenu(pluginName?, page?, data?)` / `renderBlocks(config, data?)` | 渲染 markdown |

### 2.8 ReplySpec 可视化回复模板

可在插件源码内嵌，供后台「回复编辑器」可视化改写：

```js
/*__REPLY_SPEC_BEGIN__*/
var REPLY_SPEC = {
  name: "我的插件",
  version: "1.0.0",
  desc: "用途说明",
  branches: [
    {
      key: "help",
      label: "帮助文本",
      scope: ["group"],
      triggers: ["帮助", "菜单"],
      lines: [
        { "t": "text", "v": "你好，{nick}！" },
        { "t": "blank" },
        { "t": "row", "k": "qq", "pre": "你的QQ：", "fb": "未绑定", "hide": true },
        { "t": "link", "label": "点我签到", "cmd": "签到", "pre": "• " }
      ]
    }
  ]
};
/*__REPLY_SPEC_END__*/
```

行类型 `ReplyLine.t`：

| t | 字段 | 说明 |
|---|---|---|
| `text` | `v` | 静态整行（支持 `{key}` 插值） |
| `val` | `k`, `fb` | 取数据键 `k`，空则用回退 `fb` |
| `row` | `k`, `pre`, `post`, `fb`, `hide` | 同行动态，`hide` 时空值整行隐藏 |
| `link` | `label`, `cmd`, `pre` | 外显链接，点击回填 `cmd` 指令 |
| `blank` | — | 空行 |

配置存储键：`plugin.<pluginId>.reply`（如 `plugin.file-我的插件.reply`）。

### 2.9 外显链接（mqqapi）

- 仅显式标记才外显，不扫描普通文本。
- 推荐用 API，不要手写：

```js
var t = ctx.link.linkify('点我签到', '签到');       // 受全局外显开关控制
var m = ctx.link.menuLink('菜单', { value: '菜单' }); // 始终链接式
ctx.engine.getLinkMode();  // on / off
```

- 原始格式（仅供理解）：`[文字](mqqapi://aio/%69nlinecmd?command=<urlencode(指令)>&enter=false&reply=false)`。

---

## 3. PHP 插件开发

### 3.1 运行协议

- 每条消息经由 **stdin** 传入 JSON，插件 **stdout** 输出 `{"replies":[...]}` 或 `{"reply":{...}}`。
- 8 秒超时；`stderr` 仅记日志；必须输出合法 JSON，异常不要 `die` 到 stdout。
- 桥自动注入 `php_helpers.php`，直接调用函数即可。

### 3.2 输入事件字段（stdin JSON）

| 字段 | 说明 |
|---|---|
| `action` | 固定 `message` |
| `type` | `group` / `c2c` / `guild` |
| `content` | 消息文本 |
| `groupId` | 群 OpenID |
| `channelId` | 频道/子频道 ID |
| `userId` | 发送者 OpenID |
| `msgId` | 消息 ID |
| `botId` / `botName` | 机器人 AppID / 名称 |
| `author` | `{openid, username, ...}` |
| `panelBase` | 管理面板地址 |

### 3.3 输出回复项类型

| type | 关键字段 | 说明 |
|---|---|---|
| `text`（默认） | `content` | 普通文本 |
| `markdown` | `content` | Markdown（可点击链接） |
| `image` | `imageUrl`（或 `content`）、`fileName` | URL / base64 data URI |
| `voice` | `voiceUrl`、`fileName` | 语音 URL |
| `video` | `content` | 以文本链接下发 |
| `button` | `rows`（二维数组）、`content` | 按钮键盘 |
| `infocard` | `title`, `content`, `url` | 信息卡片 |
| `dashboard` | — | 群数据看板 |
| `menu` | `content`（菜单对象） | 图片菜单 |
| `recall` | `messageId` | 撤回 |

### 3.4 回复构造与发送

| 函数 | 说明 |
|---|---|
| `回复文本($content)` | `{type:'text',content}` |
| `回复图片($url, $fileName='')` | `{type:'image',...}` |
| `回复语音($url, $fileName='')` | `{type:'voice',...}` |
| `回复按钮($rows, $content=' ')` | `{type:'button',...}` |
| `回复文卡($title, $content, $url='')` | `{type:'infocard',...}` |
| `文字($content)` / `send_text` | 立即发送文本（追加到 `$__PHP_REPLIES`） |
| `图片($url, $caption='', $fileName='')` / `send_image` | 立即发送图片 |
| `按钮($rows, $content=' ')` | 立即发送按钮 |
| `文卡($title, $content, $url='')` | 立即发送文卡 |
| `Markdown($content)` / `send_markdown` | 发送 Markdown |
| `外显($label, $cmd)` / `inline_link` | 生成 mqqapi 外显链接 |

### 3.5 数据读写（`data/database`，自动加 `.json`，防目录穿越）

| 函数 | 说明 |
|---|---|
| `读($name, $key=null, $default=null)` / `read_data` | 读 JSON |
| `写($name, $key=null, $data=null)` / `write_data` | 写 JSON |
| `删($name)` | 删除数据文件 |
| `__php_data_dir()` | 数据目录 |

### 3.6 HTTP 与工具

| 函数 | 说明 |
|---|---|
| `curl($url,$method='GET',$data=null,$timeout=8)` | 通用请求（数组自动 JSON；响应 JSON 自动解码） |
| `http_get($url,$timeout=8)` / `http_post($url,$data,$timeout=8)` | 快捷方式 |
| `二维码($text,$size=300)` / `qrcode` | 二维码图片 URL |
| `域名大写($domain)` / `upper_domain` | 域名转大写 |
| `markdown转html($md)` / `md_to_html` | Markdown → HTML |
| `邮箱验证($email)` / `is_email` | 邮箱校验 |
| `html转图($html,$width=800)` / `html_to_image` | HTML → 图片 URL（需渲染服务） |
| `当前时间($fmt='Y-m-d H:i:s')` / `now` | 北京时间 |
| `随机数($min=0,$max=100)` | 随机整数 |
| `前缀($str,$prefix)` / `str_starts` | 前缀判断 |

### 3.7 后端 API 桥（本地接口）

| 函数 | 说明 |
|---|---|
| `群信息API($gid)` / `group_info_api` | 群信息 |
| `群成员API($gid, $limit=50, $after='')` / `group_members_api` | 群成员 |
| `群详情API($gid)` / `group_detail_api` | 群详情 |
| `群统计API($gid)` / `group_stats_api` | 群统计 |
| `群排行API($limit=5)` / `groups_ranking_api` | 群排行 |
| `群列表API()` / `groups_api` | 群列表 |
| `是否超主($openid)` / `is_master` | 超级主人判定 |
| `群内授权($gid,$m)` / `group_auth` | 群内授权 |
| `是否群管理($gid,$m)` / `is_group_admin` | 群管理判定 |
| `终端授权($gid,$m)` / `terminal_allowed` | 终端授权 |
| `执行终端命令($cmd,$timeout=55)` / `exec_terminal` | 执行终端命令 |
| `截断终端输出($lines,$maxChars=3800,$keepTail=30)` / `truncate_terminal` | 截断终端输出 |
| `下载文件($url,$dst,$timeout=30,&$err=null)` / `download_file` | 下载文件 |
| `抓取文本($url)` | 抓取网页文本 |
| `版本比较($a,$b)` / `compare_versions` | 版本比较 |
| `更新根目录()` / `update_root` | 更新根目录 |
| `更新数据目录()` | 更新数据目录 |
| `延迟重启机器人($秒=3)` / `restart_bot_delayed` | 延迟重启 |
| `更新记录($op='读取',$item=null,$idx=-1)` / `update_records` | 更新记录 |
| `当前版本()` / `current_version` / `记录当前版本($v)` / `record_current_version` | 版本信息 |
| `更新配置()` / `update_config` | 读写更新配置 |
| `更新菜单图片($data)` / `render_update_card` | 更新菜单卡 |
| `绘制群统计卡片(...)` / `draw_group_stats_card` | 群统计长图 |

> 桥地址/机器人 id：`__php_bridge_url()` / `__php_bridge_bot_id()` / `__php_bridge_get($path,$query)` / `__php_bridge_post($path,$data)`。

### 3.8 Canvas 画布类（需 `php-gd`）

```php
$c = new Canvas(640, 360, '#1a1a2e');      // 宽高、背景色
$c->rect(40, 40, 560, 280, '#16213e', true); // x,y,w,h,color,填充
$c->rect(40, 40, 560, 280, '#e94560');       // 描边矩形
$c->line(40, 160, 600, 160, '#e94560', 2);   // 线段
$c->circle(320, 160, 60, '#0f3460', true);   // 圆形
$c->text(200, 150, 'Hello', 28, '#ffffff');  // 文本（自动找中文字体）
$b64 = $c->base64();                          // data URI，可直接回复图片
$c->save('example_canvas');                   // 保存 PNG 到 data/database
```

### 3.9 PHP 最小模板

```php
<?php
$in = json_decode(stream_get_contents(STDIN), true);
if (!$in) { exit(0); }
$content = trim((string)($in['content'] ?? ''));
if ($content === '') { exit(0); }

$replies = array();
if ($content === '测试') {
  $replies[] = 回复文本('你说了：' . $content);
}
echo json_encode(array('replies' => $replies), JSON_UNESCAPED_UNICODE);
```

---

## 4. Python 插件开发

### 4.1 运行协议（NDJSON 行协议，常驻进程）

Node 以 `python3 <入口.py>` 子进程运行，按行 JSON 通信：

```
Node → Python: {"op":"ping"} / {"op":"enable"} / {"op":"disable"} / {"op":"event","data":{...}} / {"op":"result","id":..,"data":..}
Python → Node: {"op":"pong"} / {"op":"reply","data":{...}} / {"op":"call","id":..,"method":"..","args":[...]} / {"op":"log","text":".."}
```

- 必须响应 `ping` → `pong`，否则 15 秒判超时卸载。
- 模板已实现主循环，一般只写 `on_message` / `on_enable` / `on_disable`。
- `call` 同步阻塞等待 `result`，出错抛 `RuntimeError`。

### 4.2 回复与调用

```python
def reply(data, text):
    t = data.get('type')
    target = data.get('groupId') or data.get('channelId') or ''
    _write({'op': 'reply', 'data': {'type': t, 'target': target, 'openid': target, 'text': text, 'botId': data.get('botId')}})

def call(method, *args):
    seq = call._seq; call._seq += 1
    _write({'op': 'call', 'id': seq, 'method': method, 'args': list(args)})
    while True:
        line = sys.stdin.readline()
        if not line: return None
        m = json.loads(line)
        if m.get('op') == 'result' and m.get('id') == seq:
            if m.get('error'): raise RuntimeError(m['error'])
            return m.get('data')
call._seq = 1
```

- 纯文本用 `reply`；Markdown / 图片 / 语音 / 群管用 `call`。
- 二进制（Buffer）无法过 JSON 桥：图片/语音请传 URL。

### 4.3 常用 BotAPI（`call`）

`sendGroupMessage(gid,text)`、`sendMarkdownGroup(gid,md)`、`sendGroupImageMessage(gid,file_info)`、`uploadGroupImage(gid,url)`、`sendGroupVoiceMessage(gid,file_info)`、`uploadGroupVoice(gid,url)`、`muteMember(gid,openid,sec)`、`unmuteMember`、`muteAll(gid,enable)`、`getRestrictChatSetting(gid)`、`setAnnouncement(gid,text)`、`kickMember(gid,openid)`、`deleteMessage(gid,msgId)`、`getGroupMembers(gid)`、`sendPrivateMessage(openid,text)`、`sendMessage(channelId,text)`；频道/身份组/帖子/面板/菜单等见 `src/plugin/types.ts`。返回值为 dict，可 `.get('id')`。

### 4.4 引擎扩展（extras，`call`）

| 方法 | 作用 |
|---|---|
| `listGroups()` | 全部群 OpenID 数组 |
| `openidByQq('12345678')` | QQ → OpenID |
| `nicknameToOpenid(gid, '昵称')` | 群内按昵称查 OpenID |
| `isSuper(openid)` | 是否超级主人 |
| `getVariable('变量名')` | 读全局变量 |
| `getMenuConfig(appid)` | 读本插件卡片/菜单布局 |
| `broadcastList()` / `broadcastSend(taskId, target?, groupId?)` | 云端广播任务 |

### 4.5 消息事件 data

```python
{
  "type": "message.group",   # message.group / message.c2c / message.guild
  "content": "消息内容",
  "groupId": "群OpenID",
  "channelId": "频道/子频道ID",
  "author": {"openid": "...", "member_openid": "...", "username": "..."},
  "id": "消息ID",
  "timestamp": "...",
  "botId": "机器人AppID"
}
```

### 4.6 Python 模板

见 `plugins/python-plugin-template.zip`（面板「添加插件」可下载）与 `plugins/测试.py`；目录包需保留 `__init__.py`。

---

## 5. 本地后端 HTTP API 汇总（插件内调用）

- 全部 **local-only**（仅 127.0.0.1 / ::1），端口取 `process.env.PORT`（默认 3000）。
- 沙箱不支持 https 直连，外网数据统一走后端代理。
- 通用请求封装见 `docs/插件API帮助文档.md` 顶部 `callLocalApi`。

| 分节 | 代表接口 |
|---|---|
| 定时任务/开关 | `GET/POST /api/bot/switches`、`/api/bot/schedule-tasks`（GET/POST/PUT/DELETE、`/toggle`） |
| 系统信息 | `GET /api/bot/version`、`/changelog`、`/uptime`、`/groups` |
| 天气 | `GET /api/bot/weather?city=武汉` |
| 用户/绑定 | `GET /api/bot/userinfo`、`POST /api/bot/bind-qq`、`/api/bot/auth-codes/openid-by-qq`、`/openids-by-qq`、`/mappings`、`/bind-openid`、`/unbind-openid` |
| 授权码 | `/api/bot/auth-codes`（GET/POST/PUT/DELETE、`/verify`）、`/login-info`、`/panel-info` |
| 面板登录 | `GET/POST /api/bot/panel-login` |
| 群本地接口 | `GET /api/groups`、`/api/groups/:id/members`、`PUT /:id/name`、`POST /:id/mute`、`/unmute`、`/kick` |
| 时间偏移 | `GET /api/time-offset` |

完整字段与示例见 `docs/插件API帮助文档.md`（507 行）。

---

## 6. 权限与身份

- 超级主人：`ctx.engine` / PHP `是否超主()` / Python `call('isSuper', openid)`。
- 群主/管理：`ctx.engine.getGroupMemberRole(gid, openid)` → `owner/admin/member/user`；PHP `是否群管理()`。
- 群内授权：PHP `群内授权($gid,$m)`；终端授权：PHP `终端授权($gid,$m)`。
- OpenID → QQ：`ctx.identity.getQQ()`、PHP `group_info_api` 返回 `qq_number`、Python `call('openidByQq', qq)`。
- 不要硬编码任何真实 OpenID / QQ / 机器人 id。

---

## 7. 外显与回复规范（全局）

- 外显仅由显式标记触发：词库 `【显示文字】` / `【显示文字=>指令】`；代码用 `linkify` / `menuLink` / `外显()`。
- 链接格式：`[label](mqqapi://aio/%69nlinecmd?command=<urlencode(指令)>&enter=false&reply=false)`（`enter=false` 不自动发送，`reply=false` 不引用）。
- 菜单文字与链接放在同一条消息；纯文本回复不会渲染 mqqapi，需外显时用 Markdown 或平台 linkify。
- @用户用真实 `@昵称`（取不到回退 openid）。
- 重复语义：同机器人同群多次同内容才去重；复读插件需正常复读。
- 被动回复超限（`40034128`）由框架自动去 `msg_id` 主动重发，插件无需处理。

---

## 8. lzyqzb 词库变量（`plugins/词库/*.txt`）

规则格式：`规则 <正则>`、`触发 <指令>`。可用变量：

| 变量 | 说明 |
|---|---|
| `消息` / `完整消息` | 消息正文 |
| `昵称` | 发送者昵称 |
| `QQ` | 发送者 OpenID |
| `群号` | 群 OpenID |
| `频道ID` / `消息ID` | 频道 / 消息 id |
| `使用次数` / `访问次数` | 本群累计使用次数 |
| `指令次数` / `当前指令次数` | 当前指令在本群已用次数 |
| `全局次数` | 所有群累计次数 |
| `当前指令` | 当前命中规则名 |
| `日期` / `时间` / `完整时间` | 时间变量 |
| `括号1` / `参数1` | `(.*)` 第 1 个捕获参数 |

多词库由 `.dic_active` 指定；数据目录默认 `plugins/词库`。

---

## 9. 上传与调试流程

1. 按目标语言准备好单文件/目录包。
2. 面板「插件管理 → 添加插件」上传，超级主人自动加载；或放入 `plugins/` 后重载。
3. 面板可在线编辑源码并热重载；语法错误会在插件列表显示错误信息与日志。
4. 用真实群/私聊发送触发指令验证；日志看「运行日志」。
5. 需要可视化回复时，用面板「回复编辑器」编辑 ReplySpec；需要卡片布局时用「插件卡片·后台编辑器」。

---

## 10. 限制与注意事项

- iOS 上的 QQ 好友媒体消息在手机端点击可能显示「暂不支持的消息」，建议引导到手机QQ/电脑查看。
- Python `call` 同步阻塞期间无法处理后续消息，长任务请拆分；主循环必须回 `pong`。
- PHP 8 秒超时，长任务应拆分为后台接口调用。
- `ctx.storage` 仅存字符串；结构化数据用 `ctx.data.writeJSON` / PHP `读/写`。
- 不要直接写 `data/database` 之外路径；不要硬编码端口、机器人 QQ、真实 OpenID。
- 插件被禁用/重载时，`ctx.eventBus` 监听器由引擎自动反注册，勿自建常驻全局副作用。
