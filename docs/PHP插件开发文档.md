# PHP 插件开发文档

本平台支持使用 PHP 编写机器人插件。将 `.php` 文件放入 `plugins/` 目录（根目录任意 `.php` 文件，或子目录下的 `index.php`），重启服务后自动加载。

- 环境要求：`php-cli`（已验证 PHP 8.2.32 可用）
- 可选扩展：`php-curl`（`curl()`/`http_get()`/`http_post()`）、`php-gd`（`Canvas` 画布类）。未安装时相关函数自动降级/不可用，不影响其他功能

## 一、运行机制

- 每条群/私聊/频道消息到达时，桥会把消息事件以 JSON 通过 **stdin** 传给每个 PHP 插件
- 插件处理完通过 **stdout** 输出 JSON：`{"replies":[回复项, ...]}`（也可用 `{"reply":回复项}` 单条）
- 输出内容会被原样解析并转换为对应消息发出；`stderr` 仅作日志，不影响回复
- 8 秒超时未返回或输出非 JSON 会被忽略
- 桥自动在插件源码前注入 `php_helpers.php` 辅助函数库，插件可直接调用，无需手动 require

## 二、输入事件字段（stdin JSON）

| 字段 | 说明 |
|---|---|
| `action` | 固定 `message` |
| `type` | `group` 群 / `c2c` 私聊 / `guild` 频道 |
| `content` | 消息文本 |
| `groupId` | 群 OpenID（群消息） |
| `channelId` | 频道/子频道 ID（频道消息） |
| `userId` | 发送者 OpenID |
| `msgId` | 消息 ID（可作被动回复 msg_id） |
| `botId` | 机器人 AppID |
| `botName` | 机器人名称 |
| `author` | 发送者对象 `{openid, username, ...}` |
| `panelBase` | 管理面板地址（外显链接用） |

## 三、输出回复项类型

每条回复项通过 `type` 指定类型，`content`/`imageUrl` 等携带内容：

| type | 说明 | 关键字段 |
|---|---|---|
| `text`（默认） | 普通文本 | `content` |
| `markdown` | markdown 消息（`[文字](https://...)` 外显链接可点击） | `content` |
| `image` | 图片：URL 或 base64 data URI | `imageUrl`（或 `content`），`fileName` |
| `voice` | 语音：URL（mp3/wav/ogg） | `voiceUrl`（或 `content`），`fileName` |
| `video` | 视频：当前以文本链接下发（QQ 群暂未开放视频文件） | `content` |
| `button` | 按钮键盘 | `rows`（二维数组），`content`（按钮上方文案） |
| `infocard` | 信息卡片 | `title`，`content`，`url` |
| `dashboard` | 群数据总览卡片 | 无 |
| `menu` | 图片菜单卡片 | `content`（菜单对象） |
| `recall` | 撤回某条消息 | `messageId` |

按钮 `rows` 示例：

```php
$replies[] = array('type' => 'button', 'content' => '请选择', 'rows' => array(
  array(array('text' => 'QQ机器人', 'url' => 'https://bot.q.qq.com/'), array('text' => '腾讯云', 'url' => 'https://cloud.tencent.com/')),
  array(array('text' => '第二行按钮', 'url' => 'https://qq.com/')),
));
```

## 四、辅助函数清单（php_helpers.php 自动注入）

### 数据读写（data/database 目录，自动加 `.json`）

| 函数 | 说明 |
|---|---|
| `读($name, $default = null)` / `read_data` | 读取 JSON；不存在/损坏返回 `$default` |
| `写($name, $data)` / `write_data` | 保存 JSON（UTF-8）；成功返回 `true` |
| `删($name)` | 删除数据文件 |

文件名自动过滤 `..`、`/`、`\`，杜绝目录穿越；数据隔离在 `data/database/` 内。

### HTTP 请求

| 函数 | 说明 |
|---|---|
| `curl($url, $method='GET', $data=null, $timeout=8)` | 通用请求；`data` 为数组时自动 JSON 编码；响应为 JSON 时自动解码为数组 |
| `http_get($url, $timeout=8)` | GET 快捷方式 |
| `http_post($url, $data, $timeout=8)` | POST 快捷方式 |

需要安装 `php-curl` 扩展；未安装时返回 `null`。

### 工具类

| 函数 | 说明 |
|---|---|
| `二维码($text, $size=300)` / `qrcode` | 返回二维码图片 URL（可直接 `回复图片()` 发送） |
| `域名大写($domain)` / `upper_domain` | 域名转大写 |
| `markdown转html($md)` / `md_to_html` | 简易 Markdown → HTML |
| `邮箱验证($email)` / `is_email` | 邮箱格式校验，返回 `true/false` |
| `html转图($html, $width=800)` / `html_to_image` | HTML 渲染为图片 URL（需配置渲染服务，见下） |
| `当前时间($fmt)` / `now` | 北京时间字符串 |
| `随机数($min, $max)` | 随机整数 |

### 回复构造（快捷生成回复项）

| 函数 | 等价回复项 |
|---|---|
| `回复文本($content)` | `{type:'text', content}` |
| `回复图片($url, $fileName='')` | `{type:'image', imageUrl, fileName}` |
| `回复语音($url, $fileName='')` | `{type:'voice', voiceUrl, fileName}` |
| `回复按钮($rows, $content=' ')` | `{type:'button', rows, content}` |
| `回复文卡($title, $content, $url='')` | `{type:'infocard', title, content, url}` |

### Canvas 画布类（需 `php-gd`）

用于动态生成图片：

```php
$c = new Canvas(640, 360, '#1a1a2e');      // 宽高、背景色
$c->rect(40, 40, 560, 280, '#16213e', true); // x,y,w,h,color,填充
$c->rect(40, 40, 560, 280, '#e94560');       // 描边矩形
$c->line(40, 160, 600, 160, '#e94560', 2);   // 线段
$c->circle(320, 160, 60, '#0f3460', true);   // 圆形
$c->text(200, 150, 'Hello', 28, '#ffffff');  // 文本（自动查找中文字体）
$b64 = $c->base64();                          // 转 data URI，直接回复图片
// 或 $c->save('example_canvas');             // 保存 PNG 到 data/database
```

### html转图 渲染服务

`html转图()` 默认未配置服务时返回空字符串。如需使用，搭建一个接收 `POST {html, width}` 并返回 `{url}` 的渲染服务，再在启动时注入常量即可（示例：`define('PHP_PLUGIN_HTML2IMG_URL', 'http://127.0.0.1:8899/render');`）。

## 五、示例插件

见 `plugins/php-example.php`，覆盖文本/外显链接/二维码图片/文卡/按钮/画布/工具函数。输入"菜单"查看全部命令。

## 六、最小插件模板

```php
<?php
$in = json_decode(stream_get_contents(STDIN), true);
if (!$in) { exit(0); }
$content = trim((string)($in['content'] ?? ''));
if ($content === '') { exit(0); }

$replies = array();
$replies[] = 回复文本('你说了：' . $content);
echo json_encode(array('replies' => $replies), JSON_UNESCAPED_UNICODE);
```

## 七、注意事项

- 所有回复通过 stdout 一次性输出；多条回复放 `replies` 数组依次发送
- 文件数据统一走 `读/写/删`，请勿直接写 `data/database` 之外路径
- 插件异常不要 `die/exit` 输出非 JSON 内容到 stdout
- 群归属多机器人场景：回复会自动路由到该群对应的机器人发送
