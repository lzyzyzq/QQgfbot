# DIC管理.js 功能说明

> 插件ID：`mod-dic-manager` ｜ 版本：v1.0.0 ｜ 作者：511742399 ｜ 状态：活跃

## 简介

开启/关闭 dic 回复、写入 dic、设置底部广告、模式设置。

## 支持的命令（均需超级主人）

| 命令 | 功能 |
|------|------|
| 「开启dic回复」 | 通过 `engine.findPluginByName('词典回复')` 定位并 `enable` 启用词典回复插件 |
| 「关闭dic回复」 | `disable` 词典回复插件 |
| 「写入dic」 | 提示以 `关键词|回复内容` 格式发送内容 |
| 「写入dic <内容>」 | 将内容写入 `plugins/dict.txt` 并 `reload` 词典回复插件 |
| 「设置底部广告」 | 展示 7 个菜单当前的底部广告 |
| 「设置底部广告 <菜单名> <内容>」 | 菜单名限 娱乐功能/实用功能/授权功能/系统功能/设置功能/DIC设置/群管系统 |
| 「模式设置」 | 显示当前全局模式 |
| 「模式设置 按钮|文字」 | 写 `global_mode` 为 button/text |

## 功能模块
- dic 开关控制
- dict.txt 文件写入与插件热重载
- 菜单底部广告管理
- 全局按钮/文字模式切换

## 数据存储
| Key | 说明 |
|-----|------|
| `super_master_id` | 读，判断超级主人 |
| `footer_ad_<菜单名>` | 读写 |
| `global_mode` | 读写 |
| `plugins/dict.txt` | 直接写文件 |

## 外部调用
- `ctx.engine.callPlugin('主菜单','sendMessage')`
- `ctx.engine.findPluginByName/enable/disable/reload`
- `ctx.bot.sendGroupMessage`（兜底）
- Node `fs/path` 写字典文件

## 权限控制
所有命令均需超级主人（`super_master_id` 匹配）。

## 维护提示
- 写入 dic 会触发词典回复插件热重载，格式为 `关键词|回复内容`。
