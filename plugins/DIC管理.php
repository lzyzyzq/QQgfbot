<?php
// @description DIC词库管理：群内列词库/可行性测试/详情/切换启用词库（与面板「cid 词库管理」串联）
// ------------------------------------------------------------
// 命令（群内，超主/群主/群管理可用）：
//   词库帮助 / DIC帮助              → 本帮助
//   词库列表 / DIC列表              → 列出 plugins/词库 下的词库文件（含当前启用标记）
//   词库当前 / DIC当前              → 显示当前启用词库
//   词库测试 [文件名] / 词库校验       → 词库可行性/语法测试（默认测试当前启用词库）
//   词库详情 <文件名>               → 规则/触发/命令行统计
//   词库切换 <文件名>               → 设为当前启用词库（写 plugins/词库/.dic_active）
// ------------------------------------------------------------
// 说明：本插件只做「词库文件」层面的管理与校验，不执行词库；解释执行仍由「娱乐群管」引擎负责。
//       面板侧可在 插件管理→DIC管理 点「📖 DIC词库」进入可视化编辑器（menu-editor.html）。

$in = json_decode(stream_get_contents(STDIN), true);
if (!is_array($in)) { fwrite(STDERR, "无效输入\n"); exit(0); }

$类型 = (string)($in['type'] ?? '');
$消息 = trim((string)($in['content'] ?? ''));
$群   = (string)($in['groupId'] ?? '');
$用户 = (string)($in['userId'] ?? '');

if ($类型 !== 'group' || $群 === '') exit(0);

// 剥离消息开头的 @机器人 提及
while (true) {
  $去 = preg_replace('/^<@!?[0-9A-Fa-f]+>\s*/', '', $消息);
  $去 = preg_replace('/^@\S+\s*/', '', $去);
  if ($去 === $消息) break;
  $消息 = trim($去);
}
if ($消息 === '') exit(0);

// 统一入口词：把 DIC 前缀归一为 词库
$命令 = preg_replace('/^DIC/i', '词库', $消息);

$是命令 = false;
foreach (array('词库帮助', '词库列表', '词库当前', '词库测试', '词库校验', '词库详情', '词库切换', '词库刷新') as $c) {
  if ($命令 === $c || strpos($命令, $c . ' ') === 0) { $是命令 = true; break; }
}
if (!$是命令) exit(0);

// 权限：超主 / 群主 / 群管理
if (!终端授权($群, $用户)) {
  文字('🔒 词库管理仅 超级主人 / 群主 / 群管理员 可用。');
  exit(0);
}

// 根目录与词库目录
$根 = 更新根目录();
$词库目录 = $根 . '/plugins/词库';
$旧目录   = $根 . '/plugins';
if (!is_dir($词库目录)) @mkdir($词库目录, 0777, true);

function dic_files($词库目录, $旧目录) {
  $out = array();
  if (is_dir($词库目录)) {
    foreach (scandir($词库目录) as $f) {
      if ($f === '' || $f[0] === '.') continue;
      if (!preg_match('/\.(txt|cid)$/i', $f)) continue;
      if (!is_file($词库目录 . '/' . $f)) continue;
      $out[$f] = array('name' => $f, 'dir' => '词库');
    }
  }
  if (is_dir($旧目录)) {
    foreach (scandir($旧目录) as $f) {
      if ($f === '' || $f[0] === '.') continue;
      if (!preg_match('/\.(txt|cid)$/i', $f)) continue;
      if (isset($out[$f])) continue;
      if (!is_file($旧目录 . '/' . $f)) continue;
      $out[$f] = array('name' => $f, 'dir' => '旧位置');
    }
  }
  ksort($out, SORT_NATURAL | SORT_FLAG_CASE);
  return $out;
}
function dic_path($词库目录, $旧目录, $file) {
  $file = basename((string)$file);
  if ($file === '' || !preg_match('/\.(txt|cid)$/i', $file)) return '';
  if (is_file($词库目录 . '/' . $file)) return $词库目录 . '/' . $file;
  if (is_file($旧目录 . '/' . $file)) return $旧目录 . '/' . $file;
  return '';
}
function dic_active($词库目录) {
  $f = $词库目录 . '/.dic_active';
  if (!is_file($f)) return '';
  return trim((string)@file_get_contents($f));
}

// 词库引擎已知命令（别名 + 规范名），用于可行性测试
function dic_known_cmds() {
  static $set = null;
  if ($set !== null) return $set;
  $别名 = array(
    '发', '回复', '发送文本', '文本', 'send_text',
    'Markdown', 'MD', '发送Markdown', '发送MD', 'send_markdown',
    '按钮', '键盘', '菜单', 'send_keyboard', 'send_button',
    '图片', '发送图片', 'send_media', 'send_temp_image', 'send_file_image',
    '引用回复', '引用', '发送引用',
    '撤回', '撤回消息', 'recall_message',
    '随机文本', '随机数', '计算',
    '读', '写', '访问', '调用',
    '停止', '空动作', '终止匹配',
    '延时', '延迟',
    '查找', '寻找', '寻找文本', '查找文本', 'find',
    '替换', '文本替换', 'replace',
    '长度', '文本长度', 'length',
    '取中间', '截取', '截取中间', 'substring',
    '取左', '左截取', 'left',
    '取右', '右截取', 'right',
    '包含', '是否包含', 'contains',
    '开头', '是否开头', 'starts_with',
    '结尾', '是否结尾', 'ends_with',
    '分割取', '取第', 'split_get',
    '大写', '转大写', 'upper', 'uppercase',
    '小写', '转小写', 'lower', 'lowercase',
    '去空格', '清除空格', 'trim',
    '查询机器人', '机器人信息', 'me', '我的信息', 'get_me', '网关信息', 'get_ws_url',
    '禁言', '禁言成员', 'mute_member',
    '取消禁言', '解除禁言', '取消禁言成员', '解禁', 'cancel_mute_member',
    '全体禁言', '禁言全体', 'mute_all',
    '取消全体禁言', '解除全禁', 'cancel_mute_all',
    '踢出成员', '删除成员', '踢人', 'kick_member', 'delete_member',
    '批量禁言成员', '批量禁言', 'mute_members',
    '取消批量禁言成员', '取消批量禁言', 'unmute_members',
    '撤回群消息', '撤回频道消息', '撤回单聊消息', '撤回私信', 'recall_message_by_id',
    '外显', '外显文字', '文字外显', 'inline',
    '解析成员', '成员解析', 'resolve_member',
    '群消息', '发送群消息', 'group_message',
    '单聊消息', '私聊消息', 'c2c_message',
    '发送频道消息', '频道消息', 'channel_message',
    '艾特', 'At', 'at', '@',
    '记录', '互动结果', 'on_interaction_result',
  );
  $规范 = array('send','md','btn','img','quote','recall','randText','randInt','calc','read','write','http','call','stop','nop','term','delay','find','replace','length','substr','left','right','contains','starts','ends','splitGet','upper','lower','trim','me','mute','unmute','muteall','unmuteall','kick','batchmute','batchunmute','inline','resolve','groupmsg','c2cmsg','channelmsg','at','log');
  $set = array();
  foreach (array_merge($别名, $规范) as $c) $set[$c] = true;
  return $set;
}

// 词库可行性测试：返回 array(格式, 行数, 条目/规则数, 触发数, 问题[前N条], 总问题数)
function dic_test($path) {
  $raw = (string)@file_get_contents($path);
  $raw = str_replace(array("\r\n", "\r"), "\n", $raw);
  $lines = explode("\n", $raw);
  $lzy = false;
  foreach ($lines as $l) {
    $t = trim($l);
    if (preg_match('/^(词库|规则)\s/', $t) || preg_match('/^触发(\s|$)/', $t) || $t === '结束规则') { $lzy = true; break; }
  }
  $问题 = array();
  $总问题 = 0;
  $加 = function ($msg) use (&$问题, &$总问题) { $总问题++; if (count($问题) < 15) $问题[] = $msg; };
  $已知 = dic_known_cmds();

  $规则数 = 0; $触发数 = 0; $条目数 = 0;

  if ($lzy) {
    $inRule = false; $ruleName = ''; $ruleTriggers = 0;
    $seen = array();
    foreach ($lines as $i => $l) {
      $ln = $i + 1;
      $t = trim($l);
      if ($t === '') continue;
      if (preg_match('/^规则\s+(\S.*)$/', $t, $m)) {
        if ($inRule) $加("第{$ln}行：规则「{$ruleName}」尚未 结束规则 就又出现新规则");
        $inRule = true; $ruleName = trim($m[1]); $ruleTriggers = 0; $规则数++;
      } elseif (preg_match('/^触发\s+(\S.*)$/', $t, $m)) {
        if (!$inRule) { $加("第{$ln}行：触发 出现在规则外"); continue; }
        $trg = trim($m[1]); $触发数++; $ruleTriggers++;
        if (isset($seen[$trg])) $加("第{$ln}行：触发重复「{$trg}」（后者覆盖前者）");
        $seen[$trg] = true;
      } elseif ($t === '结束规则') {
        if (!$inRule) { $加("第{$ln}行：多余的 结束规则"); continue; }
        if ($ruleTriggers === 0) $加("第{$ln}行：规则「{$ruleName}」缺少 触发");
        $inRule = false;
      }
      // $ 命令闭合与命令名检查（注释行不参与）
      if (strpos($t, '//') !== 0) {
        // 成对命令：校验命令名是否已知
        if (preg_match_all('/\$([^$]{1,200})\$/u', $l, $mm)) {
          foreach ($mm[1] as $seg) {
            $seg = trim($seg);
            if ($seg === '') continue;
            $tok = preg_split('/\s+/u', $seg)[0];
            if ($tok === '' || mb_strlen($tok, 'UTF-8') > 24) continue;
            if (preg_match('/^\d+$/', $tok)) continue; // $5$ 之类字面量
            if (!isset($已知[$tok])) $加("第{$ln}行：未知命令 \$" . $tok . '$');
          }
        }
        // 未闭合命令：$ 后紧跟已知命令名，但本行没有结尾 $
        $pos = 0;
        while (($p = strpos($l, '$', $pos)) !== false) {
          $rest = substr($l, $p + 1);
          if (preg_match('/^\s*([^\s$]{1,24})/u', $rest, $tm) && isset($已知[$tm[1]])) {
            if (strpos($l, '$', $p + 1) === false) $加("第{$ln}行：命令未闭合（缺少结尾 \$）：\$" . $tm[1]);
          }
          $pos = $p + 1;
        }
      }
    }
    if ($inRule) $加("规则「{$ruleName}」缺少 结束规则");
    return array('格式' => 'lzyqzb 规则词库', '行数' => count($lines), '规则数' => $规则数, '触发数' => $触发数, '问题' => $问题, '总问题' => $总问题);
  }

  // dict：key|value 两列
  $keys = array();
  foreach ($lines as $i => $l) {
    $ln = $i + 1;
    $t = trim($l);
    if ($t === '' || $t[0] === '#') continue;
    $sep = strpos($l, '|');
    if ($sep === false) { $加("第{$ln}行：缺少分隔符 |（词典格式应为 关键词|回复）"); continue; }
    $k = trim(substr($l, 0, $sep));
    if ($k === '') { $加("第{$ln}行：关键词为空"); continue; }
    if (strpos($k, '|') !== false) { $加("第{$ln}行：关键词含多余 |"); continue; }
    $条目数++;
    if (isset($keys[$k])) $加("第{$ln}行：关键词重复「{$k}」"); else $keys[$k] = true;
  }
  return array('格式' => 'dict 词典（关键词|回复）', '行数' => count($lines), '条目数' => $条目数, '问题' => $问题, '总问题' => $总问题);
}

function dic_fmt_test($r, $file) {
  $out = "🧪 词库可行性测试：{$file}\n";
  $out .= "格式：{$r['格式']}｜总行数：{$r['行数']}\n";
  if (isset($r['条目数'])) $out .= "词条数：{$r['条目数']}\n";
  else $out .= "规则数：{$r['规则数']}｜触发数：{$r['触发数']}\n";
  if ($r['总问题'] === 0) {
    $out .= "✅ 未发现问题，词库可正常加载执行。";
  } else {
    $out .= "⚠️ 发现 {$r['总问题']} 处问题：\n";
    foreach ($r['问题'] as $p) $out .= "· {$p}\n";
    if ($r['总问题'] > count($r['问题'])) $out .= "…（仅显示前 " . count($r['问题']) . " 条）";
  }
  return trim($out);
}

$子 = trim(mb_substr($命令, mb_strlen('词库', 'UTF-8'), null, 'UTF-8'));
$参数 = '';
if (strpos($子, ' ') !== false) {
  $p = explode(' ', $子, 2);
  $子 = $p[0];
  $参数 = trim($p[1]);
}

if ($子 === '帮助') {
  文字("📖 DIC词库管理（仅超主/群主/群管）\n"
    . "词库列表 —— 查看 plugins/词库 下所有词库\n"
    . "词库当前 —— 显示当前启用词库\n"
    . "词库测试 [文件名] —— 可行性/语法测试\n"
    . "词库详情 <文件名> —— 规则/触发/命令行统计\n"
    . "词库切换 <文件名> —— 设为当前启用词库\n"
    . "面板可视化编辑：插件管理→DIC管理→📖 DIC词库");
  exit(0);
}

if ($子 === '列表') {
  $files = dic_files($词库目录, $旧目录);
  if (empty($files)) { 文字('📭 plugins/词库/ 下暂无 .txt/.cid 词库文件。'); exit(0); }
  $act = dic_active($词库目录);
  $out = "📚 词库列表（" . count($files) . " 个）\n";
  $i = 0;
  foreach ($files as $f) {
    $i++;
    $mark = ($f['name'] === $act) ? ' ✅当前' : '';
    $out .= "{$i}. {$f['name']}（{$f['dir']}）{$mark}\n";
  }
  $out .= "发送「词库测试 文件名」可校验；「词库切换 文件名」可启用。";
  文字(trim($out));
  exit(0);
}

if ($子 === '当前') {
  $act = dic_active($词库目录);
  if ($act === '') { 文字('当前未显式指定启用词库，娱乐群管默认使用「娱乐群管.txt」。\n发送「词库切换 文件名」可指定。'); exit(0); }
  $p = dic_path($词库目录, $旧目录, $act);
  $存在 = $p !== '' ? '✅ 存在' : '❌ 文件缺失';
  文字("🎯 当前启用词库：{$act}（{$存在}）\n发送「词库测试 {$act}」可校验。");
  exit(0);
}

if ($子 === '测试' || $子 === '校验') {
  $file = $参数;
  if ($file === '') $file = dic_active($词库目录);
  if ($file === '') $file = '娱乐群管.txt';
  $path = dic_path($词库目录, $旧目录, $file);
  if ($path === '') { 文字("❌ 找不到词库文件：{$file}\n发送「词库列表」查看可用文件。"); exit(0); }
  $r = dic_test($path);
  文字(dic_fmt_test($r, basename($file)));
  exit(0);
}

if ($子 === '详情') {
  if ($参数 === '') { 文字('格式：词库详情 <文件名>'); exit(0); }
  $path = dic_path($词库目录, $旧目录, $参数);
  if ($path === '') { 文字("❌ 找不到词库文件：{$参数}"); exit(0); }
  $r = dic_test($path);
  $out = "📑 词库详情：" . basename($参数) . "\n";
  $out .= "格式：{$r['格式']}｜总行数：{$r['行数']}\n";
  if (isset($r['条目数'])) $out .= "词条数：{$r['条目数']}\n";
  else $out .= "规则数：{$r['规则数']}｜触发数：{$r['触发数']}\n";
  $out .= "问题数：{$r['总问题']}";
  文字($out);
  exit(0);
}

if ($子 === '切换') {
  if ($参数 === '') { 文字('格式：词库切换 <文件名>（如：词库切换 娱乐群管.txt）'); exit(0); }
  $file = basename($参数);
  if ($file === '' || !preg_match('/^[^\\\\\/:*?"<>|]+\.(txt|cid)$/i', $file)) { 文字('❌ 非法的词库文件名，仅支持单层 .txt/.cid。'); exit(0); }
  $path = dic_path($词库目录, $旧目录, $file);
  if ($path === '') { 文字("❌ 找不到词库文件：{$file}"); exit(0); }
  // 切换前先做可行性测试，避免启用有问题的词库
  $r = dic_test($path);
  @file_put_contents($词库目录 . '/.dic_active', $file);
  $out = "✅ 已切换当前启用词库为：{$file}\n";
  if ($r['总问题'] > 0) $out .= "⚠️ 该词库有 {$r['总问题']} 处问题，建议先「词库测试 {$file}」修复。\n";
  $out .= "生效：面板「cid 词库管理」保存一次词库，或在插件管理禁用再启用「娱乐群管」。";
  文字($out);
  exit(0);
}

if ($子 === '刷新') {
  $act = dic_active($词库目录);
  $out = "🔄 已重新读取词库目录。\n当前启用：" . ($act !== '' ? $act : '娱乐群管.txt（默认）') . "\n";
  $out .= "如需即时生效，请在面板「cid 词库管理」保存词库以触发热重载。";
  文字($out);
  exit(0);
}

文字('❓ 未知词库指令，发送「词库帮助」查看用法。');
