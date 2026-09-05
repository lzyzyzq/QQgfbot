# 更新日志

## 2026-09-05

### 4.2.70：个人信息卡片恢复 + 版本卡动态化 + 重启完成广播
- **实用工具「个人信息」富媒体头像卡恢复**（v1.2.1）：改用 `getUserProfile` 取头像/昵称/QQ/权限/授权 + 群名，经 markdown 图片卡发送；彻底移除对已停发的 qq-bot-plugins 包依赖
- **群内「版本」卡片动态化**：插件版本改从实际加载的插件 manifest 读取（新增 `/api/bot/version` → `plugins` 字段），修复「实用工具 v1.0.0」显示与实际不符、避免今后每次升级后手工清单滞后
- **重启/更新完成广播修复**：重启前写 `.reboot-ts` 时间戳，重启后向机器人所在全部群广播「✅ 重启完成 · 用时 X 秒」；广播增加就绪重试（HTTP/WS 未就绪自动等待重发），不再静默丢失
- 适用路径：群内「重启机器人/重启服务器」、面板重启、核心 realRestart、更新系统（更新系统.php 重启前同样写标记）

### 4.2.69：终端更新命令兼容修复
- 群里直接发送的终端升级命令支持 `wget -O 带路径包名`（如 `-O /tmp/up.zip`），自动取纯文件名下载解压，不再误报「未识别到可执行的终端更新命令」
- 原纯文件名 / 多包连续 / 带 `#` 注释与换行的升级命令格式全部保持兼容

## 2026-09-02

### 4.2.59h：GitHub 云端广播中心
- **broadcast/broadcast.json + 单文件任务**：任务定义托管在 GitHub（支持内联任务与 `{file:xxx.json}` 引用），服务器/面板/群内菜单多源读取（GitHub raw → raw.gitmirror → ghfast.top → 8091）
- **广播字段**：`send` 文本/图片（图片=渲染卡片发送）、`target` 全部群/单一群/目标群列表、`content` 固定文本（`{time}`/`{image:URL}`）、`api{url,jsonPath}` 从 API 抓内容（失败回退预设文本）、`schedule{time|intervalMin}` 定时
- **面板「GitHub 云端广播」区块**（系统设置）：刷新目录、立即广播/试播（可临时选全部群/当前群/指定群）、一键「同步定时任务」把云端带 schedule 任务登记成本机定时任务（`gh_` 前缀）
- **群内（测试.py）**：`云端广播` 查看任务列表；`云端广播 名称 [全部|本群]`（超级主人）立即执行
- **定时执行**：schedule-runner 新增 `contentType=broadcast`，到点重新拉取云端任务按最新定义广播（图片渲染/文本/@ 目标等复用定时任务既有能力）

## 2026-09-01

### 4.2.59g：部署终端新增「拉取 GitHub 项目」
- 面板「部署终端」新增 GitHub 项目操作条（默认 https://github.com/lzyzyzq/QQgfbot.git，可改仓库/分支）
- 三种模式：**仅拉取源码**（git fetch + reset --hard，覆盖本地改动，data/node_modules/dist 不受影响）、**拉取 + 构建**（npm 装依赖 + tsc 编译 + 精简生产依赖）、**拉取构建重启**（自动 pm2 restart qqbot）
- 目录无 .git 时自动 git init + 关联远端（非空部署目录安全初始化，未跟踪文件保留）；新接口 `POST /api/system/git-pull`（仅超管，拉取超时 180s/构建 600s）

### 4.2.59f：更新源迁入 GitHub Release（多源自动切换）+ GitHub Actions + README
- **更新源双主并存**：GitHub Release（主源）→ GitHub 加速镜像（ghfast.top/ghproxy.net）→ 8091 备用源；面板「服务端接收」、群内「更新系统」统一按候选源顺序自动切换下载，无需手动改地址
- **update-config.json**：新增 `mirrors` 列表（AI 发版统一维护，同版本多源 URL）
- **更新配置拉取多源**：`update.config_url` 留空时默认依次拉取 GitHub raw → raw.gitmirror.com → 8091（php 插件/Node 接收端/面板一致）
- **GitHub Actions**：`ci.yml`（push/PR 编译+测试）、`release.yml`（push v* tag 自动构建补丁/全量 zip 挂 Release）、`manual-build.yml`（手动触发打包附加）
- 代码归档 GitHub：lzyzyzq/QQgfbot（仓库级身份 QQgfbot），README 含加速下载与发布流程说明

### 4.2.59e：服务端更新接收端（AI 发布包一键接收部署）
- **面板新增「服务端接收」区块**（系统设置 → 更新系统配置 下方）：显示解压根目录/当前版本/AI 端最新配置
- **接收补丁包 / 接收全量包**：自动从云端 update-config.json 取下载地址 → 下载 → zip 校验 → 覆盖式解压到部署根 → 写更新记录（记录.json/状态.json）→ `pm2 restart qqbot`
- **上传 zip 接收**：本地上传 zip 文件走同一套接收流程
- 后端接口：`GET /api/system/update-receive/info`（接收端信息）、`POST /api/system/update-receive`（body.url 远程 或 multipart file 上传，均限超管）
- 与群内「更新系统」插件串联：同一记录文件 + 当前版本 + 重启命令，记录/检查更新立即可见
- 解压根目录可用 config `update.receive_root` 指定（默认=面板运行目录）

### 4.2.59d：移除 mqqapi 外显链接 + 唱歌播放真实版权音频
- **移除外显文字链接**：`plugins/测试.py` v0.2 全部菜单/回复去掉 `[文字](mqqapi://...)` 外显（实测群消息按原文显示、不渲染），统一改为纯文本指令说明
- **修复唱歌无版权**：改走网易云真实播放地址接口 `enhance/player/url`（320k→128k 依次尝试），有版权歌曲直接语音播放完整音频；无版权/需VIP 明确提示「换一首试试」，不再播放替代音频
- **文档同步**：`docs/Python插件开发文档.md` 外显文字一节标注实测不支持渲染，推荐纯文本菜单

### 4.2.59c：开发文档包 + 面板 py 类型标签修复
- **新增开发文档**：`docs/Python插件开发文档.md`（py 插件协议/reply/call/BotAPI/extras/外显链接/面板操作/完整示例）与 `docs/终端开发与使用文档.md`（部署终端用法、群内终端更新命令、版本升级流程）；已打包 `qqbot-dev-docs.zip` 提供下载
- **修复**：插件管理列表类型标签统一为纯类型标识（js→`js`、py→`py`、其它文件→扩展名），去掉「PY·」「文件·」前缀

### 4.2.59b：Python 多功能菜单插件「测试」v0.1 + 面板 py 全链路 + 群内终端更新串联
- **新增 Python 插件「测试」v0.1**（`plugins/测试.py`，单文件 .py）：多功能菜单，全部基于 QQ 官方开放平台 API——
  - 🎤 唱歌：网易云搜歌，先发歌词再以富媒体语音条播放（`uploadGroupVoice` + `sendGroupVoiceMessage`）
  - 🔇 禁言：`禁言 <QQ号或openid> <分钟>` / `解禁` / `全群禁言 开|关` / `禁言状态`（官方 mute API，仅超主）
  - 📢 广播：`广播 <内容>` 当前群公告+消息；`全体广播 <内容>` 全部群广播（仅超主）
  - 🎮 娱乐：掷骰子 / 石头剪刀布 / 猜数字 / 今日运势 / 讲笑话
  - 🔧 实用：天气（wttr.in）/ 二维码图片 / 安全计算器 / 北京时间 / 随机数
  - 🎵 解析抖音视频：分享口令→短链展开→第三方解析接口→无水印播放链接+封面图
  - 🔄 更新引导：发送「更新 / 重启」提示群内终端命令更新方式
  - 外显文字统一采用 `[外显文字](mqqapi://aio/%69nlinecmd?command=指令&enter=false&reply=false)` 链接格式
- **面板 py 全链路**：插件上传支持 .py；插件管理列表显示 PY 标签；代码编辑读取/保存/热重载 py；menu-editor.html 卡片布局编辑器放行 .py 插件（`/api/menu-config/plugins` 不再过滤 py），可在插件下拉选中「测试.py」编辑菜单布局；配置 key 兼容 .py 插件 id（`file-测试`）；「测试」主菜单优先渲染后台布局配置（外显按钮行），未配置时用内置菜单
- **Python 运行时引擎扩展**：`python-runtime.ts` 新增 extras 桥，py 插件可 `call()` 调用 `listGroups` / `openidByQq` / `nicknameToOpenid` / `isSuper` / `getVariable` / `getMenuConfig` 等引擎能力
- **群内终端更新串联**：`更新系统.php` 支持群里直接发送
  `cd /var/www/php && wget -O patch-4.2.59.zip <补丁URL> && unzip -o patch-4.2.59.zip && pm2 restart qqbot`
  （或 `wget -O full.zip <全量URL> ...`），自动下载→`unzip -t` 校验→`unzip -o` 解压→`pm2 restart qqbot`，全程群内反馈；与面板「部署终端」同根目录、同重启方式打通；严格校验目录/zip 名/URL 协议防命令注入，仅超级主人


### 4.2.59：本机重启 + 全群状态广播 + PHP 即时发送 + 定时任务图片发送
- **重启改本机 pm2**：面板「重启机器人/重启服务器」与服务器重启不再走 SSH `100.68.196.95`，改为本机执行 `cd /var/www/php && pm2 restart qqbot`；`restartFn` 返回执行结果，前端展示成功/失败，成功后轮询 `/api/health` 自动刷新
- **新增「重启控制」插件**：超主群内发「重启机器人/重启服务器」→ 10 秒倒计时 → 本机重启；启动后 `onEnable` 自动向全部群广播运行状态（文字 + 状态图）；重启命令失败渲染错误图；权限仅超级主人
- **PHP 插件即时发送**：`文字()/图片()` 通过本机桥接端点 `POST /api/bot/php-bridge/send-reply` 立即发送（不再等脚本结束），耗时脚本（如更新补丁）超时被杀也不会零回复；PHP 运行超时 8000ms → 120s，超时先 SIGTERM 再 SIGKILL
- **定时任务发送方式二选一**：新增 `sendType`（文字/图片），选择「图片」时把播报内容渲染为卡片图发送（新增 `renderTextCard`）；列表展示「图片」标识
- **天气播报补全**：定时任务天气走本服务天气接口（预报/预警/空气质量/紫外线/日出日落/气压/能见度/极端天气提示）；「查询天气」插件文本兜底同步补极端天气提示
- **新增「群主」插件**：发「群主/谁是群主/查群主」查询本群群主（`findGroupOwner`）
- **机器人状态卡**：新增 `renderBotStatusCard` + `GET /api/bot/php-bridge/bot-status`（版本/运行时长/端口/PID/内存/Node/插件数/群数），供重启/自启广播
- **面板新增「部署终端」**：管理面板内嵌服务器命令终端（侧边栏「部署终端」），会话目录默认 `/var/www/php`（部署根目录），支持 `cd` 切换（会话内持久）与任意 `sh -c` 命令，可直接 `unzip -o` 解压更新包、`pm2 restart qqbot` 重启机器人，无需再 SSH；仅超级主人可执行（`POST /api/system/terminal/exec`）

## 2026-08-24

### 统一菜单 v1.2.0：权限修复 + 按钮模式 + 全功能补全（插件包，服务端无改动）
- **权限修复（实锤根因）**：引擎 `storage.get('super_master_id')` 在派生场景返回 `JSON.stringify({id,name})` 对象，旧插件 `Array.isArray(arr) && arr.includes(userId)` 恒 false。新增 `src/services/perms.ts`：`isMaster` 三态兼容（对象/数组/字符串）+ `ctx.identity.isSameUser` 跨机器人同一 QQ 归一化；超主 `/菜单面板 查询`、`切换全局模式`、`报时`、`欢迎提示` 不再误报「权限不足，仅超管可操作」
- **按钮模式**：删除蓝色 markdown 链接菜单，改为 4×4 键盘按钮（`action:{type:2, data, enter:true, permission:{type:2}}`，点击填入输入框、用户点发送触发）+「🏠 返回主菜单」；群聊 `sendKeyboardGroup`、私聊 `sendKeyboardC2C`、频道消息纯文本兜底；原「40054005 消息被去重」历史错误随 markdown 移除不再触发
- **功能补全（按 plugins/整合数据.txt + README + 主菜单.js 权威清单）**：8 组全量菜单——娱乐（运势/2d6/猜拳/选择/随机数/吃什么/人品/抽老婆/敲木鱼/笑话/猜数字）、实用（个人信息/群信息/每日打卡/每日备注/设置昵称/绑定QQ/天气/补签/签到排行/积分排行）、授权（获取激活码/激活授权码/登录）、系统（版本/在线时间/更新日志/查巡）、设置（报时/欢迎提示/切换全局模式）、群管（开启群全禁/关闭群全禁/禁言/解禁/踢人，均 isMaster）、频道（列表/板块/详情/创建/修改/删除/发帖/删帖/公告/活跃度/违规/签到）、词典（开启/关闭dic回复/学习/词条列表/删词条）、AI 对话
- **新增 services**：signin（签到/补签/积分，按 openid 存 storage 并维护 signin.index 排行，因 PluginStorage 无 keys()）、note、authcodes（走本机 `/api/bot/auth-codes`）、groupadmin（群全禁/禁言/解禁/踢人）、guildops（频道 12 项）
- **打包交付修正（重要）**：引擎 `loadZipPlugin` 只认插件根目录 `index.mjs/index.js/index.ts`，且走 `import()`（`mod.default` 必须直接是插件本体）。此前 TS 包入口放 `dist/index.mjs`（找不到入口）、JS 包用 CJS bundle（`module.exports={default:plugin}` 被 import() 包成 `{default:{default:plugin}}`，onEnable 丢失→监听注册为空）。修正后两包均在根目录放 **ESM 格式 `index.mjs`** + `webui/`，`package.json` 带 `main:index.mjs`/`webui:webui/index.html`，`pack.mjs` 一键构建打包
- **ctx API 修正**：`设置昵称`/`绑定QQ` 原调用 `ctx.identity.bindUserQQ`（真实引擎该方法在 `ctx.engine`），改为 doBind 优先 `ctx.engine.bindUserQQ`、兜底 `ctx.identity.bindUserQQ`，返回 `{ok,error}` 判定
- **验证**：`npx tsc --noEmit` 通过；33 项扩展冒烟（dist/index.cjs 直接加载）全过；**新增引擎级集成验证** `/tmp/opencode/zip-engine-verify.cjs`——对两个交付 zip 走真实 `createFromZip → enable(id,true) → EventBus 发射 → 断言`，38 项全过（含权限对象格式/跨机器人 isSameUser/小主人/按钮 enter=true/私聊 C2C/娱乐/补签/群全禁/DIC/激活码拦截/频道），覆盖打包结构、入口加载、webui 识别、真实 DB storage 与 user_mappings 反查
- **交付物**：`/workspace/unified-menu-plugin-v1.2.0.zip`（TS 工程，根 index.mjs+src+dist+webui）、`/workspace/unified-menu-plugin-js-v1.2.0.zip`（纯 JS 单文件 ESM+webui）；部署后 `enable(id, true)` 强载

## 2026-08-24

### 修复多机器人回调签名校验失败 + 统一菜单恢复「个人信息」（4.2.23）
- **修复新机器人回调链接校验失败**：`getWebhookManagerFor` 的 WebhookManager 缓存此前永不失效——修改机器人 AppSecret 或先后以不同 Secret 保存后，服务端仍用旧 Secret 派生 ed25519 密钥验签，导致 QQ 开放平台 URL 校验（签名不匹配）与面板自测「HTTP 200 签名一致:false」。修复：WebhookManager 暴露 `secret`，`getWebhookManagerFor` 每次比对当前配置与缓存 Secret，不一致自动重建，无需重启
- **统一菜单插件 v1.1.0**：实用功能恢复「👤 个人信息」（走后端 `/api/bot/userinfo`，优先信息卡片展示头像，失败降级文本：群名/昵称/QQ/OpenID/权限/授权）
- **说明**：`armbian.tailaa2e36.ts.net` 公网可达（Tailscale Funnel，公网 A 记录 208.111.x.x），浏览器访问回调链接返回 400 `Expected URL verification request` 属正常（未带验签头），不是回调失败原因

## 2026-08-24

### 移除文字链接模式 + BotAPI 菜单/面板接口 + 统一菜单插件（4.2.22）
- **删除 text_link 模式**：全局菜单模式仅保留 `text` / `image`；`getGlobalMode()` 对旧 `text_link` 存储值归一化返回 `text`，`setGlobalMode()` 只接受 text/image，其他值归一化 text；`overrideMode` 同步处理，旧数据静默兼容
- **BotAPI 新增 QQ 自定义菜单/指令面板 8 接口**：`getGlobalMenu`（GET /v2/menu）、`setGlobalMenu`（PUT /v2/menu）、`getPanels`（GET /v2/panels）、`createPanel`（POST /v2/panels）、`getPanelDetail`、`updatePanel`、`deletePanel`、`updatePanelTarget`；复用 ensureToken/apiCall，供插件与面板调用
- **统一菜单插件（unified-menu-plugin）**：整合现有分散插件为单一工程，三级菜单（主/子/子子）逐级下钻；文字模式菜单项渲染「功能名↗」蓝色字体、不带按钮边框、点击行为与按钮一致（无面板域名/markdown 权限自动降级为「（发送「功能名」）」）；图片模式 sendMenuCard 失败自动降级文字
- **多机器人隔离 + 回复去重**：每个 AppID 独立模块开关，仅回复本机器人已开启的菜单/功能；同一消息 5 秒去重，避免 Webhook 与 WebSocket 重复回复
- **智能娱乐四类**：随机（运势/骰子/猜拳/大转盘）、小游戏（猜数字/老虎机）、关键词学习（学习/删词条/词条列表）、AI 对话（DeepSeek OpenAI 兼容接口，密钥用户自备，`AI配置 Key=xxx`）
- **入群欢迎 + 报时**：新成员入群提示「本群发送菜单有惊喜」；整点报时支持文字/图片模式
- **QQ 菜单/指令面板指令**：超管在群内通过 `/菜单面板 查询|列表|创建|详情|修改面板|删除|关联|修改` 管理
- **三态交付**：TS 工程（src 源码+构建产物）、纯 JS 单文件版（CJS 免构建）、面板服务包（4.2.22，含上述引擎/BotAPI 改动）

## 2026-08-23

### 智能机器人插件 v3.1.0 整合版 + WebUI 响应式升级（4.2.18）
- **插件整合为单一 TypeScript 工程**：`napcat-plugin-bot` v3.1.0 采用 napcat-plugin-template 风格工程（`src/` 多模块：config/core/services/features/handlers），所有功能（菜单/娱乐/签到/群管/定时/关键词/授权/频道/天气/点歌）集中到这一个插件，不再散落多个插件文件；zip 内含编译产物 `index.mjs` 与 TS 源码工程，真实 NapCat 与面板引擎均可加载
- **群开关按群配置**：插件配置界面新增「开启的群列表」「关闭的群列表」；留空=所有群开启，填写=仅这些群开启（白名单），关闭列表强制关闭（黑名单优先）；群命令「开启机器人/关闭机器人/群开关状态」与界面同步；兼容迁移旧版 `data.groupSwitches`
- **设置界面响应式升级（电脑端/手机端）**：NapCat 兼容配置页重构为分组卡片布局，布尔项改为开关控件，移动端底部吸底操作栏 + 大触控按钮，桌面端静态操作栏，适配 NapCat 官方插件管理页风格（wui-v3 模板，生成后自动覆盖旧模板）
- **作者与联系方式**：作者「空空爱追剧」，联系 QQ 511742399（`package.json contact` 字段 + 插件内「版本/赞助」命令展示）
- **菜单整合**：统一文字菜单（分区完整展示所有功能）+ 按钮菜单 + 图片菜单三种形式保留

### NapCat 插件 v3.0.0 + TypeScript 插件加载 + 授权码对接面板（4.2.17）
- **NapCat 插件升级 v3.0.0**：作者改为「空空爱追剧」、版本号 v3.0.0、插件名 `napcat-plugin-bot`；修复默认授权服务器地址端口异常（`https://armbian.tailaa2e36.ts.net`，去掉 `:6655`）
- **授权码对接面板授权 API**：插件「获取激活码」从面板公开接口 `GET /api/auth/code` 拉取（data/bot.db `auth_codes` 表同源）；「激活 <码>」先调面板 `POST /api/auth/code/verify` 验证并标记使用（记录 used_by 到 auth_codes），成功后才本地生效；面板新增 `POST /api/auth/code` 别名（生成授权码，与 `/api/auth-codes` 等价）
- **TypeScript 插件加载**：ZIP 插件入口支持 `index.ts` / `src/index.ts`（esbuild 打包后动态加载），上传/列表/自动注册/类型识别全链路支持 `.ts`
- **上传后插件不更新修复**：`enable(id)` 新增 `force` 参数，覆盖上传与审批时强制卸载旧实例并重载新代码；ZIP 插件动态 import 增加时间戳参数，避免命中 Node 模块缓存导致重载仍读到旧代码
- **插件列表版本/作者显示修正**：目录插件无 `plugin.json` 时回退读取 `package.json`（版本/作者/描述），面板显示 v3.0.0 与作者
- **`.txt`/`.md` 不再作为插件展示**：插件列表与类型识别过滤文本文件
- **频道管理**：插件新增「频道列表 / 频道测试」命令，默认测试频道 ID `7989734378509876559`（可配置），复用引擎频道动作 `send_qq_channel_msg`/`get_qq_channel_list`
- **群开关**：群内命令「开启机器人 / 关闭机器人 / 全局开启 / 全局关闭」控制群级与全局开关
- **配置弹窗补充「关闭」按钮**：NapCat 兼容配置页（保存配置/重新加载/关闭）全中文

## 2026-08-20

### 插件回复 PHP 模板 + 群内绑定QQ自动填充个人信息（4.2.4）
- **插件回复 PHP 模板标记 `<php? 内容 php>`**：插件回复文本用该标记包裹时，系统（sendGroupMessage/sendPrivateMessage 统一出口）自动提取标记内内容作为正文，末尾追加尾部信息（config `bot.footer_text`，是什么就是什么，默认 `PHP · QQ机器人平台`）+ 底部广告（`bot.footer_ads` 随机一行）；无标记的消息原样发送不追加；面板「系统设置」新增「底部尾部信息」配置项
- **群内绑定 QQ 自动填充个人信息**：群内发送「绑定QQ QQ号」即可绑定（私聊同样可用），后端 `/api/bot/bind-qq` 同时写入用户列表（user_mappings）、所在群（groups 群信息 + group_members 成员归属），自动获取头像（`q1.qlogo.cn` 按 QQ 拼）、昵称（群内昵称）；绑定成功回复展示 QQ号/昵称/头像/所在群（群名+群号），走 PHP 模板自动带尾部信息与广告
- **个人信息留空修复**：绑定后 user_mappings 即时可查，菜单头部与「个人信息」命令的 QQ/头像/昵称自动填充；未绑定用户 QQ 显示「未绑定」、头像用首字母占位，不再空白
- **菜单统一渲染（普通项可点击触发子菜单 + 登录/赞助直达链接）**：主菜单/子菜单/子子菜单统一经 `sendMenu → 菜单 markdown` 渲染，每行 2 个；普通菜单项渲染为蓝色文字+`↗` 链接（点击 → `/click` 指令触发页 → 机器人自动在群里回复对应子菜单），仅 `url:`/`panel:` 项（登录/赞助）为直达链接；依赖面板「系统设置-面板域名 panel.host」配置，未配置时普通项与 `panel:` 项退化为纯文字、提示语自动切换为「输入菜单名即可触发」
- **去掉矩形按钮行**：撤销键盘按钮方案（`40034029 内联键盘行/列超限`、按钮文字截断），菜单不再重复纯文字列表 + 按钮行，恢复为单一菜单消息
- **菜单不再单独发头像图片**：text_link 模式菜单直接发送单条 markdown 键盘消息，移除单独的头像富媒体图片消息与 `__AVATAR__` 占位，避免菜单回复变成「一张图片 + 一段文字」两条消息
- **面板插件类型按文件后缀显示**：插件列表「类型」列按插件实际文件后缀展示（`.js` 显示 `js`，`.php` 显示 `php`，目录插件按目录内主文件后缀显示 `js·目录`/`php·目录`），不再硬编码为 PHP/JS
- **面板用户管理群信息显示完整 + 独立群行**：成员表格群信息列显示完整群 OpenID（不再截断前 8 位）；新增「机器人所在的群」区块，每个群独立成行读取完整信息（群头像/群名/群号/群ID/成员数/归属机器人/最后活跃），行内直接修改群名/群号保存、支持删除
- **点击菜单链接不回复修复**：`/api/click` 触发的 `message.group` 事件原先携带非法 `msg_id`（`click_<时间戳>`）导致 QQ 接口返回 `40011002 不支持的调用` 发送失败，且未携带 `botId` 导致多个机器人实例重复触发；现改为不携带 msg_id（走主动发送，不依赖被动回复 id）并按 `group_members` 最近 `bot_id` 注入 `botId` 过滤，点击链接后机器人正常回复到群
- **全插件统一菜单渲染**：qq-bot-plugins 8 个子模块（娱乐/系统工具/开关机/实用/授权/词典/群管/系统设置）统一 `sendReplyKB`（按钮数组→`{label,action}`→sendMenu）；独立插件（实用工具/娱乐中心/系统工具等）的 `sendReply` 确认走 `主菜单.sendMessage → sendMenu`；词典回复的 `keyboard` 配置改为走 sendMenu（原矩形按钮死代码移除）；清理 `buildLinks`/`buildClickUrl`/`toLinks`/`buildClickLinks` 等不再使用的旧链接函数；「模式设置」轮询去掉已移除的按钮模式
- **新增「文字按钮测试」插件**：发送「文字按钮测试」显示测试菜单（普通项可点击触发娱乐/实用/授权/系统子菜单 + 赞助/登录直达链接），配合「模式设置 文字/文字链接/图片」切换对比各模式显示效果，方便确认哪种模式可用
- **绑定命令兼容「绑定 QQ号」**：除「绑定QQ QQ号」外，「绑定 511742399」格式（绑定 + 空格 + 5-12 位数字）同样识别并执行绑定（群内/私聊均可），写入 user_mappings + groups/group_members
- **私聊回复 40011002 降级重试**：C2C 被动回复带 msg_id 报 `40011002 不支持的调用` 时，`sendPrivateMessage` 自动去掉 msg_id 主动发送重试一次，避免私聊回复失败（服务端需同步升级 dist）
- **图片菜单乱码修复**：图片菜单（image 模式）标题/菜单项前的 emoji（🎮🛠🔐 等）在 sharp/librsvg 无 emoji 字体时渲染成方块乱码，现 card.ts 渲染前统一过滤 emoji（stripEmoji），个人信息卡/群活跃看板同样处理；已验证 OCR 输出全部正常
- **支持单文件 .mjs 插件（ES Module）**：引擎新增 `loadMjsPlugin`——`plugins/*.mjs` 与 `.js` 一样自动发现、注册到插件管理页、支持启用/禁用/重载；上传接口支持 `.mjs` 文件直传；与 ZIP 插件的 index.mjs 采用同一真实 `import()` 加载机制，支持 `export default { manifest, onEnable }`
- **插件管理页支持设置界面（WebUI）**：单文件插件可用同名子目录 `plugins/{插件名}/webui/` 提供设置页，插件列表出现「设置」按钮打开 `/api/plugins/:id/webui`；新增 `/api/plugins/:id/config` GET/PUT 接口供设置页读写插件配置（config 表 `plugin.{id}.{key}`）；ZIP 插件 WebUI 入口兼容 package.json 的 `webui` 字段（如 `webui/dashboard.html`）
- **ZIP 插件自动安装依赖**：createFromZip 检测 package.json dependencies，缺失 node_modules 时自动 `npm install --production`（失败仅警告不阻断）
- **PHP 插件显示在插件管理页**：`plugins/*.php` 自动注册为 `php` 类型记录（仅展示与启停标记，执行仍由 php-plugin 桥负责）
- **支持 PHP 插件（菜单.php）**：新增 `src/core/php-plugin.ts` 执行器——扫描 plugins/ 下 `.php` 文件（含子目录 index.php），`php` CLI 执行（stdin 收消息 JSON、stdout 回回复 JSON，协议见插件头部注释），自动检测 php-cli 可用性（未安装则跳过并日志提示）；附带 `plugins/菜单.php` 菜单插件（发送「PHP菜单」查看，支持「PHP菜单 序号」查看单项）
- 打包产物：`qq-bot-plugins-4.2.4-all.zip` + `qq-bot-plugins-4.2.4-fix.zip`（15 个插件文件增量包，含 菜单.php/菜单.mjs）+ `qq-bot-server-4.2.4.zip`（dist 含私聊降级/图片菜单修复/PHP 插件执行器/.mjs 插件引擎/WebUI 设置 API）+ `菜单插件.zip`（菜单.mjs + 设置界面，可直接面板上传）；部署详见 `docs/部署文档-4.2.4.md`

### 反馈闭环 + 群信息按群同步 + 定时任务端口修复 + 文字游戏（4.2.3）
- **反馈闭环打通**：面板反馈页新增「回复」按钮（机器人私聊发送给反馈提交者，成功/失败均有明确提示）；群内超级主人新增「反馈列表」（最新 10 条含状态/ID）与「回复反馈 ID 内容」命令，共用后端 `feedbacks.reply/replied_at` 链路；超级主人判断跨 OpenID 按同一 QQ 号（`ctx.identity.isSameUser`）
- **主菜单新增「📩 反馈」入口**：主菜单两份同步 16→17 项，发送「反馈 内容」即可提交；成功提示「✅ 反馈已收到」，失败明确提示（不再静默）
- **@机器人昵称 触发修复**：菜单改为「@昵称 指令」形态后，点击菜单文本按钮会带 `@昵称` 前缀；所有插件 content 清洗统一为 `replace(/^\s*(?:<@!?[A-F0-9]+>|@\S+)\s*/,'')`（开关机控制/主菜单/qq-bot-plugins 三处同步）
- **定时任务不执行根因修复**：服务端启动时 `process.env.PORT = 实际监听端口`（面板改端口后插件内 `callLocalApi` 仍连 3000，导致 schedule-tasks/报时/反馈等本地 API 全失败）；现在 config server.port 优先，端口同步后定时任务/报时/反馈链路恢复
- **用户管理/成员同步按群展示群信息**：面板用户管理页与成员同步页按群组织，展示群头像（`p.qlogo.cn/gh/群号/群号/0`）、群号、群OpenID、群名；支持修改群名/群号（改群号自动生成群头像）、删除群（级联删成员）、成员改QQ/删除；按机器人/按群筛选 + QQ/昵称/OpenID 搜索
- **群信息自动绑定**：`groups` 表新增 `group_number/avatar/bot_id` 列；webhook 收到真实群号即绑定（自动写群号+头像）、NapCat 一键同步按群名匹配后回填群号；数据源与成员同步同源（groups + group_members + user_mappings 合并）
- **超级主人群内群管理命令**：「群列表」「修改群名 群OpenID 新名」「修改群号 群OpenID 新群号」「获取群信息 群OpenID」，新增 `/api/bot/groups/:id` PUT 接口（isLocal）
- **文字游戏页**：新增 `games/谁是卧底/index.html`（带封面图，内置 40 组经典词库，支持自定义词对、4-12 人发牌/投票/揭晓），通过 `链接 + games/谁是卧底/` 可访问
- 打包产物：`qq-bot-plugins-4.2.3-all.zip` + `qq-bot-server-4.2.3.zip`（含 `src/admin/web/index.html` 与 `games/`）；部署详见 `docs/部署文档-4.2.3.md`

### @机器人指令菜单 + 用户管理/反馈面板 + 报时文案配置（4.2.2）
- **文字链接菜单改为「@机器人昵称 指令」形态**：菜单项不再跳 `/click` 网页，改为显示 `@空空爱追剧 娱乐功能` 文本按钮（由 `ctx.engine.getBotName()` 读取机器人昵称，面板「系统设置-机器人昵称」可配置）；仅 `作者`/`登录` 等 `url:`/`panel:` 项保留链接跳转
- **菜单头部信息完整化**：所有菜单（主/子/子子）头部显示发送者 QQ头像图片、昵称、QQ 号、用户 OpenID，以及群名（`groups` 表缓存）、群 OpenID；底部 `PHP · QQ机器人平台` + 随机广告（`bot.footer_ads` 配置，每行一条随机取）
- **报时/播报文案随机 + PHP 标识**：整点报时（开关机控制）与定时播报（scheduler）文案改为多组随机（默认 3 组，支持 `{H}/{HH}/{MM}` 占位符），可在面板「系统设置-报时文案」配置；末尾统一追加 `PHP · QQ机器人平台`
- **定时任务发送链路加固**：scheduler `sendToGroups` 群表为空时告警跳过、逐群发送失败记录具体错误（不再静默吞掉）；`/api/bot/config` 新增 config 读取接口供调度器/插件使用
- **面板新增「用户管理」页**：展示机器人互动用户（user_mappings）头像（q1.qlogo.cn 按 QQ 拼图）/QQ/昵称/OpenID/所属机器人/最近更新，导航与 `switchPage` 接入
- **面板新增「反馈」页**：插件新增「反馈 内容」命令 → POST `/api/bot/feedback` 写入 `feedbacks` 表；面板展示列表（状态/用户/QQ/内容/时间），支持标记已处理/待处理、删除（超级主人）
- **超级主人后台配置**：系统设置新增 机器人昵称 / 报时文案 / 菜单底部广告 三个配置项（config 表 `bot.name`/`bot.chime_texts`/`bot.footer_ads`），保存后重启生效
- 打包产物：`qq-bot-plugins-4.2.2-all.zip` + `qq-bot-server-4.2.2.zip`（含 `src/admin/web/index.html`，部署后直接生效）；部署详见 `docs/部署文档-4.2.2.md`

### 文字按钮模式修复 + 截图形态主菜单（4.2.1）
- **文字链接模式重写为截图形态**：`sendMenu` 的 text_link 分支改为「黑色多列文本按钮区（`|` 分隔）+ 蓝字链接区（`emoji 名称↗`，每行 3 项）+ PHP·广告底部」两段式布局，标题 `**🌟 主菜单 🌟**` 加粗，替代原编号列表
- **读取发消息者头像**：text_link 模式改走 `sendGroupMarkdownWithImage`——先以富媒体图片消息发送发送者头像（`ctx.identity.getQQ(openid)` 映射 → `q1.qlogo.cn`），再发 markdown（QQ 平台不支持 markdown 图片语法，占位 `![头像](__AVATAR__)` 成功后移除）
- **底部 PHP + 广告**：菜单底部固定 `PHP · QQ机器人平台` + `footer_ad_主菜单` 广告（可后台设置），修复原 text_link 底部缺失问题
- **主菜单截图化**：`qq-bot-plugins/index.js` 与 `开关机控制.js` 主菜单项改为短名+emoji（🎮 娱乐/🛠 实用/🔐 授权/⚙ 系统/🔧 设置/📋 DIC/👥 群管/⚡ 系统菜单/❓ 帮助/📊 群信息/📣 频道管理/🎵 唱歌/💖 赞助/✉ 拉我进群/👤 作者/🔑 登录），标题 `🌟 主菜单 🌟`
- **登录/反馈跳转链接，其余触发指令**：`作者`（反馈）改跳 `wpa.qq.com` 临时会话链接（`url:` 前缀）、`登录` 跳面板首页（`panel:/` 前缀），其余 14 项走 `/click` 触发指令进入子菜单（按钮行为）
- **取消按钮模式残留清理**：`getGlobalMode` 默认值 `button`→`text_link`（开关机控制 methods + handlePower 本地函数）；`DIC管理.js` 模式设置移除 button、支持 图片；`qq-bot-plugins`/`主菜单.js` 帮助文案与「按钮模式」命令改为提示已移除
- 全部子菜单路由核对完整：16 项均有对应子菜单/独立插件/链接
- 打包产物：`qq-bot-plugins-4.2.1-all.zip` + `qq-bot-server-4.2.1.zip`；部署详见 `docs/部署文档-4.2.1.md`

### 菜单三模式重构 + 图片菜单 + 唱歌点歌（4.2.0）
- **菜单三模式**：全局菜单形态改为 `文字` / `文字链接`（新默认）/ `图片` 三种，取消原 button（内联键盘）模式；`setGlobalMode` 白名单与默认值同步更新（`text/text_link/image`），群内发送「切换全局模式 图片/文字/文字链接」切换
- **图片菜单（新增 sendMenuCard）**：服务端新增 `renderMenuCard`（760 宽深色卡片：渐变标题栏 + 发送者头像/昵称/QQ 号 + 2 列菜单网格 + 底部 PHP 徽标）与 `sendMenuCard`（渲染 → 分片上传 → 群图片消息）；QQ 号经 `ctx.identity.getQQ(openid)` 后端映射，头像加载失败降级首字母占位
- **菜单统一中枢**：`开关机控制.js` 新增 `sendMenu`（三模式统一发送，text_link 用编号 + 蓝字链接 + PHP 尾注），`主菜单.js`、`qq-bot-plugins/index.js`（`sendUnifiedMenu`）、`按钮菜单.js` 全部经 `callPlugin('开关机控制','sendMenu',...)` 复用；主菜单/系统菜单/子菜单/欢迎消息/快捷菜单全部三模式化
- **唱歌点歌（新增插件）**：`plugins/唱歌.js`，匹配「唱歌/点歌/唱首歌/听歌/我要听/听首歌/点首歌/来一首 + 歌名」，返回 QQ音乐/网易云/酷狗/酷我 4 平台 markdown 点歌链接卡片，兜底纯文本；主菜单新增「唱歌」入口
- **面板插件类型标签**：插件管理表格新增「类型」列，zip 目录型插件显示 `PHP·目录`、单文件插件显示 `PHP` 标签
- **遗留按钮调用清理**：新成员欢迎消息、`按钮菜单.js` 快捷菜单改三模式；`词典回复.js` keyboard 类型在非 button 模式退化为文本；其余子模块按钮调用均有 `mode==='button'` 保护（默认 text_link 下不触发）
- 打包产物：`qq-bot-plugins-4.2.0-all.zip`（全量插件含唱歌.js）+ `qq-bot-server-4.2.0.zip`（dist，含 sendMenuCard）；部署详见 `docs/部署文档-4.2.0.md`

## 2026-08-19

### 主菜单挂载新增功能 + 打包上传修复（ac 包）
- **新增功能挂进主菜单**：主菜单（qq-bot-plugins）新增「📊 群信息」「📢 频道管理」入口按钮与路由——频道管理经 `callPlugin` 调独立插件，群信息让事件传播给独立插件响应；文字/文字链接模式菜单文本同步；旧版 `plugins/主菜单.js` 与数据库 `file-主菜单` code 同步（含频道管理路由、群管子菜单群信息按钮）；系统设置「管理频道/频道人员」占位提示改为引导使用完整频道管理
- **修复 zip 上传写错库 + 破坏目录结构**：面板上传 zip 分支弃用「手工解压 + `require('better-sqlite3')(pluginsDir/../data/bot.db)` 硬编码路径新建连接」，统一走 `engine.createFromZip`（保留多层目录结构、写库走 `getDb()` 单例、同名覆盖语义保留）；approve/reject/插件列表/文件保存重载等 6 处硬编码 DB 连接全部替换为 `getDb()`
- **Secret 更新即时生效**：新增 `BotCore.updateSecret`；面板改机器人/主机器人 AppSecret 后同步 BotCore 并清 token；registry `updated` 事件清除 WebhookManager 缓存
- **定时任务按群/用户归属路由**：群操作与私聊发送在无消息链路上下文（定时任务/面板）时按 `group_members.bot_id` / `user_mappings.bot_id` 选择对应机器人；webhook 私聊/群消息记录 bot_id

### 多机器人平台化（v 包）
- **webhook 验签按机器人路由**：QQ 平台回调请求头 `X-Bot-Appid` 标识来源机器人，服务端据此选择对应机器人的 AppSecret 验签（旧版用全局 config 密钥，多机器人时必然 401）；`?app_id=` 仅作兼容兜底
- **独立 BotCore 实例**：各机器人独立 `access_token` 与发送能力，启动时按 registry 自动注册；webhook 事件携带 botId，插件回复经 AsyncLocalStorage 路由到对应机器人发送，实现真正的多机器人并行
- **新增机器人不再覆盖 config 主机器人**：编辑非主机器人 AppSecret 仅存 registry 不写 config；修改 Secret 后自动清除该 app_id 的 WebhookManager 缓存，下次校验用新密钥重建

### 诊断增强（w 包）
- **详情页「测试回调」按钮**：一键模拟回调推送，验证机器人验签与事件链路
- **webhook 路由日志**：回调请求按机器人记录路由明细，便于排障
- **WebhookManager 缓存清除逻辑**：机器人 AppSecret 变更后缓存即时失效

### 权限模型与密码策略（x 包）
- **插件按机器人分配运行**：新增 `bot_plugins` 表（bot_id=AppID、plugin_id、assigned）；EventBus 事件带 botId 时按监听者插件分配过滤——机器人无任何分配记录则全局模式（全部已启用插件响应），有分配记录则仅 assigned=1 插件响应
- **插件分配接口**：详情页可为机器人分配/取消插件；超主可分配任意机器人任意插件，归属者只能给自己归属的机器人分配「自己上传或已审核」的插件
- **登录密码策略改为可跳过**：`/api/auth/me` 返回 `shouldRemind`，不强制修改；小主人/会员未改过或改过距今 ≥10 天时提醒，超主不提醒
- **激活码用户改码走 auth_codes 表**：校验旧码、查重、`password_changed_at` 按人记录；admin 用户改密码经 `auth.updateUser` 同步内存与 admin.json

### 管理面板手机端适配（y 包）
- 未包 table-wrap 的表格手机端 display:block + 横向滚动（机器人详情、插件分配、群管理、ZIP 文件列表、插件文档/更新日志/测试结果等）
- 代码编辑页文件列表手机端改整行显示、长代码换行、行号 gutter 减窄

### 稳定性与群管身份（z 包）
- **AccessToken 失效自动恢复**：`apiCall` 统一拦截 401/11244，自动清除 token → 重新获取 → 重试一次（防死循环）；`uploadGroupImage` 同步支持；定时推送等无人触发的 401 也能自愈
- **群列表/成员/操作按机器人路由**：面板群管理全部改用对应机器人的 BotCore（`getBotInstance(bot.appId)`），不再误用全局主机器人；群列表按 `group_members.bot_id` 反查该机器人群（无记录兜底全部群）；远程在线成员与本地记录合并
- **禁言提示带用户身份**：插件新增 `ctx.identity.getInfo(openid)`（返回 QQ号+昵称）；手动禁言提示「QQ号+昵称 你已被禁言 N 分钟」，巡查自动禁言提示「违规信息「词」+QQ号+昵称+禁言时长」
- **面板展示完整 OpenID**：群下拉显示「群名 (群OpenID)」，成员映射表 OpenID 完整展示
- **侧边栏可滚动**：小屏下「退出登录/修改授权码」等底部按钮不再被裁掉

### 小主人机器人插件回退 + 激活码按机器人隔离（aa 包）
- **插件回退**：小主人机器人存在分配记录但无任何已审核（assigned=1）插件时，事件自动回退使用超主机器人（config 主机器人）的插件分配；无分配记录的全局模式行为不变；超主机器人自身不回退
- **激活码绑定机器人**：`auth_codes` 表新增 `bot_id` 列；小主人/会员生成的激活码绑定其所在机器人（生成时自动传入当前机器人 AppID），激活时校验机器人不匹配即拒绝（「该激活码仅限在指定机器人激活」）；超主生成的激活码全局可用
- **权限收紧**：非超主只能生成 会员/小主人 激活码，尝试生成 超级主人 角色自动降级为会员；生成激活码命令由「仅超主」放宽为「超主/小主人」
- **展示**：面板授权码管理、机器人端授权码列表均标注所属（全局 / 超主机器人 / 机器人:AppID）

### 巡查与禁言修复（ab 包）
- **修复巡查开启后不生效**：开启巡查时只展示默认违规词却不写入存储，从未执行过「巡查设置」的群因无关键词永不触发；现开启时自动写入默认词（垃圾|滚|傻逼）
- **修复巡查/全禁拦截失效（崩溃级 bug）**：`onEnable` 消息监听闭包误用 `self._isAnyMaster`/`self._getUserInfo`，而 engine 构造的插件实例中方法位于 `self.methods` 下，导致监听器每次触发抛 TypeError，全禁拦截与违规巡查完全失效；已改为 `self.methods.*` 并本地端到端验证
- **禁言/解禁/踢人支持 QQ 号与群昵称定位成员**：输入 QQ 号自动经 user_mappings 反查对应机器人的 openid（优先当前机器人），输入群昵称自动匹配群成员，不再要求必须 @openid
- 群管理工具版本 v3.1.0 → v3.2.0

## 2026-08-06

### 修复
- **成员列表 QQ 号不显示（显示「暂无QQ号」）**：
  - 根因：`getAllGroupMembers` 的 `qq_id` 只取 `group_members.qq_id`（webhook 收录时基本为空），而绑定 QQ 存在 `user_mappings`；头像/权限已用 `user_mappings` 回退（所以头像能显示），行内 `qq_id` 却没回填
  - 修复：`collect` 返回回填后的 `qq`，成员行 `qq_id`/`source` 使用该值（绑定用户显示「已映射」+ QQ 号）
- **群名「未知群」**：
  - 根因：`groups` 表只记录群活动（`recordGroupActivity`），从不写群名；QQ 官方「获取群基础信息」接口实测返回 11253（仅白名单机器人），无法自动获取
  - 修复：面板群管理新增「设置群名」入口（`PUT /api/bots/:id/groups/:groupId/name` + 前端按钮），手动填写后 `userinfo`/成员列表立即显示正确群名

### 新增（面板）
- **超级主人成员管理（编辑 QQ / 删除）**：
  - 成员列表每行新增「改QQ」「删除」操作按钮（仅超级主人可用，非超主返回 403）
  - `PUT /api/napcat/members/:openid/qq`：写入 `user_mappings`（权威绑定）+ 回填 `group_members.qq_id` + 同步 `admin.json` 中该 openid 的 qq/avatar，实现跨页面串联（个人信息/权限/群管/成员列表一致）
  - `DELETE /api/napcat/members/:openid`：解绑 `user_mappings` + 删除 `group_members` 记录；`admin.json` 中该 openid 仅清空 qq/avatar（保留账号与角色，面板权限仍按 openid 生效）

## 2026-08-05

### 修复
- **个人信息头像富媒体上传修复（QQ 群文件上传接口参数错误）**：
  - 根因1：`uploadGroupImage` 用 multipart `file` 字段传二进制，而官方 `/v2/groups/{group_openid}/files` 需传媒体资源公网 `url` + `file_type`（实测缺 file_type 报 10000，二进制 file 报 850026）
  - 根因2：`sendGroupMarkdownWithImage` 取 `up.url`，而整文件上传响应只有 `file_uuid`/`file_info`（raw_url 仅分片），导致上传成功后仍降级「头像：未绑定QQ无法获取」
  - 修复：`uploadGroupImage` 改为 `file_type=1` + `srv_send_msg=false` + `url=<头像公网URL>` + `file_name`；`sendGroupMarkdownWithImage` 优先用上传返回 `url/raw_url`，否则回退公网原始 URL，仅当无头像才降级文本
  - 实测：url 方式上传返回 200（file_uuid/file_info）；删除了不再使用的 `downloadImage`
  - 待用户在群里发「个人信息」验证头像显示

### 新增（面板）
- **修复：ZIP 插件子文件无法读取/编辑**：
  - 根因1：Express 4 不支持 `*filepath` 命名通配符，`GET/PUT /api/plugins/:name/files/*filepath` 从未命中，zip 子文件读取实际落到 SPA fallback 返回 index.html
  - 根因2：前端 zip 插件「代码」按钮调 `/api/plugins/:name/code`（只按 `plugins/<name>.js` 查找），zip 是目录 → 404 `Plugin file not found`
  - 修复：后端通配符改为 `*` + `req.params[0]`；`PUT` 保存后自动重载对应 ZIP 插件（改完即生效）；前端 zip 插件按钮改为「文件」，弹出子文件列表选择编辑
  - 实测：文件列表 17 个、读取 utility.js/index.js 200 JSON、PUT 保存 200 `{reloaded:true}`、插件重载后仍启用
- **仪表盘「重启机器人」按钮**：仪表盘「快速操作」新增「重启机器人」按钮，复用 `POST /api/system/restart`（重启整个服务进程并重新加载全部插件，网页自动重连）；`restartServer()` 兼容无 `restartMsg` 容器场景，静态页即时生效无需重启服务
- **实用功能插件去重修复**：旧 `plugins/实用工具.js` 实用功能全部命令（每日备注/每日打卡/设置昵称/查询天气/个人信息）静默退出，旧 `plugins/主菜单.js` 的「实用功能」子菜单静默，统一由 `qq-bot-plugins/utility.js` 处理（含QQ/OpenID/头像图片，数据与面板同源），消除 EventBus 广播机制下新旧两套插件的重复回复与旧格式冲突
- **文件管理增强**：
  - **目录大小**：`/api/files/list` 目录项递归计算总大小，不再显示 0 B
  - **多选打包下载**：勾选多项后「下载为 ZIP」一次打包下载（`POST /api/files/download-zip`，目录递归打包、自动去重）
  - **移动文件**：每行新增「移动」按钮，输入目标目录即可移动文件/目录（`POST /api/files/move`，自动建目标目录、同名冲突报错）
  - **多文件上传**：上传弹窗支持一次选择多个文件（`POST /api/files/upload` 支持 files[]）；新增「ZIP 自动解压到当前目录」勾选，上传的 zip 完成后自动解压（`adm-zip`）
  - 编辑弹窗保持完整：行号、语法语言标签、Tab 缩进、Ctrl+S 保存、Esc 关闭
- **修复：个人信息/私聊命令失效 + 文件下载无反应**：
  - 根因1：`plugins/qq-bot-plugins/utility.js` 个人信息 markdown 拼接残留多余 `)` 导致语法错误，整个 qq-bot-plugins 插件 import 失败 → 新个人信息/私聊绑定全部失效，只剩旧插件回复旧格式
  - 修复 utility.js 语法；旧插件 `实用工具.js`、`签到系统.js` 的「个人信息」改为静默跳过，统一由 qq-bot-plugins/utility.js 走后端 userinfo（QQ号/OpenID/头像图片）
  - 私聊「绑定」「用户管理」等命令此前未命中 `handleAuthCode` 路由：`handlePower` 触发条件补充 `绑定`/`用户管理`/`管理用户`/`用户列表`/`新增用户`/`修改用户`/`删除用户`，私聊发「绑定」超管将看到用户管理菜单
  - 根因2：前端文件下载用 `POST /api/files/download`（body `{path}`）与 `POST /api/files/download-zip`（body `{paths}`），后端此前仅有 GET 路由 → 404 无反应；新增对应 POST 兼容路由
  - 实测：POST 单文件下载 200（CHANGELOG.md 17KB）、POST ZIP 打包 200（application/zip）；插件全部 `node --check` 语法通过
- **超级主人群/私聊用户管理（读写与面板用户管理同源）**：
  - 新增机器人端接口 `/api/bot/admin-users`（GET 列表 / POST 新增 / PUT 修改 / DELETE 删除），`operator` 传发送者 OpenID，后端校验其为 admin.json 超级主人才放行；禁止删除超级主人
  - 插件新增命令（群/私聊均可）：`用户管理`/`用户列表` 查看、`新增用户 QQ号：x OpenID：y 昵称：z 角色：会员/主人`、`修改用户 用户名：x QQ号：y`、`删除用户 用户名：x`；私聊发「绑定」时超管看到管理菜单提示
  - 后端 `PUT /admins/:username` 放开：超级主人可修改任意用户（含自己）的 QQ/OpenID，空值提交不覆盖已有值
  - 前端编辑弹窗 QQ/OpenID 恢复可编辑（超管）；「QQ号绑定」输入框可改
  - 数据源统一为 admin.json（用户管理页），头像仍由 userinfo 自动保存
  - 实测：非超管操作被拒、增/改/删全通过、删除超管被保护、超管可修改已有用户绑定、测试数据已清理
- **富媒体上传结果写入运行记录**：
  - `uploadGroupImage` 成功/失败时调用 `addSystemLog` 写入面板「运行记录」（category=bot）：成功记录 `url` 与 `file_info`，失败记录错误信息
  - 已在面板运行记录页可查（category=bot）；编译通过，服务已重启
- **头像图片真实显示（走 QQ 官方富媒体上传）**：
  - 修复 markdown 直接引用 qlogo 外部域名只显示 `[图片]` 占位的问题
  - 新增 `BotCore.uploadGroupImage()`：下载头像 → multipart 上传 `/v2/groups/{group_openid}/files` → 获得 QQ 校验过的图片 URL
  - 新增 `sendGroupMarkdownWithImage()`：把 markdown 中 `__AVATAR__` 占位替换为富媒体 URL 后发送（上传失败自动降级为「头像：未绑定QQ无法获取」）
  - `BotAPI` 类型与 server.ts `ctx.bot` 注入同步扩展；utility.js 个人信息调用新方法
  - 已验证：qlogo 头像可下载（64KB JPEG）、占位替换/降级逻辑正确；上传环节需真实群实测
- **用户管理：编辑持久化修复 + QQ/OpenID 绑定保护 + 头像图片展示**：
  - 修复 `PUT /admins/:username` 不写回 `admin.json` 的 bug：新增 `AdminAuth.updateUser()`（Object.assign + saveAdmins），昵称/头像/角色等编辑真正持久化
  - QQ 号与 OpenID 绑定后不可修改：后端仅在原值为空时允许首次设置；前端编辑弹窗与「QQ号绑定」输入框已有值时置灰只读（提示「绑定后不可修改」），编辑未改字段保持原数据
  - 个人信息头像改为图片展示：`sendMarkdownGroup` 发送 markdown，头像用 `![头像](qlogo URL)` 在群内以图片形式显示（失败自动降级为纯文本）
  - 头像 URL 已自动保存到 `admin.json` 用户资料（`syncAdminProfile`），用户管理弹窗可手动设置头像 URL
  - 实测：nickname 修改持久化生效；尝试改已绑定 QQ/OpenID 被拒绝（保持原值 511742399 / 948C...）
- **修复「个人信息不显示 QQ 号」根因（OpenID 污染 user_mappings）**：
  - 根因：`src/core/webhook.ts` 把 QQ 开放平台回调的 `author.id`（OpenID，含字母）误当作 QQ 号，在每条群消息到达时执行 `setUserMapping(openid, openid)`，把绑定命令刚写入的 QQ 号覆盖回 OpenID，导致个人信息永远显示「未绑定」
  - 修复：仅当 `author.id` 为 5-12 位纯数字（NapCat 真实 QQ）时才写入 `user_mappings`/`group_members`，OpenID 一律不写；`recordMember` 同步防护
  - 已清理历史脏数据（11 条 qq_number=OpenID 记录置空待重绑、8 条 group_members 污染 qq_id 清空）
  - 实测：模拟开放平台回调（author.id 为 OpenID）不再写入映射表；NapCat 场景（真实 QQ）正常写入；绑定 511742399 → userinfo 返回 QQ+头像+超级主人角色；admin.json 自动学习 openid/avatar/nickname
- **个人信息自动同步（OpenID/头像 回写面板用户）**：
  - 群成员在群里发「个人信息」时，后端 `/api/bot/userinfo` 自动将成员的 OpenID、QQ头像、群昵称 同步保存到 `admin.json` 对应面板用户资料（先按 openid 匹配，再按 QQ号匹配）
  - OpenID 已关联面板用户后，即使未单独绑定 QQ 号，也能通过 openid 反查该用户的 QQ号/头像/角色，个人信息完整显示
  - 实测：绑定过 QQ 的成员发个人信息 → 面板用户自动获得 openid/avatar/nickname；删除绑定后再次查询仍能反查 QQ 与头像
- **用户管理补全**：
  - 用户资料扩展：昵称 / 头像 / OpenID 三字段（`admin.json` + 前后端全链路支持），列表用户名旁显示昵称、QQ号列悬浮显示 OpenID
  - 「添加用户」弹窗补齐：用户名、昵称、头像(URL)、OpenID、QQ号、授权码、角色、过期时间；「编辑用户」弹窗为完整字段（用户名只读/昵称/头像/OpenID/QQ号/角色/授权码留空不改/可登录/过期时间含快捷设置 + 编辑权限入口）
  - 添加/编辑用户弹窗改为两列紧凑布局，一屏内完整显示所有字段，窄屏自动回退单列
  - 后端 `POST/PUT /api/auth/admins` 支持 nickname/openid/avatar/role/expireAt 字段，`GET /api/auth/admins` 返回完整资料
- **激活码角色体系扩展为三种**：`超级主人 / 小主人 / 会员`（super_master / master / member）：
  - 后端 `bot-auth-codes.ts` / `bot-system.ts` / `auth-codes.ts` 新增统一的 `normalizeRole()` 角色规范化，生成接口支持中文与英文角色名（超级主人/超主/小主人/主人/会员 等），非法值回落到 member
  - 后端可修改授权码信息：机器人端 `PUT /api/bot/auth-codes` 与面板端新增 `PUT /api/auth-codes/:id`（改角色、改有效期，0=永久）
  - 面板授权码管理新增「修改」按钮与修改弹窗（角色下拉含超级主人），列表角色标签含超主/小主人/会员
  - 插件 `index.js` / `auth.js` 的 `grantRole` 支持 super_master：激活超级主人激活码即设置 super_master_id，已存在其他超主时拒绝覆盖
  - `开关机控制.js` 旧激活码路径同步支持三种角色生成与激活
  - 授权码登录面板角色映射支持 super_master；`个人信息` 授权角色中文标签支持超级主人
  - 群命令：`生成激活码 [超级主人|小主人|会员] [分钟]` / `修改授权码 <CODE> <member|master|super_master|永久|分钟>` / `删除授权码 <CODE>`
  - **旧路径统一走后端**：`开关机控制.js` 的「生成激活码 / 激活授权码」由本地 activation_codes storage 改为调用本机 `127.0.0.1:3000/api/bot/auth-codes`（生成写入后端、激活 verify 标记 used_by 返回角色），与面板授权码管理使用状态实时一致；`授权系统.js` 菜单转发链路随之同步
- **修复群内激活授权码失效**：
  - `qq-bot-plugins/index.js` 的 `handlePower` 调用 `handleAuthCode` 时 `userId` 未定义，导致 `激活授权码 xxx` 命令抛 `ReferenceError: userId is not defined` 静默失败（日志 `Error in listener ... ReferenceError`），已补 `var userId = authorId`
  - QQ 平台 @机器人 前缀可能为 `<@openid>` 或 `@昵称` 两种形式，原 strip 正则仅匹配 `<@HEX>`；已统一扩展为 `/^\s*(?:<@!?[A-F0-9]+>|@\S+)\s*/`，`index.js`/`auth.js`/`开关机控制.js`/`授权系统.js` 四处同步修改，`@机器人 激活授权码 xxx` 与 `<@openid> 激活授权码 xxx` 均能正确识别命令
- **个人信息完整化（OpenID 统一身份匹配）**：
  - 后端 `bot-system.ts` userinfo 增强：返回 `panel_role`（按 QQ 号/OpenID 匹配 `admin.json` 角色，与成员同步页权限列同源）与综合 `permission` 字段；`napcat.ts` 导出 `loadAdminRoleByQQ` 复用
  - 插件 `utility.js`「个人信息」重排：头像、群名、昵称、QQ号、OpenID、权限、授权状态、连续打卡、今日备注
  - 权限判断以 OpenID 一致匹配主人系统（`super_master`/`mini_masters`/`members`）优先，其次面板角色、激活码角色；`index.js` methods 补 `isMember`

### 新增（面板）
- **授权系统插件与后端彻底串联**（修复授权码链路全部 404 的断点）：
  - 后端 `src/api/bot-auth-codes.ts` 补齐插件实际调用的 5 个接口：`POST /api/bot/auth-codes`（生成，支持角色+有效期）、`GET`（列表）、`PUT`（修改 role/有效期）、`DELETE ?code=`（删除）、`POST /auth-codes/verify`（激活，标记 used_by 并返回角色）；原 `generate`/`activate` 保留兼容
  - 群命令全链路打通：`生成激活码 [master|member] [分钟]` / `授权码列表` / `删除授权码 <CODE>` / `修改授权码 <CODE> <member|master|永久|分钟>` / `激活授权码 <CODE>`，数据与网页面板授权码管理同源（生成后面板立即可见，激活后立即显示"已使用于"）
  - 修复 `index.js` 引用未定义函数 `internalHandleAuth` 的隐患；`auth.js` 子菜单「激活授权码」由本地 storage 改为走后端 verify，激活成功同步写插件 mini_masters/members 角色
  - 修复 verify 时 `setUserMapping` 会清空已绑定 QQ 的问题（仅首次建映射，不覆盖已有 QQ 号）
  - 修复 ZIP 插件启用后立即被禁用问题（DB `enabled` 置为 1）
- **运行记录增强**（系统日志 → 运行记录页）：
  - **多选删除**：每条记录前加复选框 + 表头全选，选中后点「删除所选(N)」批量删除（`DELETE /api/system/system-logs` body `{ids:[...]}`）
  - **清空记录**：一键清空全部运行记录，清空后新消息继续自动收集（`DELETE /api/system/system-logs?all=1`）
  - **完整展示**：列表最多显示 500 条并显示总数「共 N 条记录（仅显示最近 500 条）」；用户/群 OpenID 不再截断为 12 位，改为完整显示（word-break 换行），内容与详情完整展示
  - 删除/清空仅超级主人可用（按钮按角色显隐 + 后端 `requireSuperMaster` 双重保护），普通会员读列表正常、删除返回 403
- **成员信息收集与展示**（成员同步 → 所有群成员）：新增「头像」「授权码」「权限」三列，表格扩为 群名/头像/昵称/QQ号/来源/OpenID/授权码/权限
  - **头像**：有真实 QQ 号自动拉取 QQ 头像（qlogo）；无 QQ 号显示昵称首字占位
  - **授权码**：显示该成员（OpenID 或 QQ 号）使用过的授权码与角色（小主人/会员），未使用显示"未使用"
  - **权限**：通过 QQ 号/OpenID 匹配管理面板用户，显示 超级主人/主人/会员/普通用户；无匹配显示"普通成员"
  - 后端 `GET /api/napcat/all-members` 为每个成员统一收集返回 `avatar`/`auth_code`/`auth_role`/`permission` 字段
- **修复 QQ 号列显示 OpenID 污染**：历史数据把 OpenID 误写入 `group_members.qq_id`/`user_mappings.qq_number`，QQ 号列现仅展示真实 QQ 号（5-12 位纯数字），OpenID 仅显示在 OpenID 列（完整值悬浮可看）
- **重启服务器按钮**（系统设置 → 管理面板配置）：真实重启整个 node 进程（spawn 新进程 + 就绪标记握手，`reusePort` 双进程短暂共存，新进程就绪后旧进程自动退出），重启后自动重新加载全部插件代码（含 ZIP 插件），网页自动刷新恢复
- **插件开关按钮**（插件管理）：每个插件一行「启用/禁用」独立开关 + 状态列（✅ 已启用 / ⏸ 已禁用），超级主人可单独开/关任意插件（接口 `POST /api/plugins/:id/toggle`）
- 插件列表接口新增返回 `id`/`enabled` 字段（ZIP 插件从 DB 补查）

### 新增（插件 v4.1.0）
- **定时播报**：插件命令「定时播报 创建 <报时|天气|早报|晚报|文本> <HH:MM|每N分钟> [城市 城市] [群 群] [内容 文本]」，到点自动向群播报（走后端 config 表，重启不丢失）
- **定时开关**：插件命令「定时开关 创建 <开关名> <开|关> <HH:MM>」，到点自动开/关指定功能
- **功能开关按钮菜单**：插件「系统功能 → 功能开关」一键开/关每日早报/晚报、整点报时、天气播报、定时播报、欢迎语、退群提示、签到系统；状态与网页面板同步
- **定时任务管理**：插件命令「定时任务列表 / 定时任务 删除|启停 [ID]」，网页面板 系统设置 页新增「功能开关」「定时任务」卡片
- **在线时间增强**：显示当前北京时间（年月日 星期 时分秒）+ 已运行时长 + 服务器本地时间与时区
- **后端 API 帮助文档**：`docs/插件API帮助文档.md` 汇总全部 /api/bot/* 接口（功能开关/定时任务/版本/更新日志/在线时间/群列表/天气/用户信息/QQ绑定/授权码/面板登录开关），供后续编写插件调用
- **后端共享模块** `src/shared/bot-controls.ts`：开关注册表 + 定时任务 CRUD，插件按钮菜单/调度器/网页面板三方同源

### 修复
- **修复授权码登录网页闪退**：服务器被重复启动为多个实例共享 3000 端口（SO_REUSEPORT 负载均衡），各实例启动时用 `Date.now()` 生成不同的 jwtSecret，登录 token 由实例 A 签发、后续请求被内核路由到 B/C 后验证失败返回 401，前端收到 401 立即 `showLogin()` 弹回登录页，表现为「登录后闪退」；已改为 jwtSecret 持久化到 `data/jwt.secret`，重启/多实例共用同一密钥，token 跨实例可验证；并新增单实例锁 `.server.pid`，误启第二实例自动退出（重启子进程经 `QBOT_RESTARTING` 标记豁免）
- **后端更新日志可维护**：新增 `PUT /api/system/updatelog`（仅超级主人），面板「更新日志」页新增「编辑 / 保存 / 取消」按钮，内容直接写入 CHANGELOG.md，保存后立即刷新展示
- **插件「本版」文案**统一改为「版本」（旧插件 系统工具/主菜单 的 DB code 与磁盘文件均已同步）
- **服务器重启不再清除插件**：原 `/api/system/restart` 会 `pluginEngine.shutdown()` 清空插件且不重载，改为真实进程重启后彻底解决
- 插件 zip 套装启动后调度器常驻（DB enabled 状态修正）

### 文档
- **插件功能说明文档**：新增 `docs/插件功能/` 目录，覆盖全部 16 份插件说明（15 个旧插件各一份 + qq-bot-plugins 套装一份 + README 索引）
  - 每份文档含：简介、支持的命令表、功能模块、数据存储 key、外部调用、权限控制、维护提示
  - 已标注当前静默项：`实用工具.js`（整体静默）、`主菜单.js`「实用功能」入口、`签到系统.js`「个人信息」子命令
  - qq-bot-plugins 文档含 handlePower 完整命令路由表（SUB_MENUS/ENT_CMDS/UTIL_CMDS/AUTH_CMDS/SYS_TOOL_CMDS/SYS_SETTING_CMDS/DIC_CMDS/GROUP_CMDS/CHECKIN_CMDS）与 16 个子模块清单，命令表已与 `index.js` 实际定义核对一致

## 2026-07-26

### 修复
- **服务端编译**: `npx tsc` 编译通过，解决 TypeScript 类型错误
- **事件总线**: 修复 `message.group` 无监听者问题，所有插件 `enabled=0` 导致 `onEnable` 未执行
- **权限系统**: 同步 `super_master_id` 配置到所有插件的新 ID 键，修复权限检查失效
- **INTERACTION_CREATE**: webhook 新增按钮回调事件处理，支持内联键盘交互
- **插件自动启用**: `loadAllFromDb` 新增代码插件文件存在但 DB disabled 时的自动启用逻辑

### 优化
- Cache-Control 加强为 `no-store, no-cache, must-revalidate, max-age=0, private`
- 主菜单键盘 6行→4行 (4×3=12入口)，娱乐功能 7行→4行 (4×4)
- 群管理 UI 下拉化，群OpenID和成员OpenID改为下拉选择器
- 开关机控制插件添加权限调试日志

### 新增
- BotAPI 接口扩展: `deleteMessage`, `muteAll`, `deleteAnnouncement`
- Mock 补齐缺失方法，解决栈溢出
- 开发文档目录 `docs/`，含 CQ码参考和 go-cqhttp API参考
- 集成 NapCatQQ (external/NapCatQQ) 作为可选 QQ 连接方案

## 2026-07-25

### 修复
- **ZIP 替换**: 用 `qbot最新版本2-2.zip` 的 `plugins/` 和 `src/` 替换项目对应目录
- **登录修复**:
  - `authMiddleware` 公开路径检查兼容 `/api` 前缀
  - `/api/auth/login` 同时接受 `password` 和 `code` 字段
  - `index.html` 中 `doLogin()` 语法修复
- **主菜单双重调用**: 新增直接处理"主菜单"/"菜单"路由

### 新增
- 权限模型（超级主人/小主人/会员）
- 插件审批系统
- QQ 登录两步流程 (OAuth + 手动输入QQ号)
- 授权码系统
- Admin 持久化

## 2026-07-24

### 初始版本
- QQ Bot webhook 接收模块
- 插件沙箱执行引擎
- 管理面板 (HTML/Bootstrap)
- 数据库初始化 (SQLite)
- 基础插件集: 主菜单、开关机控制、词典回复、群管理、签到等
