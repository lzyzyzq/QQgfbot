// 绑定管理 v1.2.0 - 群内绑定QQ号 / 绑定QQ群号 / 群主绑定指定用户（@用户）
// 用法：
//   群里发「绑定QQ 123456789」→ 把当前 OpenID 绑定到 QQ 号（跨机器人身份识别）
//   群里发「绑定QQ 123456789 @用户」→ 群主/管理员把被 @ 用户的 OpenID 绑定到 QQ 号（可 @ 多个）
//   群里发「绑定QQ群 123456789」→ 群主/管理员把当前群绑定到数字群号（成员行自动带群号）
//   群里发「解绑QQ群」→ 群主/管理员解绑当前群的群号
//   群里发「解绑QQ @用户」→ 群主/管理员解绑被 @ 用户的 OpenID→QQ（可 @ 多个）
//   群里发「绑定用户 123456789 <OpenID>」→ 群主/管理员把指定 OpenID 绑定到 QQ 号（用户本人不便操作时用）
//   私聊发「绑定QQ 123456789」→ 同样可绑定自己的 QQ 号
// 绑定按机器人隔离：写入 user_mappings 时记录来源 botId，各机器人各自 OpenID→QQ。
// ReplySpec 回复可视化：内置模板可被后台 config plugin.file-绑定管理.reply 覆盖
/*__REPLY_SPEC_BEGIN__*/
var REPLY_SPEC = {
  name: "绑定管理",
  version: "1.2.0",
  desc: "绑定QQ/解绑QQ（可 @他人）；绑定QQ群/解绑QQ群；绑定用户（QQ+OpenID）",
  branches: [
    {
      key: "unbind-ok",
      label: "解绑成功（解绑QQ/解绑绑定）",
      scope: ["group", "c2c"],
      triggers: ["解绑QQ", "解绑qq", "解绑绑定"],
      lines: [
        { "t": "text", "v": "✅ 已解绑当前 OpenID 的 QQ 绑定{botTag}" }
      ]
    },
    {
      key: "unbind-fail",
      label: "解绑失败（含无解绑权限/未绑定）",
      scope: ["group", "c2c"],
      triggers: ["解绑QQ", "解绑qq", "解绑绑定"],
      lines: [
        { "t": "text", "v": "❌ 解绑失败：{err}" }
      ]
    },
    {
      key: "bindUser-help",
      label: "绑定指定用户 · 帮助说明",
      scope: ["group", "c2c"],
      triggers: ["绑定用户", "绑定指定用户"],
      lines: [
        { "t": "text", "v": "👤 绑定指定用户" },
        { "t": "text", "v": "发送「绑定用户 QQ号 OpenID」" },
        { "t": "row", "pre": "例：绑定用户 123456789 ", "k": "openid", "fb": "abc...DEF" },
        { "t": "text", "v": "仅群主/管理员可操作，用于帮成员绑定身份（成员不便操作时使用）" },
        { "t": "link", "pre": "OpenID 可通过成员", "label": "发送「OpenID查询」", "cmd": "OpenID查询", "post": "获取" }
      ]
    },
    {
      key: "bindUser-badqq",
      label: "绑定指定用户 · QQ号格式错误",
      scope: ["group", "c2c"],
      triggers: ["绑定用户 QQ号 OpenID"],
      lines: [
        { "t": "text", "v": "❌ QQ 号应为 5-11 位数字，请检查后重试" }
      ]
    },
    {
      key: "bindUser-badoid",
      label: "绑定指定用户 · OpenID 格式错误",
      scope: ["group", "c2c"],
      triggers: ["绑定用户 QQ号 OpenID"],
      lines: [
        { "t": "text", "v": "❌ OpenID 格式不正确，请通过「OpenID查询」获取完整 OpenID" }
      ]
    },
    {
      key: "bindUser-denied",
      label: "绑定指定用户 · 非群主/管理员被拒",
      scope: ["group"],
      triggers: ["绑定用户 QQ号 OpenID"],
      lines: [
        { "t": "text", "v": "🔒 仅群主/管理员可绑定指定用户" }
      ]
    },
    {
      key: "bindUser-ok",
      label: "绑定指定用户 · 成功",
      scope: ["group", "c2c"],
      triggers: ["绑定用户 QQ号 OpenID"],
      lines: [
        { "t": "text", "v": "✅ 绑定成功" },
        { "t": "row", "pre": "OpenID：", "k": "uoid" },
        { "t": "text", "v": "QQ：{uqq}{botTag}" },
        { "t": "text", "v": "该用户已可跨机器人识别身份" }
      ]
    },
    {
      key: "bindUser-fail",
      label: "绑定指定用户 · 引擎绑定失败",
      scope: ["group", "c2c"],
      triggers: ["绑定用户 QQ号 OpenID"],
      lines: [
        { "t": "text", "v": "❌ 绑定失败：{err}" }
      ]
    },
    {
      key: "bindQQ-help",
      label: "绑定QQ · 帮助说明",
      scope: ["group", "c2c"],
      triggers: ["绑定QQ", "绑定qq"],
      lines: [
        { "t": "text", "v": "📱 绑定QQ" },
        { "t": "text", "v": "发送「绑定QQ 你的QQ号」" },
        { "t": "text", "v": "例：绑定QQ 123456789" },
        { "t": "text", "v": "绑定后可跨机器人识别你的身份" },
        { "t": "text", "v": "需要解绑发「解绑QQ」" }
      ]
    },
    {
      key: "bindQQ-badqq",
      label: "绑定QQ · QQ号格式错误",
      scope: ["group", "c2c"],
      triggers: ["绑定QQ 你的QQ号"],
      lines: [
        { "t": "text", "v": "❌ QQ 号应为 5-11 位数字，请检查后重试" }
      ]
    },
    {
      key: "bindQQ-ok",
      label: "绑定QQ · 成功（含 OpenID查询 指引链接）",
      scope: ["group", "c2c"],
      triggers: ["绑定QQ 你的QQ号"],
      lines: [
        { "t": "text", "v": "✅ 绑定成功" },
        { "t": "row", "pre": "QQ：", "k": "qq" },
        { "t": "row", "pre": "昵称：", "k": "nickname", "fb": "未知", "post": "{botTag}" },
        { "t": "link", "label": "发送「OpenID查询」", "cmd": "OpenID查询", "post": "可查看绑定信息" }
      ]
    },
    {
      key: "bindQQ-fail",
      label: "绑定QQ · 引擎绑定失败",
      scope: ["group", "c2c"],
      triggers: ["绑定QQ 你的QQ号"],
      lines: [
        { "t": "text", "v": "❌ 绑定失败：{err}" }
      ]
    },
    {
      key: "bindGroup-denied-help",
      label: "绑定QQ群入口 · 非群主/管理员被拒（含操作指引）",
      scope: ["group"],
      triggers: ["绑定QQ群", "绑定qq群"],
      lines: [
        { "t": "text", "v": "🔒 仅群主/管理员或机器人管理员可绑定QQ群" },
        { "t": "text", "v": "发送「绑定QQ群 群号」绑定当前群到数字群号" }
      ]
    },
    {
      key: "bindGroup-help",
      label: "绑定QQ群 · 帮助说明",
      scope: ["group"],
      triggers: ["绑定QQ群", "绑定qq群"],
      lines: [
        { "t": "text", "v": "👥 绑定QQ群" },
        { "t": "text", "v": "发送「绑定QQ群 群号」" },
        { "t": "text", "v": "例：绑定QQ群 123456789" },
        { "t": "text", "v": "绑定后群成员行自动带群号" }
      ]
    },
    {
      key: "bindGroup-denied",
      label: "绑定QQ群带群号 · 非群主/管理员被拒",
      scope: ["group"],
      triggers: ["绑定QQ群 群号"],
      lines: [
        { "t": "text", "v": "🔒 仅群主/管理员或机器人管理员可绑定QQ群" }
      ]
    },
    {
      key: "bindGroup-ok",
      label: "绑定QQ群 · 成功",
      scope: ["group"],
      triggers: ["绑定QQ群 群号"],
      lines: [
        { "t": "text", "v": "✅ 群绑定成功" },
        { "t": "row", "pre": "群 OpenID：", "k": "gid" },
        { "t": "text", "v": "群号：{gnum}{botTag}" },
        { "t": "text", "v": "群成员行已自动关联该群号" }
      ]
    },
    {
      key: "bindGroup-fail",
      label: "绑定QQ群 · 引擎绑定失败",
      scope: ["group"],
      triggers: ["绑定QQ群 群号"],
      lines: [
        { "t": "text", "v": "❌ 绑定失败：{err}" }
      ]
    },
    {
      key: "unbindGroup-ok",
      label: "解绑QQ群 · 成功",
      scope: ["group"],
      triggers: ["解绑QQ群", "解绑qq群", "解绑群"],
      lines: [
        { "t": "text", "v": "✅ 已解绑本群群号{bindNote}{botTag}" }
      ]
    },
    {
      key: "unbindGroup-fail",
      label: "解绑QQ群 · 失败（无权限/未绑定）",
      scope: ["group"],
      triggers: ["解绑QQ群", "解绑qq群", "解绑群"],
      lines: [
        { "t": "text", "v": "❌ 解绑失败：{err}" }
      ]
    },
    {
      key: "bind-others-denied",
      label: "绑定/解绑他人 · 非群主/管理员被拒",
      scope: ["group"],
      triggers: ["绑定QQ QQ号 @用户", "解绑QQ @用户"],
      lines: [
        { "t": "text", "v": "🔒 仅群主/管理员或机器人管理员可绑定/解绑他人" }
      ]
    },
    {
      key: "bind-others-ok",
      label: "绑定他人 OpenID→QQ · 成功",
      scope: ["group"],
      triggers: ["绑定QQ QQ号 @用户"],
      lines: [
        { "t": "text", "v": "✅ 已绑定 {count} 个用户的 OpenID→QQ：{uqq}{botTag}" },
        { "t": "text", "v": "{oids}" }
      ]
    },
    {
      key: "unbind-others-ok",
      label: "解绑他人 OpenID→QQ · 成功",
      scope: ["group"],
      triggers: ["解绑QQ @用户"],
      lines: [
        { "t": "text", "v": "✅ 已解绑 {count} 个用户的 OpenID 绑定{botTag}" },
        { "t": "text", "v": "{oids}" }
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
function _fbUnbindOk(bt) {
  return '✅ 已解绑当前 OpenID 的 QQ 绑定' + (bt || '');
}
function _fbUnbindFail(err) {
  return '❌ 解绑失败：' + (err || '无解绑权限或未绑定');
}
function _fbLink(label, cmd, mk) {
  return (mk || function(l, c) { return l; })(label, cmd);
}
function _fbBindUserHelp(oid, mk) {
  var lk = _fbLink('发送「OpenID查询」', 'OpenID查询', mk);
  return '👤 绑定指定用户\n发送「绑定用户 QQ号 OpenID」\n例：绑定用户 123456789 ' + (oid || 'abc...DEF') + '\n仅群主/管理员可操作，用于帮成员绑定身份（成员不便操作时使用）\nOpenID 可通过成员' + lk + '获取';
}
function _fbBadqq() {
  return '❌ QQ 号应为 5-11 位数字，请检查后重试';
}
function _fbBadoid() {
  return '❌ OpenID 格式不正确，请通过「OpenID查询」获取完整 OpenID';
}
function _fbBindUserDenied() {
  return '🔒 仅群主/管理员可绑定指定用户';
}
function _fbBindUserOk(uoid, uqq, bt) {
  return '✅ 绑定成功\nOpenID：' + uoid + '\nQQ：' + uqq + (bt || '') + '\n该用户已可跨机器人识别身份';
}
function _fbBindQQHelp() {
  return '📱 绑定QQ\n发送「绑定QQ 你的QQ号」\n例：绑定QQ 123456789\n绑定后可跨机器人识别你的身份\n需要解绑发「解绑QQ」';
}
function _fbBindQQOk(qq, nickname, bt, mk) {
  var lk = _fbLink('发送「OpenID查询」', 'OpenID查询', mk);
  return '✅ 绑定成功\nQQ：' + qq + '\n昵称：' + (nickname || '未知') + (bt || '') + '\n' + lk + '可查看绑定信息';
}
function _fbBindFail(err) {
  return '❌ 绑定失败：' + (err || '未知错误');
}
function _fbBindGroupDeniedHelp() {
  return '🔒 仅群主/管理员或机器人管理员可绑定QQ群\n发送「绑定QQ群 群号」绑定当前群到数字群号';
}
function _fbBindGroupHelp() {
  return '👥 绑定QQ群\n发送「绑定QQ群 群号」\n例：绑定QQ群 123456789\n绑定后群成员行自动带群号';
}
function _fbBindGroupDenied() {
  return '🔒 仅群主/管理员或机器人管理员可绑定QQ群';
}
function _fbBindGroupOk(gid, gnum, bt) {
  return '✅ 群绑定成功\n群 OpenID：' + gid + '\n群号：' + gnum + (bt || '') + '\n群成员行已自动关联该群号';
}
function _fbUnbindGroupOk(bindNote, bt) {
  return '✅ 已解绑本群群号' + (bindNote || '') + (bt || '');
}
function _fbUnbindGroupFail(err) {
  return '❌ 解绑失败：' + (err || '无解绑权限或未绑定');
}
function _fbOthersDenied() {
  return '🔒 仅群主/管理员或机器人管理员可绑定/解绑他人';
}
function _fbBindOthersOk(count, uqq, oids, bt) {
  return '✅ 已绑定 ' + count + ' 个用户的 OpenID→QQ：' + uqq + (bt || '') + '\n' + oids;
}
function _fbUnbindOthersOk(count, oids, bt) {
  return '✅ 已解绑 ' + count + ' 个用户的 OpenID 绑定' + (bt || '') + '\n' + oids;
}

// ===== ReplySpec 运行上下文（onEnable 初始化一次；config 覆盖 plugin.file-绑定管理.reply）=====
var _REPLY_RS = null;
function _initReplyRs(ctx) {
  var curSpec = REPLY_SPEC;
  try {
    var raw = (ctx.engine && ctx.engine.getConfigValue) ? ctx.engine.getConfigValue('plugin.file-绑定管理.reply') : null;
    if (raw) {
      var parsed = JSON.parse(String(raw));
      if (parsed && Array.isArray(parsed.branches) && parsed.branches.length) curSpec = parsed;
    }
  } catch (e) { ctx.logger.warn('绑定管理 ReplySpec config 解析失败，使用内置模板: ' + String(e && e.message || e)); }
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
  return { curSpec: curSpec, linkFn: linkFn, baseData: baseData, render: render };
}
function _getReplyRs(ctx) {
  if (!_REPLY_RS) _REPLY_RS = _initReplyRs(ctx);
  return _REPLY_RS;
}

module.exports = {
  manifest: {
    id: 'mod-bind-manage',
    name: '绑定管理',
    version: '1.2.0',
    description: '绑定QQ/解绑QQ（可 @他人）；绑定QQ群/解绑QQ群；绑定用户（QQ+OpenID）',
    author: '511742399'
  },

  methods: {
    handle: async function(ctx, data) {
      var content = (data.content || '').trim().replace(/^\s*<@!?[A-Fa-f0-9]+>\s*/, '').trim();
      var openid = (data.author && data.author.openid) || '';
      var nickname = (data.author && data.author.username) || '';
      var gid = data.groupId || '';
      var msgId = data.id;
      var rs = _getReplyRs(ctx);

      // 被 @ 的用户 OpenID（从剥离机器人前缀后的 content 提取，排除自己），用于群管理批量绑定/解绑他人
      var mentions = [];
      var mre = /<@!?([A-Za-z0-9_\-]{16,64})>/g;
      var mm;
      while ((mm = mre.exec(content)) !== null) {
        var mo = mm[1];
        if (mo && mo !== openid && mentions.indexOf(mo) < 0) mentions.push(mo);
      }

      var reply = async function(text) {
        try {
          if (gid) {
            // 外显文字链接（mqqapi）需 markdown 才可点击，优先 sendMarkdownGroup，失败回退普通文本
            if (ctx.bot.sendMarkdownGroup) {
              var r = await ctx.bot.sendMarkdownGroup(gid, text, msgId);
              if (r) return r;
            }
            return await ctx.bot.sendGroupMessage(gid, text, msgId);
          }
          else if (openid) await ctx.bot.sendPrivateMessage(openid, text, msgId);
        } catch (e) {
          ctx.logger.error('绑定管理回复失败: ' + String(e && e.message || e));
          try { if (gid) await ctx.bot.sendGroupMessage(gid, text, msgId); } catch (e2) { ctx.logger.error('绑定管理文本回复失败: ' + String(e2 && e2.message || e2)); }
        }
      };

      // ReplySpec 渲染优先：先算 d（baseData 合并该处动态变量）再渲染；渲染串为空则回退 _fbXxx 原文兜底
      var replyTpl = async function(key, extra, fb) {
        var t = rs.render(key, data, extra);
        await reply(t || (fb ? fb() : ''));
      };

      // 当前机器人标识（OpenID 绑定按机器人隔离，提示绑定发生在哪个机器人下）
      var botTag = function() {
        var b = (data && data.botId) || '';
        if (!b) return '';
        var name = (ctx.engine && ctx.engine.getBotNameById) ? ctx.engine.getBotNameById(b) : '';
        if (name && name !== b) return '｜机器人：' + name + '（' + b + '）';
        return '｜机器人：' + b;
      };

      // 群管理权限（超级主人/群主/管理员；后台未设置角色时放行，便于私域群使用）
      var canManage = false;
      try {
        var myRole = ctx.engine.getGroupMemberRole ? ctx.engine.getGroupMemberRole(gid, openid) : '';
        canManage = myRole === 'owner' || myRole === 'admin' || myRole === 'super' || myRole === 'master' || myRole === '' || !myRole;
      } catch (e) { canManage = true; }

      var mBindQQ = content === '绑定QQ' || content === '绑定qq';
      var mBindQQPre = content.indexOf('绑定QQ ') === 0 || content.indexOf('绑定qq ') === 0;
      var mBindGroup = content === '绑定QQ群' || content === '绑定qq群';
      var mBindGroupPre = content.indexOf('绑定QQ群 ') === 0 || content.indexOf('绑定qq群 ') === 0;
      var mUnbind = content === '解绑QQ' || content === '解绑qq' || content === '解绑绑定' || content.indexOf('解绑QQ ') === 0 || content.indexOf('解绑qq ') === 0;
      var mUnbindGroup = content === '解绑QQ群' || content === '解绑qq群' || content === '解绑群';
      var mBindUserHelp = content === '绑定用户' || content === '绑定指定用户';
      var mBindUser = content.indexOf('绑定用户 ') === 0;

      if (mUnbindGroup) {
        if (!gid) {
          await replyTpl('unbindGroup-fail', { err: '仅群聊可解绑群号' }, function() { return _fbUnbindGroupFail('仅群聊可解绑群号'); });
          return true;
        }
        if (!canManage) {
          await replyTpl('unbindGroup-fail', { err: '仅群主/管理员或机器人管理员可解绑群号' }, function() { return _fbUnbindGroupFail('仅群主/管理员或机器人管理员可解绑群号'); });
          return true;
        }
        var gr = ctx.engine.unbindGroupNumber ? ctx.engine.unbindGroupNumber(gid) : { ok: false, error: '引擎不支持解绑群' };
        if (gr && gr.ok) {
          var gubt = botTag();
          await replyTpl('unbindGroup-ok', { bindNote: '', botTag: gubt }, function() { return _fbUnbindGroupOk('', gubt); });
        } else {
          var gverr = (gr && gr.error) || '无解绑权限或未绑定';
          await replyTpl('unbindGroup-fail', { err: gverr }, function() { return _fbUnbindGroupFail(gverr); });
        }
        return true;
      }

      if (mUnbind) {
        // 带 @用户：群管理批量解绑他人 OpenID→QQ
        if (mentions.length > 0) {
          if (!canManage) { await replyTpl('bind-others-denied', {}, _fbOthersDenied); return true; }
          var udone = [];
          var ulastErr = '';
          for (var ui = 0; ui < mentions.length; ui++) {
            var ur = ctx.engine.unbindUser ? ctx.engine.unbindUser(mentions[ui], gid) : null;
            if (ur && ur.ok) udone.push(mentions[ui]);
            else ulastErr = (ur && ur.error) || '未绑定';
          }
          var uobot = botTag();
          var uoidList = udone.map(function(o) { return '• ' + o; }).join('\n');
          if (udone.length > 0) {
            await replyTpl('unbind-others-ok', { count: udone.length, oids: uoidList, botTag: uobot }, function() { return _fbUnbindOthersOk(udone.length, uoidList, uobot); });
          } else {
            await replyTpl('unbind-fail', { err: ulastErr || '未绑定' }, function() { return _fbUnbindFail(ulastErr || '未绑定'); });
          }
          return true;
        }
        var ures = ctx.engine.unbindUser ? ctx.engine.unbindUser(openid, gid) : null;
        if (ures && ures.ok) {
          var ubt = botTag();
          await replyTpl('unbind-ok', { botTag: ubt }, function() { return _fbUnbindOk(ubt); });
        } else {
          var uerr = (ures && ures.error) || '无解绑权限或未绑定';
          await replyTpl('unbind-fail', { err: uerr }, function() { return _fbUnbindFail(uerr); });
        }
        return true;
      }

      if (mBindUserHelp) {
        await replyTpl('bindUser-help', { openid: openid }, function() { return _fbBindUserHelp(openid, rs.linkFn); });
        return true;
      }
      if (mBindUser) {
        var parts = content.substring(5).trim().split(/\s+/);
        var uqq = (parts[0] || '').trim();
        var uoid = (parts[1] || '').trim();
        if (!/^\d{5,11}$/.test(uqq)) { await replyTpl('bindUser-badqq', {}, _fbBadqq); return true; }
        if (!/^[A-Za-z0-9_\-]+$/.test(uoid) || uoid.length < 6) { await replyTpl('bindUser-badoid', {}, _fbBadoid); return true; }
        if (gid) {
          var canBind = false;
          try {
            var role = ctx.engine.getGroupMemberRole ? ctx.engine.getGroupMemberRole(gid, openid) : '';
            canBind = role === 'owner' || role === 'admin' || role === 'super' || role === 'master' || role === '' || !role;
          } catch (e) { canBind = true; }
          if (!canBind) { await replyTpl('bindUser-denied', {}, _fbBindUserDenied); return true; }
        }
        var res = ctx.engine.bindUserQQ ? ctx.engine.bindUserQQ(uoid, uqq, '', data.botId, gid) : { ok: false, error: '引擎不支持绑定' };
        if (res.ok) {
          var ubt2 = botTag();
          await replyTpl('bindUser-ok', { uoid: uoid, uqq: uqq, botTag: ubt2 }, function() { return _fbBindUserOk(uoid, uqq, ubt2); });
        } else {
          var uerr2 = (res && res.error) || '未知错误';
          await replyTpl('bindUser-fail', { err: uerr2 }, function() { return _fbBindFail(uerr2); });
        }
        return true;
      }

      if (mBindQQ) {
        await replyTpl('bindQQ-help', {}, _fbBindQQHelp);
        return true;
      }
      if (mBindQQPre) {
        var qq = content.substring(5).trim().split(/\s+/)[0];
        if (!/^\d{5,11}$/.test(qq)) { await replyTpl('bindQQ-badqq', {}, _fbBadqq); return true; }
        // 带 @用户：群管理把被 @ 用户的 OpenID 绑定到该 QQ（每人各自机器人下独立）
        if (mentions.length > 0) {
          if (!canManage) { await replyTpl('bind-others-denied', {}, _fbOthersDenied); return true; }
          var bdone = [];
          var blastErr = '';
          for (var bi = 0; bi < mentions.length; bi++) {
            var br = ctx.engine.bindUserQQ ? ctx.engine.bindUserQQ(mentions[bi], qq, '', data.botId, gid) : { ok: false, error: '引擎不支持绑定' };
            if (br && br.ok) bdone.push(mentions[bi]);
            else blastErr = (br && br.error) || '未知错误';
          }
          var bobt = botTag();
          var boidList = bdone.map(function(o) { return '• ' + o; }).join('\n');
          if (bdone.length > 0) {
            await replyTpl('bind-others-ok', { count: bdone.length, uqq: qq, oids: boidList, botTag: bobt }, function() { return _fbBindOthersOk(bdone.length, qq, boidList, bobt); });
          } else {
            await replyTpl('bindQQ-fail', { err: blastErr || '未知错误' }, function() { return _fbBindFail(blastErr || '未知错误'); });
          }
          return true;
        }
        var res = ctx.engine.bindUserQQ ? ctx.engine.bindUserQQ(openid, qq, nickname, data.botId, gid) : { ok: false, error: '引擎不支持绑定' };
        if (res.ok) {
          var qbt = botTag();
          await replyTpl('bindQQ-ok', { qq: qq, nickname: nickname, botTag: qbt }, function() { return _fbBindQQOk(qq, nickname, qbt, rs.linkFn); });
        } else {
          var qerr = (res && res.error) || '未知错误';
          await replyTpl('bindQQ-fail', { err: qerr }, function() { return _fbBindFail(qerr); });
        }
        return true;
      }

      if (mBindGroup) {
        if (!canManage) {
          await replyTpl('bindGroup-denied-help', {}, _fbBindGroupDeniedHelp);
          return true;
        }
        await replyTpl('bindGroup-help', {}, _fbBindGroupHelp);
        return true;
      }
      if (mBindGroupPre) {
        if (!canManage) {
          await replyTpl('bindGroup-denied', {}, _fbBindGroupDenied);
          return true;
        }
        var gnum = content.substring(6).trim();
        var gname = '';
        try { gname = ctx.engine.getGroupName ? ctx.engine.getGroupName(gid) : ''; } catch (e) {}
        var res2 = ctx.engine.bindGroupNumber ? ctx.engine.bindGroupNumber(gid, gnum, gname, data.botId) : { ok: false, error: '引擎不支持绑定群' };
        if (res2.ok) {
          var gbt = botTag();
          await replyTpl('bindGroup-ok', { gid: gid, gnum: gnum, botTag: gbt }, function() { return _fbBindGroupOk(gid, gnum, gbt); });
        } else {
          var gerr = (res2 && res2.error) || '未知错误';
          await replyTpl('bindGroup-fail', { err: gerr }, function() { return _fbBindFail(gerr); });
        }
        return true;
      }

      return false;
    }
  },

  onEnable: function(ctx) {
    _REPLY_RS = _initReplyRs(ctx);
    var self = this;
    ctx.eventBus.on('message.group', async function(data) {
      try { await self.methods.handle(ctx, data); } catch (e) { ctx.logger.error('绑定管理异常: ' + String(e && e.message || e)); }
    });
    ctx.eventBus.on('message.c2c', async function(data) {
      try { await self.methods.handle(ctx, data); } catch (e) { ctx.logger.error('绑定管理异常: ' + String(e && e.message || e)); }
    });
  }
};
