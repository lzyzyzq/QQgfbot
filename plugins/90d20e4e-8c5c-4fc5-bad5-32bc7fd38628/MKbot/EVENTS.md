# NapCat 事件文档

本文档详细说明了 NapCat 插件中所有可用的事件类型及其参数含义。

---

## 事件分类

NapCat 事件分为三大类：
- **消息事件** (`post_type: "message"`) - 接收消息
- **通知事件** (`post_type: "notice"`) - 群组通知、状态变更等
- **请求事件** (`post_type: "request"`) - 加群申请、好友申请等

---

## 一、消息事件 (message)

### 1.1 群聊消息

**事件类型：** `post_type: "message"`, `message_type: "group"`

```javascript
{
  post_type: "message",           // 事件类型：消息
  message_type: "group",          // 消息类型：群聊
  time: 1234567890,               // 事件发生的时间戳（秒）
  self_id: 123456789,             // 机器人自己的 QQ 号
  message_id: 12345,              // 消息 ID（用于撤回、引用等）
  user_id: 987654321,             // 发送者的 QQ 号
  group_id: 101311160,            // 群号
  anonymous: null,                // 匿名信息（null 表示非匿名，有值表示匿名）
  message: [                       // 消息内容（数组格式，可包含多个消息段）
    { type: "text", data: { text: "你好" } },
    { type: "image", data: { url: "http://..." } }
  ],
  raw_message: "你好[CQ:image,url=...]",  // 原始消息字符串
  font: 0,                        // 字体（通常为 0）
  sender: {                       // 发送者信息
    user_id: 987654321,           // 发送者 QQ
    nickname: "小明",             // 发送者昵称
    card: "群名片",               // 发送者在群内的名片
    sex: "male",                  // 性别（male/female/unknown）
    age: 25,                       // 年龄
    area: "北京",                 // 地区
    level: 10,                     // QQ 等级
    role: "member",               // 群内角色（owner/admin/member）
    title: "群主"                 // 群内头衔
  }
}
```

**常用字段说明：**
- `user_id` - 发送者 QQ
- `group_id` - 群号
- `message_id` - 消息 ID，用于引用或撤回
- `raw_message` - 原始消息文本
- `sender.role` - 发送者在群内的角色（owner=群主, admin=管理员, member=普通成员）

---

### 1.2 私聊消息

**事件类型：** `post_type: "message"`, `message_type: "private"`

```javascript
{
  post_type: "message",           // 事件类型：消息
  message_type: "private",        // 消息类型：私聊
  time: 1234567890,               // 事件发生的时间戳
  self_id: 123456789,             // 机器人自己的 QQ 号
  message_id: 12345,              // 消息 ID
  user_id: 987654321,             // 发送者的 QQ 号
  message: [...],                 // 消息内容
  raw_message: "你好",            // 原始消息
  font: 0,                        // 字体
  sender: {                       // 发送者信息
    user_id: 987654321,           // 发送者 QQ
    nickname: "小明",             // 发送者昵称
    sex: "male",                  // 性别
    age: 25,                       // 年龄
    area: "北京"                  // 地区
  }
}
```

---

## 二、通知事件 (notice)

### 2.1 禁言事件

**事件类型：** `post_type: "notice"`, `notice_type: "group_ban"`

```javascript
{
  post_type: "notice",            // 事件类型：通知
  notice_type: "group_ban",       // 通知类型：禁言
  time: 1234567890,               // 事件发生的时间戳
  self_id: 123456789,             // 机器人自己的 QQ 号
  group_id: 101311160,            // 群号
  user_id: 987654321,             // 被禁言的用户 QQ
  operator_id: 111111111,         // 操作者的 QQ（谁执行的禁言）
  duration: 3600,                 // 禁言时长（秒），0 表示解除禁言
  sub_type: "ban"                 // 子类型：ban=禁言, lift_ban=解除禁言
}
```

**参数说明：**
- `group_id` - 发生禁言的群号
- `user_id` - 被禁言的用户 QQ
- `operator_id` - 执行禁言操作的用户 QQ
- `duration` - 禁言时长（秒），0 表示解除禁言
- `sub_type` - "ban" 表示禁言，"lift_ban" 表示解除禁言

---

### 2.2 群成员增加（有人进群）

**事件类型：** `post_type: "notice"`, `notice_type: "group_increase"`

```javascript
{
  post_type: "notice",            // 事件类型：通知
  notice_type: "group_increase",  // 通知类型：群成员增加
  time: 1234567890,               // 事件发生的时间戳
  self_id: 123456789,             // 机器人自己的 QQ 号
  group_id: 101311160,            // 群号
  user_id: 987654321,             // 加入群的用户 QQ
  operator_id: 111111111,         // 邀请者的 QQ（谁邀请的）
  sub_type: "approve"             // 子类型：approve=审批通过, invite=邀请加入
}
```

**参数说明：**
- `group_id` - 群号
- `user_id` - 加入群的用户 QQ
- `operator_id` - 邀请者或审批者的 QQ
- `sub_type` - 加群方式：
  - `"approve"` - 用户主动申请加群，被群主/管理员审批通过
  - `"invite"` - 被群成员邀请加入群

**判断加群类型的方法：**
```javascript
if (event.sub_type === "approve") {
  // 用户主动申请加群被通过
  console.log(`用户 ${event.user_id} 的加群申请被 ${event.operator_id} 审批通过`);
} else if (event.sub_type === "invite") {
  // 被邀请加入群
  console.log(`用户 ${event.user_id} 被 ${event.operator_id} 邀请加入群`);
}
```

---

### 2.3 群成员减少（有人退群或被踢）

**事件类型：** `post_type: "notice"`, `notice_type: "group_decrease"`

```javascript
{
  post_type: "notice",            // 事件类型：通知
  notice_type: "group_decrease",  // 通知类型：群成员减少
  time: 1234567890,               // 事件发生的时间戳
  self_id: 123456789,             // 机器人自己的 QQ 号
  group_id: 101311160,            // 群号
  user_id: 987654321,             // 离开群的用户 QQ
  operator_id: 111111111,         // 操作者的 QQ（谁踢的，如果是主动退群则为 user_id）
  sub_type: "leave"               // 子类型：leave=主动退群, kick=被踢出, kick_me=机器人被踢
}
```

**参数说明：**
- `group_id` - 群号
- `user_id` - 离开群的用户 QQ
- `operator_id` - 操作者 QQ（如果是主动退群，则等于 user_id）
- `sub_type` - "leave" 主动退群，"kick" 被踢出，"kick_me" 机器人被踢

---

### 2.4 群管理员变更

**事件类型：** `post_type: "notice"`, `notice_type: "group_admin"`

```javascript
{
  post_type: "notice",            // 事件类型：通知
  notice_type: "group_admin",     // 通知类型：群管理员变更
  time: 1234567890,               // 事件发生的时间戳
  self_id: 123456789,             // 机器人自己的 QQ 号
  group_id: 101311160,            // 群号
  user_id: 987654321,             // 被设置/取消管理员的用户 QQ
  sub_type: "set"                 // 子类型：set=设置管理员, unset=取消管理员
}
```

**参数说明：**
- `group_id` - 群号
- `user_id` - 被设置/取消管理员的用户 QQ
- `sub_type` - "set" 表示设置为管理员，"unset" 表示取消管理员

---

### 2.5 群名片变更

**事件类型：** `post_type: "notice"`, `notice_type: "group_card"`

```javascript
{
  post_type: "notice",            // 事件类型：通知
  notice_type: "group_card",      // 通知类型：群名片变更
  time: 1234567890,               // 事件发生的时间戳
  self_id: 123456789,             // 机器人自己的 QQ 号
  group_id: 101311160,            // 群号
  user_id: 987654321,             // 修改名片的用户 QQ
  card_old: "旧名片",             // 旧的群名片
  card_new: "新名片"              // 新的群名片
}
```

**参数说明：**
- `group_id` - 群号
- `user_id` - 修改名片的用户 QQ
- `card_old` - 修改前的群名片
- `card_new` - 修改后的群名片

---

### 2.6 群头像变更

**事件类型：** `post_type: "notice"`, `notice_type: "group_upload"`

```javascript
{
  post_type: "notice",            // 事件类型：通知
  notice_type: "group_upload",    // 通知类型：群文件上传
  time: 1234567890,               // 事件发生的时间戳
  self_id: 123456789,             // 机器人自己的 QQ 号
  group_id: 101311160,            // 群号
  user_id: 987654321,             // 上传文件的用户 QQ
  file: {                         // 文件信息
    id: "file_id_123",            // 文件 ID
    name: "document.pdf",         // 文件名
    size: 1024000,                // 文件大小（字节）
    busid: 0                      // 业务 ID
  }
}
```

---

## 三、请求事件 (request)

### 3.1 加群申请

**事件类型：** `post_type: "request"`, `request_type: "group"`

```javascript
{
  post_type: "request",           // 事件类型：请求
  request_type: "group",          // 请求类型：加群申请
  time: 1234567890,               // 事件发生的时间戳
  self_id: 123456789,             // 机器人自己的 QQ 号
  user_id: 987654321,             // 申请者的 QQ
  group_id: 101311160,            // 申请加入的群号
  comment: "我想加入这个群",      // 申请理由（可能为空字符串）
  flag: "flag_string_123",        // 请求标志（用于同意/拒绝）
  sub_type: "add"                 // 子类型：add=加群申请, invite=邀请加入（通常为 add）
}
```

**参数说明：**
- `user_id` - 申请者的 QQ
- `group_id` - 申请加入的群号
- `comment` - 申请理由（用户填写的申请内容，可能为空字符串 `""`）
- `flag` - 请求标志，用于调用 API 同意或拒绝申请
- `sub_type` - 通常为 `"add"`，表示加群申请

**判断申请内容的方法：**
```javascript
if (event.comment && event.comment.trim() !== "") {
  // 用户填写了申请理由
  console.log(`申请理由：${event.comment}`);
} else {
  // 用户没有填写申请理由
  console.log("用户没有填写申请理由");
}
```

**注意：** 
- 如果群设置了"群问题"（需要回答问题才能加群），申请者的答案会包含在 `comment` 字段中
- 如果群没有设置群问题，`comment` 就是用户自己填写的申请理由
- 无法直接判断是否有群问题，但可以通过 `comment` 内容来推断

---

### 3.2 好友申请

**事件类型：** `post_type: "request"`, `request_type: "friend"`

```javascript
{
  post_type: "request",           // 事件类型：请求
  request_type: "friend",         // 请求类型：好友申请
  time: 1234567890,               // 事件发生的时间戳
  self_id: 123456789,             // 机器人自己的 QQ 号
  user_id: 987654321,             // 申请者的 QQ
  comment: "我们一起玩游戏吧",    // 申请理由
  flag: "flag_string_456"         // 请求标志（用于同意/拒绝）
}
```

**参数说明：**
- `user_id` - 申请者的 QQ
- `comment` - 申请理由
- `flag` - 请求标志，用于调用 API 同意或拒绝申请

---

## 四、使用示例

### 示例 1：监听进群事件并发送欢迎消息

```javascript
export async function handleNotice(event, ctx) {
  if (event.notice_type === "group_increase") {
    const userId = event.user_id;
    const groupId = event.group_id;
    
    // 发送欢迎消息
    await sendReply(
      { message_type: "group", group_id: groupId },
      `欢迎新成员 ${userId} 加入群聊！`,
      ctx
    );
  }
}
```

### 示例 2：监听禁言事件

```javascript
export async function handleNotice(event, ctx) {
  if (event.notice_type === "group_ban") {
    const userId = event.user_id;
    const duration = event.duration;
    const subType = event.sub_type;
    
    if (subType === "ban") {
      console.log(`用户 ${userId} 被禁言 ${duration} 秒`);
    } else if (subType === "lift_ban") {
      console.log(`用户 ${userId} 被解除禁言`);
    }
  }
}
```

### 示例 3：监听加群申请

```javascript
export async function handleRequest(event, ctx) {
  if (event.request_type === "group") {
    const userId = event.user_id;
    const groupId = event.group_id;
    const comment = event.comment;
    
    console.log(`用户 ${userId} 申请加入群 ${groupId}，理由：${comment}`);
    
    // 可以在这里调用 API 同意或拒绝申请
    // await ctx.actions.call("set_group_add_request", {
    //   flag: event.flag,
    //   sub_type: "add",
    //   approve: true,
    //   reason: "欢迎加入"
    // }, ctx.adapterName, ctx.pluginManager.config);
  }
}
```

---

## 五、常见事件字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `post_type` | string | 事件类型：message/notice/request |
| `time` | number | 事件时间戳（秒） |
| `self_id` | number | 机器人 QQ |
| `user_id` | number | 用户 QQ |
| `group_id` | number | 群号 |
| `message_id` | number | 消息 ID |
| `message_type` | string | 消息类型：group/private |
| `notice_type` | string | 通知类型 |
| `request_type` | string | 请求类型 |
| `raw_message` | string | 原始消息文本 |
| `sender` | object | 发送者信息 |

---

## 六、事件处理流程

```
plugin_onmessage(ctx, event)
    ↓
[群号检测]
    ↓
├─ post_type === "message" → handleMessageEvent()
│   └─ handleMessage() / handleTestMessage()
│
├─ post_type === "notice" → handleNoticeEvent()
│   └─ handleNotice()
│
└─ post_type === "request" → handleRequestEvent()
    └─ handleRequest()
```

---

## 七、加群流程详解

### 加群的三种情况

#### 情况 1：用户主动申请加群（无群问题）

**流程：** 用户点击"申请加入" → 填写申请理由 → 群主/管理员审批

**触发事件：**
1. **加群申请事件** (`request_type: "group"`)
   ```javascript
   {
     request_type: "group",
     user_id: 987654321,
     group_id: 101311160,
     comment: "我想加入这个群",  // 用户填写的申请理由
     flag: "flag_123"
   }
   ```

2. **群成员增加事件** (`notice_type: "group_increase"`) - 审批通过后
   ```javascript
   {
     notice_type: "group_increase",
     user_id: 987654321,
     group_id: 101311160,
     operator_id: 111111111,  // 审批者的 QQ
     sub_type: "approve"      // 表示审批通过
   }
   ```

---

#### 情况 2：用户主动申请加群（有群问题）

**流程：** 用户点击"申请加入" → 回答群问题 → 群主/管理员审批

**触发事件：**
1. **加群申请事件** (`request_type: "group"`)
   ```javascript
   {
     request_type: "group",
     user_id: 987654321,
     group_id: 101311160,
     comment: "群问题的答案",  // 用户回答的群问题答案
     flag: "flag_123"
   }
   ```

2. **群成员增加事件** (`notice_type: "group_increase"`) - 审批通过后
   ```javascript
   {
     notice_type: "group_increase",
     user_id: 987654321,
     group_id: 101311160,
     operator_id: 111111111,  // 审批者的 QQ
     sub_type: "approve"      // 表示审批通过
   }
   ```

**判断是否有群问题：**
- 无法直接判断，但可以通过 `comment` 内容推断
- 如果 `comment` 为空或很短，可能是没有填写申请理由
- 如果 `comment` 有内容，可能是申请理由或群问题答案

---

#### 情况 3：被群成员邀请加入

**流程：** 群成员邀请用户 → 用户同意 → 直接加入群

**触发事件：**
1. **群成员增加事件** (`notice_type: "group_increase"`) - 直接加入，无需审批
   ```javascript
   {
     notice_type: "group_increase",
     user_id: 987654321,
     group_id: 101311160,
     operator_id: 111111111,  // 邀请者的 QQ
     sub_type: "invite"       // 表示被邀请
   }
   ```

**特点：** 被邀请加入时不会触发 `request_type: "group"` 事件，直接触发 `group_increase` 事件

---

### 判断加群方式的代码示例

```javascript
// 在 handleRequest 中处理加群申请
export async function handleRequest(event, ctx) {
  if (event.request_type === "group") {
    const userId = event.user_id;
    const groupId = event.group_id;
    const comment = event.comment;
    
    // 判断是否填写了申请理由或回答了群问题
    if (comment && comment.trim() !== "") {
      console.log(`用户 ${userId} 申请加入群 ${groupId}`);
      console.log(`申请理由/群问题答案：${comment}`);
    } else {
      console.log(`用户 ${userId} 申请加入群 ${groupId}（未填写申请理由）`);
    }
  }
}

// 在 handleNotice 中处理进群事件
export async function handleNotice(event, ctx) {
  if (event.notice_type === "group_increase") {
    const userId = event.user_id;
    const groupId = event.group_id;
    const operatorId = event.operator_id;
    
    if (event.sub_type === "approve") {
      // 用户的加群申请被审批通过
      console.log(`用户 ${userId} 的加群申请被 ${operatorId} 审批通过`);
    } else if (event.sub_type === "invite") {
      // 用户被邀请加入群
      console.log(`用户 ${userId} 被 ${operatorId} 邀请加入群`);
    }
  }
}
```

---

## 八、快速参考

**消息事件：** 用户发送消息时触发
- 群聊消息：`message_type: "group"`
- 私聊消息：`message_type: "private"`

**通知事件：** 群组状态变更时触发
- 禁言：`notice_type: "group_ban"`
- 进群：`notice_type: "group_increase"`
- 退群：`notice_type: "group_decrease"`
- 管理员变更：`notice_type: "group_admin"`
- 群名片变更：`notice_type: "group_card"`
- 文件上传：`notice_type: "group_upload"`

**请求事件：** 用户申请时触发
- 加群申请：`request_type: "group"`
- 好友申请：`request_type: "friend"`
