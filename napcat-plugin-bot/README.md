# napcat-plugin-bot（智能机器人插件）

多功能 QQ 群机器人 NapCat 插件，所有功能整合在单一插件内。

- **作者**：空空爱追剧
- **联系 QQ**：511742399
- **版本**：v3.1.0
- **插件名**：`napcat-plugin-bot`（智能机器人）

## 功能清单（全部集中在本插件，无重复文件）

| 分类 | 功能 |
| ---- | ---- |
| 基础 | 菜单（文字/按钮/图片）、签到、补签、排行榜、个人信息、群信息、群统计 |
| 娱乐中心 | 今日运势、今日人品、掷骰子、猜拳、选择、随机数、今天吃什么、抽CP、扫雷、敲木鱼、开心农场、去钓鱼、仙逆 |
| 音乐/工具 | 点歌/唱歌、天气、每日打卡、每日备注、设置昵称、查巡、群打卡 |
| 定时 | 添加定时、定时列表、删除定时、整点报时 |
| 群管理 | 全员禁言、解禁全员、禁言、解禁、踢人、设管理、取消管理、群公告、设置群名、撤回、设为精华、戳一戳 |
| 关键词 | 添加关键词、删除关键词、关键词列表（词典） |
| 授权 | 获取激活码、激活、授权状态（对接面板授权码 API） |
| 管理(主人) | 设置主人、主人列表、开启/关闭机器人、全局开启/关闭、群开关状态、频道列表、频道测试、定时关机 |
| 其他 | 运行时间、版本、更新日志、赞助、问候 |

## 群开关（按群配置）

在插件「配置界面」中填写：

- **开启的群列表**（逗号分隔）：留空 = 所有群开启；填写 = 仅这些群开启（白名单）
- **关闭的群列表**（逗号分隔）：这些群强制关闭（黑名单，优先级最高）

也可以直接群里发命令：

- `开启机器人` / `打开机器人`：本群开启（需主人）
- `关闭机器人`：本群关闭（需主人）
- `群开关状态`：查看本群与全局开关状态
- `全局开启` / `全局关闭`：全部群总开关（需主人）

## 安装

1. 在插件管理页上传 `napcat-plugin-bot-v3.1.0.zip`
2. 启用插件并进入配置界面填写参数
3. 建议清理旧版散落的插件文件，避免功能重复（见下）

### 可清理的旧插件文件

以下为早期版本的散落插件，功能已全部并入本插件，确认无独立使用时可以删除：

```
plugins/菜单.mjs
plugins/菜单/
plugins/主菜单.js
plugins/按钮菜单.js
plugins/html菜单.js
plugins/娱乐中心.js
plugins/签到系统.js
plugins/定时推送.js
plugins/关键词回复.js
plugins/群管理工具.js
plugins/群信息.js
plugins/系统工具.js
plugins/系统设置.js
plugins/实用工具.js
plugins/授权系统.js
plugins/开关机控制.js
plugins/唱歌.js
plugins/频道管理.js
plugins/文字按钮测试.js
plugins/登录.js
plugins/OpenID查询.js
plugins/DIC管理.js
plugins/Super Derive.js
plugins/Test Plugin.js
```

## 开发

TypeScript 工程（napcat-plugin-template 风格）：

```bash
npm install
npm run build        # esbuild 编译 src/index.ts -> dist/index.mjs
npm run typecheck    # tsc --noEmit
```

打包 zip 时，将 `dist/index.mjs` 放到 zip 根目录作为主入口，并保留 `src/`、`package.json`、`tsconfig.json`。

### 配置项

| 配置项 | 说明 |
| ------ | ---- |
| enabled | 启用插件，关闭后不响应任何命令 |
| commandPrefix | 命令前缀，留空直接匹配关键词 |
| ownerIds | 初始主人 QQ（逗号分隔） |
| globalEnabled | 全局模式，关闭后所有群停止响应 |
| groupEnabledList | 开启的群列表（白名单，空=全开） |
| groupDisabledList | 关闭的群列表（黑名单，优先） |
| authServerUrl | 授权服务器地址 |
| authApiPath | 授权 API 路径（JSON 模式） |
| authVerifyPath | 授权验证 API 路径 |
| authMethod | 获取方式：json / html |
| authCodeField | 授权码字段名 |
| authTimeout | 请求超时(ms) |
| channelId | 默认测试频道 ID |
| menuImageUrl / menuImagePath | 图片菜单配置 |
| enableButtonMenu | 启用按钮菜单 |
| hourlyChime | 整点报时 |
| welcomeMsg / byeMsg | 入群欢迎/退群提示 |
| dailyPushTime | 每日备注推送时间 |
| weatherApiUrl / weatherApiKey | 天气服务 |
| songPlatforms | 点歌平台多选 |
