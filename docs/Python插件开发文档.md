# Python 插件开发文档

本平台支持用 **Python** 编写机器人插件（`.py` 单文件或目录插件）。Python 插件与 JS 插件一样，能接收群/私聊/频道消息，并调用 QQ 官方开放平台 API（发文字/图片/语音/禁言/公告等）。

本文档基于 4.2.60 版本。官方模板：`plugins/python-plugin-template.zip`（面板「添加插件」页可下载）。

## 1. 插件放置与命名

在 `plugins/` 目录放置 Python 插件，两种形式均可：

| 形式 | 说明 | 例子 |
|------|------|------|
| 单文件 | 直接在 `plugins/` 下放 `xxx.py` | `plugins/测试.py` |
| 目录包 | `plugins/xxx/xxx.py` + `plugins/xxx/__init__.py` | `plugins/测试/测试.py` |

- 引擎启动时自动扫描 `plugins/*.py` 并注册为插件（id 为 `file-测试`，名称显示 `测试.py`）。
- 目录包形式：`__init__.py` 必须保留；入口优先 `与目录同名.py` → `index.py` → `__main__.py` → 任意 `.py`。
- 描述自动取文件头部 `@description 描述` 或首段 `"""` 注释。

## 2. 运行原理（NDJSON 行协议桥）

Node 引擎以子进程方式执行 `python3 <入口.py>`，通过标准输入/输出进行**按行 JSON** 双向通信：

```
Node → Python: {"op":"ping"} / {"op":"enable"} / {"op":"disable"} / {"op":"event","data":{...}} / {"op":"result","id":..,"data":..}
Python → Node: {"op":"pong"} / {"op":"reply","data":{...}} / {"op":"call","id":..,"method":"..","args":[...]} / {"op":"log","text":".."}
```

插件主循环读取 `sys.stdin` 的每一行 JSON，按 `op` 分发。模板自带这套逻辑，一般只需实现 `on_message` / `on_enable` / `on_disable` 三个函数。

## 3. 回复消息：reply(data, text)

```python
def reply(data, text):
    t = data.get('type')
    target = ''
    if t == 'message.group':
        target = data.get('groupId') or data.get('channelId') or ''
    elif t == 'message.guild':
        target = data.get('channelId') or ''
    else:
        author = data.get('author') or {}
        target = author.get('openid') or author.get('id') or data.get('member_openid') or ''
    _write({'op': 'reply', 'data': {'type': t, 'target': target, 'openid': target, 'text': text, 'botId': data.get('botId')}})
```

- 群消息回群、频道消息回频道、私聊回私聊。
- `reply` 由 Node 端经 BotAPI 发送**纯文本**。需要 Markdown / 图片 / 语音时改用 `call`。

## 4. 调用 API：call(method, *args)

```python
call('sendGroupMessage', gid, '内容')          # 发群文字
call('sendMarkdownGroup', gid, '### 标题')      # 发群 Markdown 卡片
call('muteMember', gid, openid, 600)            # 禁言 600 秒
call('sendGroupMessage', gid, text).get('id')   # 返回值可继续用
```

`call` 是**同步等待**的：向 Node 发 `{op:'call'}`，阻塞读 stdin 直到收到 `{op:'result'}` 返回对应 id 的数据；出错会抛 `RuntimeError(error)`。

### 4.1 常用 BotAPI 方法（群聊为主）

| 方法 | 作用 |
|------|------|
| `sendGroupMessage(gid, text)` | 发送群文字消息 |
| `sendMarkdownGroup(gid, markdown)` | 发送群 Markdown 消息 |
| `sendGroupImageMessage(gid, file_info)` | 发送群图片（file_info 来自上传） |
| `uploadGroupImage(gid, imageUrl)` | 上传 URL 图片，返回 `{file_info}` |
| `sendGroupVoiceMessage(gid, file_info)` | 发送群语音条（file_info 来自上传） |
| `uploadGroupVoice(gid, audioUrl)` | 上传 URL 音频（mp3/wav/ogg/silk），返回 `{file_info}` |
| `textToSpeech(text, voice)` | 文字转语音（微软 TTS），返回 Buffer（注意：Buffer 无法经 JSON 传给 Python，请用 URL 形式上传） |
| `muteMember(gid, openid, seconds)` | 群成员禁言 |
| `unmuteMember(gid, openid)` | 解除禁言 |
| `muteAll(gid, enable)` | 全群禁言 / 解除 |
| `getRestrictChatSetting(gid)` | 查询群禁言设置 |
| `setAnnouncement(gid, content)` | 发布群公告 |
| `kickMember(gid, openid)` | 移出群成员 |
| `deleteMessage(gid, messageId)` | 撤回消息 |
| `getGroupMembers(gid)` | 群成员列表 |
| `sendPrivateMessage(openid, text)` | 发私聊消息 |
| `sendMessage(channelId, text)` | 发频道消息 |
| 频道管理/身份组/帖子/面板/菜单等 | 见 `src/plugin/types.ts` 的 `BotAPI` 全量方法注释 |

### 4.2 引擎扩展能力（extras）

除 BotAPI 外，Python 插件还可调用以下**引擎能力**（同样走 `call`）：

| 方法 | 作用 |
|------|------|
| `call('listGroups')` | 返回全部已收录群的 OpenID 数组（groups 表） |
| `call('openidByQq', '12345678')` | QQ 号 → 绑定的 OpenID（无绑定返回 null） |
| `call('nicknameToOpenid', gid, '昵称')` | 群内按昵称查成员 OpenID |
| `call('isSuper', openid)` | 该 OpenID 是否为超级主人 |
| `call('getVariable', '变量名')` | 读面板「全局变量」（plugin.vars） |
| `call('getMenuConfig', appid)` | 读本插件在 menu-editor.html 保存的卡片/菜单布局配置 |

## 5. 消息事件 data 结构

`op='event'` 的 `data` 包含：

```python
{
  "type": "message.group",      # message.group / message.c2c / message.guild
  "content": "消息内容",
  "groupId": "群OpenID",          # 群消息才有
  "channelId": "频道/子频道ID",
  "author": { "openid": "...", "member_openid": "...", "username": "..." },
  "id": "消息ID",
  "timestamp": "...",
  "botId": "机器人AppID"
}
```

## 6. 外显文字（mqqapi 链接）

官方「文字外显」格式，本意是点击文字后回填指令到输入框：

```python
'[文字](mqqapi://aio/%%69nlinecmd?command=%s&enter=false&reply=false)' % quote(cmd, safe='')
```

**注意：实测群消息纯文本回复不会渲染 mqqapi 外显链接，会按原文显示 `[文字](mqqapi://...)`，因此插件菜单一律使用纯文本指令说明，不使用外显链接**（参考 `plugins/测试.py` v0.2）。

- 网页链接（`https://`）在官方 Markdown 消息中可显示为可点击链接，但在纯文本消息中同样按原文显示，仅用于 Markdown 卡片。
- 菜单类输出统一写成：`功能名 → 发送「指令」`。

## 7. 面板操作

1. **上传**：面板「插件管理 → 添加插件」上传 `.py` 文件（或目录插件 zip）；超级主人上传后自动加载。
2. **代码编辑**：插件管理列表点「编辑」→ 在线修改 Python 代码 → Ctrl+S 保存并热重载（无需重启机器人）。
3. **菜单布局**：侧边栏「插件卡片 · 后台编辑器」→ 插件下拉选择 `测试.py` → 可视化编辑卡片/菜单布局 → 保存。
   - 保存后插件内可用 `call('getMenuConfig', appid)` 读取布局。
4. **启用/禁用**：插件管理列表点启用/禁用。

## 8. 完整示例：plugins/测试.py（多功能菜单 v0.1）

功能：唱歌（歌词+语音条）、禁言、广播、娱乐、实用、抖音解析。要点：

- `on_message(data)` 按 `content` 前缀路由指令；
- 群消息用 `reply` 回复文本；需要发语音/图片/公告时用 `call` 调用 BotAPI；
- 主菜单 `maybe_menu()` 优先渲染 menu-editor 后台布局，未配置回退内置菜单；
- 权限控制用 `call('isSuper', user)`，群成员禁言目标解析用 `call('openidByQq', qq)`。

完整源码见 `plugins/测试.py`，可直接作为 Python 插件开发脚手架。

## 9. 注意事项

- 插件主循环必须响应 `ping` → `pong`，否则引擎判定启动超时（15 秒）卸载插件。
- `call` 同步阻塞期间无法处理后续消息；长耗时任务请拆分或异步。
- Python 侧异常会被 `{op:'log'}` 记录到引擎日志（面板「运行日志」可见）。
- 二进制（Buffer）无法经 JSON 桥传递：语音/图片请传 **URL**，由 Node 端 `uploadGroupVoice/uploadGroupImage` 下载并分片上传。
- 修改插件代码保存后自动热重载；若代码有语法错误，插件会进入错误状态并在面板显示错误信息。
