#!/usr/bin/env php
<?php
/**
 * 分类菜单插件 v1.0.0（PHP 入口）
 *
 * 收到 menu / 菜单 指令时，按「管理 / 娱乐 / 实用功能」分类展示已启用指令。
 *
 * ============ 消息事件输入（自动检测，兼容四种方式） ============
 * 1) 环境变量：PLUGIN_MSG / MSG_CONTENT / CONTENT / MESSAGE（事件信息走 MSG_TYPE/GROUP_OPENID/USER_OPENID/MSG_ID/BOT_APPID）
 * 2) HTTP POST：php://input 的 JSON 或表单 body（Webhook 接入）
 * 3) stdin 管道：平台以子进程方式执行并把消息事件 JSON 写入 stdin（进程接入）
 * 4) CLI 参数：--event '{"content":"菜单",...}' / --content "菜单" [--type group|guild|c2c] [--text]
 *
 * ============ 回复输出 ============
 * - HTTP 模式：JSON 响应 { reply, ... }
 * - CLI/stdin 模式：stdout 输出 JSON { reply, ... }；加 --text 输出纯文本（本地调试用）
 *
 * ============ 指令清单数据源（三级 fallback） ============
 * 1) 平台插件列表 API（环境变量 PLUGIN_PLATFORM_API，鉴权用 PLUGIN_API_TOKEN）
 * 2) 本机后端 API（PLUGIN_LOCAL_API，默认 http://127.0.0.1:{PORT}/api/plugins）
 * 3) 内置静态清单（下方 STATIC_PLUGINS，结合 qq-bot-platform 现有插件）
 */

// ==================== 配置（环境变量 > plugin.json > 默认值） ====================

$CONFIG = array(
    'triggers'          => array('menu', '菜单'),
    'match_mode'        => 'exact',        // exact | contains
    'categories'        => array('管理', '娱乐', '实用'),
    'platform_api'      => getenv('PLUGIN_PLATFORM_API') ?: '',
    'local_api'         => getenv('PLUGIN_LOCAL_API') ?: '',
    'api_token'         => getenv('PLUGIN_API_TOKEN') ?: '',
    'port'              => getenv('PORT') ?: '3000',
    'timeout'           => 4,
    'show_only_enabled' => true,           // true：只展示数据源中 enabled=1 的插件
    'output'            => 'auto',         // auto | text | json
);

// 平台运行时若注入 event，可通过 PLUGIN_EVENT_JSON 环境变量整体传入（覆盖单字段变量）
if (($GLOBALS['__event_json'] = getenv('PLUGIN_EVENT_JSON'))) {
    $CONFIG['__event_json'] = $GLOBALS['__event_json'];
}

// ==================== 内置静态清单（结合当前项目 plugins/） ====================

$STATIC_PLUGINS = array(
    // ---- 管理类 ----
    array('name' => '主菜单',     'category' => '管理', 'enabled' => true, 'commands' => '开机/关机/全景/主菜单', 'description' => '导航中枢，路由所有子插件'),
    array('name' => '开关机控制', 'category' => '管理', 'enabled' => true, 'commands' => '开机/关机/获取授权码/登录', 'description' => '身份权限+面板登录+群管一体化'),
    array('name' => '系统设置',   'category' => '管理', 'enabled' => true, 'commands' => '功能开关/定时任务', 'description' => '系统功能开关与定时任务配置'),
    array('name' => '系统工具',   'category' => '管理', 'enabled' => true, 'commands' => '系统状态/在线时间', 'description' => '运行状态与在线时间查询'),
    array('name' => '群管理工具', 'category' => '管理', 'enabled' => true, 'commands' => '禁言/解禁/踢人/全部解禁', 'description' => '群组管理工具集'),
    array('name' => '群信息',     'category' => '管理', 'enabled' => true, 'commands' => '群资料查询', 'description' => '群信息查询'),
    array('name' => '授权系统',   'category' => '管理', 'enabled' => true, 'commands' => '生成授权码/激活授权码', 'description' => '授权码管理与角色分配'),
    array('name' => '定时推送',   'category' => '管理', 'enabled' => true, 'commands' => '定时播报/报时', 'description' => '定时消息推送'),
    array('name' => 'DIC管理',    'category' => '管理', 'enabled' => true, 'commands' => '词典管理/词条', 'description' => '词典数据管理'),
    // ---- 娱乐类 ----
    array('name' => '娱乐中心',   'category' => '娱乐', 'enabled' => true, 'commands' => '笑话/运势/骰子/猜数字', 'description' => '娱乐小游戏'),
    array('name' => '问候插件',   'category' => '娱乐', 'enabled' => true, 'commands' => '入群/退群问候', 'description' => '成员入群退群问候'),
    // ---- 实用类 ----
    array('name' => '签到系统',   'category' => '实用', 'enabled' => true, 'commands' => '签到/积分/个人信息', 'description' => '每日签到与积分'),
    array('name' => '关键词回复', 'category' => '实用', 'enabled' => true, 'commands' => '关键词自动回复', 'description' => '关键词应答'),
    array('name' => '词典回复',   'category' => '实用', 'enabled' => true, 'commands' => '词典查询', 'description' => '词典应答'),
    array('name' => '实用工具',   'category' => '实用', 'enabled' => true, 'commands' => '日常小工具', 'description' => '实用功能集合'),
    array('name' => '按钮菜单',   'category' => '实用', 'enabled' => true, 'commands' => '按钮菜单', 'description' => '内联键盘按钮菜单'),
);

// 数据源无 category 字段时的归类关键词
$CATEGORY_RULES = array(
    '管理' => array('群管', '系统', '授权', '定时', '开关机', '管理', 'DIC', '主菜单', '设置', '信息', '推送', '面板', '登录'),
    '娱乐' => array('娱乐', '游戏', '笑话', '骰子', '运势', '猜数字', '问候', '按钮'),
    '实用' => array('签到', '积分', '关键词', '词典', '工具', '回复'),
);

// ==================== 消息事件采集（多来源） ====================

function parseArgs($argv = array()) {
    if (!is_array($argv)) $argv = array();
    $args = array();
    $n = count($argv);
    $i = 1;
    while ($i < $n) {
        $a = $argv[$i];
        if ($a === '--event' || $a === '-e') { $args['event'] = isset($argv[$i + 1]) ? $argv[$i + 1] : ''; $i += 2; continue; }
        if ($a === '--content' || $a === '-c') { $args['content'] = isset($argv[$i + 1]) ? $argv[$i + 1] : ''; $i += 2; continue; }
        if ($a === '--type' || $a === '-t') { $args['type'] = isset($argv[$i + 1]) ? $argv[$i + 1] : ''; $i += 2; continue; }
        if ($a === '--text') { $args['text'] = true; $i += 1; continue; }
        if ($a === '--help' || $a === '-h') { $args['help'] = true; $i += 1; continue; }
        $i += 1;
    }
    return $args;
}

function eventFromEnv() {
    if (getenv('PLUGIN_EVENT_JSON')) {
        $data = json_decode(getenv('PLUGIN_EVENT_JSON'), true);
        if (is_array($data)) return $data;
    }
    $content = '';
    foreach (array('PLUGIN_MSG', 'MSG_CONTENT', 'CONTENT', 'MESSAGE') as $k) {
        $v = getenv($k);
        if ($v !== false && $v !== '') { $content = $v; break; }
    }
    if ($content === '') return null;
    $type = getenv('MSG_TYPE') ?: getenv('EVENT_TYPE');
    $type = $type ? strtolower($type) : 'c2c';
    return array(
        'type'         => $type,
        'content'      => $content,
        'group_openid' => getenv('GROUP_OPENID') ?: '',
        'user_openid'  => getenv('USER_OPENID') ?: '',
        'msg_id'       => getenv('MSG_ID') ?: '',
        'bot_appid'    => getenv('BOT_APPID') ?: '',
    );
}

function normalizeEvent($raw) {
    if (!is_array($raw)) return null;
    $pick = function ($keys, $default = '') use ($raw) {
        foreach ($keys as $k) {
            if (isset($raw[$k]) && $raw[$k] !== '') return $raw[$k];
        }
        return $default;
    };
    $content = (string)$pick(array('content', 'message', 'msg', 'text', 'text_content', 'message_content', 'CONTENT', 'MSG_CONTENT', 'PLUGIN_MSG'));
    if (trim($content) === '') return null;
    $type = strtolower((string)$pick(array('type', 'msg_type', 'event_type', 'msgType'), 'c2c'));
    if (strpos($type, 'group') !== false || strpos($type, 'guild') !== false) $type = 'group';
    else $type = 'c2c';
    return array(
        'type'         => $type,
        'content'      => $content,
        'group_openid' => (string)$pick(array('group_openid', 'group_id', 'groupId', 'groupOpenid', 'chat_id')),
        'user_openid'  => (string)$pick(array('user_openid', 'user_id', 'userId', 'sender_openid', 'from_openid', 'openid', 'userOpenid')),
        'msg_id'       => (string)$pick(array('msg_id', 'message_id', 'msgId')),
        'bot_appid'    => (string)$pick(array('bot_appid', 'bot_id', 'appid', 'botAppid')),
    );
}

function collectEvent($argv) {
    $args = parseArgs($argv);
    if (isset($args['help'])) return array('help' => true);

    // 1) CLI 参数（显式指定优先）
    if (isset($args['event']) && $args['event'] !== '') {
        $ev = normalizeEvent(json_decode($args['event'], true));
        if ($ev) return $ev;
    }
    if (isset($args['content']) && $args['content'] !== '') {
        return array(
            'type'         => isset($args['type']) ? $args['type'] : 'c2c',
            'content'      => $args['content'],
            'group_openid' => '',
            'user_openid'  => 'cli-test',
            'msg_id'       => '',
            'bot_appid'    => '',
        );
    }
    // 2) HTTP POST body
    if (!empty($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $raw = file_get_contents('php://input');
        $data = ($raw !== '' && $raw !== false) ? json_decode($raw, true) : null;
        if (!is_array($data)) $data = $_POST;
        if (is_array($data)) {
            $ev = normalizeEvent($data);
            if ($ev) return $ev;
        }
    }
    // 3) 环境变量
    $ev = eventFromEnv();
    if ($ev) return $ev;
    // 4) stdin 管道
    $stdin = stream_get_contents(STDIN);
    if (is_string($stdin)) {
        $trim = trim($stdin);
        if ($trim !== '') {
            $data = json_decode($trim, true);
            if (is_array($data)) {
                $ev = normalizeEvent($data);
                if ($ev) return $ev;
            }
            return array('type' => 'c2c', 'content' => $trim, 'group_openid' => '', 'user_openid' => 'stdin-test', 'msg_id' => '', 'bot_appid' => '');
        }
    }
    return null;
}

// ==================== 指令匹配 ====================

function stripMention($content) {
    if (preg_match('/^@\S+\s*(.*)$/u', $content, $m)) return trim($m[1]);
    return $content;
}

function matchTrigger($content, $CONFIG) {
    $c = strtolower($content);
    foreach ($CONFIG['triggers'] as $t) {
        $lt = strtolower((string)$t);
        if ($lt === '') continue;
        if ($CONFIG['match_mode'] === 'contains') {
            if (strpos($c, $lt) !== false) return true;
        } elseif ($c === $lt) {
            return true;
        }
    }
    return false;
}

// ==================== 指令清单数据源（三级 fallback） ====================

function httpGetJson($url, $CONFIG) {
    $headers = 'Accept: application/json';
    if ($CONFIG['api_token'] !== '') $headers .= "\r\nAuthorization: Bearer " . $CONFIG['api_token'];
    $ctx = stream_context_create(array('http' => array(
        'method'        => 'GET',
        'timeout'       => $CONFIG['timeout'],
        'header'        => $headers,
        'ignore_errors' => true,
    )));
    $body = @file_get_contents($url, false, $ctx);
    if ($body === false) return null;
    $data = json_decode($body, true);
    return is_array($data) ? $data : null;
}

function fetchPlugins($CONFIG) {
    // 1) 平台插件列表 API
    if ($CONFIG['platform_api'] !== '') {
        $data = httpGetJson($CONFIG['platform_api'], $CONFIG);
        if ($data) return $data;
    }
    // 2) 本机后端 API
    $local = $CONFIG['local_api'];
    if ($local === '') $local = 'http://127.0.0.1:' . $CONFIG['port'] . '/api/plugins';
    $data = httpGetJson($local, $CONFIG);
    if ($data) return $data;
    // 3) 内置静态清单
    return $GLOBALS['STATIC_PLUGINS'];
}

function normalizeStatic($list) {
    $items = array();
    foreach ($list as $p) {
        if (!is_array($p) || !isset($p['name'])) continue;
        $items[] = array(
            'name'        => $p['name'],
            'title'       => isset($p['title']) ? $p['title'] : $p['name'],
            'category'    => isset($p['category']) ? (string)$p['category'] : '',
            'enabled'     => isset($p['enabled']) ? (bool)$p['enabled'] : true,
            'commands'    => isset($p['commands']) ? (string)$p['commands'] : '',
            'description' => isset($p['description']) ? (string)$p['description'] : '',
        );
    }
    return $items;
}

function listPlugins($CONFIG) {
    $data = fetchPlugins($CONFIG);
    if (isset($data['plugins']) && is_array($data['plugins'])) $data = $data['plugins'];
    if (isset($data['data']) && is_array($data['data'])) $data = $data['data'];
    if (!is_array($data) || empty($data)) return normalizeStatic($GLOBALS['STATIC_PLUGINS']);

    $items = array();
    foreach ($data as $p) {
        if (!is_array($p)) continue;
        $name = isset($p['name']) ? $p['name'] : (isset($p['title']) ? $p['title'] : '');
        if (trim($name) === '') continue;
        $enabled = isset($p['enabled']) ? (bool)$p['enabled'] : true;
        if ($CONFIG['show_only_enabled'] && !$enabled) continue;
        $items[] = array(
            'name'       => $name,
            'title'      => isset($p['title']) ? $p['title'] : $name,
            'category'   => isset($p['category']) ? (string)$p['category'] : '',
            'enabled'    => $enabled,
            'commands'   => isset($p['commands']) ? (string)$p['commands'] : '',
            'description'=> isset($p['description']) ? (string)$p['description'] : '',
        );
    }
    return empty($items) ? normalizeStatic($GLOBALS['STATIC_PLUGINS']) : $items;
}

// ==================== 分类 ====================

function classifyItem($item) {
    $cat = trim((string)$item['category']);
    if ($cat !== '') {
        foreach (array('管理' => '管理', '娱乐' => '娱乐', '实用' => '实用') as $c) {
            if (strpos($cat, $c) !== false) return $c;
        }
    }
    $hay = $item['name'] . $item['commands'] . $item['description'];
    foreach ($GLOBALS['CATEGORY_RULES'] as $c => $kws) {
        foreach ($kws as $kw) {
            if (strpos($hay, $kw) !== false) return $c;
        }
    }
    return '实用';
}

// ==================== 菜单文本生成 ====================

function buildMenu($items, $CONFIG) {
    $groups = array();
    foreach ($CONFIG['categories'] as $c) $groups[$c] = array();
    foreach ($items as $it) $groups[classifyItem($it)][] = $it;

    $icons = array('管理' => '🔧', '娱乐' => '🎮', '实用' => '🛠');
    $lines = array('📌 分类菜单（' . implode(' / ', $CONFIG['categories']) . '）', '━━━━━━━━━━━━━━━━');
    foreach ($CONFIG['categories'] as $cat) {
        if (empty($groups[$cat])) continue;
        $lines[] = (isset($icons[$cat]) ? $icons[$cat] : '•') . ' ' . $cat;
        $total = count($groups[$cat]);
        foreach ($groups[$cat] as $i => $it) {
            $branch = ($i === $total - 1) ? '  └ ' : '  ├ ';
            $sub = '';
            if ($it['commands'] !== '') $sub = ' - ' . $it['commands'];
            elseif ($it['description'] !== '') $sub = ' - ' . $it['description'];
            $lines[] = $branch . $it['title'] . $sub;
        }
    }
    $lines[] = '━━━━━━━━━━━━━━━━';
    $lines[] = '📩 发送「主菜单」返回主界面';
    return implode("\n", $lines);
}

// ==================== 输出 ====================

function outputReply($event, $reply, $CONFIG, $args) {
    $isHttp = !empty($_SERVER['REQUEST_METHOD']);
    $payload = array('reply' => $reply, 'type' => $event['type'], 'content' => $event['content']);
    if ($isHttp) {
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($payload, JSON_UNESCAPED_UNICODE);
        return;
    }
    if (isset($args['text'])) { echo $reply . "\n"; return; }
    echo json_encode($payload, JSON_UNESCAPED_UNICODE) . "\n";
}

function printHelp() {
    echo "分类菜单插件 v1.0.0 (PHP)\n";
    echo "用法:\n";
    echo "  php Main.php --content \"菜单\" [--type group|c2c] [--text]   # 直接指定内容\n";
    echo "  php Main.php --event '{\"content\":\"菜单\",\"type\":\"group\"}' [--text]\n";
    echo "  echo '{\"content\":\"menu\"}' | php Main.php                  # stdin 管道\n";
    echo "  PLUGIN_MSG=菜单 php Main.php                                 # 环境变量\n";
    echo "环境变量: PORT / PLUGIN_PLATFORM_API / PLUGIN_LOCAL_API / PLUGIN_API_TOKEN / PLUGIN_EVENT_JSON\n";
}

// ==================== 主流程 ====================

$ARGS = parseArgs(isset($argv) ? $argv : array());
if (isset($ARGS['help'])) { printHelp(); exit(0); }

$event = collectEvent($argv);
if (!$event) exit(0);
if (!isset($event['content'])) exit(0);

$content = stripMention(trim($event['content']));
if ($content === '') exit(0);
if (!matchTrigger($content, $CONFIG)) exit(0);

$items = listPlugins($CONFIG);
$reply = buildMenu($items, $CONFIG);
outputReply($event, $reply, $CONFIG, $ARGS);
exit(0);
