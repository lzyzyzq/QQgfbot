<?php
if (!defined('PHP_PLUGIN_DATA_DIR')) define('PHP_PLUGIN_DATA_DIR', "/workspace/data/database");
if (!defined('PHP_PLUGIN_BRIDGE_URL')) define('PHP_PLUGIN_BRIDGE_URL', "http://127.0.0.1:3000");
if (!isset($GLOBALS['__PHP_REPLIES'])) $GLOBALS['__PHP_REPLIES'] = array();
ob_start();
register_shutdown_function(function () {
  $__out = (string)ob_get_clean();
  if (trim($__out) !== '') { echo $__out; }
  elseif (!empty($GLOBALS['__PHP_REPLIES'])) { echo json_encode(array('replies' => $GLOBALS['__PHP_REPLIES']), JSON_UNESCAPED_UNICODE); }
  else { echo '{}'; }
});
// QQ 机器人 PHP 插件辅助函数库
// 由 PHP 插件桥在运行时自动注入到插件源码前，插件文件内可直接调用；
// 插件也可手动 require_once __DIR__.'/php_helpers.php';
// 说明见 /workspace/docs/PHP插件开发文档.md

if (!defined('PHP_HELPERS_LOADED')) {
define('PHP_HELPERS_LOADED', 1);

if (!function_exists('__php_data_dir')) {
function __php_data_dir() {
  $base = defined('PHP_PLUGIN_DATA_DIR') && PHP_PLUGIN_DATA_DIR
    ? PHP_PLUGIN_DATA_DIR
    : (getcwd() . '/data/database');
  if (!is_dir($base)) @mkdir($base, 0777, true);
  return $base;
}
}

if (!function_exists('__php_safe_path')) {
function __php_safe_path($name, $ext = '') {
  $name = str_replace(array('..', '/', '\\', "\0"), '', (string)$name);
  if ($name === '') return '';
  $p = __php_data_dir() . '/' . $name;
  if (strpos(basename($p), '.') === false) $p .= $ext;
  return $p;
}
}

// ================= 数据读写（data/database 目录，自动加 .json） =================

if (!function_exists('读')) {
// 读：读取 JSON 数据；文件不存在或损坏返回 $default
// 用法1：读($name, $default=null) 读整个文件
// 用法2：读($name, $key, $default=null) 读文件内指定键（对象/数组的键）
function 读($name, $key = null, $default = null) {
  if (is_array($key) || is_object($key)) { $default = $key; $key = null; }
  $f = __php_safe_path($name, '.json');
  if (!is_file($f)) return $key === null ? $default : $default;
  $raw = @file_get_contents($f);
  if ($raw === false) return $default;
  $j = json_decode($raw, true);
  if ($key === null) return $j === null ? $raw : $j;
  if (is_array($j) && array_key_exists($key, $j)) return $j[$key];
  return $default;
}
function read_data($name, $key = null, $default = null) { return 读($name, $key, $default); }

// 写：保存 JSON 数据，成功返回 true
// 用法1：写($name, $data) 写整个文件
// 用法2：写($name, $key, $data) 只更新文件内指定键（保留其他键）
function 写($name, $key = null, $data = null) {
  if (is_array($key) || is_object($key)) { $data = $key; $key = null; }
  $f = __php_safe_path($name, '.json');
  if ($f === '') return false;
  if (func_num_args() >= 3) {
    // 三参：键写入
    $existing = array();
    if (is_file($f)) {
      $raw = @file_get_contents($f);
      $j = json_decode($raw, true);
      if (is_array($j)) $existing = $j;
    }
    $existing[$key] = $data;
    $ok = @file_put_contents($f, json_encode($existing, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);
    return $ok !== false;
  }
  // 两参：整文件写入（$data 优先，兼容 写($name, $arr) 风格）
  $ok = @file_put_contents($f, json_encode($data === null ? $key : $data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);
  return $ok !== false;
}
function write_data($name, $key = null, $data = null) { return func_num_args() >= 3 ? 写($name, $key, $data) : 写($name, $key); }

// 删：删除数据文件
function 删($name) {
  $f = __php_safe_path($name, '.json');
  if ($f === '' || !is_file($f)) return false;
  return @unlink($f);
}
}

// ================= HTTP 请求 =================

if (!function_exists('curl')) {
// curl：HTTP 请求。method: GET/POST/PUT/DELETE；data 为数组时自动 JSON 编码。
// 响应为 JSON 时自动解码为数组，否则返回字符串；失败返回 null
function curl($url, $method = 'GET', $data = null, $timeout = 8) {
  if (!function_exists('curl_init')) return null;
  $ch = curl_init((string)$url);
  curl_setopt_array($ch, array(
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => (int)$timeout,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => false,
    CURLOPT_USERAGENT => 'qq-bot-php-plugin',
  ));
  $m = strtoupper((string)$method);
  if (in_array($m, array('POST', 'PUT', 'PATCH', 'DELETE'), true)) {
    $body = is_array($data) ? json_encode($data, JSON_UNESCAPED_UNICODE) : (string)$data;
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $m);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    curl_setopt($ch, CURLOPT_HTTPHEADER, array('Content-Type: application/json'));
  }
  $res = curl_exec($ch);
  curl_close($ch);
  if ($res === false) return null;
  $j = json_decode($res, true);
  return $j === null ? $res : $j;
}
function http_get($url, $timeout = 8) { return curl($url, 'GET', null, $timeout); }
function http_post($url, $data, $timeout = 8) { return curl($url, 'POST', $data, $timeout); }
}

// ================= 二维码 =================

if (!function_exists('二维码')) {
// 二维码：返回二维码图片 URL（可作回复图片发送）
function 二维码($text, $size = 300) {
  return 'https://api.qrserver.com/v1/create-qr-code/?size=' . (int)$size . 'x' . (int)$size . '&data=' . urlencode((string)$text);
}
function qrcode($text, $size = 300) { return 二维码($text, $size); }
}

// ================= 文本工具 =================

if (!function_exists('域名大写')) {
// 域名大写：域名转大写显示
function 域名大写($domain) { return strtoupper((string)$domain); }
function upper_domain($domain) { return 域名大写($domain); }
}

if (!function_exists('markdown转html')) {
// markdown转html：简易 Markdown → HTML
function markdown转html($md) {
  $s = htmlspecialchars((string)$md, ENT_QUOTES, 'UTF-8');
  $s = preg_replace('/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/', '<a href="$2" target="_blank" rel="nofollow">$1</a>', $s);
  $s = preg_replace('/\*\*([^*]+)\*\*/', '<strong>$1</strong>', $s);
  $s = preg_replace('/\*([^*]+)\*/', '<em>$1</em>', $s);
  $s = preg_replace('/^### (.*)$/m', '<h3>$1</h3>', $s);
  $s = preg_replace('/^## (.*)$/m', '<h2>$1</h2>', $s);
  $s = preg_replace('/^# (.*)$/m', '<h1>$1</h1>', $s);
  $s = preg_replace("/\n/", '<br>', $s);
  return $s;
}
function md_to_html($md) { return markdown转html($md); }
}

if (!function_exists('邮箱验证')) {
// 邮箱验证：邮箱格式校验，返回 true/false
function 邮箱验证($email) {
  return filter_var((string)$email, FILTER_VALIDATE_EMAIL) !== false;
}
function is_email($email) { return 邮箱验证($email); }
}

if (!function_exists('html转图')) {
// html转图：把 HTML 渲染为图片。需配置外部渲染服务
// （桥运行时注入常量 PHP_PLUGIN_HTML2IMG_URL，POST {html,width} 返回 {url}）。
// 未配置时返回空字符串
function html转图($html, $width = 800) {
  $svc = defined('PHP_PLUGIN_HTML2IMG_URL') ? PHP_PLUGIN_HTML2IMG_URL : '';
  if ($svc === '') return '';
  $res = curl($svc, 'POST', array('html' => (string)$html, 'width' => (int)$width));
  if (is_array($res) && isset($res['url'])) return $res['url'];
  return '';
}
function html_to_image($html, $width = 800) { return html转图($html, $width); }
}

// ================= 时间/随机 =================

if (!function_exists('当前时间')) {
// 当前时间：北京时间
function 当前时间($fmt = 'Y-m-d H:i:s') { return gmdate($fmt, time() + 8 * 3600); }
function now($fmt = 'Y-m-d H:i:s') { return 当前时间($fmt); }
function 随机数($min = 0, $max = 100) { return mt_rand((int)$min, (int)$max); }
}

// ================= 回复构造 =================

if (!function_exists('回复文本')) {
function 回复文本($content) { return array('type' => 'text', 'content' => (string)$content); }
function 回复图片($url, $fileName = '') { return array('type' => 'image', 'imageUrl' => (string)$url, 'fileName' => (string)$fileName); }
function 回复语音($url, $fileName = '') { return array('type' => 'voice', 'voiceUrl' => (string)$url, 'fileName' => (string)$fileName); }
function 回复按钮($rows, $content = ' ') { return array('type' => 'button', 'rows' => $rows, 'content' => (string)$content); }
function 回复文卡($title, $content, $url = '') { return array('type' => 'infocard', 'title' => (string)$title, 'content' => (string)$content, 'url' => (string)$url); }
}

// ================= 快捷发送（自动累积回复，脚本结束自动输出） =================

if (!function_exists('文字')) {
// 文字：发送文本回复（自动累积，无需手动 echo）
function 文字($content) {
  $GLOBALS['__PHP_REPLIES'][] = array('type' => 'text', 'content' => (string)$content);
  return true;
}
function send_text($content) { return 文字($content); }

// 图片：发送图片回复（支持 URL / base64 data URI），可附带说明文字（先发文字再发图）
function 图片($url, $caption = '', $fileName = '') {
  if ($caption !== '') $GLOBALS['__PHP_REPLIES'][] = array('type' => 'text', 'content' => (string)$caption);
  $GLOBALS['__PHP_REPLIES'][] = array('type' => 'image', 'imageUrl' => (string)$url, 'fileName' => (string)$fileName);
  return true;
}
function send_image($url, $caption = '', $fileName = '') { return 图片($url, $caption, $fileName); }

// 按钮：发送按钮键盘（rows 二维数组）
function 按钮($rows, $content = ' ') { $GLOBALS['__PHP_REPLIES'][] = 回复按钮($rows, $content); return true; }
// 文卡：发送信息卡片
function 文卡($title, $content, $url = '') { $GLOBALS['__PHP_REPLIES'][] = 回复文卡($title, $content, $url); return true; }
}

// ================= 字符串工具 =================

if (!function_exists('前缀')) {
// 前缀：判断字符串是否以指定前缀开头
function 前缀($str, $prefix) {
  return strpos((string)$str, (string)$prefix) === 0;
}
function str_starts($str, $prefix) { return 前缀($str, $prefix); }
}

// ================= 群信息桥接（调用服务端开放平台，需本机桥接端点） =================
// 底层函数：调用 PHP_PLUGIN_BRIDGE_URL 指向的 /api/bot/php-bridge/* 端点（仅本机可访问）
// 桥接端点由服务端 bot-system 路由提供，PHP 插件在服务器本机运行可直接访问

if (!function_exists('__php_bridge_get')) {
function __php_bridge_url() {
  return defined('PHP_PLUGIN_BRIDGE_URL') ? PHP_PLUGIN_BRIDGE_URL : '';
}
function __php_bridge_bot_id() {
  $b = getenv('PHP_PLUGIN_BOT_ID');
  return $b !== false ? (string)$b : '';
}
function __php_bridge_get($path, $query = array()) {
  $base = __php_bridge_url();
  if ($base === '') return null;
  $q = $query;
  if (!isset($q['bot_id']) && __php_bridge_bot_id() !== '') $q['bot_id'] = __php_bridge_bot_id();
  if ($q) $path .= (strpos($path, '?') === false ? '?' : '&') . http_build_query($q);
  return curl($base . '/api/bot/php-bridge/' . $path);
}
function __php_bridge_post($path, $data) {
  $base = __php_bridge_url();
  if ($base === '') return null;
  return curl($base . '/api/bot/php-bridge/' . $path, 'POST', $data);
}

// 群信息API：官方群信息（群名/群成员数等）。成功返回数组，失败返回 null
function 群信息API($groupOpenid) {
  $r = __php_bridge_get('group-info', array('group_openid' => (string)$groupOpenid));
  return (is_array($r) && !empty($r['ok']) && is_array($r['info'])) ? $r['info'] : null;
}
function group_info_api($groupOpenid) { return 群信息API($groupOpenid); }

// 群成员API：官方群成员列表（分页）。返回 array('members'=>[..], 'next_index'=>..)，失败返回 null
function 群成员API($groupOpenid, $limit = 50, $after = '') {
  $r = __php_bridge_get('group-members', array(
    'group_openid' => (string)$groupOpenid,
    'limit' => (int)$limit,
    'after' => (string)$after,
  ));
  if (!is_array($r) || empty($r['ok'])) return null;
  return array('members' => is_array($r['members']) ? $r['members'] : array(), 'next_index' => (string)($r['next_index'] ?? ''));
}
function group_members_api($groupOpenid, $limit = 50, $after = '') { return 群成员API($groupOpenid, $limit, $after); }

// 群详情API：本地绑定信息（群名/群号）。返回 array('id','name','group_number','avatar') 或 null
function 群详情API($groupOpenid) {
  $r = __php_bridge_get('group-detail', array('group_openid' => (string)$groupOpenid));
  return (is_array($r) && !empty($r['ok']) && is_array($r['group'])) ? $r['group'] : null;
}
function group_detail_api($groupOpenid) { return 群详情API($groupOpenid); }

// 群统计API：与旧版「群信息」看板同源聚合数据。
// 返回 array('groupName','groupId','date','until','metrics'[8项],'topUsers','recentUsers','groupRanking','elapsedMs')
// metrics 元素: array('label','value','color')；topUsers: array('name','masked','count')
// recentUsers: array('name','masked','lastSeen')；groupRanking: array('groupId','name','groupNumber','count')
function 群统计API($groupOpenid) {
  $r = __php_bridge_get('group-stats', array('group_openid' => (string)$groupOpenid));
  return (is_array($r) && !empty($r['ok']) && is_array($r['stats'])) ? $r['stats'] : null;
}
function group_stats_api($groupOpenid) { return 群统计API($groupOpenid); }

// 群排行API：今日各群消息数 TopN（跨所有群）。返回 array(array('groupId','name','groupNumber','count'))
function 群排行API($limit = 5) {
  $r = __php_bridge_get('groups-ranking', array('limit' => (int)$limit));
  return (is_array($r) && !empty($r['ok']) && is_array($r['ranking'])) ? $r['ranking'] : array();
}
function groups_ranking_api($limit = 5) { return 群排行API($limit); }

// 群列表API：机器人所在的所有群（本地记录）。返回数组列表，失败返回 array()
function 群列表API() {
  $r = __php_bridge_get('groups');
  return (is_array($r) && !empty($r['ok']) && is_array($r['groups'])) ? $r['groups'] : array();
}
function groups_api() { return 群列表API(); }

// 绘制群统计卡片：服务端 sharp 渲染竖版长图，返回 base64 data URI；失败返回 ''
// 参数见 GroupStatsCardData：date, groupName, groupDesc, until, metrics[[label,value,color]],
//   topActive[[name,value,score]], topRecent[[name,value,score]], topGroups[[name,value,score]], footer
function 绘制群统计卡片($date, $groupName, $until, $metrics, $topActive, $topRecent, $footer = 'QQ机器人 · 群活跃统计', $topGroups = array(), $groupDesc = '', $elapsedMs = 0) {
  $payload = array(
    'date' => (string)$date,
    'groupName' => (string)$groupName,
    'groupDesc' => (string)$groupDesc,
    'until' => (string)$until,
    'metrics' => array(),
    'topActive' => array(),
    'topRecent' => array(),
    'topGroups' => array(),
    'footer' => (string)$footer,
    'elapsedMs' => (float)$elapsedMs,
  );
  $norm = function ($rows) {
    $out = array();
    foreach ((array)$rows as $r) {
      if (!is_array($r)) continue;
      $name = (string)($r['name'] ?? $r['昵称'] ?? (isset($r[0]) ? $r[0] : ''));
      $value = (string)($r['value'] ?? (isset($r[1]) ? $r[1] : ''));
      $score = (float)($r['score'] ?? (isset($r[2]) ? $r[2] : 0));
      if ($name === '' && $value === '') continue;
      $out[] = array('name' => $name, 'value' => $value, 'score' => $score);
    }
    return $out;
  };
  $payload['metrics'] = array_values(array_filter(array_map(function ($m) {
    if (!is_array($m)) return null;
    $label = (string)($m['label'] ?? (isset($m[0]) ? $m[0] : ''));
    $value = (string)($m['value'] ?? (isset($m[1]) ? $m[1] : ''));
    $color = (string)($m['color'] ?? (isset($m[2]) ? $m[2] : '#3b82f6'));
    if ($label === '') return null;
    return array('label' => $label, 'value' => $value, 'color' => $color);
  }, (array)$metrics)));
  $payload['topActive'] = $norm($topActive);
  $payload['topRecent'] = $norm($topRecent);
  $payload['topGroups'] = $norm($topGroups);
  $r = __php_bridge_post('render-stats-card', $payload);
  if (!is_array($r) || empty($r['ok']) || empty($r['base64'])) return '';
  return 'data:image/png;base64,' . $r['base64'];
}
function draw_group_stats_card($date, $groupName, $until, $metrics, $topActive, $topRecent, $footer = 'QQ机器人 · 群活跃统计', $topGroups = array(), $groupDesc = '', $elapsedMs = 0) {
  return 绘制群统计卡片($date, $groupName, $until, $metrics, $topActive, $topRecent, $footer, $topGroups, $groupDesc, $elapsedMs);
}
} // __php_bridge_get 函数块

// ================= 画布类（基于 GD，用于生成图片） =================

if (function_exists('imagecreatetruecolor') && !class_exists('Canvas')) {
class Canvas {
  private $im; private $w; private $h;
  public function __construct($w = 800, $h = 600, $bg = '#ffffff') {
    $this->w = (int)$w; $this->h = (int)$h;
    $this->im = imagecreatetruecolor($this->w, $this->h);
    imagefill($this->im, 0, 0, $this->_color($bg));
  }
  private function _color($c) {
    $c = ltrim((string)$c, '#');
    if (strlen($c) === 3) $c = $c[0].$c[0].$c[1].$c[1].$c[2].$c[2];
    $r = hexdec(substr($c,0,2)); $g = hexdec(substr($c,2,2)); $b = hexdec(substr($c,4,2));
    return imagecolorallocate($this->im, $r, $g, $b);
  }
  public function width() { return $this->w; }
  public function height() { return $this->h; }
  public function fill($color) { imagefill($this->im, 0, 0, $this->_color($color)); return $this; }
  public function rect($x, $y, $w, $h, $color, $filled = false) {
    if ($filled) imagefilledrectangle($this->im, (int)$x, (int)$y, (int)($x+$w), (int)($y+$h), $this->_color($color));
    else imagerectangle($this->im, (int)$x, (int)$y, (int)($x+$w), (int)($y+$h), $this->_color($color));
    return $this;
  }
  public function line($x1, $y1, $x2, $y2, $color, $thick = 1) {
    imagesetthickness($this->im, (int)$thick);
    imageline($this->im, (int)$x1, (int)$y1, (int)$x2, (int)$y2, $this->_color($color));
    imagesetthickness($this->im, 1);
    return $this;
  }
  public function circle($cx, $cy, $r, $color, $filled = false) {
    if ($filled) imagefilledellipse($this->im, (int)$cx, (int)$cy, (int)($r*2), (int)($r*2), $this->_color($color));
    else imageellipse($this->im, (int)$cx, (int)$cy, (int)($r*2), (int)($r*2), $this->_color($color));
    return $this;
  }
  public function text($x, $y, $text, $size = 20, $color = '#333333') {
    $font = $this->_font();
    if ($font !== '') imagettftext($this->im, (int)$size, 0, (int)$x, (int)($y + $size), $this->_color($color), $font, (string)$text);
    else imagestring($this->im, 5, (int)$x, (int)$y, (string)$text, $this->_color($color));
    return $this;
  }
  public function drawText($x, $y, $text, $size = 20, $color = '#333333') { return $this->text($x, $y, $text, $size, $color); }
  private function _font() {
    $list = array(
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
      '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
      '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
    );
    foreach ($list as $f) if (is_file($f)) return $f;
    return '';
  }
  // 保存为 PNG 到 data/database，返回文件绝对路径；name 不含扩展名时自动补 .png
  public function save($name) {
    $name = str_replace(array('..', '/', '\\', "\0"), '', (string)$name);
    if ($name === '') return '';
    $f = __php_data_dir() . '/' . $name;
    if (strpos(basename($f), '.') === false) $f .= '.png';
    @imagepng($this->im, $f);
    imagedestroy($this->im);
    return $f;
  }
  // 返回 base64 data URI（可直接作为回复图片内容）
  public function base64() {
    ob_start();
    imagepng($this->im);
    $b = base64_encode(ob_get_clean());
    imagedestroy($this->im);
    return 'data:image/png;base64,' . $b;
  }
}
}

} // PHP_HELPERS_LOADED

// ================= 更新系统辅助（更新插件使用） =================
// 以下函数独立于 PHP_HELPERS_LOADED 之外，始终可用

if (!function_exists('更新配置')) {
// 更新配置：从面板后端读取（版本/补丁URL/全量URL/更新内容）。失败返回空数组
// 支持远程配置源：本地配置的 configUrl（更新配置远程地址）非空时，优先从该地址
// 拉取更新配置（用于在云端面板统一维护更新参数，家庭/生产服务器执行更新）。
function 更新配置() {
  $r = __php_bridge_get('update-config');
  if (!is_array($r) || empty($r['ok'])) return array('version' => '', 'patchUrl' => '', 'fullUrl' => '', 'changeLog' => '');
  $cfg = array(
    'version' => (string)($r['version'] ?? ''),
    'patchUrl' => (string)($r['patchUrl'] ?? ''),
    'fullUrl' => (string)($r['fullUrl'] ?? ''),
    'changeLog' => (string)($r['changeLog'] ?? ''),
  );
  $remote = trim((string)($r['configUrl'] ?? ''));
  if ($remote !== '' && function_exists('curl_init')) {
    $ch = curl_init((string)$remote);
    curl_setopt_array($ch, array(
      CURLOPT_RETURNTRANSFER => true,
      CURLOPT_TIMEOUT => 10,
      CURLOPT_FOLLOWLOCATION => true,
      CURLOPT_SSL_VERIFYPEER => false,
      CURLOPT_SSL_VERIFYHOST => false,
      CURLOPT_USERAGENT => 'qq-bot-php-plugin-updater',
    ));
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($body !== false && $code < 400) {
      $j = json_decode((string)$body, true);
      if (is_array($j) && !empty($j['ok'])) {
        $rcfg = array(
          'version' => (string)($j['version'] ?? ''),
          'patchUrl' => (string)($j['patchUrl'] ?? ''),
          'fullUrl' => (string)($j['fullUrl'] ?? ''),
          'changeLog' => (string)($j['changeLog'] ?? ''),
        );
        if ($rcfg['version'] !== '' || $rcfg['patchUrl'] !== '' || $rcfg['fullUrl'] !== '') $cfg = $rcfg;
      }
    }
  }
  return $cfg;
}
function update_config() { return 更新配置(); }

// 是否超级主人：openid 属于 admin.json 超主，或超主 QQ 名下的任一 OpenID
function 是否超主($openid) {
  if ((string)$openid === '') return false;
  $r = __php_bridge_post('is-master', array('openid' => (string)$openid));
  return is_array($r) && !empty($r['ok']) && !empty($r['master']);
}
function is_master($openid) { return 是否超主($openid); }

// 下载文件：二进制下载到本地路径，成功返回 true
function 下载文件($url, $dst) {
  if ((string)$url === '' || !function_exists('curl_init')) return false;
  $fp = @fopen((string)$dst, 'wb');
  if (!$fp) return false;
  $ch = curl_init((string)$url);
  curl_setopt_array($ch, array(
    CURLOPT_FILE => $fp,
    CURLOPT_TIMEOUT => 120,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => false,
    CURLOPT_USERAGENT => 'qq-bot-php-plugin-updater',
  ));
  $ok = curl_exec($ch);
  $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  fclose($fp);
  if ($ok === false || $code >= 400 || @filesize((string)$dst) <= 0) { @unlink((string)$dst); return false; }
  return true;
}
function download_file($url, $dst) { return 下载文件($url, $dst); }

// 版本号比较：a>b 返回 1，a==b 返回 0，a<b 返回 -1（按数字分段比较，忽略非数字字符）
function 版本比较($a, $b) {
  $pa = explode('.', preg_replace('/[^0-9.]/', '', (string)$a));
  $pb = explode('.', preg_replace('/[^0-9.]/', '', (string)$b));
  $n = max(count($pa), count($pb));
  for ($i = 0; $i < $n; $i++) {
    $x = (int)($pa[$i] ?? 0); $y = (int)($pb[$i] ?? 0);
    if ($x > $y) return 1;
    if ($x < $y) return -1;
  }
  return 0;
}
function compare_versions($a, $b) { return 版本比较($a, $b); }

// 更新系统根目录：服务器代码根（unzip 解压目标）。可用环境变量 PHP_PLUGIN_ROOT_DIR 覆盖
function 更新根目录() {
  $env = getenv('PHP_PLUGIN_ROOT_DIR');
  if ($env !== false && $env !== '') return rtrim((string)$env, '/');
  $cwd = getcwd();
  if (is_dir($cwd . '/plugins')) return $cwd;
  if (is_dir(dirname($cwd) . '/plugins')) return dirname($cwd);
  return $cwd;
}
function update_root() { return 更新根目录(); }

// 延迟重启 qqbot（pm2）：先输出回复，sleep 后才重启，保证回复已发出
function 延迟重启机器人($秒 = 3) {
  if (!function_exists('exec')) return false;
  $root = 更新根目录();
  $cmd = "nohup bash -c 'sleep " . (int)$秒 . "; cd " . escapeshellarg($root) . " && pm2 restart qqbot' >/dev/null 2>&1 &";
  @exec($cmd);
  return true;
}
function restart_bot_delayed($秒 = 3) { return 延迟重启机器人($秒); }

// 更新数据目录（data/database/更新）
function 更新数据目录() {
  $dir = __php_data_dir() . '/更新';
  if (!is_dir($dir)) @mkdir($dir, 0777, true);
  return $dir;
}

// 更新记录：操作 '读取' 返回列表数组；'追加' 追加条目；'删除' 按序号删除，返回 true/false
function 更新记录($操作 = '读取', $条目 = null, $序号 = -1) {
  $dir = 更新数据目录();
  $f = $dir . '/记录.json';
  $list = array();
  if (is_file($f)) { $j = json_decode(@file_get_contents($f), true); if (is_array($j)) $list = $j; }
  if ((string)$操作 === '追加' && is_array($条目)) {
    $list[] = $条目;
    @file_put_contents($f, json_encode($list, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);
    return true;
  }
  if ((string)$操作 === '删除') {
    $idx = (int)$序号;
    if ($idx >= 0 && $idx < count($list)) {
      array_splice($list, $idx, 1);
      @file_put_contents($f, json_encode($list, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);
      return true;
    }
    return false;
  }
  return $list;
}
function update_records($op = '读取', $item = null, $idx = -1) { return 更新记录($op, $item, $idx); }

// 当前部署版本（data/database/更新/状态.json 记录），空表示从未记录
function 当前版本() {
  $f = 更新数据目录() . '/状态.json';
  if (!is_file($f)) return '';
  $j = json_decode(@file_get_contents($f), true);
  return is_array($j) ? (string)($j['version'] ?? '') : '';
}
function current_version() { return 当前版本(); }

// 记录当前部署版本
function 记录当前版本($version) {
  $f = 更新数据目录() . '/状态.json';
  @file_put_contents($f, json_encode(array('version' => (string)$version, 'updatedAt' => 当前时间()), JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);
}
function record_current_version($version) { return 记录当前版本($version); }

// 更新菜单图片：服务端 sharp 渲染，返回 base64 data URI；失败返回 ''
function 更新菜单图片($data) {
  $r = __php_bridge_post('render-update-card', array('data' => (array)$data));
  if (!is_array($r) || empty($r['ok']) || empty($r['base64'])) return '';
  return 'data:image/png;base64,' . $r['base64'];
}
function render_update_card($data) { return 更新菜单图片($data); }

// 文字外显链接：[显示文字](mqqapi://aio/inlinecmd?command=指令&enter=false&reply=false)
function 外显($label, $cmd) {
  return '[' . (string)$label . '](mqqapi://aio/%69nlinecmd?command=' . urlencode((string)$cmd) . '&enter=false&reply=false)';
}
function inline_link($label, $cmd) { return 外显($label, $cmd); }

// Markdown 快捷回复（文字外显链接需 markdown 才可点击）
function Markdown($content) {
  $GLOBALS['__PHP_REPLIES'][] = array('type' => 'markdown', 'content' => (string)$content);
  return true;
}
function send_markdown($content) { return Markdown($content); }
} // 更新系统辅助

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
// 「系统设置 → 更新系统配置」中维护；默认版本 4.2.57。
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
$版本 = $cfg['version'] !== '' ? $cfg['version'] : '4.2.58';
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

