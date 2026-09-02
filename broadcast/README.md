# GitHub 云端广播中心（QQgfbot）

机器人支持从 GitHub 仓库读取「云端广播任务」，并执行到 **全部群 / 单一群 / 目标群** 的
**文本 / 图片** 广播；内容既可以是固定文本，也可以从任意 **API 抓取**后广播；支持按
**每天时间 / 间隔分钟** 定时到点自动发送（由服务器 schedule-runner 每分钟扫描触发）。

## 文件结构

```
broadcast/
├── broadcast.json     # 目录/索引：内联任务，或 { "file": "xxx.json" } 引用单文件
├── 任务.json          # 单个任务文件（可被 broadcast.json 引用）
└── README.md
```

## 单个任务字段

```jsonc
{
  "id": "demo",            // 必填：字母/数字/_/-
  "name": "示例广播",       // 名称（面板/群内显示）
  "enabled": true,         // false 则暂停（同步定时后不触发）
  "send": "text",          // text=文本消息 | image=把文字渲染成图片发送
  "target": "all",         // all=全部群 | one=单一群(需 groupId) | list=目标群列表(需 groups)
  "groupId": "群OpenID",    // target=one 时必填
  "groups": ["群OpenID1"], // target=list 时必填
  "content": "固定文本 {time} {image:https://example.com/a.png}",
  "api": {                // 可选：从 API 抓内容（成功优先，失败回退 content）
    "url": "https://news-at.zhihu.com/api/4/news/latest",
    "jsonPath": "stories"  // 可选；.a.b[0] 取值；缺省=整份
  },
  "schedule": {            // 可选：留空/删除=手动广播（面板/群内触发）
    "time": "08:30"        // 每天北京时间 HH:MM；或
    // "intervalMin": 60   // 每隔 N 分钟
  }
}
```

- 内容占位符：`{time}` 当前北京时间；`{image:URL}`（文本模式）追加发送一张图片。
- API jsonPath 结果：字符串/数字原文；数组按行（对象取 title/name/content/text/desc）。

## 更新（新增/修改/停用任务）

1. 编辑本仓库 `broadcast/broadcast.json`（或新增单文件任务并引用），提交并推送 GitHub。
2. 面板「系统设置 → GitHub 云端广播」点「刷新广播目录」即可看到最新任务；
   - 「立即广播」= 立即发一次（可按任务默认目标，或临时选 全部群/当前群/指定群）；
   - 「同步定时任务」= 把带 schedule 的任务登记成本机定时任务，到点自动广播；
3. 群内（测试.py）：发送 `云端广播` 查看列表；`云端广播 名称 全部` 或 `云端广播 名称 本群`
   （超级主人）立即执行。

来源读取顺序（多候选自动切换）：GitHub raw 直连 → raw.gitmirror 加速 → ghfast.top 加速 → 8091 备用；
服务器若在本仓库目录运行则优先读取本地 `broadcast/` 目录（离线开发/调试可用）。
