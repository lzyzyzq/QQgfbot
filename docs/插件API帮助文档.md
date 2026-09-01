# 插件 API 帮助文档

> 本机网页后端（localhost:3000）对外开放的机器人功能 API 汇总，供后续编写插件时调用。
> 所有接口均为 **local-only**（仅 127.0.0.1 / ::1 可访问），非本机调用返回 `403 { error: "Forbidden: local only" }`。

## 通用调用方式（插件内）

插件沙箱不支持 https 外网直连，调用后端一律走本机 http。**端口由 `process.env.PORT` 动态决定，默认 3000**（如服务器以 3100 运行则自动用 3100），插件无需硬编码。以下为通用请求函数：

```js
function callLocalApi(method, apiPath, bodyString) {
  return new Promise(function(resolve) {
    try {
      var http = require('http');
      var port = (typeof process !== 'undefined' && process.env && process.env.PORT) ? Number(process.env.PORT) : 3000;
      var req = http.request({
        host: '127.0.0.1',
        port: port,
        path: apiPath,
        method: method,
        timeout: 6000,
        headers: { 'Content-Type': 'application/json' }
      }, function(res) {
        var body = '';
        res.on('data', function(chunk) { body += chunk; });
        res.on('end', function() {
          try { resolve(JSON.parse(body)); }
          catch(e) { resolve(null); }
        });
      });
      req.on('error', function() { resolve(null); });
      req.on('timeout', function() { req.destroy(); resolve(null); });
      if (bodyString) req.write(bodyString);
      req.end();
    } catch(e) { resolve(null); }
  });
}
```

- GET：`callLocalApi('GET', '/api/bot/xxx')`
- POST（带 JSON body）：`callLocalApi('POST', '/api/bot/xxx', JSON.stringify({...}))`
- DELETE（带 query）：`callLocalApi('DELETE', '/api/bot/xxx?id=123')`
- `?city=` 等查询参数必须 `encodeURIComponent` 编码

---

## 一、定时任务与功能开关（4.1.0 新增）

### 1. 功能开关列表

```
GET /api/bot/switches
```

返回：

```json
{
  "switches": [
    { "key": "morning_report", "name": "每日早报", "desc": "每日定时推送早报", "enabled": true },
    { "key": "evening_report", "name": "每日晚报", "desc": "每日定时推送晚报", "enabled": true },
    { "key": "chime",          "name": "整点报时", "desc": "整点/半点准时报时",     "enabled": true },
    { "key": "weather_report", "name": "天气播报", "desc": "定时播报天气",           "enabled": true },
    { "key": "broadcast",      "name": "定时播报", "desc": "定时任务播报总开关",     "enabled": true },
    { "key": "welcome",        "name": "欢迎语",   "desc": "新人入群欢迎消息",       "enabled": true },
    { "key": "leave_notice",   "name": "退群提示", "desc": "成员退群提醒",           "enabled": true },
    { "key": "checkin",        "name": "签到系统", "desc": "每日签到与积分",         "enabled": true }
  ]
}
```

所有开关默认开启，存后端 config 表（key `switch.<key>`），重启不丢失。

### 2. 设置功能开关

```
POST /api/bot/switches
Body: { "key": "morning_report", "enabled": false }
```

- `key` 支持英文 key 或中文名（如 `每日早报`）
- 返回：`{ ok: true, switch: { key, name, desc, enabled } }`
- 未知开关返回：`{ ok: false, error: "未知开关：xxx" }`

### 3. 定时任务列表

```
GET /api/bot/schedule-tasks
```

返回：

```json
{
  "tasks": [
    {
      "id": "msfphqwlkglh",
      "type": "broadcast",
      "enabled": true,
      "contentType": "chime",
      "text": "",
      "city": "",
      "time": "08:00",
      "intervalMin": 0,
      "groups": [],
      "switchKey": "",
      "switchTo": null
    }
  ]
}
```

### 4. 新建定时任务

```
POST /api/bot/schedule-tasks
```

**类型 A：定时播报（type=broadcast）** — 到点自动向群播报

```json
{
  "type": "broadcast",
  "contentType": "chime",
  "time": "08:00",
  "groups": []
}
```

- `contentType`：`chime`（报时）/ `weather`（天气）/ `morning`（早报）/ `evening`（晚报）/ `text`（自定义文本）
- 时间二选一：`time`（北京时间 HH:MM，每天到点触发）或 `intervalMin`（每 N 分钟，重启后先对齐不立即触发）
- 可选：`city`（天气类播报的城市，默认北京）、`text`（text 类型的内容）、`groups`（群名/群ID 数组，空 = 全部群）
- 各类播报受对应功能开关门控：chime→整点报时、weather→天气播报、morning→每日早报、evening→每日晚报、text→定时播报总开关

**类型 B：定时开关（type=toggle）** — 到点自动开/关某个功能

```json
{
  "type": "toggle",
  "switchKey": "evening_report",
  "switchTo": false,
  "time": "23:00"
}
```

- `switchKey`：开关 key 或中文名；`switchTo`：true=开，false=关；`time`：北京时间 HH:MM

返回：`{ ok: true, task: {...} }`（含生成的 `id`，后续删除/启停用它）

### 5. 修改定时任务

```
PUT /api/bot/schedule-tasks
Body: { "id": "msfphqwlkglh", "time": "09:00", "enabled": true }
```

`id` 必填，其余字段按需覆盖。

### 6. 删除定时任务

```
DELETE /api/bot/schedule-tasks?id=msfphqwlkglh
```

返回：`{ ok: true }`（任务不存在返回 `{ ok: false }`）

### 7. 启停定时任务

```
POST /api/bot/schedule-tasks/toggle
Body: { "id": "msfphqwlkglh" }
```

翻转 `enabled`，返回：`{ ok: true, task: {...} }`

---

## 二、系统信息

### 1. 版本信息

```
GET /api/bot/version
```

返回：`{ platform: "QQ Bot Platform", version: "4.1.0", framework: { name: "NapCatQQ", version: "..." }, node: "v22..." }`

### 2. 更新日志

```
GET /api/bot/changelog
```

返回：`{ content: "<CHANGELOG.md 全文>" }`

### 3. 运行时间 / 在线时间

```
GET /api/bot/uptime
```

返回：

```json
{
  "uptimeSeconds": 3600,
  "startedAt": "2026-08-05T06:28:17.284Z",
  "pid": 13876,
  "beijingTime": "2026年08月05日 14:28:41 星期三",
  "serverTime": "Wed Aug 05 2026 06:28:41 GMT+0000 ...",
  "serverTimezone": "UTC"
}
```

- `beijingTime`：当前北京时间（年月日 时分秒 星期），插件的「在线时间」用它展示
- `uptimeSeconds`：进程已运行秒数

### 4. 群列表（定时任务发送目标源）

```
GET /api/bot/groups
```

返回：`{ groups: [{ id, name, last_active }] }`

---

## 三、天气（后端代理，插件沙箱无法直连 https）

```
GET /api/bot/weather?city=武汉
```

- `city`：中文城市名（须 URL 编码），支持北京/上海/广州/深圳/成都/武汉/西安等常见城市映射
- 数据源：wttr.in（实时天气）+ 中国天气网（气象预警）

返回：

```json
{
  "ok": true,
  "city": "武汉",
  "desc": "🌧 小雨",
  "temp": "24",
  "feels": "26",
  "humidity": "85",
  "wind": "11",
  "winddir": "N",
  "minT": "20",
  "maxT": "29",
  "date": "2026-08-05",
  "updateTime": "14:00",
  "hourly": [ { "time": "14:00", "temp": "24", "desc": "🌧 小雨", "rain": "63" } ],
  "today": "当前🌧 小雨，14时转⛅ 多云，最高29°C",
  "tomorrow": { "date": "2026-08-06", "desc": "⛅ 多云", "minT": "21", "maxT": "31" },
  "warnings": [ { "area": "湖北省武汉市", "type": "暴雨", "level": "黄色", "time": "...", "content": "...", "source": "国家预警信息发布中心" } ]
}
```

失败返回：`{ ok: false, error: "..." }`

---

## 四、用户信息与 QQ 绑定

### 1. 用户信息

```
GET /api/bot/userinfo?user_openid=xxx&group_openid=yyy
```

返回：

```json
{
  "group_name": "群名",
  "username": "昵称",
  "user_openid": "xxx",
  "qq_number": "12345678",
  "avatar": "https://q1.qlogo.cn/g?b=qq&nk=12345678&s=640",
  "authorized": true,
  "auth_role": "member"
}
```

- `qq_number`：真实 QQ 号（仅认 5-12 位纯数字，需已手动映射或绑定）；`avatar` 由此生成

### 2. 绑定 QQ 号（openid ↔ QQ）

```
POST /api/bot/bind-qq
Body: { "openid": "xxx", "qq_number": "12345678", "nickname": "昵称" }
```

- QQ 号需 5-12 位纯数字；**绑定后不可修改**（已绑定返回 ok:false 并提示）
- 返回：`{ ok: true, openid, qq_number, bound: true }`

### 3. 按 QQ 查 OpenID

```
GET /api/bot/auth-codes/openid-by-qq?qq=12345678
```

返回：`{ openid: "xxx", nickname: "昵称" }`（未绑定返回 `{ openid: null }`）

### 4. 多机器人绑定（一个 QQ 绑定多个机器人的 OpenID）

```
GET  /api/bot/auth-codes/openids-by-qq?qq=12345678
      # 按 QQ 查询全部绑定 → { qq, openids: [{ openid, bot_id, nickname }] }

GET  /api/bot/auth-codes/mappings
      # 全部映射（按 QQ 聚合），供用户管理页展示 → { mappings: [...] }

POST /api/bot/auth-codes/bind-openid
      # 绑定 OpenID → QQ
      Body: { "openid": "xxx", "qq_number": "12345678", "nickname": "昵称", "bot_id": "机器人ID" }
      # 返回 { ok: true, openid, qq_number }

POST /api/bot/auth-codes/unbind-openid
      # 解绑
      Body: { "openid": "xxx" }
      # 返回 { ok: true, removed: true|false }
```

- 绑定成功后插件侧 `ctx.identity.getQQ / getOpenids / isSameUser` 立即可用
- 管理员面板「用户管理」页的 OpenID 绑定/解绑即调用以上接口

---

## 五、授权码管理（供超级主人群内指令调用）

```
GET  /api/bot/auth-codes                        # 列表
POST /api/bot/auth-codes                        # 新增
      Body: { "role": "master|member", "expires_in_minutes": 1440 }  # 省略/0 = 永久
PUT  /api/bot/auth-codes                        # 修改
      Body: { "code": "XXXXXX", "role": "master", "expires_in_minutes": 0 }  # 0 = 永久
DELETE /api/bot/auth-codes?code=XXXXXX          # 删除
POST /api/bot/auth-codes/verify                 # 激活（标记使用）
      Body: { "code": "XXXXXX", "openid": "xxx" }
```

- 新增返回：`{ ok: true, code: "XXXXXX", role, expires_at, is_permanent }`
- verify 返回：`{ valid: true, role, code }`（无效/过期返回 `{ valid: false, error }`）

### 5. 私聊登录信息（按 OpenID 解析用户名 + 授权码）

```
GET /api/bot/auth-codes/login-info?openid=xxx
```

- 插件「登录 / 登录链接 / 获取登录信息 / 获取授权码」命令调用
- OpenID 需已绑定 QQ（或已用该 OpenID 激活过授权码），否则返回 `{ qq_number: null }`
- 返回：

```json
{
  "qq_number": "12345678",
  "nickname": "昵称",
  "username": "面板用户名（QQ号）",
  "code": "XXXXXX",
  "role": "member",
  "expires_at": "2026-08-06T00:00:00Z",
  "is_permanent": true,
  "panel_url": "面板登录地址"
}
```

### 6. 面板信息（登录链接地址）

```
GET /api/bot/panel-info
```

返回：`{ host, port, url }`（`url` 为面板访问地址，`port` 即 `process.env.PORT`）

---

## 六、面板授权码登录开关

```
GET  /api/bot/panel-login                       # → { enabled: true }
POST /api/bot/panel-login                       # Body: { "enabled": false } → { ok: true, enabled }
```

---

## 七、面板授权码登录串联（登录 / 登录链接 / 获取授权码）

机器人私聊命令触发整条串联链路，用户无需记忆面板地址：

1. `GET /api/bot/panel-info` → 面板访问地址
2. `GET /api/bot/auth-codes/login-info?openid=xxx` → 用户名（QQ 号）+ 授权码
3. 回复用户：`登录链接：{panel_url}，用户名：{qq_number}，授权码：{code}`

面板授权码登录校验流程：

```
OpenID → QQ 号（user_mappings） → admin.json 用户名匹配 → 登录成功
```

- 授权码登录成功后将 OpenID 绑定到该管理员账号（面板「用户管理」可见）
- 未授权用户调用时插件回复无权限提示，不泄露登录信息

---

## 八、群信息本地接口（群列表 / 成员 / 禁言 / 踢人）

插件沙箱内可直接调用，供群信息查询与群管指令使用。

### 1. 群列表

```
GET /api/groups
```

返回：`{ groups: [{ id, name, member_count, first_seen, last_active }] }`

### 2. 群成员列表

```
GET /api/groups/:id/members?bot_id=xxx
```

- `bot_id` 可选，按机器人过滤
- 返回：`{ members: [{ member_openid, qq_id, nickname, bot_id, first_seen, last_seen }], source: "local" }`

### 3. 修改群名

```
PUT /api/groups/:id/name
body: { "name": "新群名" }
```

### 4. 禁言群成员

```
POST /api/groups/:id/mute
body: { "memberId": "xxx", "duration": 600 }
```

- `duration` 秒，默认 600

### 5. 解除禁言

```
POST /api/groups/:id/unmute
body: { "memberId": "xxx" }
```

### 6. 移出群成员

```
POST /api/groups/:id/kick
body: { "memberId": "xxx" }
```

### 7. 时间偏移

```
GET /api/time-offset
```

返回：`{ offsetHours: 8 }`（服务器与北京时间时差，供定时任务计算）

---

## 插件内典型用法示例

```js
// 1. 定时播报：每天 08:00 北京时间报时到全部群
await callLocalApi('POST', '/api/bot/schedule-tasks', JSON.stringify({
  type: 'broadcast', contentType: 'chime', time: '08:00', groups: []
}));

// 2. 定时开关：每天 23:00 关闭每日晚报
await callLocalApi('POST', '/api/bot/schedule-tasks', JSON.stringify({
  type: 'toggle', switchKey: 'evening_report', switchTo: false, time: '23:00'
}));

// 3. 读取当前天气
var w = await callLocalApi('GET', '/api/bot/weather?city=' + encodeURIComponent('武汉'));
var msg = w.ok ? (w.city + '：' + w.desc + ' ' + w.temp + '°C') : '天气获取失败';

// 4. 私聊登录：拼接面板登录链接（用户名 + 授权码）
var pinfo = await callLocalApi('GET', '/api/bot/panel-info', null);
var linfo = await callLocalApi('GET', '/api/bot/auth-codes/login-info?openid=' + encodeURIComponent(userId), null);
if (linfo && linfo.qq_number && linfo.code) {
  var loginUrl = (pinfo && pinfo.url) || '';
  // 回复：登录链接：${loginUrl} 用户名：${linfo.qq_number} 授权码：${linfo.code}
}

// 5. 多机器人绑定：将另一机器人的 OpenID 绑定到同一 QQ
await callLocalApi('POST', '/api/bot/auth-codes/bind-openid', JSON.stringify({
  openid: '新机器人的openid', qq_number: '12345678', nickname: '昵称', bot_id: '机器人ID'
}));

// 6. 查询群成员并禁言
var list = await callLocalApi('GET', '/api/groups/' + encodeURIComponent(groupId) + '/members', null);
if (list && list.members) {
  var target = list.members[0];
  await callLocalApi('POST', '/api/groups/' + encodeURIComponent(groupId) + '/mute', JSON.stringify({
    memberId: target.member_openid, duration: 600
  }));
}
```
