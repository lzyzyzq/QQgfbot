<?php
// @description 复读插件：群内发送「开始」开始复读，发送「停止」立即停止；仅群主/管理员/超主可控制
// ------------------------------------------------------------
// 命令：
//   开始 / 开始复读 / 复读开始   → 开启本群复读
//   停止 / 停止复读 / 复读停止   → 立即关闭本群复读
//   其他任意群消息               → 开启状态下原样复读
// ------------------------------------------------------------
// 说明：PHP 插件每条消息独立进程执行，开关状态持久化到 data/database/复读状态.json，
//       因此「停止」在收到消息的当刻即写盘失效，后续消息不再复读（立即立刻停止）。
// 权限：开启/停止仅 超级主人 / 群主 / 群管理员 可用（与终端插件一致）。

$in = json_decode(stream_get_contents(STDIN), true);
if (!$in || !is_array($in)) { fwrite(STDERR, "无效输入\n"); exit(0); }

$类型 = (string)($in['type'] ?? '');
$消息 = trim((string)($in['content'] ?? ''));
$群   = (string)($in['groupId'] ?? '');
$用户 = (string)($in['userId'] ?? '');

if ($类型 !== 'group' || $群 === '') exit(0);

// 状态按「机器人 + 群」隔离：多机器人同库时各机器人独立开关，互不串扰
$botId = getenv('PHP_PLUGIN_BOT_ID');
$botId = $botId !== false ? (string)$botId : '';
$状态键 = ($botId !== '' ? $botId . '@' : '') . $群;

// 剥离消息开头对机器人的 @ 提及，避免控制词匹配失败
while (true) {
  $去 = preg_replace('/^<@!?[0-9A-Fa-f]+>\s*/', '', $消息);
  $去 = preg_replace('/^@\S+\s*/', '', $去);
  if ($去 === $消息) break;
  $消息 = trim($去);
}

$状态 = 读('复读状态', $状态键);
$开启 = ($状态 === true || $状态 === 1 || $状态 === '1');

$是开始 = in_array($消息, array('开始', '开始复读', '复读开始', '开启复读'), true);
$是停止 = in_array($消息, array('停止', '停止复读', '复读停止', '关闭复读', '结束复读'), true);

if ($是开始 || $是停止) {
  if (!终端授权($群, $用户)) {
    echo json_encode(array('replies' => array(回复文本("「复读」控制仅 超级主人 / 群主 / 群管理员 可用。"))), JSON_UNESCAPED_UNICODE);
    exit(0);
  }
  if ($是开始) {
    写('复读状态', $状态键, true);
    echo json_encode(array('replies' => array(回复文本("复读已开启，发送「停止」立即关闭。"))), JSON_UNESCAPED_UNICODE);
    exit(0);
  }
  写('复读状态', $状态键, false);
  echo json_encode(array('replies' => array(回复文本("复读已停止，后续消息不再复读。"))), JSON_UNESCAPED_UNICODE);
  exit(0);
}

if (!$开启) exit(0);
if ($消息 === '') exit(0);

// 防回显死循环：机器人自己发出的控制回复被 QQ 回推为「群消息」时直接忽略，
// 否则会形成「复读→回推→再复读」的自我刷屏（表现为复读的其实是机器人自己的话）。
$自产 = array('复读已开启，发送「停止」立即关闭。', '复读已停止，后续消息不再复读。', '「复读」控制仅 超级主人 / 群主 / 群管理员 可用。');
if (in_array($消息, $自产, true)) exit(0);

echo json_encode(array('replies' => array(回复文本($消息))), JSON_UNESCAPED_UNICODE);
