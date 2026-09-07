// 签到系统 v2.1.1 - 每日签到 + 积分 + 排行 + 补签 + 按钮/文字双模式
// v2.1.1: 积分排行显示绑定 QQ（已绑定用户显示 QQ 号，未绑定才显示 UID 前 8 位）
// ReplySpec 回复可视化：内置模板可被后台 config plugin.file-签到系统.reply 覆盖
// @ts-nocheck
/*__REPLY_SPEC_BEGIN__*/
var REPLY_SPEC = {
  name: "签到系统",
  version: "2.1.1",
  desc: "每日签到、补签、积分与排行榜回复（排行行项由代码动态追加，模板覆盖表头）",
  branches: [
    {
      key: "disabled",
      label: "系统停用（后台开关 switch.checkin=0）",
      scope: ["group"],
      triggers: ["签到", "补签", "签到排行", "积分排行"],
      lines: [
        { "t": "text", "v": "签到系统已停用" }
      ]
    },
    {
      key: "already",
      label: "签到-今天已签过，明天再来",
      scope: ["group"],
      triggers: ["签到"],
      lines: [
        { "t": "text", "v": "你今天已经签过到了，明天再来吧！" }
      ]
    },
    {
      key: "ok",
      label: "签到成功（bonus 为满月/连续天数/幸运暴击追加文本）",
      scope: ["group"],
      triggers: ["签到"],
      lines: [
        { "t": "text", "v": "签到成功！+ {points} 积分{bonus}\n累计积分：{total} | 连续签到：{streak}天" }
      ]
    },
    {
      key: "makeup-already",
      label: "补签-今天已签过，无需补签",
      scope: ["group"],
      triggers: ["补签"],
      lines: [
        { "t": "text", "v": "你今天已经签到过了，无需补签。" }
      ]
    },
    {
      key: "makeup-yesterday",
      label: "补签-昨天已签到",
      scope: ["group"],
      triggers: ["补签"],
      lines: [
        { "t": "text", "v": "昨天已签到，无需补签。发送\"签到\"即可。" }
      ]
    },
    {
      key: "makeup-low",
      label: "补签-积分不足（消耗30）",
      scope: ["group"],
      triggers: ["补签"],
      lines: [
        { "t": "text", "v": "补签需要消耗30积分，你的积分不足（当前：{total}）。" }
      ]
    },
    {
      key: "makeup-ok",
      label: "补签成功（消耗30积分，恢复连续天数）",
      scope: ["group"],
      triggers: ["补签"],
      lines: [
        { "t": "text", "v": "补签成功！消耗30积分，连续签到恢复为{streak}天。\n剩余积分：{total}" }
      ]
    },
    {
      key: "rank-empty",
      label: "排行榜-暂无签到数据",
      scope: ["group"],
      triggers: ["签到排行", "积分排行"],
      lines: [
        { "t": "text", "v": "暂无签到数据，发送\"签到\"成为第一名！" }
      ]
    },
    {
      key: "rank-top",
      label: "排行榜-表头 TOP{topN}（名次行由代码动态追加，不入模板）",
      scope: ["group"],
      triggers: ["签到排行", "积分排行"],
      lines: [
        { "t": "text", "v": "积分排行榜 TOP{topN}：" }
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

// ===== 运行时 spec / linkFn（onEnable 载入服务器 config plugin.file-签到系统.reply 覆盖）=====
var _rsSpec = REPLY_SPEC;
var _rsLink = null;

function rsText(ctx, key, data, extra) {
  var a = data.author || {};
  var botId = data.botId || '';
  var bName = (ctx && ctx.engine && ctx.engine.getBotNameById) ? (ctx.engine.getBotNameById(botId) || '') : '';
  var d = {
    botId: botId,
    botName: bName,
    botShow: (bName && bName !== botId) ? bName + '（' + botId + '）' : botId,
    gid: data.groupId || '',
    openid: (a && (a.openid || a.id)) || data.member_openid || '',
    qq: (a && a.qqId) || '',
    nick: (a && a.username) || ''
  };
  if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) d[k] = extra[k];
  return rsRender(key, d, _rsSpec, _rsLink);
}

// ===== 固定回复兜底原文（rsRender 因 spec 缺失/异常返回空时使用，保证线上行为不回退）=====
var RS_FALLBACK = {
  disabled: '签到系统已停用',
  already: '你今天已经签过到了，明天再来吧！',
  ok: function(d) { return '签到成功！+ ' + (d && d.points !== undefined ? d.points : '') + ' 积分' + ((d && d.bonus) || '') + '\n累计积分：' + (d && d.total !== undefined ? d.total : '') + ' | 连续签到：' + (d && d.streak !== undefined ? d.streak : '') + '天'; },
  'makeup-already': '你今天已经签到过了，无需补签。',
  'makeup-yesterday': '昨天已签到，无需补签。发送"签到"即可。',
  'makeup-low': function(d) { return '补签需要消耗30积分，你的积分不足（当前：' + (d && d.total !== undefined ? d.total : '') + '）。'; },
  'makeup-ok': function(d) { return '补签成功！消耗30积分，连续签到恢复为' + (d && d.streak !== undefined ? d.streak : '') + '天。\n剩余积分：' + (d && d.total !== undefined ? d.total : ''); },
  'rank-empty': '暂无签到数据，发送"签到"成为第一名！',
  'rank-top': function(d) { return '积分排行榜 TOP' + (d && d.topN !== undefined ? d.topN : '') + '：'; }
};
function _fb(key, d) {
  var f = RS_FALLBACK[key];
  if (typeof f === 'function') return f(d || {});
  return (f === undefined || f === null) ? '' : String(f);
}

module.exports = {
  manifest: {
    id: 'mod-checkin',
    name: '签到系统',
    version: '2.1.1',
    description: '每日签到、积分系统、补签、排行榜、个人信息',
    author: '511742399',
  },

  methods: {
    _today: function() {
      var d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    },
    _yesterday: function() {
      var d = new Date(); d.setDate(d.getDate() - 1);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    },

    handleCommand: async function(ctx, data) {
      try {
        var content = (data.content || '').trim().replace(/^\s*<@!?[A-F0-9]+>\s*/, '').trim();
        var userId = data.author.openid;
        var groupId = data.groupId;
        var msgId = data.id;

        var backBtn = function() {
          return { id: '返回主菜单', render_data: { label: '返回主菜单', visited_label: '返回主菜单', style: 0 }, action: { type: 2, data: '返回主菜单', enter: true, permission: { type: 2 } } };
        };
        var backRow = function() { return [backBtn()]; };

        var sendReply = async function(text, buttons) {
          try {
            await ctx.engine.callPlugin('主菜单', 'sendMessage', groupId, userId, msgId, text, buttons);
          } catch(e) {
            await ctx.bot.sendGroupMessage(groupId, text + '\n发送"返回主菜单"回到主界面', msgId);
          }
        };

        // 功能开关门控：签到系统总开关（后台「功能开关」可停用）
        try {
          var swVal = ctx.engine.getConfigValue ? String(ctx.engine.getConfigValue('switch.checkin') || '') : '';
          if (swVal === '0') {
            var tDisabled = rsText(ctx, 'disabled', data, {});
            await sendReply(tDisabled || _fb('disabled', {}), [backRow()]);
            return;
          }
        } catch(e) {}

        if (content === '签到') {
          var today = this._today();
          var yesterday = this._yesterday();
          var lastDate = ctx.storage.get('checkin_' + userId + '_date');

          if (lastDate === today) {
            var tAlready = rsText(ctx, 'already', data, {});
            await sendReply(tAlready || _fb('already', {}), [backRow()]);
            return;
          }

          var streak = 1;
          if (lastDate === yesterday) {
            streak = (parseInt(ctx.storage.get('checkin_' + userId + '_streak'), 10) || 0) + 1;
          }

          var points = Math.floor(Math.random() * 100) + 1;
          var bonusMsg = '';
          if (streak >= 30) { points += 200; bonusMsg = '\n满月签到奖励+200积分！'; }
          else if (streak >= 7) { points += 50; bonusMsg = '\n连续' + streak + '天奖励+50积分！'; }
          else if (streak >= 3) { points += 20; bonusMsg = '\n连续' + streak + '天奖励+20积分！'; }

          var lucky = Math.random();
          if (lucky < 0.05) { points *= 2; bonusMsg += '\n幸运暴击！积分x2！'; }

          ctx.storage.set('checkin_' + userId + '_date', today);
          ctx.storage.set('checkin_' + userId + '_streak', String(streak));

          var totalKey = 'checkin_' + userId + '_total';
          var total = (parseInt(ctx.storage.get(totalKey), 10) || 0) + points;
          ctx.storage.set(totalKey, String(total));

          if (!ctx._checkinUsers) ctx._checkinUsers = [];
          if (ctx._checkinUsers.indexOf(userId) === -1) ctx._checkinUsers.push(userId);

          var tOk = rsText(ctx, 'ok', data, { points: points, streak: streak, bonus: bonusMsg, total: total });
          await sendReply(tOk || _fb('ok', { points: points, streak: streak, bonus: bonusMsg, total: total }), [backRow()]);
          return;
        }

        if (content === '补签') {
          var today = this._today();
          var lastDate = ctx.storage.get('checkin_' + userId + '_date');
          if (lastDate === today) {
            var tMa = rsText(ctx, 'makeup-already', data, {});
            await sendReply(tMa || _fb('makeup-already', {}), [backRow()]);
            return;
          }
          var yday = this._yesterday();
          if (lastDate === yday) {
            var tMy = rsText(ctx, 'makeup-yesterday', data, {});
            await sendReply(tMy || _fb('makeup-yesterday', {}), [backRow()]);
            return;
          }
          var total = parseInt(ctx.storage.get('checkin_' + userId + '_total'), 10) || 0;
          if (total < 30) {
            var tMl = rsText(ctx, 'makeup-low', data, { total: total });
            await sendReply(tMl || _fb('makeup-low', { total: total }), [backRow()]);
            return;
          }
          total -= 30;
          ctx.storage.set('checkin_' + userId + '_total', String(total));
          ctx.storage.set('checkin_' + userId + '_date', yday);

          var streak = (parseInt(ctx.storage.get('checkin_' + userId + '_streak'), 10) || 0) + 1;
          ctx.storage.set('checkin_' + userId + '_streak', String(streak));

          var tMo = rsText(ctx, 'makeup-ok', data, { streak: streak, total: total });
          await sendReply(tMo || _fb('makeup-ok', { streak: streak, total: total }), [backRow()]);
          return;
        }

        if (content === '个人信息') {
          return;
        }

        if (content === '签到排行' || content === '积分排行') {
          var allKeys = this._scanCheckinKeys(ctx);
          if (allKeys.length === 0) {
            var tRe = rsText(ctx, 'rank-empty', data, {});
            await sendReply(tRe || _fb('rank-empty', {}), [backRow()]);
            return;
          }
          var ranked = allKeys.sort(function(a, b) { return b.total - a.total; }).slice(0, 10);
          var txt = rsText(ctx, 'rank-top', data, { topN: ranked.length });
          if (!txt) txt = _fb('rank-top', { topN: ranked.length });
          for (var i = 0; i < ranked.length; i++) {
            var showName = this._displayName(ctx, ranked[i].uid);
            txt += '\n' + (i + 1) + '. ' + showName + ' | ' + ranked[i].total + '分';
          }
          await sendReply(txt, [backRow()]);
          return;
        }
      } catch (e) {
        ctx.logger.error('签到系统错误: ' + e.message);
      }
    },

    _displayName: function(ctx, openid) {
      var qq = '';
      try {
        if (ctx.engine && ctx.engine.identity && ctx.engine.identity.getQQ) qq = ctx.engine.identity.getQQ(openid) || '';
        else if (ctx.engine && ctx.engine.getUserProfile) {
          var p = ctx.engine.getUserProfile(openid);
          qq = (p && p.qq) || '';
        }
      } catch (e) {}
      if (qq) return 'QQ:' + qq;
      return 'UID:' + String(openid).substring(0, 8) + '...';
    },

    _scanCheckinKeys: function(ctx) {
      if (!ctx._checkinUsers) ctx._checkinUsers = [];
      var users = ctx._checkinUsers;
      var result = [];
      for (var i = 0; i < users.length; i++) {
        var uid = users[i];
        var total = parseInt(ctx.storage.get('checkin_' + uid + '_total') || '0', 10);
        if (total > 0) result.push({ uid: uid, total: total });
      }
      return result;
    },
  },

  onEnable: function(ctx) {
    if (!ctx._checkinUsers) ctx._checkinUsers = [];
    ctx.logger.info('签到系统已加载 v2.1.0');
    // ReplySpec：服务器 config 覆盖内置模板（后台「回复编辑器」保存后需重载插件生效）
    try {
      var raw = (ctx.engine && ctx.engine.getConfigValue) ? ctx.engine.getConfigValue('plugin.file-签到系统.reply') : null;
      if (raw) {
        var parsed = JSON.parse(String(raw));
        if (parsed && Array.isArray(parsed.branches) && parsed.branches.length) _rsSpec = parsed;
      }
    } catch (e) { ctx.logger.warn('签到系统 ReplySpec config 解析失败，使用内置模板: ' + String(e && e.message || e)); }
    _rsLink = (ctx.link && ctx.link.linkify) ? function(t, c) { return ctx.link.linkify(t, c); } : _rsMq;
  },
};
