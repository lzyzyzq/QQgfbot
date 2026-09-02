# coding: utf-8
# ============================================================
# 测试 v0.2 - 多功能菜单 Python 插件（单文件）
# ------------------------------------------------------------
# 命令（群聊/私聊均可，功能均基于 QQ 官方开放平台 API）：
#   测试 / 测试菜单 / 菜单      → 多功能菜单
#   娱乐                         → 娱乐子菜单（骰子/猜拳/猜数字/运势/笑话）
#   实用                         → 实用子菜单（天气/二维码/计算/时间/随机数）
#   唱歌 <歌名> / 清唱 / 怪唱    → 网易云搜歌，先发歌词再以语音条播放完整版权音频
#   禁言 <QQ或openid> <分钟>     → 群成员禁言（官方 mute）
#   解禁 <QQ或openid>            → 解除禁言
#   全群禁言 开/关               → 全体禁言/解除
#   禁言状态                     → 查询群禁言设置
#   广播 <内容>                  → 当前群发公告 + 群消息
#   全体广播 <内容>              → 向全部已收录群广播（仅超级主人）
#   云端广播                     → 查看 GitHub 云端广播列表；「云端广播 名称 [全部/本群]」立即执行（仅超级主人）
#   抖音 <分享口令或链接>        → 解析抖音视频无水印链接
#   重启 / 更新                  → 引导使用「更新系统」或群内直接发送终端命令
# ------------------------------------------------------------
# v0.2 变更：移除 mqqapi 外显文字链接（群消息不支持渲染，改为纯文本指令说明）；
#           唱歌改用网易云真实播放地址接口（enhance/player/url，320k→128k），
#           无版权/需VIP 明确提示，不再播放无版权替代音频。
# ============================================================

import sys
import json
import re
import random
import time
import datetime

try:
    from urllib.parse import urlencode, quote, unquote
    import urllib.request
    import ssl
except Exception:
    urlencode = lambda s, **kw: s
    quote = lambda s, safe='': s
    unquote = lambda s: s
    urllib = None
    ssl = None

_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36'
_guess_state = {}


# ================= 通信原语 =================

def _write(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + '\n')
    sys.stdout.flush()


def reply(data, text):
    """回复当前消息：群消息回群、频道消息回频道、私聊回私聊"""
    t = data.get('type')
    target = ''
    if t == 'message.group':
        target = data.get('groupId') or data.get('channelId') or ''
    elif t == 'message.guild':
        target = data.get('channelId') or ''
    else:
        author = data.get('author') or {}
        target = author.get('openid') or author.get('id') or data.get('member_openid') or ''
    _write({'op': 'reply', 'data': {'type': t, 'target': target, 'openid': target, 'text': text, 'botId': data.get('botId')}})


def call(method, *args):
    """调用 BotAPI / 引擎扩展能力并同步等待结果，例如 call('sendGroupMessage', gid, '内容')"""
    seq = call._seq
    call._seq += 1
    _write({'op': 'call', 'id': seq, 'method': method, 'args': list(args)})
    while True:
        line = sys.stdin.readline()
        if not line:
            return None
        try:
            m = json.loads(line)
        except Exception:
            continue
        if m.get('op') == 'result' and m.get('id') == seq:
            if m.get('error'):
                raise RuntimeError(m['error'])
            return m.get('data')
    return None


call._seq = 1


# ================= 工具 =================

def send_group(data, gid, text):
    try:
        call('sendGroupMessage', gid, text)
    except Exception:
        pass


def http_get(url, timeout=8):
    """GET 请求，返回 (status, body)；失败返回 (0, '')"""
    if urllib is None:
        return (0, '')
    try:
        req = urllib.request.Request(url, headers={'User-Agent': _UA, 'Referer': 'https://www.douyin.com/'})
        ctx = None
        if ssl is not None:
            try:
                ctx = ssl.create_default_context()
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE
            except Exception:
                ctx = None
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
            return (r.status, r.read().decode('utf-8', 'ignore'))
    except Exception as e:
        return (0, '')


def strip_at(content):
    """去掉消息开头的 @机器人 标签"""
    return re.sub(r'^\s*(?:<@!?[A-Fa-f0-9]+>|@\S+)\s*', '', content or '').strip()


def now_str():
    t = time.time() + 8 * 3600
    return time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime(t))


# ================= 菜单 =================

def build_menu():
    lines = []
    lines.append('【测试 · 多功能菜单】v0.1')
    lines.append('━━━━━━━━━━━━━━━━')
    lines.append('🎤 唱歌    → 发送「唱歌 歌名」')
    lines.append('🔇 禁言    → 发送「禁言 QQ号 分钟」')
    lines.append('📢 云端广播 → 发送「云端广播」查看/执行 GitHub 云端广播')
    lines.append('📢 广播    → 发送「广播 内容」')
    lines.append('🎮 娱乐    → 发送「娱乐」')
    lines.append('🔧 实用    → 发送「实用」')
    lines.append('🎵 抖音    → 发送「抖音 分享口令」')
    lines.append('🔄 更新    → 发送「更新」')
    lines.append('━━━━━━━━━━━━━━━━')
    lines.append('发送「主菜单」返回主菜单')
    return '\n'.join(lines)


def collect_menu_items(cfg):
    """递归收集 menu-editor 布局配置中的全部菜单项（label + 指令/链接），用于渲染外显按钮行"""
    items = []
    def walk(o):
        if isinstance(o, dict):
            lbl = o.get('label')
            if isinstance(lbl, str) and ('value' in o or 'cmd' in o or 'url' in o):
                v = o.get('value') or o.get('cmd') or o.get('url') or ''
                if isinstance(v, str) and v:
                    items.append((lbl, v))
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(cfg)
    # 去重（保持顺序）
    seen = set()
    out = []
    for it in items:
        k = (it[0], it[1])
        if k in seen:
            continue
        seen.add(k)
        out.append(it)
    return out


def layout_menu(cfg, botId):
    """按 menu-editor.html 保存的布局配置渲染主菜单（外显按钮行）"""
    items = collect_menu_items(cfg)
    if not items:
        return None
    lines = []
    lines.append('【测试 · 多功能菜单】v0.1（布局版）')
    lines.append('━━━━━━━━━━━━━━━━')
    lines.append('以下菜单项来自后台「插件卡片 · 后台编辑器」')
    lines.append('可在管理面板编辑布局后发送「测试」刷新')
    lines.append('━━━━━━━━━━━━━━━━')
    for lbl, v in items:
        if v.startswith('http://') or v.startswith('https://'):
            lines.append('%s → %s' % (lbl, v))
        else:
            lines.append('%s → 发送「%s」' % (lbl, v))
    lines.append('━━━━━━━━━━━━━━━━')
    lines.append('发送「主菜单」返回')
    return '\n'.join(lines)


def maybe_menu(data):
    """主菜单：优先使用 menu-editor 布局配置，否则内置菜单"""
    botId = data.get('botId') or ''
    cfg = None
    try:
        cfg = call('getMenuConfig', botId)
    except Exception:
        cfg = None
    if isinstance(cfg, dict):
        laid = layout_menu(cfg, botId)
        if laid:
            reply(data, laid)
            return
    reply(data, build_menu())


def build_fun_menu():
    lines = []
    lines.append('【娱乐中心】')
    lines.append('━━━━━━━━━━━━━━━━')
    lines.append('🎲 掷骰子')
    lines.append('✊ 石头剪刀布 <石头/剪刀/布>')
    lines.append('🔢 猜数字（1-100）')
    lines.append('🍀 今日运势')
    lines.append('😂 讲个笑话')
    lines.append('━━━━━━━━━━━━━━━━')
    return '\n'.join(lines)


def build_tool_menu():
    lines = []
    lines.append('【实用功能】')
    lines.append('━━━━━━━━━━━━━━━━')
    lines.append('🌤 天气 <城市>')
    lines.append('▦ 二维码 <内容>')
    lines.append('🔢 计算 <表达式>')
    lines.append('🕐 时间')
    lines.append('🎲 随机数 <最小值> <最大值>')
    lines.append('━━━━━━━━━━━━━━━━')
    return '\n'.join(lines)


# ================= 唱歌（网易云：歌词 + 富媒体语音条） =================

def sing(data, gid, keyword):
    q = quote(keyword)
    st, body = http_get('https://music.163.com/api/search/get/web?s=%s&type=1&limit=1' % q)
    song = None
    if st == 200:
        try:
            j = json.loads(body)
            s = j['result']['songs'][0]
            song = {
                'id': s['id'],
                'name': s['name'],
                'artist': '/'.join([a.get('name', '') for a in (s.get('artists') or [])]) or '未知歌手',
            }
        except Exception:
            song = None
    if not song:
        reply(data, '🎵 未找到「%s」这首歌，换个关键词试试吧~' % keyword)
        return

    sid = song['id']
    # 先发歌词
    try:
        st2, b2 = http_get('https://music.163.com/api/song/lyric?id=%s&lv=1&kv=1&tv=-1' % sid)
        lrc = ''
        if st2 == 200:
            j2 = json.loads(b2)
            lrc = str(j2.get('lrc', {}).get('lyric') or '')
        if lrc:
            out = []
            for ln in lrc.split('\n'):
                ln = re.sub(r'\[[^\]]*\]', '', ln).strip()
                if not ln:
                    continue
                if re.match(r'^(作词|作曲|编曲|制作|混音|母带|录音|监制|和声|吉他|贝斯|鼓|键盘|弦乐|发行|出品|版权|OP|SP)\s*[:：]', ln):
                    continue
                out.append(ln)
                if len(out) >= 26:
                    break
            if out:
                send_group(data, gid, '📜 《%s》歌词\n━━━━━━━━━━━━━━━━\n%s\n━━━━━━━━━━━━━━━━\n🎵 正在演唱，请稍候…' % (song['name'], '\n'.join(out)))
    except Exception:
        pass

    # 语音条：先用网易云真实播放地址接口取音频 URL（无版权/需VIP 时 url 为空，320k→128k 依次尝试）
    audio_url = ''
    for br in (320000, 128000):
        try:
            st3, b3 = http_get('https://music.163.com/api/song/enhance/player/url?id=%s&ids=%%5B%s%%5D&br=%s' % (sid, sid, br))
            if st3 == 200:
                j3 = json.loads(b3)
                u = (j3.get('data') or [{}])[0].get('url')
                if u:
                    audio_url = u
                    break
        except Exception:
            continue
    if not audio_url:
        reply(data, '🎵 《%s》· %s 无版权或需VIP，暂无法语音播放，换一首试试~' % (song['name'], song['artist']))
        return

    voice_ok = False
    try:
        up = call('uploadGroupVoice', gid, audio_url, 'song.mp3')
        if up and (up.get('file_info') or up.get('url')):
            r = call('sendGroupVoiceMessage', gid, up.get('file_info') or up.get('url'))
            voice_ok = bool(r)
    except Exception:
        voice_ok = False

    if voice_ok:
        reply(data, '🎤 已语音播放《%s》· %s\n发送「测试」返回菜单' % (song['name'], song['artist']))
    else:
        reply(data, '🎵 《%s》· %s\n▶️ 试听：%s' % (song['name'], song['artist'], audio_url))


# ================= 禁言（官方群禁言 API） =================

def resolve_target(data, gid, raw):
    """解析禁言目标为成员 openid：支持 <@!openid> / 32位hex openid / 数字QQ"""
    raw = str(raw or '').strip()
    m = re.search(r'<@!?([A-Fa-f0-9]{32})>', raw)
    if m:
        return m.group(1)
    if re.fullmatch(r'[A-Fa-f0-9]{32}', raw):
        return raw
    if re.fullmatch(r'\d{5,12}', raw):
        try:
            oid = call('openidByQq', raw)
            if oid:
                return oid
        except Exception:
            pass
        raise RuntimeError('QQ号 %s 未绑定，请先让该成员发一条消息后重试' % raw)
    raise RuntimeError('无法识别的目标，请使用：禁言 QQ号 分钟')


def mute_cmd(data, content):
    if data.get('type') != 'message.group':
        reply(data, '🔇 禁言功能请在群聊中使用。')
        return
    gid = data.get('groupId') or ''
    user = (data.get('author') or {}).get('openid') or ''
    try:
        if not call('isSuper', user):
            reply(data, '🔇 仅超级主人可执行禁言操作。')
            return
    except Exception:
        reply(data, '🔇 暂无权限判断能力，请联系管理员。')
        return
    parts = content.split()
    # 全群禁言
    if parts[0] in ('全群禁言',):
        if len(parts) > 1 and parts[1] in ('开', '关闭', '关', 'on', 'true'):
            call('muteAll', gid, True)
            reply(data, '🔇 已开启全群禁言。发送「全群禁言 关」解除。')
        else:
            call('muteAll', gid, False)
            reply(data, '🔇 已解除全群禁言。')
        return
    if parts[0] == '禁言状态':
        try:
            st = call('getRestrictChatSetting', gid)
            if isinstance(st, dict):
                reply(data, '🔇 群禁言状态：\n' + json.dumps(st, ensure_ascii=False, indent=2)[:500])
            else:
                reply(data, '🔇 群禁言状态：' + json.dumps(st, ensure_ascii=False))
        except Exception as e:
            reply(data, '🔇 查询失败：%s' % e)
        return
    if len(parts) < 2:
        reply(data, '🔇 用法：\n禁言 <QQ号> <分钟>\n解禁 <QQ号>\n全群禁言 开/关\n禁言状态')
        return
    try:
        oid = resolve_target(data, gid, parts[1])
        if parts[0] == '解禁':
            call('unmuteMember', gid, oid)
            reply(data, '✅ 已解除禁言。')
        elif parts[0] == '禁言':
            mins = 10
            if len(parts) > 2:
                mins = int(re.sub(r'[^0-9]', '', parts[2]) or '10')
            mins = max(1, min(mins, 43200))
            call('muteMember', gid, oid, mins * 60)
            reply(data, '🔇 已禁言 %d 分钟。' % mins)
        else:
            reply(data, '🔇 未知指令。发送「禁言」查看用法。')
    except Exception as e:
        reply(data, '🔇 操作失败：%s' % e)


# ================= 广播（群公告 + 群消息 / 全体群广播 / GitHub 云端广播） =================

def _fmt_cloud_task(t):
    """把云端任务格式化为可读描述"""
    sched = t.get('schedule') or {}
    s = ''
    if sched.get('time'):
        s = '每天 ' + str(sched['time'])
    elif sched.get('intervalMin'):
        s = '每 ' + str(sched['intervalMin']) + ' 分钟'
    if not s:
        s = '手动'
    mode = '图片' if t.get('send') == 'image' else '文本'
    tgt = t.get('target') or 'all'
    if tgt == 'one':
        tgt_s = '单一群'
    elif tgt == 'list':
        tgt_s = '目标群×%d' % len(t.get('groups') or [])
    else:
        tgt_s = '全部群'
    return '🔹 %s（%s）%s · %s\n    发送：%s · 定时：%s' % (
        t.get('name') or t.get('id'),
        t.get('id'),
        '✅' if t.get('enabled') is not False else '⏸',
        tgt_s,
        mode,
        s,
    )


def cloud_broadcast_cmd(data, content):
    """云端广播：查看/发送 GitHub 上的广播任务（broadcast/broadcast.json）
    命令：云端广播               → 查看任务列表
         云端广播 <名称或id> [全部/本群] [立即]
    """
    gid = data.get('groupId') or ''
    user = (data.get('author') or {}).get('openid') or ''
    if data.get('type') != 'message.group':
        reply(data, '📢 云端广播请在群聊中使用。')
        return
    parts = content.split()
    try:
        r = call('broadcastList')
    except Exception as e:
        reply(data, '📢 读取云端广播失败：%s' % e)
        return
    if not isinstance(r, dict) or not r.get('ok'):
        reply(data, '📢 云端广播目录不可用：%s' % (r.get('error') if isinstance(r, dict) else ''))
        return
    tasks = r.get('tasks') or []
    if not tasks:
        reply(data, '📢 云端暂无广播任务（broadcast/broadcast.json 为空）。')
        return
    if len(parts) < 2:
        lines = ['📢 【云端广播列表】(%d 条)' % len(tasks)]
        lines.append('━━━━━━━━━━━━━━━━')
        lines.extend(_fmt_cloud_task(t) for t in tasks)
        lines.append('━━━━━━━━━━━━━━━━')
        lines.append('发送「云端广播 名称」立即执行（仅超级主人）')
        reply(data, '\n'.join(lines))
        return
    # 执行
    try:
        if not call('isSuper', user):
            reply(data, '📢 云端广播仅超级主人可用。')
            return
    except Exception:
        pass
    q = content[len(parts[0]):].strip()
    m = re.match(r'^(.+?)(?:\s+(全部|本群))?$', q)
    target = None
    gid_target = ''
    name = q.strip()
    if m:
        name = (m.group(1) or '').strip()
        scope = m.group(2)
        if scope == '本群':
            target, gid_target = 'this', gid
        elif scope == '全部':
            target = 'all'
    hit = None
    for t in tasks:
        if t.get('id') == name or t.get('name') == name:
            hit = t
            break
    if not hit:
        reply(data, '📢 未找到云端广播「%s」。发送「云端广播」查看列表。' % name)
        return
    try:
        res = call('broadcastSend', hit.get('id'), target or 'default', gid_target)
    except Exception as e:
        reply(data, '📢 执行失败：%s' % e)
        return
    if not isinstance(res, dict) or not res.get('ok'):
        reply(data, '📢 执行失败：%s' % ((res or {}).get('error') or '未知错误'))
        return
    scope_txt = {'this': '当前群', 'all': '全部群'}.get(target, {'all': '全部群', 'one': '单一群', 'list': '目标群'}.get(hit.get('target'), '全部群'))
    if res.get('dryRun'):
        reply(data, '📢 试播「%s」：%s，目标 %s' % (hit.get('name'), res.get('message') or '', scope_txt))
        return
    fail = res.get('failed') or []
    parts_line = '，'.join(fail[:3]) if fail else ''
    extra = '\n未送达：%s' % parts_line if parts_line else ''
    reply(data, '✅ 云端广播「%s」完成：%d/%d 群已发送（%s）%s' % (hit.get('name'), res.get('sent') or 0, res.get('total') or 0, scope_txt, extra))


def broadcast_cmd(data, content):
    gid = data.get('groupId') or ''
    user = (data.get('author') or {}).get('openid') or ''
    if data.get('type') != 'message.group':
        reply(data, '📢 广播功能请在群聊中使用。')
        return
    parts = content.split()
    if len(parts) < 2 or not parts[1].strip():
        reply(data, '📢 用法：\n广播 <内容> —— 当前群公告+消息\n全体广播 <内容> —— 全部群广播（仅超级主人）')
        return
    text = content[len(parts[0]):].strip()
    if not text:
        reply(data, '📢 广播内容不能为空。')
        return
    if parts[0] == '全体广播':
        try:
            if not call('isSuper', user):
                reply(data, '📢 全体广播仅超级主人可用。')
                return
        except Exception:
            pass
        groups = []
        try:
            groups = call('listGroups') or []
        except Exception:
            groups = []
        if not groups:
            reply(data, '📢 暂无可广播的群（groups 表为空）。')
            return
        ok = 0
        for g in groups:
            try:
                call('sendGroupMessage', g, '📢 【全体广播】\n' + text)
                ok += 1
            except Exception:
                pass
        reply(data, '📢 全体广播完成：%d/%d 个群已发送。' % (ok, len(groups)))
        return
    if parts[0] == '广播':
        try:
            call('setAnnouncement', gid, text)
            ann = True
        except Exception:
            ann = False
        send_group(data, gid, '📢 【群公告】\n' + text)
        reply(data, '✅ 广播已发送' + ('并设置为群公告。' if ann else '（公告设置失败，仅群消息）。'))
        return
    reply(data, '📢 用法：\n广播 <内容>\n全体广播 <内容>')


# ================= 娱乐 =================

def guess_init(gid):
    n = random.randint(1, 100)
    _guess_state[gid] = {'num': n, 'try': 0}
    return n


def guess_answer(gid):
    return _guess_state.get(gid, {}).get('num')


def fun_cmd(data, content):
    gid = data.get('groupId') or 'g'
    if content == '娱乐':
        reply(data, build_fun_menu())
        return
    if content == '掷骰子':
        reply(data, '🎲 你掷出了：%d 点' % random.randint(1, 6))
        return
    if content.startswith('石头剪刀布'):
        p = content.replace('石头剪刀布', '').strip()
        if not p:
            reply(data, '✊ 玩法：发送「石头剪刀布 石头」/「石头剪刀布 剪刀」/「石头剪刀布 布」')
            return
        bot = random.choice(['石头', '剪刀', '布'])
        win = {'石头': '剪刀', '剪刀': '布', '布': '石头'}
        if p == bot:
            res = '平局'
        elif win[p] == bot:
            res = '🎉 你赢了！'
        else:
            res = '😢 你输了！'
        reply(data, '🤖 我出：%s\n✊ 你出：%s\n%s\n发送「娱乐」返回菜单' % (bot, p, res))
        return
    if content.startswith('猜数字'):
        rest = content.replace('猜数字', '').strip()
        if rest:
            try:
                v = int(rest)
                if guess_answer(gid) is None:
                    guess_init(gid)
                target = guess_answer(gid)
                s = _guess_state[gid]
                s['try'] += 1
                if v == target:
                    msg = '🎉 恭喜！%d 正是答案，你用了 %d 次猜中！' % (target, s['try'])
                    del _guess_state[gid]
                    reply(data, msg)
                elif v < target:
                    reply(data, '🔢 小了，答案更大（1-100）。发送「猜数字 %d」继续' % (v + 1))
                else:
                    reply(data, '🔢 大了，答案更小（1-100）。发送「猜数字 %d」继续' % (v - 1))
                return
            except Exception:
                reply(data, '🔢 请输入 1-100 的整数。')
                return
        if guess_answer(gid) is None:
            guess_init(gid)
        reply(data, '🔢 已开始猜数字（1-100），发送「猜数字 50」开始猜！')
        return
    if content == '今日运势':
        lv = ['大吉', '中吉', '小吉', '吉', '平', '小凶', '凶']
        r = random.choice(lv)
        tips = ['今天适合聊天', '保持微笑', '早睡早起', '多喝热水', '好运正在路上', '小心水逆', '适合吃顿好的']
        reply(data, '🍀 今日运势：%s\n💡 %s\n发送「娱乐」返回菜单' % (r, random.choice(tips)))
        return
    if content == '讲个笑话' or content == '讲笑话':
        jokes = [
            '程序员最讨厌的两个词：你等一下，我马上好。',
            '为什么程序员分不清万圣节和圣诞节？因为 OCT 31 == DEC 25。',
            '我：您好，请问这个bug怎么回事？客服：重启一下试试。我：已经重启了。客服：那就再重启一次。',
            '女朋友和电脑的相同点：都容易死机，都需要重启。',
            '程序员写代码的最高境界：能跑就行。',
        ]
        reply(data, '😂 ' + random.choice(jokes) + '\n发送「娱乐」返回菜单')
        return
    reply(data, '🎮 未知娱乐指令。发送「娱乐」查看菜单。')


# ================= 实用功能 =================

def tool_cmd(data, content):
    if content == '实用':
        reply(data, build_tool_menu())
        return
    if content.startswith('天气'):
        city = content.replace('天气', '').strip() or '北京'
        st, body = http_get('https://wttr.in/%s?format=j1&lang=zh' % quote(city), 10)
        if st != 200:
            reply(data, '🌤 天气查询失败，请稍后重试。')
            return
        try:
            j = json.loads(body)
            cur = j['current_condition'][0]
            area = (j.get('nearest_area') or [{}])[0].get('areaName', [{}])[0].get('value', city)
            t = cur.get('temp_C', '?')
            txt = cur.get('lang_zh', [{}])[0].get('value') or cur.get('weatherDesc', [{}])[0].get('value', '未知')
            hum = cur.get('humidity', '?')
            wind = cur.get('windspeedKmph', '?')
            reply(data, '🌤 %s 天气\n━━━━━━━━━━━━━━━━\n温度：%s℃\n天气：%s\n湿度：%s%%\n风速：%s km/h\n━━━━━━━━━━━━━━━━\n数据来源 wttr.in' % (area, t, txt, hum, wind))
        except Exception:
            reply(data, '🌤 天气解析失败。')
        return
    if content.startswith('二维码') or content.startswith('二维码生成'):
        qc = content[len('二维码'):].strip() if content.startswith('二维码') else content[len('二维码生成'):].strip()
        if not qc:
            reply(data, '▦ 用法：发送「二维码 内容」生成二维码图片。')
            return
        img_url = 'https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=%s' % quote(qc)
        try:
            up = call('uploadGroupImage', data.get('groupId') or '', img_url)
            if up and (up.get('file_info') or up.get('url')):
                call('sendGroupImageMessage', data.get('groupId') or '', up.get('file_info') or up.get('url'))
                reply(data, '▦ 二维码已生成：%s' % qc)
                return
        except Exception:
            pass
        reply(data, '▦ 二维码图片发送失败，链接：\n' + img_url)
        return
    if content.startswith('计算'):
        expr = content.replace('计算', '').strip()
        if not expr:
            reply(data, '🔢 用法：发送「计算 1+2*3」。')
            return
        try:
            import ast
            tree = ast.parse(expr, mode='eval')
            for n in ast.walk(tree):
                if isinstance(n, (ast.Call, ast.Attribute, ast.Subscript)):
                    raise ValueError('仅支持简单四则运算')
            v = eval(compile(tree, '<expr>', 'eval'), {'__builtins__': {}}, {})
            if isinstance(v, (int, float)):
                reply(data, '🔢 %s = %s' % (expr, ('%.6f' % v).rstrip('0').rstrip('.') if isinstance(v, float) else v))
            else:
                reply(data, '🔢 结果：%s' % v)
        except Exception as e:
            reply(data, '🔢 表达式无效：%s' % e)
        return
    if content in ('时间', '北京时间', '报时'):
        reply(data, '🕐 当前时间（北京时间）：\n%s' % now_str())
        return
    if content.startswith('随机数'):
        rest = content.replace('随机数', '').strip()
        parts = rest.split()
        try:
            lo = int(parts[0]) if parts else 1
            hi = int(parts[1]) if len(parts) > 1 else 100
        except Exception:
            reply(data, '🎲 用法：发送「随机数 1 100」。')
            return
        if lo > hi:
            lo, hi = hi, lo
        reply(data, '🎲 随机数（%d - %d）：%d' % (lo, hi, random.randint(lo, hi)))
        return
    reply(data, '🔧 未知实用指令。发送「实用」查看菜单。')


# ================= 抖音解析 =================

def douyin_cmd(data, content):
    # 从分享口令/文本中提取链接
    m = re.search(r'https?://[^\s]+', content)
    if not m:
        reply(data, '🎵 请发送抖音分享口令或链接，例如：\n抖音 复制打开抖音，看看【xxx】的作品 https://v.douyin.com/xxxxx/')
        return
    url = m.group(0).strip().rstrip('。，,;；')
    reply(data, '⏳ 正在解析抖音视频，请稍候…')
    # 优先展开短链拿真实地址
    final = url
    if urllib is not None:
        try:
            req = urllib.request.Request(url, headers={'User-Agent': _UA})
            ctx = None
            if ssl is not None:
                try:
                    ctx = ssl.create_default_context()
                    ctx.check_hostname = False
                    ctx.verify_mode = ssl.CERT_NONE
                except Exception:
                    ctx = None
            resp = urllib.request.urlopen(req, timeout=8, context=ctx)
            final = resp.geturl()
            resp.close()
        except Exception:
            final = url
    # 调用第三方解析接口（qjqq.cn 抖音解析，返回无水印视频地址）
    try:
        api = 'https://api.qjqq.cn/api/douyin?url=%s' % quote(final)
        st, body = http_get(api, 12)
        j = json.loads(body) if st == 200 and body else {}
        dataj = j.get('data') or {}
        video = dataj.get('video_url') or dataj.get('videoUrl') or dataj.get('url') or j.get('video_url') or ''
        title = dataj.get('title') or j.get('title') or '抖音视频'
        cover = dataj.get('cover') or dataj.get('video_cover') or j.get('cover') or ''
        author = dataj.get('author') or j.get('author') or ''
        if video:
            lines = ['🎵 【抖音解析】%s' % title]
            if author:
                lines.append('👤 %s' % author)
            lines.append('━━━━━━━━━━━━━━━━')
            lines.append('无水印播放：')
            lines.append(video)
            lines.append('')
            lines.append('发送「测试」返回菜单')
            if cover:
                try:
                    up = call('uploadGroupImage', data.get('groupId') or '', cover)
                    if up and (up.get('file_info') or up.get('url')):
                        call('sendGroupImageMessage', data.get('groupId') or '', up.get('file_info') or up.get('url'))
                except Exception:
                    pass
            reply(data, '\n'.join(lines))
            return
        raise RuntimeError('接口未返回视频地址')
    except Exception as e:
        reply(data, '🎵 解析失败：%s\n可尝试发送原始分享链接重试，或去抖音App查看原视频。' % e)


# ================= 更新/重启串联 =================

def update_cmd(data, content):
    lines = ['🔄 【更新系统】', '━━━━━━━━━━━━━━━━']
    lines.append('更新方式：')
    lines.append('1️⃣ 发送「更新」调出更新菜单')
    lines.append('2️⃣ 或直接发送终端命令更新：')
    lines.append('   cd /var/www/php && wget -O patch-4.2.59.zip <补丁URL> && unzip -o patch-4.2.59.zip && pm2 restart qqbot')
    lines.append('   cd /var/www/php && wget -O full.zip <全量URL> && unzip -o full.zip && pm2 restart qqbot')
    lines.append('（仅超级主人，替换 <URL> 为下载地址）')
    lines.append('━━━━━━━━━━━━━━━━')
    reply(data, '\n'.join(lines))


# ================= 消息分发 =================

def on_message(data):
    content = strip_at(data.get('content') or '')
    if not content:
        return
    # 抖音：优先匹配，避免与其它冲突
    if content.startswith('抖音') or content.startswith('解析抖音'):
        douyin_cmd(data, content)
        return
    if content in ('测试', '测试菜单', '菜单', '主菜单', '帮助'):
        maybe_menu(data)
        return
    if content == '娱乐':
        fun_cmd(data, content)
        return
    if content == '实用':
        tool_cmd(data, content)
        return
    if content.startswith('唱歌') or content.startswith('点歌') or content.startswith('唱首歌'):
        kw = content[len('唱歌'):].strip() if content.startswith('唱歌') else (content[len('点歌'):].strip() if content.startswith('点歌') else content[len('唱首歌'):].strip())
        gid = data.get('groupId') or ''
        if data.get('type') != 'message.group':
            reply(data, '🎵 点歌请在群聊中使用，发送「唱歌 歌名」。')
            return
        if not kw:
            reply(data, '🎵 用法：发送「唱歌 歌名」，例如：唱歌 海阔天空')
            return
        sing(data, gid, kw)
        return
    if content.startswith('禁言') or content.startswith('解禁') or content == '禁言状态' or content.startswith('全群禁言'):
        mute_cmd(data, content)
        return
    if content == '云端广播' or content.startswith('云端广播 '):
        cloud_broadcast_cmd(data, content)
        return
    if content.startswith('广播') or content.startswith('全体广播'):
        broadcast_cmd(data, content)
        return
    if content.startswith('娱乐') or content in ('掷骰子', '今日运势', '讲个笑话', '讲笑话') or content.startswith('石头剪刀布') or content.startswith('猜数字'):
        fun_cmd(data, content)
        return
    if content.startswith('天气') or content.startswith('二维码') or content.startswith('计算') or content in ('时间', '北京时间', '报时') or content.startswith('随机数'):
        tool_cmd(data, content)
        return
    if content in ('更新', '更新菜单', '重启'):
        update_cmd(data, content)
        return


def on_enable():
    pass


def on_disable():
    pass


if __name__ == '__main__':
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except Exception:
            continue
        op = msg.get('op')
        try:
            if op == 'ping':
                _write({'op': 'pong'})
            elif op == 'enable':
                on_enable()
            elif op == 'disable':
                on_disable()
            elif op == 'event':
                on_message(msg.get('data') or {})
        except Exception as e:
            _write({'op': 'log', 'text': '插件异常: %s' % e})
