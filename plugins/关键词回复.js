// 关键词回复 v1.0.0 - 频道消息含「帮助/help/菜单/menu」任意关键词时自动回复固定帮助文本
// ReplySpec 回复可视化：内置模板可被后台 config plugin.file-关键词回复.reply 覆盖
/*__REPLY_SPEC_BEGIN__*/
var REPLY_SPEC = {
  name: "关键词回复",
  version: "1.0.0",
  desc: "频道内发送含「帮助/help/菜单/menu」任意关键词的消息时，自动回复常用命令帮助文本",
  branches: [
    {
      key: "help",
      label: "帮助文本（命中 帮助/help/菜单/menu）",
      scope: ["guild"],
      triggers: ["帮助", "help", "菜单", "menu"],
      lines: [
        { "t": "text", "v": "你好！常用命令：" },
        { "t": "text", "v": "- 签到" },
        { "t": "text", "v": "- 个人信息" },
        { "t": "text", "v": "- 词典" },
        { "t": "text", "v": "- 插件列表" }
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

// ===== 固定回复兜底原文（rsRender 因 spec 缺失/异常返回空时使用，保证线上行为不回退）=====
function _fbHelp() {
  return '你好！常用命令：\n- 签到\n- 个人信息\n- 词典\n- 插件列表';
}

module.exports = {
  manifest: {
    id: 'builtin-keyword',
    name: '关键词回复',
    version: '1.0.0',
    description: '根据关键词自动回复消息',
    author: 'System'
  },
  onEnable: function(ctx) {
    ctx.logger.info('关键词回复插件已启用');

    // ReplySpec：服务器 config 覆盖内置模板（后台「回复编辑器」保存后即时生效）
    var curSpec = REPLY_SPEC;
    try {
      var raw = (ctx.engine && ctx.engine.getConfigValue) ? ctx.engine.getConfigValue('plugin.file-关键词回复.reply') : null;
      if (raw) {
        var parsed = JSON.parse(String(raw));
        if (parsed && Array.isArray(parsed.branches) && parsed.branches.length) curSpec = parsed;
      }
    } catch (e) { ctx.logger.warn('关键词回复 ReplySpec config 解析失败，使用内置模板: ' + String(e && e.message || e)); }
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
    // 频道出口：沿用插件原本发送函数 sendMessage(channelId, text, msgId)
    async function sendText(channelId, text, msgId) {
      try { return await ctx.bot.sendMessage(channelId, text, msgId); }
      catch (e) { ctx.logger.error('关键词回复发送失败: ' + String(e && e.message || e)); return null; }
    }

    ctx.eventBus.on('message.guild', async function(data) {
      const content = (data.content || '').trim();
      if (!content) return;
      var keys = ['帮助', 'help', '菜单', 'menu'];
      for (var i = 0; i < keys.length; i++) {
        if (content.includes(keys[i])) {
          var t = rsRender('help', baseData(data), curSpec, linkFn);
          await sendText(data.channelId, t || _fbHelp(), data.id);
          return;
        }
      }
    });
  },
  onDisable: function(ctx) { ctx.logger.info('关键词回复插件已禁用'); }
};
