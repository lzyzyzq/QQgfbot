<?php
if (!defined('PHP_PLUGIN_DATA_DIR')) define('PHP_PLUGIN_DATA_DIR', "/workspace/data/database");
<?php
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
function 读($name, $default = null) {
  $f = __php_safe_path($name, '.json');
  if (!is_file($f)) return $default;
  $raw = @file_get_contents($f);
  if ($raw === false) return $default;
  $j = json_decode($raw, true);
  return $j === null ? $raw : $j;
}
function read_data($name, $default = null) { return 读($name, $default); }

// 写：保存 JSON 数据，成功返回 true
function 写($name, $data) {
  $f = __php_safe_path($name, '.json');
  if ($f === '') return false;
  $ok = @file_put_contents($f, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);
  return $ok !== false;
}
function write_data($name, $data) { return 写($name, $data); }

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
function 读($name, $default = null) {
  $f = __php_safe_path($name, '.json');
  if (!is_file($f)) return $default;
  $raw = @file_get_contents($f);
  if ($raw === false) return $default;
  $j = json_decode($raw, true);
  return $j === null ? $raw : $j;
}
function read_data($name, $default = null) { return 读($name, $default); }

// 写：保存 JSON 数据，成功返回 true
function 写($name, $data) {
  $f = __php_safe_path($name, '.json');
  if ($f === '') return false;
  $ok = @file_put_contents($f, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);
  return $ok !== false;
}
function write_data($name, $data) { return 写($name, $data); }

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

