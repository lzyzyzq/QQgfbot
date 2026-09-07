// 群主 v1.0.0 - 查询本群群主/群管理员：发送「群主 / 谁是群主 / 查群主 / 群主是谁 / 群主信息」查看
// 数据源：群成员记录中 role IN ('owner','super') 的成员（引擎 findGroupOwner）
// ReplySpec 回复可视化：内置模板可被后台 config plugin.file-群主.reply 覆盖
// @ts-nocheck
/*__REPLY_SPEC_BEGIN__*/
var REPLY_SPEC = {
  name: "群主",
  version: "1.0.0",
  desc: "查询本群群主/管理员信息",
  branches: [
    {
      key: "none",
      label: "未记录群主（无 owner 数据）",
      scope: ["group"],
      triggers: ["群主", "谁是群主", "查群主", "群主是谁", "群主信息"],
      lines: [
        { "t": "text", "v": "👑 尚未记录本群群主信息。" },
        { "t": "text", "v": "请先让群主在群内发一条消息，机器人记录后即可查询。" }
      ]
    },
    {
      key: "owner",
      label: "群主/群管理员信息（owner 命中）",
      scope: ["group"],
      triggers: ["群主", "谁是群主", "查群主", "群主是谁", "群主信息"],
      lines: [
        { "t": "text", "v": "👑 {role}信息" },
        { "t": "text", "v": "━━━━━━━━━━━━━━" },
        { "t": "row", "pre": "昵称：", "k": "nick", "fb": "未知" },
        { "t": "row", "pre": "QQ：", "k": "qq", "hide": true },
        { "t": "row", "pre": "角色：", "k": "role" },
        { "t": "text", "v": "━━━━━━━━━━━━━━" },
        { "t": "text", "v": "发送「主菜单」查看更多" }
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
function _fbNone() { return '👑 尚未记录本群群主信息。\n请先让群主在群内发一条消息，机器人记录后即可查询。'; }
function _fbOwner(owner) {
  var roleText = owner.role === 'owner' ? '群主' : '群管理员';
  var lines = ['👑 ' + roleText + '信息'];
  lines.push('━━━━━━━━━━━━━━');
  lines.push('昵称：' + (owner.nickname || '未知'));
  if (owner.qq_id) lines.push('QQ：' + owner.qq_id);
  lines.push('角色：' + roleText);
  lines.push('━━━━━━━━━━━━━━');
  lines.push('发送「主菜单」查看更多');
  return lines.join('\n');
}

module.exports = {
  manifest: {
    id: 'mod-group-owner',
    name: '群主',
    version: '1.0.0',
    description: '查询本群群主/管理员',
    author: '511742399'
  },

  async init() {},

  onEnable: function(ctx) {
    ctx.logger.info('群主 v1.0.0 已加载');

    // ReplySpec：服务器 config 覆盖内置模板（后台「回复编辑器」保存后即时生效）
    var curSpec = REPLY_SPEC;
    try {
      var raw = (ctx.engine && ctx.engine.getConfigValue) ? ctx.engine.getConfigValue('plugin.file-群主.reply') : null;
      if (raw) {
        var parsed = JSON.parse(String(raw));
        if (parsed && Array.isArray(parsed.branches) && parsed.branches.length) curSpec = parsed;
      }
    } catch (e) { ctx.logger.warn('群主 ReplySpec config 解析失败，使用内置模板: ' + String(e && e.message || e)); }
    var linkFn = function(t, c) { return (ctx.link && ctx.link.linkify) ? ctx.link.linkify(t, c) : _rsMq(t, c); };

    function normalize(content) {
      return (content || '').trim().replace(/^\s*(?:<@!?[A-Za-z0-9_\-]+>|@\S+)\s*/, '').trim();
    }
    function isQuery(content) {
      return content === '群主' || content === '谁是群主' || content === '查群主' || content === '群主是谁' || content === '群主信息';
    }
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
        gid: data.groupId || '',
        openid: (a && (a.openid || a.id)) || data.member_openid || '',
        qq: (a && a.qqId) || '',
        nick: (a && a.username) || ''
      };
    }
    function render(key, data, extra) {
      var bd = baseData(data);
      var d = {};
      for (var k in bd) if (Object.prototype.hasOwnProperty.call(bd, k)) d[k] = bd[k];
      if (extra) for (var e in extra) if (Object.prototype.hasOwnProperty.call(extra, e)) d[e] = extra[e];
      return rsRender(key, d, curSpec, linkFn);
    }
    async function sendGroup(gid, text, msgId) {
      try {
        if (ctx.bot && ctx.bot.sendMarkdownGroup) {
          var r = await ctx.bot.sendMarkdownGroup(gid, text, msgId);
          if (r) return r;
        }
        return await ctx.bot.sendGroupMessage(gid, text, msgId);
      } catch (e) {
        ctx.logger.error('群主回复失败: ' + String(e && e.message || e));
        try { return await ctx.bot.sendGroupMessage(gid, text, msgId); } catch (e2) { ctx.logger.error('群主文本回复失败: ' + String(e2 && e2.message || e2)); }
        return null;
      }
    }

    // 事件自监听：消息直接进入处理（标准 JS 插件消息入口）
    ctx.eventBus.on('message.group', async function(data) {
      try {
        var content = normalize(data.content || '');
        if (!isQuery(content)) return;
        var gid = data.groupId;
        if (!gid) return;
        var msgId = data.id;
        var owner = null;
        try { if (ctx.engine && ctx.engine.findGroupOwner) owner = ctx.engine.findGroupOwner(gid); } catch (e) {}
        if (!owner) {
          var t0 = render('none', data);
          await sendGroup(gid, t0 || _fbNone(), msgId);
          return;
        }
        var roleText = owner.role === 'owner' ? '群主' : '群管理员';
        var t1 = render('owner', data, { role: roleText, nick: owner.nickname || '', qq: owner.qq_id || '' });
        await sendGroup(gid, t1 || _fbOwner(owner), msgId);
      } catch (e) {
        ctx.logger.error('群主插件错误: ' + (e && e.message || e));
      }
    });
  }
};
