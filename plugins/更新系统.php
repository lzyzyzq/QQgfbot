<?php
// ============================================================
// 更新系统插件：群内发「更新」调出更新菜单，自动下载/解压/重启升级
// ------------------------------------------------------------
// 命令：
//   更新 / 更新菜单 / 返回更新  → 图片菜单 + 文字外显按钮
//   更新补丁 / 更新补丁包        → 下载补丁包并升级
//   更新全量 / 更新全量包        → 下载全量包并升级
//   检查更新                   → 版本对比，有更新提醒
//   更新记录 / 更新列表          → 历史更新列表
//   删除更新记录 [序号]          → 删除指定更新记录
//   返回菜单                   → 回主菜单（文字外显）
// ------------------------------------------------------------
// 权限：仅超级主人可使用。
// 更新包配置（版本号/补丁地址/全量地址/更新内容）在管理面板
// 「系统设置 → 更新系统配置」中维护；默认版本 4.2.59。
// 版本判断依据：更新包版本 与 本机已部署版本（data/database/更新/状态.json）
// 对比，更新包版本高于本机版本才提示/允许更新。
// ============================================================

$in = json_decode(stream_get_contents(STDIN), true);
if (!$in || !is_array($in)) { fwrite(STDERR, "无效输入\n"); exit(0); }

$类型 = (string)($in['type'] ?? '');
$消息 = trim((string)($in['content'] ?? ''));
$群 = (string)($in['groupId'] ?? '');
$用户 = (string)($in['userId'] ?? '');

if ($类型 !== 'group') exit(0); // 仅群聊
if ($群 === '') exit(0);

$at = "<@!" . $用户 . ">";

// ========== 终端命令直接更新（与面板部署终端串联） ==========
// 群里直接发送（仅超级主人，URL 为补丁/全量包下载地址）：
//   cd /var/www/php && wget -O patch-4.2.59.zip <补丁URL> && unzip -o patch-4.2.59.zip && pm2 restart qqbot
//   cd /var/www/php && wget -O full.zip <全量URL> && unzip -o full.zip && pm2 restart qqbot
// 识别成功后自动执行：下载 → unzip -t 校验 → unzip -o 解压 → pm2 restart qqbot，全程群内反馈。
$终端更新 = 解析终端更新命令($消息);
if ($终端更新 !== null) {
  if (!是否超主($用户)) {
    文字($at . "\n「终端更新」仅超级主人可使用。如需升级请联系管理员。");
    exit(0);
  }
  $zip = $终端更新['zip'];
  $url = $终端更新['url'];
  $kind = stripos($zip, 'patch') !== false ? '补丁包' : '全量包';
  $root = 更新根目录();
  文字($at . "\n⏳ 已识别终端更新命令，正在下载" . $kind . "（" . $zip . "）…");
  $zipPath = 更新数据目录() . '/' . $zip;
  if (!下载文件($url, $zipPath)) {
    文字($at . "\n❌ 下载失败，请检查下载地址是否可访问。");
    exit(0);
  }
  if (!function_exists('exec')) {
    文字($at . "\n❌ 服务器未启用 PHP exec，无法自动解压/重启。\n请手动执行：\ncd " . $root . " && unzip -o " . $zipPath . " && pm2 restart qqbot");
    @unlink($zipPath);
    exit(0);
  }
  exec('cd ' . escapeshellarg($root) . ' && unzip -t ' . escapeshellarg($zipPath) . ' 2>&1', $tOut, $tCode);
  if ($tCode !== 0) {
    文字($at . "\n❌ 压缩包校验失败（服务器未安装 unzip 或文件损坏）。");
    @unlink($zipPath);
    exit(0);
  }
  exec('cd ' . escapeshellarg($root) . ' && unzip -o ' . escapeshellarg($zipPath) . ' 2>&1', $uOut, $uCode);
  if ($uCode !== 0) {
    文字($at . "\n❌ 解压失败：\n" . implode("\n", array_slice($uOut, 0, 5)));
    @unlink($zipPath);
    exit(0);
  }
  @unlink($zipPath);
  $ver = '';
  if (preg_match('/(\d+(?:\.\d+){1,3})/', $zip, $vm)) $ver = $vm[1];
  if ($ver !== '') {
    记录当前版本($ver);
    更新记录('追加', array('type' => $kind, 'version' => $ver, 'time' => 当前时间(), 'content' => '群内终端命令更新：' . $zip));
  }
  文字($at . "\n✅ 更新完成！已升级到 v" . ($ver !== '' ? $ver : $版本) . "（" . $kind . "）。\n\n3 秒后自动重启机器人…");
  Markdown("　" . 外显('返回更新', '返回更新') . '　' . 外显('返回菜单', '菜单'));
  延迟重启机器人(3);
  exit(0);
}

// ========== 命令命中判断 ==========
$命令命中 = false;
if ($消息 === '更新' || $消息 === '更新菜单' || $消息 === '返回更新') $命令命中 = true;
elseif (前缀($消息, '更新补丁') || 前缀($消息, '更新全量')) $命令命中 = true;
elseif ($消息 === '检查更新' || 前缀($消息, '检查更新')) $命令命中 = true;
elseif (前缀($消息, '更新记录') || 前缀($消息, '更新列表')) $命令命中 = true;
elseif (前缀($消息, '删除更新记录')) $命令命中 = true;
if (!$命令命中) exit(0);

// ========== 权限：仅超级主人 ==========
if (!是否超主($用户)) {
  文字($at . "\n「更新系统」仅超级主人可使用。如需升级请联系管理员。");
  exit(0);
}

// ========== 更新配置与版本对比 ==========
$cfg = 更新配置();
$版本 = $cfg['version'] !== '' ? $cfg['version'] : '4.2.59';
$当前 = 当前版本();
if ($当前 === '') { $当前 = $版本; 记录当前版本($版本); } // 首次以更新包版本为基线
$hasUpdate = 版本比较($版本, $当前) === 1;

$更新内容默认 = "更新系统界面全新美化：版本信息卡/更新状态徽章/更新历史\n检查更新无论有无新版本都会提醒\n群号「截至时间」显示用户发送命令的时刻（北京时间）\n更新到服务器后执行：cd /var/www/php && pm2 restart qqbot";
$changelog = $cfg['changeLog'] !== '' ? $cfg['changeLog'] : $更新内容默认;

// ========== 辅助 ==========
function 更新按钮行() {
  return 外显('更新补丁', '更新补丁') . '　' . 外显('更新全量', '更新全量') . '　' . 外显('检查更新', '检查更新') . "\n" .
         外显('更新记录', '更新记录') . '　' . 外显('返回更新', '返回更新') . '　' . 外显('返回菜单', '菜单');
}

function 发送更新菜单($版本, $当前, $cfg, $changelog, $hasUpdate, $at, $caption = '') {
  if ($caption === '') $caption = $at . "「更新系统」";
  文字($caption);
  $records = 更新记录('读取');
  $lastUpdate = '';
  if (count($records) > 0) { $lastUpdate = (string)end($records)['time']; }
  $img = 更新菜单图片(array(
    'version' => $版本,
    'current' => $当前,
    'patchUrl' => $cfg['patchUrl'],
    'fullUrl' => $cfg['fullUrl'],
    'changeLog' => $changelog,
    'hasUpdate' => $hasUpdate,
    'checkedAt' => 当前时间(),
    'lastUpdate' => $lastUpdate,
    'recordCount' => count($records),
  ));
  if ($img !== '') {
    图片($img, '', '更新系统.png');
  } else {
    文字("当前版本：" . $当前 . "\n更新包版本：" . $版本 . "\n" .
      ($hasUpdate ? "⚠️ 发现新版本，可升级" : "✅ 已是最新版本") . "\n\n【更新内容】\n" . $changelog);
  }
  Markdown("　" . 更新按钮行());
}

// ========== 命令分发 ==========

// 更新菜单
if ($消息 === '更新' || $消息 === '更新菜单' || $消息 === '返回更新') {
  发送更新菜单($版本, $当前, $cfg, $changelog, $hasUpdate, $at);
  exit(0);
}

// 执行更新（补丁/全量）
if (前缀($消息, '更新补丁') || 前缀($消息, '更新全量')) {
  $isPatch = 前缀($消息, '更新补丁');
  $url = $isPatch ? $cfg['patchUrl'] : $cfg['fullUrl'];
  $kind = $isPatch ? '补丁包' : '全量包';

  if ($url === '') {
    文字($at . "\n未配置" . $kind . "下载地址。请在管理面板「系统设置 → 更新系统配置」中填写更新包地址。");
    exit(0);
  }
  if (!$hasUpdate && $当前 !== '') {
    文字($at . "\n当前版本（" . $当前 . "）已不低于更新包版本（" . $版本 . "），无需升级。");
    exit(0);
  }
  if ($当前 !== '' && 版本比较($版本, $当前) === 0) {
    文字($at . "\n当前已是最新版本（" . $版本 . "），无需重复更新。");
    exit(0);
  }

  文字($at . "\n⏳ 正在下载" . $kind . " v" . $版本 . " …");

  $zip = 更新数据目录() . '/update-' . ($isPatch ? 'patch' : 'full') . '.zip';
  if (!下载文件($url, $zip)) {
    文字($at . "\n❌ 下载失败，请检查更新包地址是否可访问。");
    exit(0);
  }
  $root = 更新根目录();
  if (!function_exists('exec')) {
    文字($at . "\n❌ 服务器未启用 PHP exec，无法自动解压/重启。\n请手动执行：\ncd " . $root . " && unzip -o " . $zip . " && pm2 restart qqbot");
    exit(0);
  }
  // 校验
  exec('cd ' . escapeshellarg($root) . ' && unzip -t ' . escapeshellarg($zip) . ' 2>&1', $tOut, $tCode);
  if ($tCode !== 0) {
    文字($at . "\n❌ 压缩包校验失败（服务器未安装 unzip 或文件损坏）。");
    exit(0);
  }
  // 解压
  exec('cd ' . escapeshellarg($root) . ' && unzip -o ' . escapeshellarg($zip) . ' 2>&1', $uOut, $uCode);
  if ($uCode !== 0) {
    文字($at . "\n❌ 解压失败：\n" . implode("\n", array_slice($uOut, 0, 5)));
    exit(0);
  }
  @unlink($zip);

  记录当前版本($版本);
  更新记录('追加', array('type' => $kind, 'version' => $版本, 'time' => 当前时间(), 'content' => $changelog));

  文字($at . "\n✅ 更新完成！已升级到 v" . $版本 . "（" . $kind . "）。\n\n【本轮更新内容】\n" . $changelog . "\n\n3 秒后自动重启机器人…");
  Markdown("　" . 外显('返回更新', '返回更新') . '　' . 外显('返回菜单', '菜单'));
  延迟重启机器人(3);
  exit(0);
}

// 检查更新：无论有无新版本都明确提醒（附带状态菜单图片）
if ($消息 === '检查更新' || 前缀($消息, '检查更新')) {
  if ($hasUpdate) {
    发送更新菜单($版本, $当前, $cfg, $changelog, $hasUpdate, $at,
      $at . "\n⚠️ 发现新版本 v" . $版本 . "（当前 v" . $当前 . "），可发送「更新补丁」或「更新全量」升级。");
  } else {
    发送更新菜单($版本, $当前, $cfg, $changelog, $hasUpdate, $at,
      $at . "\n✅ 已检查更新：当前版本 v" . $当前 . " 已是最新，无需升级。");
  }
  exit(0);
}

// 更新记录（读取列表）
if (前缀($消息, '更新记录') || 前缀($消息, '更新列表')) {
  $list = 更新记录('读取');
  if (count($list) === 0) { 文字($at . "\n暂无更新记录。"); exit(0); }
  $rows = array();
  foreach ($list as $i => $it) {
    $rows[] = ($i + 1) . ". [" . ($it['time'] ?? '') . "] " . ($it['type'] ?? '') . " v" . ($it['version'] ?? '') . "\n   " . mb_substr(str_replace("\n", ' ', $it['content'] ?? ''), 0, 40);
  }
  文字($at . "\n📋 更新记录（共 " . count($list) . " 条）：\n" . implode("\n", $rows) . "\n\n发送「删除更新记录 序号」可删除对应记录。");
  Markdown("　" . 外显('删除更新记录', '删除更新记录') . '　' . 外显('返回更新', '返回更新'));
  exit(0);
}

// 删除更新记录
if (前缀($消息, '删除更新记录')) {
  $parts = preg_split('/\s+/', trim($消息));
  $序号 = isset($parts[1]) && is_numeric($parts[1]) ? ((int)$parts[1] - 1) : -1;
  if ($序号 < 0) {
    $list = 更新记录('读取');
    if (count($list) === 0) { 文字($at . "\n暂无更新记录。"); exit(0); }
    $lines = array();
    foreach ($list as $i => $it) $lines[] = ($i + 1) . ". " . ($it['time'] ?? '') . " " . ($it['type'] ?? '') . " v" . ($it['version'] ?? '');
    文字($at . "\n请指定要删除的序号（如「删除更新记录 1」）：\n" . implode("\n", $lines));
    exit(0);
  }
  if (更新记录('删除', null, $序号)) 文字($at . "\n✅ 已删除更新记录第 " . ($序号 + 1) . " 条。");
  else 文字($at . "\n❌ 序号无效（共 " . count(更新记录('读取')) . " 条记录）。");
  exit(0);
}

// ========== 终端更新命令解析 ==========
// 识别群内直接发送的更新命令：cd <更新根目录> && wget -O <zip> <url> && unzip -o <zip> && pm2 restart qqbot
// 严格校验目录/文件名/进程名与 URL 协议，防止任意命令注入；不匹配返回 null 走常规指令流程。
function 解析终端更新命令($msg) {
  $msg = trim((string)$msg);
  // 去掉引号（wget -O "patch.zip" "url" / 'patch.zip' 'url'）
  $msg = preg_replace('/"([^"]+)"/', '$1', $msg);
  $msg = preg_replace("/'([^']+)'/", '$1', $msg);
  if (!preg_match('/^cd\s+(\S+)\s*&&\s*wget\s+(?:-O\s+)?(\S+)\s+(\S+)\s*&&\s*unzip\s+(?:-o\s+)?(\S+)\s*&&\s*pm2\s+restart\s+(\S+)$/i', $msg, $m)) return null;
  $dir = $m[1]; $zip = $m[2]; $url = $m[3]; $unz = $m[4]; $proc = $m[5];
  $root = 更新根目录();
  if (rtrim($dir, '/') !== rtrim($root, '/')) return null;
  if ($zip !== $unz) return null;
  if ($proc !== 'qqbot') return null;
  if (!preg_match('/^[\w.\-]+\.zip$/i', $zip)) return null;
  if (!preg_match('/^https?:\/\//i', $url)) return null;
  return array('zip' => $zip, 'url' => $url);
}
