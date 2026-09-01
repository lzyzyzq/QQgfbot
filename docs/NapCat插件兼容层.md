# NapCat 插件兼容层

> 适用版本：4.2.4（增量功能，基于 4.2.4 部署文档叠加）
> 发布日期：2026-08-21

## 一、这是什么

本平台原生插件格式是 `export default { manifest, onEnable, ... }`（ZIP 或单文件 `.mjs`）。有些插件（如 MKbot）按 **NapCatQQ** 的格式编写：导出 `plugin_init`/`plugin_onmessage`/`plugin_onevent`/`plugin_config_ui`。

兼容层让这类 **NapCat 格式插件无需改任何源码**，直接上传到本平台即可：

- 插件管理面板正常显示、启用/禁用
- `plugin_config_ui` 配置表自动渲染成「设置」界面（面板上点「设置」按钮）
- `plugin_onmessage` 消息回调照常触发，收到的是一份 OneBot v11 事件
- `actions.call(action, data)`（`ctx` 上的 NapCat 动作调用）映射到本平台 API

## 二、上传方式

在面板「插件管理」里上传 NapCat 插件的 zip（或把单文件 `.mjs` 放入 `plugins/` 目录）。

zip 要求：

- 包内入口为 `index.mjs`（或 `index.js`），导出 `plugin_init`
- 如果 zip 里带一层顶层目录（如 `MKbot/xxx`），自动把入口所在子目录内容上移到插件根，无需手动处理
- 依赖会自动 `npm install`（如 `napcat-types`，仅类型包，安装失败不影响运行）

## 三、识别规则

模块导出中**含 `plugin_init`** 即判定为 NapCat 插件，不再要求 `manifest` 或 `plugin.json`。

## 四、消息事件转换

本平台收到群/私聊消息后，转成 OneBot v11 事件再交给 `plugin_onmessage`：

```jsonc
{
  "post_type": "message",
  "message_type": "group",            // 或 "private"
  "message_id": "...",
  "user_id": 2058270005,              // QQ 号（经 user_mappings 映射；openid 为纯数字时直接当 QQ 号）
  "group_id": 101311160,              // 数字群号（经 groups.group_number 映射）
  "raw_message": "...",
  "message": [{ "type": "text", "data": { "text": "..." } }],
  "sender": { "user_id": ..., "nickname": "..." },
  "self_id": ...,
  "time": ...
}
```

- 群号/QQ 号双向映射：数字群号 → group openid、QQ 号 → user openid，由系统查 `groups` / `user_mappings` 表完成
- 数字群号未绑定（群还没收到过任何消息）时回退 `0`，此时插件可按 `group_id == 0` 或 group_of 配置判断

## 五、动作映射（actions.call）

| NapCat 动作 | 本平台实现 |
|-------------|-----------|
| `send_msg` / `send_group_msg` / `send_private_msg` | 群/私聊发送（`[CQ:...]` 码与消息段数组均支持） |
| `set_group_ban` / `set_group_whole_ban` | 禁言 / 全体禁言 |
| `set_group_kick` | 踢出群成员 |
| `get_group_list` / `get_friend_list` / `get_login_info` | 群列表 / 好友列表 / 登录信息 |
| `get_group_member_info` / `get_group_member_list` | 群成员信息 / 列表 |
| `delete_msg` / `send_group_card` 等未实现动作 | 返回 `retcode: 1404`（不报错） |

`messageToText` 会把 `[CQ:image]`/`[CQ:reply]` 等 CQ 码和消息段数组转成可发送文本。

## 六、配置界面

- `plugin_config_ui` 数组里的表单元素由 `ctx.NapCatConfig.text()/boolean()/select()` 生成，自动渲染为通用设置页
- 配置文件存在 `data/napcat/{插件id}/config.json`（对应 NapCat 的 `ctx.configPath`），`ctx.dataPath` 指向同目录，插件通过 `readB("config.json", ...)` 可读
- 面板「设置」按钮保存后**立即重载插件**，新配置当场生效，无需重启服务
- 自动生成一个通用 webui（`webui/index.html`）供面板打开；zip 里自带 `webui/dashboard.html` 之类自定义页面仍保留可访问

## 七、MKbot 示例

1. 面板「插件管理」上传 MKbot 的 zip
2. 列表出现 `napcat-plugin-mkbot`，类型 zip，启用
3. 点「设置」填入：
   - `OwnerQQs`：主人 QQ（多个用逗号分隔）
   - `group_of`：允许响应的群号（多个用逗号分隔）
4. 保存后立即生效

MKbot 默认只在群号 `101311160` / `1082631686` 回复，且非主人触发管理类命令会回复「你不是她.......」——这是插件自身的权限逻辑，配置好 `OwnerQQs` 即正常。

## 八、验证

```bash
# 上传后查看日志出现加载成功
grep "NapCat plugin loaded" logs/...   # 或 pm2 logs qqbot

# 面板插件列表应显示该插件，且「设置」按钮可打开配置页

# 模拟消息测试（面板「插件测试」）：plugin_name 填插件名，群选测试群，user_id 填 QQ 号
# 主人：回复正常内容；非主人：回复「你不是她.......」
```

## 九、注意事项

- 兼容层把 NapCat 插件的「内部数据」（卡密、授权等）留在它自己的 `dataPath` 目录（即 `data/napcat/{插件id}/`），和系统 `bot.db` 隔离
- 插件从 `plugins/` 卸载后，`data/napcat/{插件id}/` 里的配置/数据仍在，重新上传同名插件可恢复
- 面板「插件测试」传的数字 `user_id` 会直接当 QQ 号用，方便验证主人/权限逻辑
