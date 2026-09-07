// OpenID查询插件 v1.0.0 - 查询自己的 OpenID / 群 OpenID / 频道 OpenID，支持 @ 其他用户查询其 OpenID
// 用法：
//   群里发「OpenID查询」→ 返回你的 OpenID（含昵称/QQ/所属机器人）
//   群里发「OpenID查询 @xxx」→ 返回被 @ 用户的 OpenID（对方需在本群与机器人交互过）
//   群里发「群OpenID查询」→ 返回当前群的 OpenID（群OpenID/群id）
//   私聊发「OpenID查询」→ 返回你的 OpenID
//   频道里发「OpenID查询」/「频道OpenID查询」→ 返回频道 OpenID
// 说明：每个机器人下同一用户的 OpenID 不同，此命令用于跨机器人对账与身份识别
// 说明：回复内容已接入 ReplySpec 可视化编辑器（后台「回复编辑器」可改行/增删/写回源码），
//       生效优先级：config（plugin.file-OpenID查询.reply）> 内置 REPLY_SPEC 常量。

/*__REPLY_SPEC_BEGIN__*/
var REPLY_SPEC = {
  name: 'OpenID查询',
  version: '1.0.0',
  desc: '查询自己的 OpenID / 群 OpenID / 频道 OpenID，可 @ 其他用户查询其 OpenID（帮助多机器人 OpenID 对账与身份识别）',
  branches: [
    {
      key: 'self', label: 'OpenID查询（群/私聊/频道 · 自己）', scope: ['group', 'c2c', 'guild'], triggers: ['OpenID查询', '我的OpenID'],
      lines: [
        { t: 'text', v: '你的 OpenID：' },
        { t: 'val', k: 'openid', fb: '(未获取到，请确认已通过机器人所在群/私聊交互过)' },
        { t: 'row', pre: 'QQ号：', k: 'qq', hide: true },
        { t: 'row', pre: '昵称：', k: 'nick', hide: true },
        { t: 'row', pre: '所属机器人：', k: 'botShow', hide: true }
      ]
    },
    {
      key: 'self@group', label: 'OpenID查询（群内 · 追加群OpenID指引）', scope: ['group'], triggers: ['OpenID查询'],
      lines: [
        { t: 'text', v: '你的 OpenID：' },
        { t: 'val', k: 'openid', fb: '(未获取到，请确认已通过机器人所在群/私聊交互过)' },
        { t: 'row', pre: 'QQ号：', k: 'qq', hide: true },
        { t: 'row', pre: '昵称：', k: 'nick', hide: true },
        { t: 'row', pre: '所属机器人：', k: 'botShow', hide: true },
        { t: 'link', pre: '群 OpenID 请', label: '发送「群OpenID查询」', cmd: '群OpenID查询' }
      ]
    },
    {
      key: 'self@c2c', label: 'OpenID查询（私聊）', scope: ['c2c'], triggers: ['OpenID查询'],
      lines: [
        { t: 'text', v: '你的 OpenID：' },
        { t: 'val', k: 'openid', fb: '(未获取到)' },
        { t: 'row', pre: '昵称：', k: 'nick', hide: true },
        { t: 'row', pre: '所属机器人：', k: 'botShow', hide: true }
      ]
    },
    {
      key: 'self@guild', label: 'OpenID查询（频道）', scope: ['guild'], triggers: ['OpenID查询'],
      lines: [
        { t: 'text', v: '你的 OpenID：' },
        { t: 'val', k: 'openid', fb: '(未获取到)' },
        { t: 'row', pre: '昵称：', k: 'nick', hide: true },
        { t: 'row', pre: '所属机器人：', k: 'botShow', hide: true }
      ]
    },
    {
      key: 'at', label: 'OpenID查询 @用户（有人被 @）', scope: ['group'], triggers: ['OpenID查询 @xxx'],
      lines: [
        { t: 'text', v: '被 @ 用户们的 OpenID：' },
        { t: 'val', k: 'atOpenids' },
        { t: 'text', v: '（每个机器人下 OpenID 不同，请在使用对应机器人的群内查询）' }
      ]
    },
    {
      key: 'atEmpty', label: 'OpenID查询 @用户（未 @ 到人）', scope: ['group'], triggers: ['OpenID查询 @xxx'],
      lines: [
        { t: 'text', v: '请 @ 一个用户来查询他的 OpenID，例如：OpenID查询 @张三' }
      ]
    },
    {
      key: 'group', label: '群OpenID查询（群内）', scope: ['group'], triggers: ['群OpenID查询'],
      lines: [
        { t: 'text', v: '当前群 OpenID：' },
        { t: 'val', k: 'gid', fb: '(未获取到)' },
        { t: 'row', pre: '所属机器人：', k: 'botShow', hide: true },
        { t: 'link', pre: '你的 OpenID 请', label: '发送「OpenID查询」', cmd: 'OpenID查询' }
      ]
    },
    {
      key: 'group@guild', label: '频道OpenID查询（频道内）', scope: ['guild'], triggers: ['频道OpenID查询'],
      lines: [
        { t: 'text', v: '当前频道 OpenID：' },
        { t: 'val', k: 'gid', fb: '(未获取到)' },
        { t: 'row', pre: '频道ID：', k: 'guildId', hide: true },
        { t: 'row', pre: '所属机器人：', k: 'botShow', hide: true }
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
    id: 'mod-openid-query',
    name: 'OpenID查询',
    version: '1.0.0',
    description: '查询自己的 OpenID、群 OpenID、频道 OpenID，可 @ 其他用户查询其 OpenID（帮助多机器人 OpenID 对账与身份识别）',
    author: '511742399',
  },

  onEnable: function(ctx) {
    ctx.logger.info('OpenID查询插件已启用 v1.0.0');

    // ReplySpec：服务器 config 覆盖内置模板（后台「回复编辑器」保存后即时生效）
    var curSpec = REPLY_SPEC;
    try {
      var raw = (ctx.engine && ctx.engine.getConfigValue) ? ctx.engine.getConfigValue('plugin.file-OpenID查询.reply') : null;
      if (raw) {
        var parsed = JSON.parse(String(raw));
        if (parsed && Array.isArray(parsed.branches) && parsed.branches.length) curSpec = parsed;
      }
    } catch (e) { ctx.logger.warn('OpenID查询 ReplySpec config 解析失败，使用内置模板: ' + String(e && e.message || e)); }
    var linkFn = function(t, c) { return (ctx.link && ctx.link.linkify) ? ctx.link.linkify(t, c) : _rsMq(t, c); };

    function normalize(content) {
      return (content || '').trim().replace(/^\s*<@!?[A-Fa-f0-9]+>\s*/, '').trim();
    }

    function selfOpenid(data) {
      var a = data.author || {};
      return a.openid || a.id || data.member_openid || '';
    }

    function botShow(botId) {
      if (!botId) return '';
      var name = (ctx.engine && ctx.engine.getBotNameById) ? ctx.engine.getBotNameById(botId) : '';
      if (name && name !== botId) return name + '（' + botId + '）';
      return botId;
    }

    // 群内回复：外显文字链接（mqqapi）需 markdown 才可点击，优先 sendMarkdownGroup，失败回退普通文本
    async function sendGroup(gid, text, msgId) {
      try {
        if (ctx.bot && ctx.bot.sendMarkdownGroup) {
          var r = await ctx.bot.sendMarkdownGroup(gid, text, msgId);
          if (r) return r;
        }
        return await ctx.bot.sendGroupMessage(gid, text, msgId);
      } catch (e) {
        ctx.logger.error('OpenID查询回复失败: ' + String(e && e.message || e));
        try { return await ctx.bot.sendGroupMessage(gid, text, msgId); } catch (e2) { ctx.logger.error('OpenID查询文本回复失败: ' + String(e2 && e2.message || e2)); }
        return null;
      }
    }

    // 提取消息中被 @ 的 openid（QQ 开放平台富文本 @ 格式 <@!xxxx> 或 <@xxxx>）
    function extractAtOpenids(content) {
      var ids = [];
      var re = /<@!?([A-Fa-f0-9]+)>/g;
      var m;
      while ((m = re.exec(content || '')) !== null) ids.push(m[1]);
      return ids;
    }

    function isQuery(content) {
      return content === 'OpenID查询' || content === 'openid查询' || content === '我的OpenID' || content === '我的openid';
    }
    function isGroupQuery(content) {
      return content === '群OpenID查询' || content === '群OpenID' || content === '群openid' || content === '频道OpenID查询' || content === '频道OpenID';
    }

    function baseData(data) {
      var a = data.author || {};
      return {
        openid: selfOpenid(data),
        qq: a.qqId || '',
        nick: a.username || '',
        botShow: botShow(data.botId),
        gid: data.groupId || data.channelId || '',
        guildId: data.guildId || '',
      };
    }

    // ===== 群消息 =====
    ctx.eventBus.on('message.group', async function(data) {
      try {
        var content = normalize(data.content || '');
        var gid = data.groupId || data.channelId || '';
        var msgId = data.id;
        var d = baseData(data);
        var myOpenid = d.openid;

        if (isQuery(content)) {
          var text = rsRender('self@group', d, curSpec, linkFn);
          if (gid && text) await sendGroup(gid, text, msgId);
          return;
        }

        if ((content === 'OpenID查询 @' || content.indexOf('OpenID查询 @') === 0 || content.indexOf('openid查询 @') === 0) && !isQuery(content)) {
          var ats = extractAtOpenids(content);
          var atText = (ats.length === 0)
            ? rsRender('atEmpty', d, curSpec, linkFn)
            : rsRender('at', { atOpenids: ats.map(function(id, i) { return (i + 1) + '. ' + id; }).join('\n') }, curSpec, linkFn);
          if (atText && gid) await sendGroup(gid, atText);
          return;
        }

        if (isGroupQuery(content)) {
          var gText = rsRender('group', d, curSpec, linkFn);
          if (gid && gText) await sendGroup(gid, gText);
          return;
        }
      } catch (e) {
        ctx.logger.error('OpenID查询插件处理异常: ' + String(e && e.message || e));
      }
    });

    // ===== 频道消息（message.guild）=====
    ctx.eventBus.on('message.guild', async function(data) {
      try {
        var content = normalize(data.content || '');
        var channelId = data.channelId || '';
        var d = baseData(data);
        var myOpenid = d.openid;

        if (isQuery(content)) {
          var text = rsRender('self@guild', d, curSpec, linkFn);
          if (channelId && text) {
            try { await ctx.bot.sendChannelMessage(channelId, { content: text }); }
            catch(e) { try { await ctx.bot.sendMessage(channelId, text); } catch(e2) { ctx.logger.error('频道回复失败: ' + String(e2 && e2.message || e2)); } }
          }
          return;
        }

        if (isGroupQuery(content)) {
          var gText = rsRender('group@guild', d, curSpec, linkFn);
          if (channelId && gText) {
            try { await ctx.bot.sendChannelMessage(channelId, { content: gText }); }
            catch(e) { try { await ctx.bot.sendMessage(channelId, gText); } catch(e2) { ctx.logger.error('频道回复失败: ' + String(e2 && e2.message || e2)); } }
          }
          return;
        }
      } catch (e) {
        ctx.logger.error('OpenID查询插件频道处理异常: ' + String(e && e.message || e));
      }
    });

    // ===== 私聊消息（message.c2c）=====
    ctx.eventBus.on('message.c2c', async function(data) {
      try {
        var content = normalize(data.content || '');
        var myOpenid = selfOpenid(data);
        var d = baseData(data);
        if (isQuery(content)) {
          var text = rsRender('self@c2c', d, curSpec, linkFn);
          if (myOpenid && text) {
            try { await ctx.bot.sendPrivateMessage(myOpenid, text); } catch(e) { ctx.logger.error('私聊回复失败: ' + String(e && e.message || e)); }
          }
          return;
        }
      } catch (e) {
        ctx.logger.error('OpenID查询插件私聊处理异常: ' + String(e && e.message || e));
      }
    });
  },
};
