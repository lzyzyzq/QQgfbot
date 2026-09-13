module.exports = {
  manifest: {
    id: 'file-娱乐群管',
    name: '娱乐群管',
    version: '1.0.0',
    description: 'lzyqzb TXT 词库解释引擎：加载 plugins/娱乐群管.txt，执行 规则/触发/回复文本/按钮/写读/条件/随机/群管动作（与官方词典回复的 key|value 语法相互独立）',
    author: '系统'
  },

  onEnable: function(ctx) {
    var fs = require('fs');
    var path = require('path');
    var crypto = require('crypto');

    var FILE_NAME = ctx.config.dictFile || '';
    var CWD = process.cwd();
    // 多词库支持：plugins/词库/.dic_active 记录当前启用的 txt（由 DIC管理.php 写入）
    if (!FILE_NAME) {
      try {
        var _act = fs.readFileSync(path.join(CWD, 'plugins', '词库', '.dic_active'), 'utf8').trim();
        if (_act && /^[^\\/:*?"<>|]+\.txt$/i.test(_act)) FILE_NAME = _act;
      } catch (e) {}
    }
    if (!FILE_NAME) FILE_NAME = '娱乐群管.txt';
    // 词库统一目录化：txt 词库与它运行时创建的文件/用户信息全部落在 plugins/词库/ 下
    // 文件：优先 plugins/词库/<name>.txt，兼容旧 plugins/<name>.txt
    var FILE_PATH = null;
    var _fileCands = [
      path.join(CWD, 'plugins', '词库', FILE_NAME),
      path.join(CWD, 'plugins', FILE_NAME),
    ];
    for (var _f = 0; _f < _fileCands.length; _f++) {
      try { if (fs.existsSync(_fileCands[_f]) && fs.statSync(_fileCands[_f]).isFile()) { FILE_PATH = _fileCands[_f]; break; } } catch (e) {}
    }
    if (!FILE_PATH) FILE_PATH = _fileCands[_fileCands.length - 1];
    // 数据目录：默认 plugins/词库；旧 data/lzyqzb 存在时一次性迁移过去（保持绑定/积分等用户数据不丢）
    var DATA_DIR = process.env.LZYQZB_DATA_DIR || '';
    if (!DATA_DIR) {
      var preferData = path.join(CWD, 'plugins', '词库');
      var legacyData = path.join(CWD, 'data', 'lzyqzb');
      DATA_DIR = preferData;
      function copyTree(s, d) {
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
        var ents = fs.readdirSync(s);
        for (var i = 0; i < ents.length; i++) {
          var sp = path.join(s, ents[i]);
          var dp = path.join(d, ents[i]);
          try {
            var st = fs.statSync(sp);
            if (st.isDirectory()) copyTree(sp, dp);
            else fs.copyFileSync(sp, dp);
          } catch (e) {}
        }
      }
      try {
        if (fs.existsSync(legacyData) && !fs.existsSync(preferData)) {
          copyTree(legacyData, preferData);
          ctx.logger.info('娱乐群管数据已迁移 data/lzyqzb → plugins/词库');
        }
      } catch (e) {
        ctx.logger.error('娱乐群管数据迁移失败: ' + e.message);
      }
    }

    // ---------- 词库文本解析 ----------
    // rules: [{ name, triggers:[], lines:[], pos }]，行内容为原始文本
    function parseCorpus(text) {
      var rules = [];
      var cur = null;
      var lines = String(text || '').split(/\r?\n/);
      for (var i = 0; i < lines.length; i++) {
        var raw = lines[i];
        var line = raw.trim();
        if (!line) { if (cur) cur.lines.push({ raw: raw, line: '' }); continue; }
        if (/^\/\//.test(line)) { if (cur) cur.lines.push({ raw: raw, line: '', comment: true }); continue; }
        var m;
        if ((m = line.match(/^规则\s+(\S.*)$/))) {
          cur = { name: m[1].trim(), triggers: [], lines: [], pos: rules.length };
          rules.push(cur);
          continue;
        }
        if ((m = line.match(/^触发\s+(\S.*)$/))) {
          if (cur) cur.triggers.push(m[1].trim());
          continue;
        }
        if (/^结束规则$/.test(line)) { cur = null; continue; }
        if (/^(词库|版本|主人QQ)/.test(line) && !cur) continue;
        if (cur) cur.lines.push({ raw: raw, line: line });
      }
      // 无触发规则丢弃；同触发多条规则：文件靠后者覆盖前者
      var byTrig = {};
      var finalRules = [];
      for (var j = 0; j < rules.length; j++) {
        var r = rules[j];
        if (!r.triggers.length) continue;
        for (var t = 0; t < r.triggers.length; t++) byTrig[r.triggers[t]] = r;
      }
      for (var k = 0; k < rules.length; k++) {
        if (rules[k].triggers.length && byTrig[rules[k].triggers[0]] === rules[k]) finalRules.push(rules[k]);
      }
      return finalRules;
    }

    function loadCorpus() {
      try {
        var text = fs.readFileSync(FILE_PATH, 'utf8');
        var rules = parseCorpus(text);
        ctx.logger.info('娱乐群管词库加载: ' + rules.length + ' 条规则, 文件: ' + FILE_PATH);
        return rules;
      } catch (e) {
        ctx.logger.error('娱乐群管词库加载失败: ' + e.message);
        return [];
      }
    }

    var RULES = loadCorpus();

    // ---------- 使用次数统计（按群 + 按指令，落盘 plugins/词库/使用统计.json） ----------
    var STATS_PATH = path.join(DATA_DIR, '使用统计.json');
    function emptyStats() { return { groups: {}, global: { total: 0, rules: {} } }; }
    function loadStats() {
      try {
        var j = JSON.parse(fs.readFileSync(STATS_PATH, 'utf8'));
        if (!j || typeof j !== 'object') return emptyStats();
        if (!j.groups || typeof j.groups !== 'object') j.groups = {};
        if (!j.global || typeof j.global !== 'object') j.global = { total: 0, rules: {} };
        if (!j.global.rules || typeof j.global.rules !== 'object') j.global.rules = {};
        return j;
      } catch (e) { return emptyStats(); }
    }
    var STATS = loadStats();
    function saveStats() {
      try { fs.writeFileSync(STATS_PATH, JSON.stringify(STATS, null, 2), 'utf8'); } catch (e) {}
    }
    // 命中规则时累加：整群总次数 + 该指令次数 + 全局总次数，返回给 builtinVars 展示
    function bumpStats(groupId, ruleName) {
      groupId = String(groupId || '全局');
      ruleName = String(ruleName || '未命名');
      var g = STATS.groups[groupId];
      if (!g || typeof g !== 'object') { g = { total: 0, rules: {} }; STATS.groups[groupId] = g; }
      if (!g.rules || typeof g.rules !== 'object') g.rules = {};
      g.total = (parseInt(g.total, 10) || 0) + 1;
      g.rules[ruleName] = (parseInt(g.rules[ruleName], 10) || 0) + 1;
      g.last = Date.now();
      STATS.global.total = (parseInt(STATS.global.total, 10) || 0) + 1;
      STATS.global.rules[ruleName] = (parseInt(STATS.global.rules[ruleName], 10) || 0) + 1;
      saveStats();
      return {
        groupTotal: g.total,
        ruleCount: g.rules[ruleName],
        globalTotal: STATS.global.total,
        ruleName: ruleName
      };
    }
    // 供词库 $统计$ 命令输出本群使用排行
    function statsText(groupId) {
      var g = STATS.groups[String(groupId || '全局')] || { total: 0, rules: {} };
      var arr = [];
      Object.keys(g.rules || {}).forEach(function (k) { arr.push([k, g.rules[k]]); });
      arr.sort(function (a, b) { return b[1] - a[1]; });
      var lines = ['📊 本群使用统计', '总使用：' + (parseInt(g.total, 10) || 0) + ' 次', '──────────'];
      if (!arr.length) lines.push('暂无记录');
      for (var i = 0; i < arr.length && i < 10; i++) lines.push((i + 1) + '. ' + arr[i][0] + '：' + arr[i][1] + ' 次');
      return lines.join('\n');
    }

    // ---------- 触发匹配（支持 (.*) 捕获 → %括号1%..） ----------
    function matchTrigger(trigger, content) {
      var t = trigger;
      var parts = t.split('(.*)');
      if (parts.length === 1) return content === t.trim() ? [] : null;
      var re = '^';
      for (var i = 0; i < parts.length; i++) {
        re += escapeRe(parts[i]) + (i < parts.length - 1 ? '([\\s\\S]*?)' : '');
      }
      re += '$';
      var m = content.match(new RegExp(re));
      if (!m) return null;
      var params = [];
      for (var x = 1; x < m.length; x++) params.push(m[x]);
      return params;
    }
    function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

    // ---------- 数据安全路径（data/lzyqzb 内相对路径） ----------
    function safeDataPath(rel) {
      rel = String(rel || '').replace(/^\/+/, '');
      if (/\.\./.test(rel) || /[\\\/\0]/.test(rel.replace(/\//g, '')) && /\.\./.test(rel)) return null;
      if (rel.indexOf('..') >= 0) return null;
      var full = path.resolve(DATA_DIR, rel);
      if (full.indexOf(path.resolve(DATA_DIR) + path.sep) !== 0) return null;
      return full;
    }

    // ---------- 变量与表达式求值 ----------
    function builtinVars(data, params, statsInfo) {
      var groupId = data.groupId || '';
      var authorId = (data.author && data.author.id) || '';
      var nick = (data.author && (data.author.name || data.author.nickname || data.author.username)) || '';
      var now = new Date();
      function pad(n) { return (n < 10 ? '0' : '') + n; }
      var v = {
        '消息': data.content || '',
        '完整消息': data.content || '',
        '昵称': nick,
        'QQ': authorId,
        'QQ号': (data.author && (data.author.qqId || data.author.qq)) || '',
        '用户ID': authorId,
        '群号': groupId,
        '频道ID': data.channelId || '',
        '消息ID': data.id || '',
        '事件类型': data.type || 'message.group',
        '事件': (data.event || '') || '',
        '使用次数': statsInfo ? String(statsInfo.groupTotal) : '0',
        '访问次数': statsInfo ? String(statsInfo.groupTotal) : '0',
        '指令次数': statsInfo ? String(statsInfo.ruleCount) : '0',
        '当前指令次数': statsInfo ? String(statsInfo.ruleCount) : '0',
        '全局次数': statsInfo ? String(statsInfo.globalTotal) : '0',
        '当前指令': statsInfo ? String(statsInfo.ruleName || '') : '',
        '日期': now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()),
        '时间': pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds()),
        '完整时间': now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes())
      };
      for (var i = 1; i <= 8; i++) {
        v['括号' + i] = params && params[i - 1] != null ? params[i - 1] : '';
        v['参数' + i] = params && params[i - 1] != null ? params[i - 1] : '';
      }
      return v;
    }

    // 命令别名表：execCmd 与「未闭合 $ 命令」容错解析共用
    var CMD_ALIASES = {
      '发': 'send', '回复': 'send', '发送文本': 'send', '文本': 'send', 'send_text': 'send',
      'Markdown': 'md', 'MD': 'md', '发送Markdown': 'md', '发送MD': 'md', 'send_markdown': 'md',
      '按钮': 'btn', '键盘': 'btn', '菜单': 'btn', 'send_keyboard': 'btn', 'send_button': 'btn',
      '图片': 'img', '发送图片': 'img', 'send_media': 'img', 'send_temp_image': 'img', 'send_file_image': 'img',
      '引用回复': 'quote', '引用': 'quote', '发送引用': 'quote',
      '撤回': 'recall', '撤回消息': 'recall', 'recall_message': 'recall',
      '随机文本': 'randText', '随机数': 'randInt', '计算': 'calc',
      '读': 'read', '写': 'write', '访问': 'http', '调用': 'call',
      '停止': 'stop', '空动作': 'nop', '终止匹配': 'term',
      '延时': 'delay', '延迟': 'delay',
      '查找': 'find', '寻找': 'find', '寻找文本': 'find', '查找文本': 'find', 'find': 'find',
      '替换': 'replace', '文本替换': 'replace', 'replace': 'replace',
      '长度': 'length', '文本长度': 'length', 'length': 'length',
      '取中间': 'substr', '截取': 'substr', '截取中间': 'substr', 'substring': 'substr',
      '取左': 'left', '左截取': 'left', 'left': 'left',
      '取右': 'right', '右截取': 'right', 'right': 'right',
      '包含': 'contains', '是否包含': 'contains', 'contains': 'contains',
      '开头': 'starts', '是否开头': 'starts', 'starts_with': 'starts',
      '结尾': 'ends', '是否结尾': 'ends', 'ends_with': 'ends',
      '分割取': 'splitGet', '取第': 'splitGet', 'split_get': 'splitGet',
      '大写': 'upper', '转大写': 'upper', 'upper': 'upper', 'uppercase': 'upper',
      '小写': 'lower', '转小写': 'lower', 'lower': 'lower', 'lowercase': 'lower',
      '去空格': 'trim', '清除空格': 'trim', 'trim': 'trim',
      '查询机器人': 'me', '机器人信息': 'me', 'me': 'me', '我的信息': 'me', 'get_me': 'me', '网关信息': 'me', 'get_ws_url': 'me',
      '禁言': 'mute', '禁言成员': 'mute', 'mute_member': 'mute',
      '取消禁言': 'unmute', '解除禁言': 'unmute', '取消禁言成员': 'unmute', '解禁': 'unmute', 'cancel_mute_member': 'unmute',
      '全体禁言': 'muteall', '禁言全体': 'muteall', 'mute_all': 'muteall',
      '取消全体禁言': 'unmuteall', '解除全禁': 'unmuteall', 'cancel_mute_all': 'unmuteall',
      '踢出成员': 'kick', '删除成员': 'kick', '踢人': 'kick', 'kick_member': 'kick', 'delete_member': 'kick',
      '批量禁言成员': 'batchmute', '批量禁言': 'batchmute', 'mute_members': 'batchmute',
      '取消批量禁言成员': 'batchunmute', '取消批量禁言': 'batchunmute', 'unmute_members': 'batchunmute',
      '撤回群消息': 'recall', '撤回频道消息': 'recall', '撤回单聊消息': 'recall', '撤回私信': 'recall', 'recall_message_by_id': 'recall',
      '外显': 'inline', '外显文字': 'inline', '文字外显': 'inline', 'inline': 'inline',
      '解析成员': 'resolve', '成员解析': 'resolve', 'resolve_member': 'resolve',
      '群消息': 'groupmsg', '发送群消息': 'groupmsg', 'group_message': 'groupmsg',
      '单聊消息': 'c2cmsg', '私聊消息': 'c2cmsg', 'c2c_message': 'c2cmsg',
      '发送频道消息': 'channelmsg', '频道消息': 'channelmsg', 'channel_message': 'channelmsg',
      '艾特': 'at', 'At': 'at', 'at': 'at', '@': 'at',
      '统计': 'stats', '使用统计': 'stats', '访问统计': 'stats', '使用排行': 'stats', '指令统计': 'stats', 'stats': 'stats',
      '记录': 'log', '互动结果': 'nop', 'on_interaction_result': 'nop'
    };
    var CANON_CMDS = ['send', 'md', 'btn', 'img', 'quote', 'recall', 'randText', 'randInt', 'calc', 'read', 'write', 'http', 'call', 'stop', 'nop', 'term', 'delay', 'find', 'replace', 'length', 'substr', 'left', 'right', 'contains', 'starts', 'ends', 'splitGet', 'upper', 'lower', 'trim', 'me', 'mute', 'unmute', 'muteall', 'unmuteall', 'kick', 'batchmute', 'batchunmute', 'inline', 'resolve', 'groupmsg', 'c2cmsg', 'channelmsg', 'at', 'log', 'stats'];
    function isKnownCmdToken(w) {
      if (!w) return false;
      return !!CMD_ALIASES[w] || CANON_CMDS.indexOf(w) >= 0;
    }

    // 按调用栈解析 %变量%，vars 为规则级变量（新值覆盖内置）
    function interp(text, scope) {
      var s = String(text == null ? '' : text);
      // 逐段处理 $命令$（返回值回填；纯副作用命令无值）
      var out = '';
      var rest = s;
      while (rest.length) {
        var oi = rest.indexOf('$');
        if (oi < 0) { out += expand(rest, scope); rest = ''; break; }
        out += expand(rest.slice(0, oi), scope);
        rest = rest.slice(oi + 1);
        var ci = rest.indexOf('$');
        if (ci < 0) {
          // 容错：作者漏写结尾 $ 时，若行尾命中的是合法命令名，则按“到行尾闭合”执行；
          // 否则仍按字面量输出（避免把正文里的单个 $ 误当命令）。
          var head = rest.split(/\s+/)[0];
          if (isKnownCmdToken(head)) {
            var rr = execCmd(rest, scope);
            if (rr != null && rr.value != null && rr.value !== '') out += rr.value;
          } else {
            out += '$' + rest;
          }
          rest = '';
          break;
        }
        var cmdBody = rest.slice(0, ci);
        rest = rest.slice(ci + 1);
        var r = execCmd(cmdBody, scope);
        if (r != null && r.value != null && r.value !== '') out += r.value;
      }
      return out;
    }

    function expand(t, scope) {
      // %变量%（含特殊 %随机数A-B% 内联随机变量）
      var replaced = String(t).replace(/%([^%]+)%/g, function(_, name) {
        var rm = name.match(/^随机数(\d+)-(\d+)$/);
        if (rm) {
          var lo = parseInt(rm[1], 10), hi = parseInt(rm[2], 10);
          if (hi < lo) { var tp = lo; lo = hi; hi = tp; }
          return String(lo + Math.floor(Math.random() * (hi - lo + 1)));
        }
        if (scope.vars && scope.vars[name] !== undefined) return String(scope.vars[name]);
        if (scope.builtin && scope.builtin[name] !== undefined) return String(scope.builtin[name]);
        return '';
      });
      // 方括号：纯算术计算，否则保留内容展开
      return String(replaced).replace(/\[([^\]]*)\]/g, function(_, inner) {
        var r = safeArith(inner);
        return r == null ? inner : r;
      });
    }

    function safeArith(expr) {
      var e = String(expr == null ? '' : expr).trim();
      if (!e) return '';
      if (/^[\d\s+\-*/().%]+$/.test(e)) {
        try { return String(eval('(' + e + ')')); } catch (err) { return null; }
      }
      return null; // 非纯算术表达式：交给方括号外层原样保留
    }

    function safeCalc(expr) {
      var e = String(expr == null ? '' : expr).trim();
      if (!e) return '';
      if (!/^[\d\s+\-*/().]+$/.test(e)) return '表达式需为数字运算';
      try { return String(eval('(' + e + ')')); } catch (err) { return '计算错误'; }
    }

    // ---------- 命令执行 ----------
    // 返回 { value }：值用于赋值/文本回填；副作用(发消息/键盘/群管动作)直接执行
    function execCmd(body, scope) {
      var sp = body.indexOf(' ');
      var name = (sp < 0 ? body : body.slice(0, sp)).trim();
      var arg = sp < 0 ? '' : body.slice(sp + 1).trim();
      var aliases = CMD_ALIASES;
      var fn = aliases[name] || name;
      if (fn === 'send') { scope.outputs.push(interp(arg, scope)); return { value: '' }; }
      if (fn === 'md') { scope.outputs.push({ md: interp(arg, scope) }); return { value: '' }; }
      if (fn === 'quote') {
        var q = interp(arg, scope);
        var qi = q.indexOf('|');
        if (qi >= 0) q = q.slice(0, qi);
        scope.outputs.push(q);
        return { value: '' };
      }
      if (fn === 'img') {
        var imgArg = interp(arg, scope);
        var botI = scope.bot || {};
        // 群/C2C 优先走富媒体发送；不可用时给提示文本（不伪造成功）
        try {
          if (scope.data.groupId && botI.sendImageGroup) { botI.sendImageGroup(scope.data.groupId, imgArg, scope.data.id).catch(function(){}); return { value: '' }; }
          if (scope.data.author && scope.data.author.id && botI.sendImagePrivate) { botI.sendImagePrivate(scope.data.author.id, imgArg, scope.data.id).catch(function(){}); return { value: '' }; }
        } catch (e) {}
        scope.outputs.push('[图片] ' + imgArg + '（当前机器人未配置图片发送）');
        return { value: '' };
      }
      if (fn === 'btn') { sendButtons(scope, interp(arg, scope)); return { value: '' }; }
      if (fn === 'recall') {
        var recallArg = interp(arg, scope).trim();
        var rId = scope.data.id || '';
        var rGroup = scope.data.groupId || '';
        if (recallArg.indexOf('=') >= 0) {
          recallArg.split('&').forEach(function(seg){
            var i = seg.indexOf('=');
            if (i > 0) {
              var k = seg.slice(0, i).trim(), val = seg.slice(i + 1).trim();
              if (k === 'message_id') rId = val;
              if (k === 'group_openid' || k === 'group_id') rGroup = val;
            }
          });
        } else if (recallArg) {
          rId = recallArg;
        }
        if (rGroup && scope.bot && scope.bot.deleteMessage && rId) {
          scope.bot.deleteMessage(rGroup, rId).catch(function(e){ try { ctx.logger.warn('[娱乐群管] 撤回失败: ' + (e && e.message)); } catch(x){} });
        }
        return { value: '' };
      }
      if (fn === 'inline') {
        var spec = interp(arg, scope);
        var linkMode = 'on';
        try { if (ctx.link && ctx.link.mode) linkMode = ctx.link.mode(); } catch (e) {}
        var items = spec.split(/[;,，]/).map(function(x){ return x.trim(); }).filter(Boolean);
        var labels = items.map(function(it){
          var eq = it.indexOf('=>');
          var label = eq >= 0 ? it.slice(0, eq).trim() : it;
          var cmd = eq >= 0 ? it.slice(eq + 2).trim() : it;
          if (!label) return '';
          if (linkMode === 'off') return label;
          try { if (ctx.link && ctx.link.linkify) return ctx.link.linkify(label, cmd); } catch (e) {}
          return '[' + label + '](mqqapi://aio/%69nlinecmd?command=' + encodeURIComponent(cmd) + '&enter=false&reply=false)';
        }).filter(Boolean);
        if (labels.length) {
          if (linkMode === 'off') scope.outputs.push(labels.join('  '));
          else scope.outputs.push({ md: labels.join('  ') });
        }
        return { value: '' };
      }
      if (fn === 'resolve') {
        return { value: resolveMemberArg(interp(arg, scope), scope) };
      }
      if (fn === 'at') {
        var atId = resolveMemberArg(interp(arg, scope), scope);
        return { value: atId ? '@' + memberDisplayName(atId) : '' };
      }
      if (fn === 'groupmsg' || fn === 'c2cmsg' || fn === 'channelmsg') {
        var mk = {};
        interp(arg, scope).split('&').forEach(function(seg){
          var i = seg.indexOf('=');
          if (i > 0) mk[seg.slice(0, i).trim()] = seg.slice(i + 1).trim();
        });
        var body = mk.content != null ? mk.content : '';
        try {
          if (fn === 'groupmsg' && scope.bot && scope.bot.sendGroupMessage) {
            var gTarget = mk.group_openid || mk.group_id || '';
            if (gTarget) scope.bot.sendGroupMessage(gTarget, body, scope.data.id).catch(function(e){ logSendFail('群消息', e); });
          } else if (fn === 'c2cmsg' && scope.bot && scope.bot.sendPrivateMessage) {
            var cTarget = mk.openid || mk.user_openid || '';
            if (cTarget) scope.bot.sendPrivateMessage(cTarget, body, scope.data.id).catch(function(e){ logSendFail('单聊消息', e); });
          } else if (fn === 'channelmsg' && scope.bot && scope.bot.sendMessage) {
            var chTarget = mk.channel_id || '';
            if (chTarget) scope.bot.sendMessage(chTarget, body, scope.data.id).catch(function(e){ logSendFail('频道消息', e); });
          } else {
            scope.outputs.push('⚠️ 当前机器人未开放对应消息发送接口。');
          }
        } catch (e) { logSendFail(fn, e); }
        return { value: '' };
      }
      if (fn === 'randText') {
        var opts = interp(arg, scope).split(/[|,，]/).map(function(x){ return x.trim(); }).filter(Boolean);
        return { value: opts.length ? opts[Math.floor(Math.random() * opts.length)] : '' };
      }
      if (fn === 'randInt') {
        var iv = interp(arg, scope).split(/\s+/);
        var lo = parseInt(iv[0], 10), hi = parseInt(iv[1], 10);
        if (isNaN(lo)) lo = 0;
        if (isNaN(hi)) hi = lo;
        if (hi < lo) { var tmp = lo; lo = hi; hi = tmp; }
        return { value: String(lo + Math.floor(Math.random() * (hi - lo + 1))) };
      }
      if (fn === 'calc') { return { value: safeCalc(interp(arg, scope)) }; }
      if (fn === 'read') { return { value: readStore(arg, scope) }; }
      if (fn === 'write') { writeStore(arg, scope); return { value: '' }; }
      if (fn === 'http') {
        var url = interp(arg, scope).trim();
        return { value: httpGetSync(url) };
      }
      if (fn === 'call') { doCall(arg, scope, 0); return { value: '' }; }
      if (fn === 'delay') { doCall(arg, scope, -1); return { value: '' }; }
      // 文本函数（返回纯值，无副作用）
      if (['find', 'replace', 'length', 'substr', 'left', 'right', 'contains', 'starts', 'ends', 'splitGet', 'upper', 'lower', 'trim'].indexOf(fn) >= 0) {
        return { value: textFunc(fn, arg, scope) };
      }
      if (fn === 'stop') { scope.stop = true; return { value: '' }; }
      if (fn === 'term') { scope.term = true; scope.stop = true; return { value: '' }; }
      if (fn === 'nop') { return { value: '' }; }
      if (fn === 'log') { try { ctx.logger.info('[娱乐群管-记录] ' + interp(arg, scope)); } catch(e){} return { value: '' }; }
      if (fn === 'stats') {
        scope.outputs.push(statsText(scope.data.groupId || scope.data.channelId || ''));
        return { value: '' };
      }
      if (fn === 'me') {
        var me = (scope.bot && scope.bot.getStatus) ? '当前机器人已就绪' : '机器人信息不可用';
        scope.outputs.push(me);
        return { value: me };
      }
      if (fn === 'mute' || fn === 'unmute' || fn === 'kick' || fn === 'muteall' || fn === 'unmuteall' || fn === 'batchmute' || fn === 'batchunmute') {
        var rmsg = doGroupAction(fn, arg, scope);
        if (rmsg) { scope.outputs.push(rmsg); }
        return { value: '' };
      }
      // 未识别命令：不编造回复，仅记录
      try { ctx.logger.info('[娱乐群管] 未识别命令: ' + name); } catch(e){}
      return { value: '' };
    }

    // 存储：$读 path a 默认$ / $写 path a 内容$（兼容词库中的 a 分隔写法）
    function readStore(arg, scope) {
      var toks = interp(arg, scope).split(' ').filter(function(x){ return x !== ''; });
      var rel = toks[0] || '';
      var def = '';
      if (toks.length >= 3 && toks[1] === 'a') def = toks.slice(2).join(' ');
      else if (toks.length === 2 && toks[1] === 'a') def = '';
      else if (toks.length >= 2) def = toks.slice(1).join(' ');
      var full = safeDataPath(rel);
      if (!full) return def;
      try {
        if (fs.existsSync(full)) return fs.readFileSync(full, 'utf8');
      } catch (e) {}
      return def;
    }
    function writeStore(arg, scope) {
      var toks = interp(arg, scope).split(' ').filter(function(x){ return x !== ''; });
      var rel = toks[0] || '';
      var content = '';
      if (toks.length >= 3 && toks[1] === 'a') content = toks.slice(2).join(' ');
      else if (toks.length >= 2) content = toks.slice(1).join(' ');
      var full = safeDataPath(rel);
      if (!full) { try { ctx.logger.warn('[娱乐群管] 拒绝越界写: ' + rel); } catch(e){} return; }
      try {
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content, 'utf8');
      } catch (e) { try { ctx.logger.error('[娱乐群管] 写失败: ' + e.message); } catch(x){} }
    }
    function httpGetSync(url) {
      if (!/^https?:\/\//i.test(url)) return '';
      var cp = null;
      try { cp = require('child_process'); } catch (e) {}
      if (!cp || typeof cp.execFileSync !== 'function') return '';
      try {
        var buf = cp.execFileSync('curl', ['-s', '--max-time', '8', url], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
        return String(buf || '').slice(0, 1000);
      } catch (e) { return ''; }
    }

    function expandVars(t, scope) {
      return String(t).replace(/%([^%]+)%/g, function(_, name) {
        if (scope.vars && scope.vars[name] !== undefined) return String(scope.vars[name]);
        if (scope.builtin && scope.builtin[name] !== undefined) return String(scope.builtin[name]);
        return '';
      });
    }

    // 参数分割：含 | 时按 | 分隔（v1.3：参数/规则名含空格用 |），否则按空格
    function splitArgs(s) {
      if (s.indexOf('|') >= 0) return s.split('|').map(function(t){ return t.trim(); }).filter(function(x){ return x !== ''; });
      return s.split(/\s+/).filter(function(x){ return x !== ''; });
    }

    function findRuleByNameOrTrigger(name) {
      for (var i = 0; i < RULES.length; i++) {
        if (RULES[i].name === name) return RULES[i];
      }
      for (var j = 0; j < RULES.length; j++) {
        for (var t = 0; t < RULES[j].triggers.length; t++) {
          if (RULES[j].triggers[t] === name) return RULES[j];
        }
      }
      return null;
    }

    // $调用/$延时：支持 $调用 规则 参数…$、$调用 毫秒 回调$、$调用 规则|参数1|参数2$、$延时 毫秒 回调$
    function doCall(arg, scope, delayMode) {
      var toks = splitArgs(expandVars(arg, scope));
      var name = toks.shift() || '';
      var ms = 0;
      if (/^\d+$/.test(name)) { ms = parseInt(name, 10); name = toks.shift() || ''; }
      if (!name) { try { ctx.logger.warn('[娱乐群管] 调用缺少目标规则'); } catch(e){} return; }
      var rule = findRuleByNameOrTrigger(name);
      if (!rule) { try { ctx.logger.warn('[娱乐群管] 未找到子规则: ' + name); } catch(e){} return; }
      if (delayMode < 0 && ms === 0) ms = 1; // 显式 $延时$ 未给毫秒时视为立即排队
      var run = function() {
        try {
          var sub = newScope(scope.data, toks);
          runLines(rule, sub);
          flushOutputs(sub);
        } catch (e) { try { ctx.logger.error('[娱乐群管] 延时回调异常: ' + e.message); } catch(x){} }
      };
      if (ms > 0) {
        var tid = setTimeout(run, ms);
        try {
          if (tid.unref) tid.unref();
          if (ctx.__entertainment_lzyqzb_timers) ctx.__entertainment_lzyqzb_timers.push(tid);
        } catch (e) {}
      } else {
        run();
      }
    }

    function textFunc(fn, arg, scope) {
      var A = splitArgs(interp(arg, scope));
      var s = A[0] || '', b = A[1] || '', c = A[2] || '', idx;
      switch (fn) {
        case 'find': return String(s.indexOf(b));
        case 'length': return String(Array.from(s).length);
        case 'contains': return s.indexOf(b) >= 0 ? '1' : '0';
        case 'starts': return s.slice(0, b.length) === b ? '1' : '0';
        case 'ends': return s.slice(-b.length) === b ? '1' : '0';
        case 'upper': return s.toUpperCase();
        case 'lower': return s.toLowerCase();
        case 'trim': return s.trim();
        case 'replace': return s.split(b).join(c);
        case 'substr':
          idx = Math.max(0, parseInt(b, 10) || 0);
          return (A[2] !== undefined && A[2] !== '' ? Array.from(s).slice(idx, idx + Math.max(0, parseInt(A[2], 10) || 0)) : Array.from(s).slice(idx)).join('');
        case 'left':
          idx = Math.max(0, parseInt(b, 10) || 0);
          return Array.from(s).slice(0, idx).join('');
        case 'right':
          idx = Math.max(0, parseInt(b, 10) || 0);
          return Array.from(s).slice(-idx).join('');
        case 'splitGet':
          idx = isNaN(parseInt(c, 10)) ? 0 : parseInt(c, 10);
          return s.split(b)[idx] !== undefined ? s.split(b)[idx] : '';
      }
      return '';
    }

    // 键盘按钮
    function sendButtons(scope, spec) {
      if (!scope.bot) return;
      var rowsSpec = spec.split(';');
      var rows = [];
      var seq = 0;
      for (var r = 0; r < rowsSpec.length; r++) {
        var seg = rowsSpec[r].trim();
        if (!seg) continue;
        var btns = [];
        var items = seg.split(',');
        for (var b = 0; b < items.length; b++) {
          var it = items[b].trim();
          if (!it) continue;
          var eq = it.indexOf('=>');
          var label = eq >= 0 ? it.slice(0, eq).trim() : it;
          var action = eq >= 0 ? it.slice(eq + 2).trim() : it;
          if (!label) continue;
          seq++;
          var bid = 'ydlz_' + seq + '_' + crypto.createHash('md5').update(String(action)).digest('hex').slice(0, 8);
          var bAction;
          if (/^url:/i.test(action)) {
            bAction = { type: 0, data: { url: action.slice(4).trim() }, permission: { type: 2 } };
          } else if (/^at:/i.test(action)) {
            bAction = { type: 2, data: '<@' + action.slice(3).trim() + '>', enter: true, permission: { type: 2 } };
          } else {
            bAction = { type: 2, data: action, enter: true, permission: { type: 2 } };
          }
          btns.push({
            id: bid,
            render_data: { label: label, visited_label: label, style: 0 },
            action: bAction
          });
        }
        if (btns.length) rows.push(btns);
      }
      if (!rows.length) return;
      var isGroup = !!(scope.data.groupId && !scope.data.channelId);
      if (isGroup && scope.bot.sendKeyboardGroup) {
        scope.bot.sendKeyboardGroup(scope.data.groupId, { content: '点下方按钮即可触发（也支持直接发文字指令）', rows: rows }, scope.data.id).catch(function(){});
      } else if (scope.data.author && scope.data.author.id && scope.bot.sendKeyboardPrivate) {
        scope.bot.sendKeyboardPrivate(scope.data.author.id, { content: '点下方按钮即可触发（也支持直接发文字指令）', rows: rows }, scope.data.id).catch(function(){});
      } else if (scope.data.groupId && scope.bot.sendGroupMessage) {
        scope.bot.sendGroupMessage(scope.data.groupId, spec.replace(/\$/g, ''), scope.data.id).catch(function(){});
      }
    }

    // 群管动作映射（QQ 官方群机器人开放能力；频道/其它由调用方权限决定）
    // 返回：动作无法执行时的提示文本（'' 表示已调用接口/无需提示）
    function doGroupAction(fn, arg, scope) {
      var raw = interp(arg, scope);
      var kv = {};
      raw.split('&').forEach(function(seg){
        var i = seg.indexOf('=');
        if (i > 0) kv[seg.slice(0, i).trim()] = seg.slice(i + 1).trim();
      });
      var group = kv.guild_id || kv.group_openid || kv.group_id || scope.data.groupId || '';
      var bot = scope.bot;
      if (!group || !bot) return '';
      var duration = parseInt(kv.mute_seconds || kv.duration || '60', 10);
      if (isNaN(duration) || duration <= 0) duration = 60;
      function runMute(target) {
        if (!bot.muteMember) return false;
        bot.muteMember(group, target, duration).then(function(r){
          if (r && r.code !== undefined && r.code !== 0) logActionFail(fn, 'code=' + r.code + ' ' + (r.message || ''));
        }).catch(function(e){ logActionFail(fn, (e && e.message) || ''); });
        return true;
      }
      function runUnmute(target) {
        if (!bot.unmuteMember) return false;
        bot.unmuteMember(group, target).then(function(r){
          if (r && r.code !== undefined && r.code !== 0) logActionFail(fn, 'code=' + r.code + ' ' + (r.message || ''));
        }).catch(function(e){ logActionFail(fn, (e && e.message) || ''); });
        return true;
      }
      if (fn === 'mute' || fn === 'unmute' || fn === 'kick') {
        var target = resolveMemberArg(kv.user_id || kv.member || kv.openid || '', scope);
        if (!target) return '⚠️ ' + (fn === 'kick' ? '踢出' : '禁言') + ' 未执行：未能识别目标成员（请 @ 对方后再试）';
        if (fn === 'mute' && runMute(target)) return '';
        if (fn === 'unmute' && runUnmute(target)) return '';
        if (fn === 'kick' && bot.kickMember) {
          bot.kickMember(group, target).then(function(r){
            if (r && r.code !== undefined && r.code !== 0) logActionFail(fn, 'code=' + r.code + ' ' + (r.message || ''));
          }).catch(function(e){ logActionFail(fn, (e && e.message) || ''); });
      return '';
    }

    // OpenID → 展示昵称（取不到昵称回退 OpenID）；统一 @用户 输出真实昵称
    function memberDisplayName(openid) {
      var id = String(openid || '').trim();
      if (!id) return '';
      try {
        if (ctx.engine && typeof ctx.engine.getInfo === 'function') {
          var info = ctx.engine.getInfo(id);
          if (info && info.nickname) return String(info.nickname);
        }
      } catch (e) {}
      return id;
    }

        return warnUnsupported(fn, fn === 'kick' ? '踢出成员' : fn === 'unmute' ? '取消禁言' : '禁言成员');
      }
      if (fn === 'batchmute' || fn === 'batchunmute') {
        var ids = String(kv.user_ids || kv.users || '').split(/[,，\s]+/).map(function(x){ return x.trim(); }).filter(Boolean);
        if (!ids.length) return '⚠️ 未提供成员列表（user_ids）。';
        var canRun = fn === 'batchmute' ? !!bot.muteMember : !!bot.unmuteMember;
        if (!canRun) return warnUnsupported(fn, fn === 'batchmute' ? '批量禁言' : '批量解除禁言');
        var okCount = 0, missCount = 0;
        ids.forEach(function(uid){
          var t = resolveMemberArg(uid, scope);
          if (!t) { missCount++; return; }
          if (fn === 'batchmute') runMute(t); else runUnmute(t);
          okCount++;
        });
        if (!okCount) return '⚠️ 未能识别任何目标成员，批量动作未执行。';
        return missCount ? '⚠️ 已对 ' + okCount + ' 名成员执行，' + missCount + ' 个目标未能识别。' : '';
      }
      if (fn === 'muteall' || fn === 'unmuteall') {
        if (!bot.muteAll) return warnUnsupported(fn, '全体禁言');
        var enable = fn === 'muteall';
        bot.muteAll(group, enable, enable ? duration : undefined).then(function(r){
          if (r && r.code !== undefined && r.code !== 0) logActionFail(fn, 'code=' + r.code + ' ' + (r.message || ''));
        }).catch(function(e){ logActionFail(fn, (e && e.message) || ''); });
        return '';
      }
      return '';
    }
    function logActionFail(fn, detail) {
      try { ctx.logger.warn('[娱乐群管] 群管动作失败: ' + fn + (detail ? ' — ' + detail : '')); } catch(e){}
    }
    function logSendFail(label, err) {
      try { ctx.logger.warn('[娱乐群管] ' + label + '发送失败: ' + ((err && err.message) || '')); } catch(e){}
    }
    function warnUnsupported(fn, label) {
      try { ctx.logger.warn('[娱乐群管] 群管动作未执行: ' + fn + ' 当前机器人未开放' + label + '接口'); } catch(e){}
      return '⚠️ 当前机器人未开放' + label + '接口，已记录日志。';
    }
    // 成员解析：<@openid>/<@!openid>/@openid 文本 → 纯 OpenID → 数字 QQ（引擎绑定表）
    function resolveMemberArg(s, scope) {
      s = String(s || '').trim();
      if (!s) return '';
      var cleaned = s.replace(/^<@!?/, '').replace(/^@/, '').replace(/[<>]/g, '').trim();
      if (/^[0-9A-Za-z_\-]{16,64}$/.test(cleaned)) return cleaned;
      if (/^\d{5,12}$/.test(cleaned)) {
        try {
          if (ctx.engine && typeof ctx.engine.resolveOpenidByQq === 'function') return ctx.engine.resolveOpenidByQq(cleaned) || '';
        } catch (e) {}
      }
      return '';
    }

    // ---------- 规则执行 ----------
    function newScope(data, params, statsInfo) {
      return {
        data: data,
        bot: ctx.bot,
        builtin: builtinVars(data, params, statsInfo),
        vars: {},
        outputs: [],
        stop: false,
        term: false
      };
    }

    function isActive(scope) {
      for (var i = 0; i < scope.stack.length; i++) if (!scope.stack[i]) return false;
      return !scope.stop;
    }

    function runLines(rule, scope) {
      scope.stack = scope.stack || [];
      for (var i = 0; i < rule.lines.length && !scope.stop; i++) {
        var raw = rule.lines[i].raw;
        var line = rule.lines[i].line;
        if (!line) continue;
        var active = isActive(scope);
        // 如果块：需要始终维护条件栈，即使上层不活跃
        var m;
        if ((m = line.match(/^如果[:：]\s*(.*)$/))) {
          scope.stack.push(evalCond(m[1], scope));
          continue;
        }
        if (line === '否则') {
          if (scope.stack.length) scope.stack[scope.stack.length - 1] = !scope.stack[scope.stack.length - 1];
          continue;
        }
        if (line === '如果尾') {
          if (scope.stack.length) scope.stack.pop();
          continue;
        }
        if (line === '停止') { if (active) scope.stop = true; continue; }
        if (!active) continue;
        if ((m = line.match(/^回复文本[:：]\s*(.*)$/))) {
          scope.outputs.push(interp(m[1], scope));
          continue;
        }
        if (line.charAt(0) === '$') {
          execCmd(line.slice(1, line.length - 1), scope);
          continue;
        }
        // 变量赋值：名称:值
        var vm = line.match(/^([^\s:：]+)\s*[:：]\s*([\s\S]*)$/);
        if (vm && !/^(否则|停止|词库|版本|结束规则|主人生成|主人QQ)/.test(line)) {
          scope.vars[vm[1].trim()] = interp(vm[2], scope);
          continue;
        }
        // 普通文本行 = 发送内容
        scope.outputs.push(interp(line, scope));
      }
    }

    function evalCond(text, scope) {
      var ops = ['包含', '不包含', '>=', '<=', '!=', '==', '=', '>', '<'];
      var found = null, opIdx = -1;
      for (var i = 0; i < ops.length; i++) {
        var idx = text.indexOf(ops[i]);
        if (idx >= 0 && (found === null || idx < opIdx)) { found = ops[i]; opIdx = idx; }
      }
      if (found === null) return !!interp(text, scope);
      var lhs = interp(text.slice(0, opIdx), scope).trim();
      var rhs = interp(text.slice(opIdx + found.length), scope).trim();
      if (found === '包含') return lhs.indexOf(rhs) >= 0;
      if (found === '不包含') return lhs.indexOf(rhs) < 0;
      var a = Number(lhs), b = Number(rhs);
      var na = lhs !== '' && !isNaN(a), nb = rhs !== '' && !isNaN(b);
      if (found === '=' || found === '==') return na && nb ? a === b : lhs === rhs;
      if (found === '!=') return na && nb ? a !== b : lhs !== rhs;
      if (found === '>') return na && nb ? a > b : lhs > rhs;
      if (found === '<') return na && nb ? a < b : lhs < rhs;
      if (found === '>=') return na && nb ? a >= b : lhs >= rhs;
      if (found === '<=') return na && nb ? a <= b : lhs <= rhs;
      return false;
    }

    // 找到首个命中规则执行（同触发去重已在解析期完成），返回是否命中
    function tryReply(data) {
      var content = String(data.content || '').trim();
      // 剥离前导 @机器人 提及（兼容 <@ID> 与 <@!ID>，QQ 群提到可能带 !），
      // 句中 @目标 openid 作为触发参数保留（禁言/留言等需要）
      var clean = content.replace(/^\s*<@!?[0-9A-Za-z_-]{16,64}>\s*/, '').trim();
      if (!clean) return false;
      var paramsArr = [];
      var hit = null;
      for (var i = 0; i < RULES.length; i++) {
        var r = RULES[i];
        for (var t = 0; t < r.triggers.length; t++) {
          var p = matchTrigger(r.triggers[t], clean);
          if (p) { hit = { rule: r, params: p }; break; }
        }
        if (hit) break;
      }
      if (!hit) return false;
      try { ctx.logger.info('[娱乐群管] 命中规则「' + String(hit.rule.name).slice(0, 30) + '」 trigger="' + String(content).slice(0, 40) + '"'); } catch(e){}
      var statsInfo = bumpStats(data.groupId || data.channelId || '', hit.rule.name);
      var scope = newScope(data, hit.params, statsInfo);
      try { runLines(hit.rule, scope); } catch (e) { try { ctx.logger.error('[娱乐群管] 规则执行异常: ' + e.message); } catch(x){} }
      flushOutputs(scope);
      return true;
    }

    // 词库中常用字面量 \r / \n 表示换行（部分词库作者习惯用 \r 分段），统一还原为真实换行
    function normalizeOutput(s) {
      return String(s == null ? '' : s).replace(/\\r\\n/g, '\n').replace(/\\r/g, '\n').replace(/\\n/g, '\n');
    }

    // 新增词库语法：行内标记 【显示文字】 或 【显示文字=>指令】 → 可点击外显链接。
    // 只有显式写标记的词库行才会被渲染，不扫描普通文本中的 「」，避免全局自动识别误伤排版。
    // 返回 { text, plain, changed, mode }；plain 为剥离标记后的纯文本（无 markdown 通道时回退用）。
    function linkifyMarks(text) {
      var mode = 'on';
      try { if (ctx.link && ctx.link.mode) mode = ctx.link.mode(); } catch (e) {}
      var changed = false;
      var src = String(text == null ? '' : text);
      function render(body) {
        var i = body.indexOf('=>');
        var label = (i >= 0 ? body.slice(0, i) : body).trim();
        var cmd = (i >= 0 ? body.slice(i + 2) : body).trim();
        if (!label) return '';
        changed = true;
        if (mode === 'off' || !cmd) return label;
        try { if (ctx.link && ctx.link.linkify) return ctx.link.linkify(label, cmd); } catch (e) {}
        return '[' + label + '](mqqapi://aio/%69nlinecmd?command=' + encodeURIComponent(cmd) + '&enter=false&reply=false)';
      }
      var plain = src.replace(/【([^】\n]{1,80})】/g, function (m, body) {
        var i = body.indexOf('=>');
        return (i >= 0 ? body.slice(0, i) : body).trim();
      });
      var formatted = src.replace(/【([^】\n]{1,80})】/g, function (m, body) { return render(body); });
      return { text: formatted, plain: plain, changed: changed, mode: mode };
    }

    // 当前会话是否有 markdown 渲染通道（无则外显/标记退化为纯文本标签）
    // 与 sendTo 的路由保持一致：群消息只看 sendMarkdownGroup，单聊只看 sendMarkdownPrivate
    function supportsMarkdown(scope) {
      var bot = (scope && scope.bot) || {};
      var d = (scope && scope.data) || {};
      if (d.groupId) return !!bot.sendMarkdownGroup;
      if (d.author && d.author.id) return !!bot.sendMarkdownPrivate;
      return false;
    }

    // 发送：asMd=true 优先 markdown，通道不支持时回退纯文本
    function sendTo(scope, text, asMd) {
      var msgId = scope.data.id;
      var bot = scope.bot || {};
      function safe(fn) { try { var p = fn(); if (p && p.catch) p.catch(function (e) { logSendFail('消息', e); }); } catch (e) { logSendFail('消息', e); } }
      if (scope.data.groupId) {
        if (asMd && bot.sendMarkdownGroup) { safe(function () { return bot.sendMarkdownGroup(scope.data.groupId, text, msgId); }); return; }
        if (bot.sendGroupMessage) { safe(function () { return bot.sendGroupMessage(scope.data.groupId, text, msgId); }); return; }
      }
      if (scope.data.channelId && bot.sendMessage) { safe(function () { return bot.sendMessage(scope.data.channelId, text, msgId); }); return; }
      if (scope.data.author && scope.data.author.id) {
        if (asMd && bot.sendMarkdownPrivate) { safe(function () { return bot.sendMarkdownPrivate(scope.data.author.id, text, msgId); }); return; }
        if (bot.sendPrivateMessage) { safe(function () { return bot.sendPrivateMessage(scope.data.author.id, text, msgId); }); return; }
      }
      try { ctx.logger.warn('[娱乐群管] 发送被跳过：无可用通道 group=' + (scope.data.groupId || '') + ' bot=' + !!(scope.bot)); } catch (e2) {}
    }

    // 统一收集输出：普通文本与 $外显/【标记】 链接合并为同一条消息（不拆分）。
    // 仅当确有外显内容（$外显 的 md 输出或 【标记】）且通道支持 markdown 时才走 markdown，
    // 其余普通回复保持纯文本发送，避免 markdown 误渲染历史词库文本。
    function flushOutputs(scope) {
      var out = scope.outputs || [];
      var textParts = [];
      var mdParts = [];
      for (var i = 0; i < out.length; i++) {
        var o = out[i];
        if (o == null) continue;
        if (typeof o === 'object' && o.md) { mdParts.push(String(o.md)); continue; }
        var s = String(o);
        if (s === '') continue;
        textParts.push(s);
      }
      var text = normalizeOutput(textParts.join('\n'));
      var canMd = supportsMarkdown(scope);
      var mk = linkifyMarks(text);
      var wantMd = canMd && mk.mode !== 'off' && (mdParts.length > 0 || mk.changed);
      if (wantMd) {
        var combined = mk.text;
        if (mdParts.length) combined = combined ? combined + '\n' + normalizeOutput(mdParts.join('\n')) : normalizeOutput(mdParts.join('\n'));
        combined = linkifyMarks(combined).text;
        if (combined && combined.trim() !== '') sendTo(scope, combined, true);
        return;
      }
      if (mk.plain && mk.plain.trim() !== '') sendTo(scope, mk.plain, false);
    }

    // 重新加载词库（管理页保存后触发 engine.reload 重跑 onEnable；另做 mtime 热侦测兜底）
    // 延时回调定时器统一登记，reload/停用时清理，避免重复计时与句柄泄漏
    if (ctx.__entertainment_lzyqzb_timers) {
      ctx.__entertainment_lzyqzb_timers.forEach(function(t){ try { clearTimeout(t); } catch(e){} });
      ctx.__entertainment_lzyqzb_timers = [];
    } else {
      ctx.__entertainment_lzyqzb_timers = [];
    }
    var lastMtime = 0;
    try { var st = fs.statSync(FILE_PATH); lastMtime = st.mtimeMs; } catch (e) {}
    var mtimeTimer = setInterval(function(){
      try {
        var st2 = fs.statSync(FILE_PATH);
        if (st2.mtimeMs && st2.mtimeMs !== lastMtime) { lastMtime = st2.mtimeMs; RULES = loadCorpus(); }
      } catch (e) {}
    }, 3000);
    if (ctx.__entertainment_lzyqzb_timer) clearInterval(ctx.__entertainment_lzyqzb_timer);
    ctx.__entertainment_lzyqzb_timer = mtimeTimer;

    function handle(data) {
      try { tryReply(data); } catch (e) {}
    }

    // 订阅防重复：reload 重跑 onEnable 时先退订上一次注册的 handler
    var bus = ctx.eventBus;
    if (bus && typeof bus.off === 'function' && ctx.__entertainment_lzyqzb_handlers) {
      var prev = ctx.__entertainment_lzyqzb_handlers;
      bus.off('message.guild', prev.guild);
      bus.off('message.c2c', prev.c2c);
      bus.off('message.group', prev.group);
    }
    var handlers = { guild: handle, c2c: handle, group: handle };
    ctx.__entertainment_lzyqzb_handlers = handlers;
    bus.on('message.guild', handlers.guild);
    bus.on('message.c2c', handlers.c2c);
    bus.on('message.group', handlers.group);

    ctx.logger.info('娱乐群管插件已启用（lzyqzb 词库引擎）');
  },

  onDisable: function(ctx) {
    if (ctx.__entertainment_lzyqzb_timers) {
      ctx.__entertainment_lzyqzb_timers.forEach(function(t){ try { clearTimeout(t); } catch(e){} });
      ctx.__entertainment_lzyqzb_timers = [];
    }
    ctx.logger.info('娱乐群管插件已禁用');
  }
};
