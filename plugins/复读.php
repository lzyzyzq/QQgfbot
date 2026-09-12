<?php
// @description 复读插件：群内发送「开始」开始复读，发送「停止」立即停止；支持复读计数、代码块包裹、底部内容({time} 实时刷新)、限频与防回显
// ------------------------------------------------------------
// 控制（超级主人 / 群主 / 群管理员）：
//   开始 / 开始复读 / 复读开始 / 开启复读   → 开启本群复读
//   停止 / 停止复读 / 复读停止 / 关闭复读 / 结束复读 → 立即关闭本群复读
//   其他任意群消息                        → 开启状态下原样复读
//
// 配置（同样需超级主人 / 群主 / 群管理员）：
//   复读设置                               → 查看当前配置与计数
//   复读设置 代码块 text                    → 复读正文用 ```text 代码块包裹（值：text/plain/txt…；填 关闭 则纯文本）
//   复读设置 底部 第一行|第二行             → 底部内容，| 分行，支持 {time}/{count}/{group} 占位；填 关闭 则清空
//   复读设置 频率 15 10                     → 每 10 秒最多复读 15 条（关闭=不限频）
//   复读设置 防回显 3                       → 相同内容 3 秒内重复出现视为机器人回显，跳过（关闭=不检测）
//   复读计数                               → 查看本群累计复读次数
// ------------------------------------------------------------
// 稳定性说明：
// 1) 开关与计数采用 flock 加锁读写（共享锁读 / 排他锁写），避免「写盘瞬间被读到半截 JSON」导致开关被误判为关。
// 2) 开关除按「机器人+群」存一份外，另按「群」镜像一份；机器人 ID 变化（重启/换实例）时自动回退镜像，
//    避免「重启后复读状态丢失」。
// 3) 相同内容短时间重复出现判定为机器人自身回显，直接跳过；再叠加限频，双保险防止自我刷屏触发平台风控。

$in = json_decode(stream_get_contents(STDIN), true);
if (!$in || !is_array($in)) { fwrite(STDERR, "无效输入\n"); exit(0); }

$类型 = (string)($in['type'] ?? '');
$消息 = trim((string)($in['content'] ?? ''));
$群   = (string)($in['groupId'] ?? '');
$用户 = (string)($in['userId'] ?? '');

if ($类型 !== 'group' || $群 === '') exit(0);

$botId = getenv('PHP_PLUGIN_BOT_ID');
$botId = $botId !== false ? (string)$botId : '';
$状态键 = ($botId !== '' ? $botId . '@' : '') . $群;
// 统计按「群」共享：多机器人同群时计数合并为整群复读总量
$统计键 = $群;

// 剥离消息开头对机器人的 @ 提及，避免控制词匹配失败
while (true) {
  $去 = preg_replace('/^<@!?[0-9A-Fa-f]+>\s*/', '', $消息);
  $去 = preg_replace('/^@\S+\s*/', '', $去);
  if ($去 === $消息) break;
  $消息 = trim($去);
}

// ================= 加锁读写（避免并发读半截 JSON 误判开关） =================
if (!function_exists('__复读_路径')) {
function __复读_路径($name) {
  $base = defined('PHP_PLUGIN_DATA_DIR') && PHP_PLUGIN_DATA_DIR ? PHP_PLUGIN_DATA_DIR : (getcwd() . '/data/database');
  if (!is_dir($base)) @mkdir($base, 0777, true);
  $safe = str_replace(array('..', '/', '\\', "\0"), '', (string)$name);
  return rtrim($base, '/\\') . '/' . $safe . '.json';
}
function __复读_读($name, $key) {
  $f = __复读_路径($name);
  if (!is_file($f)) return null;
  $fp = @fopen($f, 'r');
  if (!$fp) return null;
  @flock($fp, LOCK_SH);
  $raw = stream_get_contents($fp);
  @flock($fp, LOCK_UN);
  fclose($fp);
  $j = json_decode((string)$raw, true);
  if (!is_array($j)) return null;
  return array_key_exists($key, $j) ? $j[$key] : null;
}
function __复读_写($name, $key, $val) {
  $f = __复读_路径($name);
  $fp = @fopen($f, 'c+');
  if (!$fp) return false;
  @flock($fp, LOCK_EX);
  $raw = stream_get_contents($fp);
  $j = json_decode((string)$raw, true);
  if (!is_array($j)) $j = array();
  $j[$key] = $val;
  ftruncate($fp, 0);
  rewind($fp);
  fwrite($fp, json_encode($j, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
  fflush($fp);
  @flock($fp, LOCK_UN);
  fclose($fp);
  return true;
}
}
if (!function_exists('__复读_配置')) {
// 读取配置并补齐默认值
function __复读_配置() {
  $c = 读('复读配置', null);
  if (!is_array($c)) $c = array();
  if (!array_key_exists('code_fence', $c)) $c['code_fence'] = '';
  if (!isset($c['footer']) || !is_array($c['footer'])) $c['footer'] = array('🕐 {time}', '🔁 已复读 {count} 次');
  if (!array_key_exists('rate_limit', $c)) $c['rate_limit'] = 15;
  if (!array_key_exists('rate_window', $c)) $c['rate_window'] = 10;
  if (!array_key_exists('echo_guard', $c)) $c['echo_guard'] = 3;
  return $c;
}
}
if (!function_exists('__复读_底部')) {
// 渲染底部内容，替换 {time}/{count}/{group}/{user} 占位
function __复读_底部($配置, $次数, $群, $用户) {
  $行 = isset($配置['footer']) && is_array($配置['footer']) ? $配置['footer'] : array();
  if (!$行) return '';
  $时间 = function_exists('当前时间') ? 当前时间('Y-m-d H:i:s') : date('Y-m-d H:i:s');
  $映射 = array(
    '{time}'  => $时间,
    '{count}' => (string)$次数,
    '{group}' => (string)$群,
    '{user}'  => (string)$用户,
  );
  $out = array();
  foreach ($行 as $l) {
    $s = strtr((string)$l, $映射);
    if (trim($s) !== '') $out[] = $s;
  }
  return implode("\n", $out);
}
}

$配置 = __复读_配置();

// ================= 读取开关（新键 → 群镜像 → 旧格式） =================
$开关 = __复读_读('复读开关', $状态键);
if ($开关 === null) {
  // 机器人 ID 变化（重启/换实例）时回退「群」镜像，避免状态丢失
   $开关 = __复读_读('复读开关', $群);
  if ($开关 === true) __复读_写('复读开关', $状态键, true);
}
if ($开关 === null) {
  $旧 = 读('复读状态', $状态键);
  if ($旧 === true || $旧 === 1 || $旧 === '1') $开关 = true;
  elseif ($旧 === false || $旧 === 0 || $旧 === '0') $开关 = false;
}
$开启 = ($开关 === true);

$是开始 = in_array($消息, array('开始', '开始复读', '复读开始', '开启复读'), true);
$是停止 = in_array($消息, array('停止', '停止复读', '复读停止', '关闭复读', '结束复读'), true);

// ================= 管理配置 / 计数查询（不受开关影响） =================
if ($消息 === '复读设置' || strpos($消息, '复读设置 ') === 0 || $消息 === '复读计数') {
  if (!终端授权($群, $用户)) {
    echo json_encode(array('replies' => array(回复文本("「复读」配置仅 超级主人 / 群主 / 群管理员 可用。"))), JSON_UNESCAPED_UNICODE);
    exit(0);
  }
  $统计 = __复读_读('复读统计', $统计键);
  if (!is_array($统计)) $统计 = array();
  $次数 = isset($统计['count']) ? (int)$统计['count'] : 0;

  if ($消息 === '复读计数') {
    echo json_encode(array('replies' => array(回复文本("本群累计复读 {$次数} 次。"))), JSON_UNESCAPED_UNICODE);
    exit(0);
  }

  if (strpos($消息, '复读设置 ') === 0) {
    $参数 = trim(substr($消息, strlen('复读设置 ')));
    $空值 = array('关闭', '无', '空', 'none', 'off', '0', '-', '取消');
    if (strpos($参数, '代码块 ') === 0) {
      $v = trim(substr($参数, strlen('代码块 ')));
      $配置['code_fence'] = in_array($v, $空值, true) ? '' : $v;
    } elseif (strpos($参数, '底部 ') === 0) {
      $v = trim(substr($参数, strlen('底部 ')));
      if (in_array($v, $空值, true)) {
        $配置['footer'] = array();
      } else {
        $配置['footer'] = array_values(array_filter(array_map('trim', preg_split('/[|｜]/u', $v)), function($x){ return $x !== ''; }));
      }
    } elseif (strpos($参数, '频率 ') === 0) {
      $v = trim(substr($参数, strlen('频率 ')));
      if (in_array($v, $空值, true)) {
        $配置['rate_limit'] = 0;
      } else {
        $p = preg_split('/\s+/', $v);
        $配置['rate_limit'] = max(0, (int)($p[0] ?? 0));
        if (isset($p[1]) && (int)$p[1] > 0) $配置['rate_window'] = (int)$p[1];
      }
    } elseif (strpos($参数, '防回显 ') === 0) {
      $v = trim(substr($参数, strlen('防回显 ')));
      $配置['echo_guard'] = in_array($v, $空值, true) ? 0 : max(0, (int)$v);
    } else {
      echo json_encode(array('replies' => array(回复文本("未知配置项。用法：复读设置 代码块 text｜复读设置 底部 第一行|第二行｜复读设置 频率 15 10｜复读设置 防回显 3"))), JSON_UNESCAPED_UNICODE);
      exit(0);
    }
    写('复读配置', $配置);
  }

  $围 = max(1, (int)$配置['rate_window']);
  $文本 = "【复读配置】\n"
    . "代码块类型：" . ($配置['code_fence'] === '' ? '（不包裹，纯文本）' : $配置['code_fence']) . "\n"
    . "底部内容：" . (empty($配置['footer']) ? '（空）' : str_replace("\n", ' / ', implode("\n", $配置['footer']))) . "\n"
    . "复读频率：" . ((int)$配置['rate_limit'] <= 0 ? '不限' : $配置['rate_limit'] . ' 条 / ' . $围 . ' 秒') . "\n"
    . "防回显窗口：" . ((int)$配置['echo_guard'] <= 0 ? '关闭' : $配置['echo_guard'] . ' 秒') . "\n"
    . "累计复读：{$次数} 次";
  echo json_encode(array('replies' => array(回复文本($文本))), JSON_UNESCAPED_UNICODE);
  exit(0);
}

// ================= 开始 / 停止 =================
if ($是开始 || $是停止) {
  if (!终端授权($群, $用户)) {
    echo json_encode(array('replies' => array(回复文本("「复读」控制仅 超级主人 / 群主 / 群管理员 可用。"))), JSON_UNESCAPED_UNICODE);
    exit(0);
  }
  if ($是开始) {
    __复读_写('复读开关', $状态键, true);
    // 群镜像：机器人 ID 变化后仍可回退
    __复读_写('复读开关', $群, true);
    // 清理旧格式残留，避免与镜像语义混淆
    写('复读状态', $状态键, true);
    echo json_encode(array('replies' => array(回复文本("复读已开启，发送「停止」立即关闭。"))), JSON_UNESCAPED_UNICODE);
    exit(0);
  }
  __复读_写('复读开关', $状态键, false);
  __复读_写('复读开关', $群, false);
  写('复读状态', $状态键, false);
  echo json_encode(array('replies' => array(回复文本("复读已停止，后续消息不再复读。"))), JSON_UNESCAPED_UNICODE);
  exit(0);
}

if (!$开启) exit(0);
if ($消息 === '') exit(0);

// 防回显死循环：机器人自己发出的控制回复被 QQ 回推为「群消息」时直接忽略
$自产 = array('复读已开启，发送「停止」立即关闭。', '复读已停止，后续消息不再复读。', '「复读」控制仅 超级主人 / 群主 / 群管理员 可用。');
if (in_array($消息, $自产, true)) exit(0);

$现在 = time();

// ================= 读取统计并做防回显 / 限频 =================
$统计 = __复读_读('复读统计', $统计键);
if (!is_array($统计)) $统计 = array();
$次数   = isset($统计['count']) ? (int)$统计['count'] : 0;
$时间戳 = isset($统计['ts']) && is_array($统计['ts']) ? array_values($统计['ts']) : array();
$最近   = isset($统计['recent']) && is_array($统计['recent']) ? array_values($统计['recent']) : array();

$防回显 = max(0, (int)$配置['echo_guard']);
$限频   = max(0, (int)$配置['rate_limit']);
$窗口   = max(1, (int)$配置['rate_window']);

// 清理过期记录（保留最近 3 倍防回显窗口内的内容记录）
$保留 = max(1, $防回显) * 3;
$最近 = array_values(array_filter($最近, function($r) use ($现在, $保留) {
  return is_array($r) && ($现在 - (int)($r['t'] ?? 0)) <= $保留;
}));

// 防回显：相同内容在窗口内再次出现，判定为机器人自身回显（框架自产过滤之外的兜底）
if ($防回显 > 0) {
  foreach ($最近 as $r) {
    if (is_array($r) && (string)($r['c'] ?? '') === $消息 && ($现在 - (int)($r['t'] ?? 0)) <= $防回显) {
      exit(0);
    }
  }
}

// 限频：窗口内复读次数达到上限则跳过，避免被平台判定刷屏限流
$时间戳 = array_values(array_filter($时间戳, function($t) use ($现在, $窗口) {
  return ($现在 - (int)$t) < $窗口;
}));
if ($限频 > 0 && count($时间戳) >= $限频) exit(0);

// 计数 + 记录
$次数++;
$时间戳[] = $现在;
$最近[] = array('c' => $消息, 't' => $现在);
if (count($最近) > 20) $最近 = array_slice($最近, -20);
__复读_写('复读统计', $统计键, array('count' => $次数, 'ts' => $时间戳, 'recent' => $最近));

// ================= 构建复读内容（代码块 + 底部内容） =================
$脚注 = __复读_底部($配置, $次数, $群, $用户);
$围栏 = (string)$配置['code_fence'];

if ($围栏 !== '') {
  $正文 = "```" . $围栏 . "\n" . $消息 . "\n```";
  if ($脚注 !== '') $正文 .= "\n" . $脚注;
  $回复 = array('type' => 'markdown', 'content' => $正文);
} else {
  $正文 = $消息;
  if ($脚注 !== '') $正文 .= "\n" . $脚注;
  $回复 = 回复文本($正文);
}

echo json_encode(array('replies' => array($回复)), JSON_UNESCAPED_UNICODE);
