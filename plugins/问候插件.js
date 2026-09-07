// 问候插件 v1.0.0 - 自动回复用户的问候消息（关键词子串匹配，按当前小时选择时段问候语）
// ReplySpec 回复可视化：内置模板可被后台 config plugin.file-问候插件.reply 覆盖；
// 时段问候语由 JS 按当前小时计算后注入 {greeting}，文案主体可用后台模板化
// @ts-nocheck
/*__REPLY_SPEC_BEGIN__*/
var REPLY_SPEC = {
  name: "问候插件",
  version: "1.0.0",
  desc: "自动回复用户的问候消息，{greeting} 由 JS 按当前小时注入（夜深了/早上好/下午好/晚上好）",
  branches: [
    {
      key: "greet",
      label: "问候自动回复（{greeting} 由 JS 按小时注入）",
      scope: ["group", "c2c", "guild"],
      triggers: ["你好", "hello", "hi", "嗨", "在吗", "早上好", "下午好", "晚上好"],
      lines: [
        { "t": "text", "v": "{greeting}！有什么可以帮助你的吗？" }
      ]
    }
  ]
};
/*__REPLY_SPEC_END__*/

// ===== ReplySpec 行渲染（与后台 src/admin/reply-editor.ts renderBranch 同语义，单文件自包含）=====
function _rsGet(d, k) {
  if (d && k && d[k] !== undefined && String(d[k]).length) return String(d[k]);
  return '';
}
function _rsVal(ln, d) {
  var v = _rsGet(d, ln.k);
  if (v) return v;
  return (ln.fb !== undefined && ln.fb !== null && String(ln.fb).length) ? String(ln.fb) : '';
}
function _rsInterp(s, d) {
  return String(s).replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, function(m, k) { return _rsGet(d, k); });
}
function _rsMq(label, cmd) {
  return '[' + label + '](mqqapi://aio/%69nlinecmd?command=' + encodeURIComponent(cmd) + '&enter=false&reply=false)';
}
function rsRender(branchKey, d, spec, linkFn) {
  var s = spec || REPLY_SPEC;
  if (!s || !s.branches) return '';
  var b = null;
  for (var i = 0; i < s.branches.length; i++) { if (s.branches[i].key === branchKey) { b = s.branches[i]; break; } }
  if (!b) return '';
  var out = [];
  for (var j = 0; j < b.lines.length; j++) {
    var ln = b.lines[j];
    if (!ln) continue;
    if (ln.t === 'blank') { out.push(''); continue; }
    if (ln.t === 'text') { out.push(_rsInterp(ln.v || '', d)); continue; }
    if (ln.t === 'val') { out.push(_rsInterp(_rsVal(ln, d), d)); continue; }
    if (ln.t === 'row') {
      var v = _rsVal(ln, d);
      if (!v && ln.hide) continue;
      out.push(_rsInterp((ln.pre || '') + v + (ln.post || ''), d));
      continue;
    }
    if (ln.t === 'link') {
      var lk = (linkFn || _rsMq)(ln.label || '', ln.cmd || '');
      out.push((ln.pre || '') + lk + (ln.post || ''));
    }
  }
  return out.join('\n');
}

module.exports = {
  manifest: {
    id: 'builtin-greeting',
    name: '问候插件',
    version: '1.0.0',
    description: '自动回复用户的问候消息',
    author: '系统'
  },

  onEnable: function(ctx) {
    ctx.logger.info('问候插件已启用');

    // ReplySpec：服务器 config 覆盖内置模板（后台「回复编辑器」保存后即时生效）
    var curSpec = REPLY_SPEC;
    try {
      var raw = (ctx.engine && ctx.engine.getConfigValue) ? ctx.engine.getConfigValue('plugin.file-问候插件.reply') : null;
      if (raw) {
        var parsed = JSON.parse(String(raw));
        if (parsed && Array.isArray(parsed.branches) && parsed.branches.length) curSpec = parsed;
      }
    } catch (e) { ctx.logger.warn('问候插件 ReplySpec config 解析失败，使用内置模板: ' + String(e && e.message || e)); }
    var linkFn = function(t, c) { return (ctx.link && ctx.link.linkify) ? ctx.link.linkify(t, c) : _rsMq(t, c); };

    function botNameOf(botId) {
      return (ctx.engine && ctx.engine.getBotNameById) ? (ctx.engine.getBotNameById(botId) || '') : '';
    }

    function baseData(data) {
      var a = data.author || {};
      var botId = data.botId || '';
      var bName = botNameOf(botId);
      return {
        botId: botId,
        botName: bName,
        botShow: (bName && bName !== botId) ? bName + '（' + botId + '）' : botId,
        gid: data.groupId || data.channelId || '',
        openid: (a && (a.openid || a.id)) || data.member_openid || '',
        qq: (a && a.qqId) || '',
        nick: (a && a.username) || ''
      };
    }

    // 固定回复兜底原文（rsRender 因 spec 缺失/异常返回空时使用）
    function fbGreet(greeting) {
      return greeting + '！有什么可以帮助你的吗？';
    }

    function greetingNow() {
      var hour = new Date().getHours();
      return hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
    }

    function handleMsg(data) {
      var content = (data.content || '').trim();
      var greetings = ['你好', 'hello', 'hi', '嗨', '在吗', '早上好', '下午好', '晚上好'];
      if (greetings.some(function(g) { return content.toLowerCase().includes(g.toLowerCase()); })) {
        var g = greetingNow();
        var d = baseData(data);
        d.greeting = g;
        var text = rsRender('greet', d, curSpec, linkFn);
        if (!text) text = fbGreet(g);
        if (data.channelId) {
          ctx.bot.sendMessage(data.channelId, text, data.id);
        } else if (data.groupId) {
          ctx.bot.sendGroupMessage(data.groupId, text, data.id);
        } else if (data.author && data.author.id) {
          ctx.bot.sendPrivateMessage(data.author.id, text, data.id);
        }
      }
    }

    ctx.eventBus.on('message.guild', handleMsg);
    ctx.eventBus.on('message.c2c', handleMsg);
    ctx.eventBus.on('message.group', handleMsg);
  },

  onDisable: function(ctx) {
    ctx.logger.info('问候插件已禁用');
  }
};
