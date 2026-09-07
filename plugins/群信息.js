// 群信息插件 v1.0.0 - 查看群的详细信息与活跃统计（数据看板卡片）
// 用法：群里发「群信息」/「群活跃」/「群数据」，机器人渲染并发送群活跃统计看板图片
// 说明：看板图片由服务端 sendGroupDashboard 渲染（富媒体主体，不走模板）；
//       过程/错误降级文案已接入 ReplySpec，可被后台 config plugin.file-群信息.reply 覆盖
// @ts-nocheck
/*__REPLY_SPEC_BEGIN__*/
var REPLY_SPEC = {
  name: '群信息',
  version: '1.0.0',
  desc: '群活跃统计看板的生成过程提示与失败/不支持降级文案（看板图片本身由服务端渲染，不走模板）',
  branches: [
    {
      key: 'generating',
      label: '正在生成看板（生成前的过程提示）',
      scope: ['group'],
      triggers: ['群信息', '群活跃', '群数据', '活跃统计'],
      lines: [
        { "t": "text", "v": "⏳ 正在生成群活跃统计看板..." }
      ]
    },
    {
      key: 'failed',
      label: '看板生成失败（结果提示）',
      scope: ['group'],
      triggers: ['群信息', '群活跃', '群数据', '活跃统计'],
      lines: [
        { "t": "text", "v": "❌ 群信息看板生成失败，请查看运行记录" }
      ]
    },
    {
      key: 'unsupported',
      label: '服务端不支持看板（降级提示）',
      scope: ['group'],
      triggers: ['群信息', '群活跃', '群数据', '活跃统计'],
      lines: [
        { "t": "text", "v": "当前版本不支持群信息看板，请升级服务端" }
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
function _fbGenerating() { return '⏳ 正在生成群活跃统计看板...'; }
function _fbFailed() { return '❌ 群信息看板生成失败，请查看运行记录'; }
function _fbUnsupported() { return '当前版本不支持群信息看板，请升级服务端'; }

module.exports = {
  manifest: {
    id: 'mod-group-info',
    name: '群信息',
    version: '1.0.0',
    description: '查看群的详细信息与活跃统计（成员数/消息数/活跃成员/加退群等数据看板）',
    author: '511742399',
  },

  onEnable: function(ctx) {
    ctx.logger.info('群信息插件已启用 v1.0.0');

    // ReplySpec：服务器 config 覆盖内置模板（后台「回复编辑器」保存后即时生效）
    var curSpec = REPLY_SPEC;
    try {
      var raw = (ctx.engine && ctx.engine.getConfigValue) ? ctx.engine.getConfigValue('plugin.file-群信息.reply') : null;
      if (raw) {
        var parsed = JSON.parse(String(raw));
        if (parsed && Array.isArray(parsed.branches) && parsed.branches.length) curSpec = parsed;
      }
    } catch (e) { ctx.logger.warn('群信息 ReplySpec config 解析失败，使用内置模板: ' + String(e && e.message || e)); }
    var linkFn = function(t, c) { return (ctx.link && ctx.link.linkify) ? ctx.link.linkify(t, c) : _rsMq(t, c); };

    function baseData(data) {
      var a = data.author || {};
      var botId = data.botId || '';
      var bName = (ctx.engine && ctx.engine.getBotNameById) ? (ctx.engine.getBotNameById(botId) || '') : '';
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
        ctx.logger.error('群信息回复失败: ' + String(e && e.message || e));
        try { return await ctx.bot.sendGroupMessage(gid, text, msgId); } catch (e2) { ctx.logger.error('群信息文本回复失败: ' + String(e2 && e2.message || e2)); }
        return null;
      }
    }

    ctx.eventBus.on('message.group', async function(data) {
      try {
        var content = (data.content || '').trim().replace(/^\s*<@!?[A-F0-9]+>\s*/, '').trim();
        var groupId = data.groupId;
        var msgId = data.id;

        if (content !== '群信息' && content !== '群活跃' && content !== '群数据' && content !== '活跃统计') return;

        ctx.logger.info('群信息命令触发: group=' + groupId + ' user=' + (data.author && data.author.id));

        // 服务端不支持看板：降级提示（模板化）
        if (!ctx.bot.sendGroupDashboard) {
          ctx.logger.warn('sendGroupDashboard 不可用，请升级服务端');
          var uText = render('unsupported', data);
          try { await sendGroup(groupId, uText || _fbUnsupported(), msgId); } catch(e) {}
          return;
        }

        // 渲染耗时可能较长，先提示用户正在生成（模板化）
        var gText = render('generating', data);
        try { await sendGroup(groupId, gText || _fbGenerating(), msgId); } catch(e) {}

        // 主体看板由服务端渲染发送（富媒体，不走模板，原样保留）
        var ok = await ctx.bot.sendGroupDashboard(groupId, msgId);
        if (!ok) {
          var fText = render('failed', data);
          try { await sendGroup(groupId, fText || _fbFailed(), msgId); } catch(e) {}
        }
      } catch (e) {
        ctx.logger.error('群信息命令处理异常: ' + String(e && e.message || e));
      }
    });
  },
};
