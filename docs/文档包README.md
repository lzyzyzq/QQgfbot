# 开发与使用文档包

QQgfbot · 空空爱追剧（QQ 机器人 4.x）的**开发与使用文档合集**，含当前全部插件的索引、命令总览与逐插件功能说明，以及 PHP / Python / JS 三种插件开发文档、BotAPI/终端/更新系统/NapCat 参考。

> 包内容与 `plugins/` 目录同步整理，插件索引由 `scripts/gen-plugin-index.mjs` 自动生成（改动插件后重跑可更新）。

## 目录结构

```
开发文档/
├── README.md                    ← 本文件（包导览）
├── 插件索引与命令总览.md         ← 全部插件清单（文件/ID/版本/命令/存储键/后端接口，自动生成）
├── 终端开发与使用文档.md         ← 群内「终端/执行」Shell 能力与「更新系统」说明
├── PHP插件开发文档.md           ← PHP 插件协议/辅助函数开发指南
├── Python插件开发文档.md        ← Python 插件开发指南
├── 插件API帮助文档.md            ← 插件可用 API/上下文（ctx/engine/bot）速查
├── BotAPI参考.md                ← 群消息/富媒体/卡片（sendGroupInfoCard 等）API 参考
├── CQ码参考.md / go-cqhttp-API参考.md
├── NapCat-Termux-部署.md        ← Termux/NapCat 部署（如需以真实 QQ 头像展示个人信息）
├── NapCat插件兼容层.md
├── 编辑器-使用说明.md
├── 插件功能/                     ← 各插件人工功能说明（历史档案，最新以总览清单为准）
│   ├── README.md（说明索引与「个人信息」去重约定）
│   ├── 实用工具.md 签到系统.md 主菜单.md ……
└── 示例/
    ├── 测试.py                  ← Python 插件可直接运行的完整示例
    └── python-plugin-template.zip ← Python 插件工程模板
```

## 快速开始：插件安装 / 更新

盒子（服务器）上 `plugins/` 即全部插件目录，每个 `.js/.php/.py` 文件是一个独立插件（PHP 还需 `php_helpers.php` 辅助库在目录内）：

1. **后台更新**：登录机器人管理面板 →「插件管理」，上传/替换对应 `.js/.php` 文件，保存后自动重载该插件。
2. **命令行更新**：`cp 新文件 plugins/实用工具.js` 后重启机器人，或触发群内「插件列表」看加载状态。
3. 新装 PHP 插件请确认目录内 `php_helpers.php` 与本包一致。

## 查看插件功能

- **想找某个命令由谁实现** → 打开 `插件索引与命令总览.md`，按文件名/命令关键词定位，命中即见插件 ID、版本、存储键。
- **想改某个功能** → 用总览找到插件文件与 ID，再到 `插件功能/` 找对应说明文档，然后直接编辑该 `.js`。
- **示例**：「个人信息」由 `实用工具.js`（mod-utils，v1.2.1）实现，富媒体头像卡（getUserProfile + sendGroupMarkdownWithImage），签到系统对其保持静默避免双回复，详见 `插件功能/实用工具.md`。

## 版本对应

本包整理自仓库 `plugins/` + `docs/`；主程序版本见 `update-config.json`（当前站点发布的最新版）。

## 维护提示

- 插件列表变更后执行：`node scripts/gen-plugin-index.mjs` 重新生成总览再打包。
- 打包命令见仓库 `scripts/build-dev-docs-zip.mjs`（或手工 `zip -r qqbot-dev-docs.zip 开发文档`）。
