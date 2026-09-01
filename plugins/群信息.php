<?php
// ============================================================
// 群信息插件：群活跃统计 + 群信息查询 + 群成员列表
// ------------------------------------------------------------
// 命令：
//   群信息 / 活跃统计 / 群统计 / 群活跃  → 生成群活跃统计长图卡片
//   群成员 [页数]                        → 群成员列表（分页）
// ------------------------------------------------------------
// 统计数据与旧版「群信息」看板同源（system_logs/group_members/groups 表，
// 经服务端 collectGroupStatsFull 聚合），数据完整连续：
//   群成员数、今日活跃成员、今日消息数、机器人回复、本周消息数、
//   最近活跃时段、今日加群、今日退群、最活跃成员/最近活跃成员排行、
//   最活跃的群排行（跨所有群）
// ------------------------------------------------------------
// 群名显示优先级：官方群名 → 本地群号绑定（群号+群名） → 群OpenID
// 群号绑定在管理面板「群管理」更新群号后自动生效（显示 群号xxxx）
// ============================================================

$in = json_decode(stream_get_contents(STDIN), true);
if (!$in || !is_array($in)) { fwrite(STDERR, "无效输入\n"); exit(0); }

$消息来源 = (string)($in['type'] ?? 'group');
$消息 = trim((string)($in['content'] ?? ''));
$gid = (string)($in['groupId'] ?? '');
$用户 = (string)($in['userId'] ?? '');
$appid = (string)($in['botId'] ?? '');
$作者 = is_array($in['author'] ?? null) ? $in['author'] : array();
$当前昵称 = (string)($作者['username'] ?? '');

$isGroup = ($消息来源 === 'group');
if (!$isGroup) exit(0); // 仅群聊
if ($gid === '') exit(0);

// ============================================================
// 群名解析：官方群名 → 本地群号绑定 → 群OpenID
// 返回 array('name' => 展示名, 'member' => 官方成员数或0, 'desc' => 群号描述)
// ============================================================
function 解析群名($群, $appid) {
  // 1. 官方群信息（有群名）
  $info = 群信息API($群);
  if (is_array($info) && !empty($info['group_name'])) {
    $name = (string)$info['group_name'];
    $member = (int)($info['group_member_count'] ?? 0);
  } else {
    $name = '';
    $member = 0;
  }
  // 2. 本地绑定（群号）—— 有绑定就展示群号
  $detail = 群详情API($群);
  $desc = '';
  if (is_array($detail)) {
    if (!empty($detail['group_number'])) $desc = '群号' . (string)$detail['group_number'];
    if ($name === '' && !empty($detail['name'])) $name = (string)$detail['name'];
  }
  // 3. OpenID 兜底
  if ($name === '') $name = mb_strlen($群) > 14 ? mb_substr($群, 0, 12) . '…' : $群;
  return array('name' => $name, 'member' => $member, 'desc' => $desc);
}

// 群成员角色名（官方昵称 → OpenID 截断）
function 群成员角色名($openid, $昵称, $gid, $appid) {
  if ($昵称 !== '') return $昵称;
  $成员 = 群成员API($gid, 50, '');
  if (is_array($成员)) {
    foreach ($成员['members'] as $m) {
      if (is_array($m) && ($m['openid'] ?? '') === $openid && !empty($m['username'])) return (string)$m['username'];
    }
  }
  return mb_strlen($openid) > 14 ? mb_substr($openid, 0, 12) . '…' : $openid;
}

// 最活跃成员排行（来自服务端聚合 topUsers，按今日消息数 Top5）
function 用户排行($stats) {
  $out = array();
  $最大 = 1;
  foreach (($stats['topUsers'] ?? array()) as $u) {
    $c = (int)($u['count'] ?? 0);
    if ($c > $最大) $最大 = $c;
  }
  foreach (($stats['topUsers'] ?? array()) as $u) {
    $c = (int)($u['count'] ?? 0);
    $out[] = array('name' => (string)($u['name'] ?? ''), 'value' => (string)$c . '条',
      'score' => $最大 > 0 ? $c / $最大 : 0);
  }
  return $out;
}

// 最近活跃成员排行（来自服务端聚合 recentUsers，按最后活跃时间 Top5）
function 最近排行($stats) {
  $out = array();
  foreach (($stats['recentUsers'] ?? array()) as $u) {
    $seen = (string)($u['lastSeen'] ?? '--:--');
    // 时间转当天进度比例（HH:MM → 分钟/1440）
    $score = 0;
    if (preg_match('/^(\d{1,2}):(\d{2})$/', $seen, $m)) {
      $score = ((int)$m[1] * 60 + (int)$m[2]) / 1440;
    }
    $out[] = array('name' => (string)($u['name'] ?? ''), 'value' => $seen, 'score' => $score);
  }
  return $out;
}

// 最活跃的群排行（来自服务端聚合 groupRanking，今日消息数跨群 Top5）
function 群排行($stats, $当前群) {
  $out = array();
  $最大 = 1;
  foreach (($stats['groupRanking'] ?? array()) as $g) {
    $c = (int)($g['count'] ?? 0);
    if ($c > $最大) $最大 = $c;
  }
  foreach (($stats['groupRanking'] ?? array()) as $g) {
    $c = (int)($g['count'] ?? 0);
    $isSelf = ((string)($g['groupId'] ?? '') === (string)$当前群);
    $name = $isSelf ? '本群' : (string)($g['name'] ?? '');
    if ($name === '') $name = '未命名群';
    if (!$isSelf && !empty($g['groupNumber'])) $name .= '(' . $g['groupNumber'] . ')';
    $out[] = array('name' => $name, 'value' => (string)$c . '条',
      'score' => $最大 > 0 ? $c / $最大 : 0);
  }
  return $out;
}

// ============================================================
// 1. 自动记录活跃（每次群消息，供群成员累计；查询数据以服务端聚合为准）
// ============================================================
$活跃文件 = "活跃/" . $appid . "/" . date("Y-m-d");
$活跃 = 读($活跃文件, "数据", array());
if (!is_array($活跃)) $活跃 = array();

if ($消息 === '[加群]' || $消息 === '加群') {
  $活跃['群'][$gid]['加群'] = (int)($活跃['群'][$gid]['加群'] ?? 0) + 1;
  $活跃['群'][$gid]['成员数'] = (int)($活跃['群'][$gid]['成员数'] ?? 0) + 1;
  写($活跃文件, "数据", $活跃);
  文字("欢迎加入本群！发送「群信息」可查看本群活跃统计～");
  exit(0);
}
if ($消息 === '[退群]' || $消息 === '退群') {
  $活跃['群'][$gid]['退群'] = (int)($活跃['群'][$gid]['退群'] ?? 0) + 1;
  $活跃['群'][$gid]['成员数'] = max(0, (int)($活跃['群'][$gid]['成员数'] ?? 0) - 1);
  写($活跃文件, "数据", $活跃);
  exit(0);
}

if ($用户 !== '') {
  $活跃['群'][$gid]['消息'] = (int)($活跃['群'][$gid]['消息'] ?? 0) + 1;
  $本周 = date("W");
  $活跃['群'][$gid]['本周消息'][$本周] = (int)($活跃['群'][$gid]['本周消息'][$本周] ?? 0) + 1;
  $活跃['群'][$gid]['时段'][date("G")] = (int)($活跃['群'][$gid]['时段'][date("G")] ?? 0) + 1;
  if (!isset($活跃['群'][$gid]['活跃成员'])) $活跃['群'][$gid]['活跃成员'] = array();
  $成员 = $活跃['群'][$gid]['活跃成员'][$用户] ?? array('消息数' => 0, '昵称' => '', '最后时间' => '', '时段' => '');
  $成员['消息数'] = (int)($成员['消息数'] ?? 0) + 1;
  if ($当前昵称 !== '') $成员['昵称'] = $当前昵称;
  $成员['最后时间'] = date("H:i");
  $成员['时段'] = date("G");
  $活跃['群'][$gid]['活跃成员'][$用户] = $成员;
  写($活跃文件, "数据", $活跃);

  // 群成员记录（累计所有发过消息的成员）
  $成员文件 = "群成员/" . $appid;
  $成员数据 = 读($成员文件);
  if (!is_array($成员数据)) $成员数据 = array();
  if (!isset($成员数据[$gid])) $成员数据[$gid] = array();
  $成员数据[$gid][$用户] = array('昵称' => $当前昵称, '最后消息' => date("Y-m-d H:i:s"));
  写($成员文件, $成员数据);
}

// ============================================================
// 2. 命令处理
// ============================================================

// 群成员列表（分页）
if (前缀($消息, "群成员")) {
  $页数 = 1;
  $分 = explode(" ", trim(substr($消息, 3)));
  if (isset($分[1]) && is_numeric($分[1]) && (int)$分[1] >= 1) $页数 = (int)$分[1];

  $页大小 = 10;
  $全部 = array();
  $游标 = '';
  $安全 = 0;
  do {
    $页 = 群成员API($gid, 50, $游标);
    if (!is_array($页)) break;
    $全部 = array_merge($全部, is_array($页['members']) ? $页['members'] : array());
    $游标 = (string)($页['next_index'] ?? '');
    $安全++;
  } while ($游标 !== '' && $安全 < 20);

  if (count($全部) === 0) { 文字("本群暂无成员数据（接口未返回成员列表）"); exit(0); }

  $总页数 = (int)ceil(count($全部) / $页大小);
  if ($页数 > $总页数) $页数 = $总页数;
  $页成员 = array_slice($全部, ($页数 - 1) * $页大小, $页大小);

  $文本 = "本群成员（共 " . count($全部) . " 人）\n";
  $n = ($页数 - 1) * $页大小 + 1;
  foreach ($页成员 as $m) {
    $昵称 = trim((string)($m['username'] ?? ''));
    if ($昵称 === '') $昵称 = '（未设置昵称）';
    $文本 .= $n . ". " . $昵称 . "\n";
    $n++;
  }
  $文本 .= "第 " . $页数 . "/" . $总页数 . " 页｜发送「群成员 " . ($页数 + 1 > $总页数 ? $总页数 : $页数 + 1) . "」看下一页";
  文字($文本);
  exit(0);
}

// 群活跃统计 / 群信息
if (前缀($消息, "群信息") || 前缀($消息, "活跃统计") || 前缀($消息, "群统计") || 前缀($消息, "群活跃")) {
  // 服务端同源聚合（与旧版「群信息」看板数据一致）
  $stats = 群统计API($gid);

  // 群名解析（官方 → 本地群号绑定 → OpenID），群号绑定必须展示
  $群名信息 = 解析群名($gid, $appid);
  $群名 = $群名信息['name'];
  $群描述 = $群名信息['desc'];

  // 指标 8 项：直接使用服务端聚合结果
  $metrics = array();
  if (is_array($stats) && is_array($stats['metrics'] ?? null)) {
    foreach ($stats['metrics'] as $m) {
      if (!is_array($m)) continue;
      $metrics[] = array((string)($m['label'] ?? ''), (string)($m['value'] ?? '0'), (string)($m['color'] ?? '#3b82f6'));
    }
  }

  if (count($metrics) === 0) {
    // 兜底：本地活跃文件
    $官方成员数 = $群名信息['member'];
    $群活跃 = is_array($活跃['群'][$gid] ?? null) ? $活跃['群'][$gid] : array();
    $本周消息数 = 0;
    foreach (($群活跃['本周消息'] ?? array()) as $c) $本周消息数 += (int)$c;
    $最活跃时段 = '';
    $时段 = $群活跃['时段'] ?? array();
    if (is_array($时段) && count($时段) > 0) { arsort($时段); $最活跃时段 = sprintf("%02d:00", (int)key($时段)); }
    else $最活跃时段 = '暂无';
    $metrics = array(
      array('群成员数', $官方成员数 > 0 ? $官方成员数 : max(0, (int)($群活跃['成员数'] ?? 0)), '#3b82f6'),
      array('今日活跃成员', count($群活跃['活跃成员'] ?? array()), '#22c55e'),
      array('今日消息数', (int)($群活跃['消息'] ?? 0), '#f97316'),
      array('机器人回复', (int)($活跃['回复'][$gid] ?? 0), '#8b5cf6'),
      array('本周消息数', $本周消息数, '#06b6d4'),
      array('最近活跃时段', $最活跃时段, '#eab308'),
      array('今日加群', (int)($群活跃['加群'] ?? 0), '#10b981'),
      array('今日退群', (int)($群活跃['退群'] ?? 0), '#ef4444'),
    );
  }

  // 排行（服务端聚合）
  $topActive = is_array($stats) ? 用户排行($stats) : array();
  $topRecent = is_array($stats) ? 最近排行($stats) : array();
  $topGroups = is_array($stats) ? 群排行($stats, $gid) : array();

  // 截止时间 = 用户发送命令的时刻（消息时间戳 → 北京时间 H:i），与服务器时区无关
  $ts = 0;
  $tsRaw = (string)($in['timestamp'] ?? '');
  if ($tsRaw !== '') {
    $ts = is_numeric($tsRaw) ? (int)$tsRaw : strtotime($tsRaw);
    if ($ts > 100000000000) $ts = (int)($ts / 1000); // 毫秒 → 秒
  }
  if ($ts <= 0) $ts = time();
  $截止时间 = gmdate("H:i", $ts + 8 * 3600);

  // 绘制长图
  $卡片 = 绘制群统计卡片(($stats['date'] ?? gmdate("m-d", $ts + 8 * 3600)), $群名, $截止时间, $metrics,
    $topActive, $topRecent, 'QQ机器人 · 群活跃统计', $topGroups, $群描述, (float)($stats['elapsedMs'] ?? 0));

  if ($卡片 !== '') {
    图片($卡片, "<@!" . $用户 . ">「" . $群名 . "」活跃统计", "群活跃统计.png");
  } else {
    $文本 = "「" . $群名 . "」活跃统计（" . date("Y-m-d") . "）\n";
    foreach ($metrics as $m) $文本 .= $m[0] . "：" . $m[1] . "\n";
    if (count($topActive) > 0) {
      $文本 .= "\n最活跃成员：";
      foreach ($topActive as $r) $文本 .= $r['name'] . "(" . $r['value'] . ") ";
    }
    文字("<@!" . $用户 . ">\n" . $文本);
  }
  exit(0);
}
