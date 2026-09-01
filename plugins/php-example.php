<?php
// PHP 插件示例：演示辅助函数与回复类型
// 协议：stdin 收 JSON 事件，stdout 输出 JSON {"replies":[回复项]}
// 事件字段：action/message, type(group|c2c|guild), content, groupId, userId, msgId, botId, botName, author{openid,username}, panelBase
// 回复项 type: text|markdown|image|voice|video|button|infocard|dashboard|menu|recall
// 详细说明见 docs/PHP插件开发文档.md

$in = json_decode(stream_get_contents(STDIN), true);
if (!$in) { fwrite(STDERR, "无效输入\n"); exit(0); }

$content = trim((string)($in['content'] ?? ''));
$replies = array();

// 每次收到消息先自增访问计数
$cnt = (int)(读('example_visits') ?? 0) + 1;
写('example_visits', $cnt);

if ($content === '') {
  exit(0);
}

switch ($content) {
  case '菜单':
  case 'help':
  case '帮助':
    $replies[] = 回复文本(
      "PHP 示例插件 v1.0\n" .
      "输入以下命令体验：\n" .
      "· 文本 - 演示文字回复\n" .
      "· 链接 - 演示外显 markdown 链接\n" .
      "· 图片 - 演示图片回复（二维码）\n" .
      "· 文卡 - 演示信息卡片\n" .
      "· 按钮 - 演示按钮键盘\n" .
      "· 画布 - 演示 GD 画布生成图片\n" .
      "· 工具 - 演示读/写/时间/邮箱等工具\n" .
      "· 转发 - 演示语音（需配置语音 URL）\n" .
      "今日访问：{$cnt}"
    );
    break;

  case '文本':
    $replies[] = 回复文本('你好！当前北京时间：' . 当前时间() . '，随机数：' . 随机数(1, 999));
    break;

  case '链接':
    // 外显文字链接：markdown 消息中 [文字](https://...) 可点击
    $replies[] = array('type' => 'markdown', 'content' =>
      "点击访问：[QQ 机器人文档](https://bot.q.qq.com/)\n" .
      "[个人主页](https://qq.com/)\n\n来自 PHP 插件");
    break;

  case '图片':
    // 二维码图片 URL → 桥自动上传并发送图片消息
    $replies[] = 回复图片(二维码('https://qq.com', 300), 'qrcode.png');
    break;

  case '文卡':
    $replies[] = 回复文卡('PHP 插件信息卡', "插件已收到你的消息：{$content}\n时间：" . 当前时间(), 'https://bot.q.qq.com/');
    break;

  case '按钮':
    // rows 为二维数组，每行多个按钮；text=按钮文字，url=点击跳转
    $replies[] = 回复按钮(array(
      array(array('text' => 'QQ机器人', 'url' => 'https://bot.q.qq.com/'), array('text' => '腾讯云', 'url' => 'https://cloud.tencent.com/')),
      array(array('text' => '示例按钮2', 'url' => 'https://qq.com/')),
    ), '请选择跳转目标');
    break;

  case '画布':
    if (class_exists('Canvas')) {
      $c = new Canvas(640, 360, '#1a1a2e');
      $c->rect(40, 40, 560, 280, '#16213e', true);
      $c->rect(40, 40, 560, 280, '#e94560', false);
      $c->line(40, 160, 600, 160, '#e94560', 2);
      $c->circle(320, 160, 60, '#0f3460', true);
      $c->text(200, 150, 'PHP Canvas', 28, '#ffffff');
      $c->text(180, 260, 当前时间(), 18, '#e0e0e0');
      $c->save('example_canvas');
      // Canvas::save 返回 data/database 下文件路径，此处改回 base64 图片直接发送
      // （实际生产建议保存后读取转图片 URL 或使用 base64）
      $b64 = $c->base64();
      $replies[] = array('type' => 'image', 'imageUrl' => $b64, 'fileName' => 'canvas.png');
    } else {
      $replies[] = 回复文本('GD 扩展未安装（php-gd），画布功能不可用。');
    }
    break;

  case '工具':
    $replies[] = 回复文本(
      "工具演示：\n" .
      "· 访问计数 read/write：{$cnt}\n" .
      "· 邮箱验证 123@qq.com：" . (邮箱验证('123@qq.com') ? '通过' : '失败') . "\n" .
      "· 域名大写：qq.com → " . 域名大写('qq.com') . "\n" .
      "· markdown转html：" . markdown转html('**加粗** [链接](https://qq.com)')
    );
    break;

  case '转发':
    $replies[] = 回复文本('语音演示需在配置中设置语音 URL（PHP_PLUGIN_VOICE_URL）。');
    break;

  default:
    // 未命中演示命令：保持静默，不回复任意消息（避免对每条消息都回复造成刷屏）
    break;
}

echo json_encode(array('replies' => $replies), JSON_UNESCAPED_UNICODE);
