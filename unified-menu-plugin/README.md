# 统一菜单插件（unified-menu-plugin）

整合面板现有分散插件的统一菜单插件。TS 工程 → 构建出 `dist/index.mjs` 上传面板；也可直接用纯 JS 单文件（`dist/index.cjs`）；同一套逻辑支持独立 WebSocket 直连运行。

## 主要能力

- **三级菜单**：主菜单 → 子菜单 → 子子菜单，逐级下钻，任何层级可返回上级/主菜单
- **删除文字链接模式**：全局模式仅 `text` / `image`；旧 `text_link` 值自动归一化为 `text`
- **蓝色字体菜单项**：文字模式渲染「功能名↗」蓝色字体、不带按钮边框，点击行为与按钮一致；无面板域名/markdown 权限时降级为「（发送「功能名」）」
- **图片模式**：sendMenuCard 渲染图片菜单，失败自动降级文字
- **多机器人隔离**：每个 AppID 独立模块开关，仅回复本机器人已开启的菜单
- **回复去重**：同一消息 5 秒窗口去重，避免 Webhook 与 WebSocket 重复
- **入群欢迎**：新成员入群提示「本群发送菜单有惊喜」
- **报时**：整点报时，文字/图片模式
- **QQ 自定义菜单与指令面板**：/v2/menu、/v2/panels 全套 8 接口（依赖面板 4.2.22 新增 BotAPI）
- **智能娱乐**：随机（运势/骰子/猜拳/大转盘）、小游戏（猜数字/老虎机）、关键词学习、AI 对话（用户自备 Key）
- **个人信息**：实用功能内「👤 个人信息」走后端 `/api/bot/userinfo`，优先信息卡片展示头像，失败降级文本（群名/昵称/QQ/OpenID/权限/授权）
- **WebUI**：配置说明页

## 构建

```bash
cd unified-menu-plugin
npm install          # 或复用外层 node_modules
npm run build        # 输出 dist/index.mjs + dist/index.cjs + dist/webui/
```

- `dist/index.mjs`：ESM 单文件，面板 ZIP 上传（入口 index.mjs）
- `dist/index.cjs`：CJS 单文件，纯 JS 形态（可改名 index.js 后放 plugins/ 目录）

## 面板依赖

需面板 **4.2.22+**（本工程发布 zip 内含），改动点：
- 移除 `text_link`：全局模式仅 text/image，`getGlobalMode` 默认 text、`setGlobalMode` 将 text_link 归一化为 text
- BotAPI 新增：`getGlobalMenu` / `setGlobalMenu` / `getPanels` / `createPanel` / `getPanelDetail` / `updatePanel` / `deletePanel` / `updatePanelTarget`

## 指令（群里发送）

```
主菜单 / 菜单 / 返回主菜单        进入主菜单
娱乐功能 / 实用功能 / ...         进入子菜单
运势 / 骰子 / 猜拳 石头 / 大转盘  随机娱乐
猜数字 / 老虎机                   小游戏
学习 关键词=回复内容              词典学习
词条列表 / 删词条 关键词          词典管理
AI 问题 / AI配置 Key=xxx          AI 对话（超管配置密钥）
切换全局模式 / 报时 开 / 欢迎提示 开  超管设置
/菜单面板 查询|列表|创建|详情|修改面板|删除|关联|修改  超管管理 QQ 指令面板
```

## 结构

```
unified-menu-plugin/
├── src/
│   ├── index.ts            # 面板插件入口（manifest/onEnable/onDisable/methods）
│   ├── config.ts           # WebUI schema
│   ├── types.ts
│   ├── core/state.ts       # 状态：配置/模块开关/词典/去重
│   ├── menu/tree.ts        # 三级菜单树
│   ├── menu/render.ts      # text（蓝色字体）/ image 渲染 + 降级
│   ├── handlers/message.ts # 消息路由（去重→隔离→菜单→功能）
│   ├── handlers/notice.ts  # 入群欢迎
│   ├── services/           # random/games/learn/ai/qq-menu-panel
│   ├── features/schedule.ts# 报时
│   └── webui/index.html
├── build.mjs               # esbuild 构建
├── package.json
└── tsconfig.json
```
