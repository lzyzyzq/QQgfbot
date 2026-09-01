# BotAPI 参考（插件开发）

插件通过 `ctx.bot` 调用 QQ 官方服务端接口。所有方法均为异步（返回 Promise），调用时建议 `await` 或 `.catch()` 处理失败。

## 消息发送

| 方法 | 说明 |
|------|------|
| `sendGroupMessage(groupOpenid, content, msgId?)` | 群聊文本消息 |
| `sendPrivateMessage(openid, content, msgId?)` | 私聊文本消息 |
| `sendKeyboardGroup(groupOpenid, keyboard, msgId?)` | 群聊按钮（键盘）消息 |
| `sendKeyboardPrivate(openid, keyboard, msgId?)` | 私聊按钮（键盘）消息 |
| `sendMarkdownGroup(groupOpenid, markdown, templateId?, params?, msgId?)` | 群聊 Markdown 消息 |
| `sendMarkdownPrivate(openid, markdown, templateId?, params?, msgId?)` | 私聊 Markdown 消息 |
| `sendGroupMarkdownWithImage(groupOpenid, markdown, imageUrl, msgId?)` | 群聊图文 Markdown |
| `sendImageMessage(channelId, imageUrl, msgId?)` | 频道图片消息 |
| `uploadGroupImage(groupOpenid, imageUrl)` | 上传群图片，返回 `{ url, raw_url, file_info }` |
| `sendGroupInfoCard(groupOpenid, card, msgId?)` | 发送「个人信息」合成卡片（返回 boolean） |
| `sendGroupDashboard(groupOpenid, msgId?)` | 发送「群信息」活跃统计看板（返回 boolean） |

示例：

```js
await ctx.bot.sendGroupMessage(groupId, '你好，世界', msgId);
await ctx.bot.sendKeyboardGroup(groupId, {
  rows: [
    [{ text: '功能', value: 'menu' }],
    [{ text: '签到', value: 'sign' }]
  ]
});
await ctx.bot.sendMarkdownGroup(groupId, '## 今日数据\n消息数：**100**');
```

`keyboard` 结构：`{ rows: Array<Array<{ text, value, type?, click? }>> }`。
`msgId` 传回调事件的 `id` 可回复指定消息。

## 禁言管理（官方服务端接口）

| 方法 | 说明 |
|------|------|
| `muteMember(groupOpenid, memberOpenid, durationSecs)` | 禁言群成员（秒），返回 API 结果或 null |
| `unmuteMember(groupOpenid, memberOpenid)` | 解除群成员禁言 |
| `muteAll(groupOpenid, enable, durationSecs?)` | 全员禁言开关，`enable=true` 开启 |

```js
await ctx.bot.muteMember(groupId, memberOpenid, 600);   // 禁言 10 分钟
await ctx.bot.unmuteMember(groupId, memberOpenid);      // 解除
await ctx.bot.muteAll(groupId, true, 3600);             // 全员禁言 1 小时
await ctx.bot.muteAll(groupId, false);                  // 解除全员禁言
```

## 群成员管理

| 方法 | 说明 |
|------|------|
| `kickMember(groupOpenid, memberOpenid, addBlacklist?, deleteMsgDays?)` | 移出群成员，可选拉黑、删历史消息天数 |
| `deleteMessage(groupOpenid, messageId, hideTip?)` | 撤回消息 |
| `getGroupMembers(groupOpenid)` | 获取群成员列表（数组），失败返回空数组 |

```js
await ctx.bot.kickMember(groupId, memberOpenid, true, 7);   // 踢出并拉黑，删7天消息
await ctx.bot.deleteMessage(groupId, msgId, true);          // 撤回且不提示
const members = await ctx.bot.getGroupMembers(groupId);     // 成员数组
```

## 群公告

| 方法 | 说明 |
|------|------|
| `setAnnouncement(groupOpenid, content)` | 发布群公告 |
| `deleteAnnouncement(groupOpenid, messageId)` | 删除群公告 |

## 群信息查询（官方服务端接口）

| 方法 | 说明 |
|------|------|
| `getGroupInfo(groupOpenid)` | 群基础信息：群名/头像/成员数/群主/创建时间/简介等，无权限返回 null |
| `getGroupBotState(groupOpenid)` | 机器人在群状态：进群时间/群角色等 |

```js
const info = await ctx.bot.getGroupInfo(groupId);
if (info && info.group_name) {
  await ctx.bot.sendGroupMessage(groupId, '本群：' + info.group_name);
}
const state = await ctx.bot.getGroupBotState(groupId);
```

`getGroupInfo` 返回字段（示例）：

```json
{
  "group_openid": "xxxx",
  "group_name": "群名称",
  "group_avatar": "https://...",
  "member_count": 100,
  "max_member_count": 500,
  "owner_member_openid": "xxxx",
  "is_owner": false,
  "created_at": "2024-01-01 00:00:00",
  "description": "群简介"
}
```

## 其他

| 方法 | 说明 |
|------|------|
| `getStatus()` | 机器人状态：`running` / `stopped` / `error` 等 |

## 全局模式（按钮 / 文字 / 文字链接）

菜单类插件在三种全局模式下自动选择展示方式。模式由 `ctx.engine` 管理，存于全局配置（跨全部插件共享）：

| 方法 | 说明 |
|------|------|
| `getGlobalMode()` | 当前全局模式：`button`（键盘按钮，默认）/ `text`（纯文本）/ `text_link`（文字链接） |
| `setGlobalMode(mode)` | 设置全局模式（`button` / `text` / `text_link`） |
| `getPanelBaseUrl()` | 面板域名基础地址。`panel.host` 未配置返回空串；配置带 `http(s)://` 原样返回，否则拼 `https://<host>` |
| `buildClickUrl(groupOpenid, userOpenid, action)` | 生成"文字链接模式"用的点击指令链接。用户点击链接 → 打开落地页 → 后端以该用户在群内身份自动触发 `action` 指令并回复到群 |

文字链接模式的使用要点：

1. 未配置面板域名 `panel.host` 时，`buildClickUrl` 返回空串，菜单自动回退为纯文本展示。
2. `buildClickUrl` 生成的链接形如 `https://<panel.host>/click?g=..&u=..&d=..&s=..`，`s` 为 HMAC 签名，链接不可伪造。
3. 链接默认"点击后触发指令并回复到群"。如需跳转外部网页或面板页面，按钮 `action.data` 前缀约定：
   - `url:https://xxx` → 点击跳转到指定网页；
   - `panel:/xxx` → 点击跳转到面板管理页（需 `panel.host` 已配置）。

## 插件上下文

插件导出 `onMessage`（群/私聊消息）时，回调参数 `ctx` 含：

| 字段 | 说明 |
|------|------|
| `ctx.bot` | 上述全部 BotAPI 方法 |
| `ctx.logger` | 日志：`info` / `warn` / `error` / `debug` |
| `ctx.storage` | KV 存储：`get(key)` / `set(key, value)` / `delete(key)` |
| `ctx.config` | 插件配置对象 |
| `ctx.engine` | 引擎控制：`callPlugin(name, method, ...args)` 等 |
| `ctx.identity` | 身份：`getQQ(openid)` / `getOpenids(qq)` / `isSameUser(a, b)` |

消息事件数据（onMessage 的 data）：

```json
{
  "id": "消息ID",
  "content": "消息内容",
  "author": { "id": "openid", "openid": "openid", "member_openid": "", "username": "昵称" },
  "groupId": "群 openid（群聊才有）",
  "channelId": "频道/群 ID",
  "group_name": "群名",
  "timestamp": "毫秒时间戳"
}
```

## 本地 HTTP API（供沙箱内插件请求）

插件沙箱内无法直连外部 https，请通过后端本地 API 获取扩展能力（详见 `docs/插件API帮助文档.md`）。基础地址：

```js
const url = `http://127.0.0.1:3000/api/...`;
```

常用本地接口：`/api/bot/uptime`、`/api/bot/version`、`/api/bot/userinfo?user_openid=..&group_openid=..`、`/api/groups`、`/api/plugins/test` 等，完整清单见 `docs/插件API帮助文档.md`。

## 完整插件示例

```js
module.exports = {
  name: '示例插件',
  version: '1.0.0',
  async onMessage(data, ctx) {
    if (data.content === '群名') {
      const info = await ctx.bot.getGroupInfo(data.groupId);
      ctx.bot.sendGroupMessage(data.groupId, '本群：' + (info?.group_name || '未知'), data.id);
    }
    if (data.content === '禁言测试') {
      await ctx.bot.muteMember(data.groupId, data.author.id, 60);
      ctx.bot.sendGroupMessage(data.groupId, '已禁言 1 分钟', data.id);
    }
  },
};
```
