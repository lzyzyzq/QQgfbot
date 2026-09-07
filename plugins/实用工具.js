// 实用工具 v1.2.1 - 每日备注/打卡/昵称/天气/个人信息（富媒体头像卡）
// ReplySpec 回复可视化：内置模板可被后台 config plugin.file-实用工具.reply 覆盖；渲染优先+原文兜底
/*__REPLY_SPEC_BEGIN__*/
var REPLY_SPEC = {
  name: '实用工具',
  version: '1.2.1',
  desc: '每日备注/每日打卡/设置昵称/查询天气（帮助与失败提示）等纯文本回复模板；个人信息头像卡与天气图片保持富媒体原样',
  branches: [
    {
      key: 'noteView', label: '每日备注（查看·今日已有内容）', scope: ['group'], triggers: ['每日备注'],
      lines: [
        { "t": "text", "v": "📝 今日备注" },
        { "t": "text", "v": "{note}" }
      ]
    },
    {
      key: 'noteEmpty', label: '每日备注（查看·今日暂无备注）', scope: ['group'], triggers: ['每日备注'],
      lines: [
        { "t": "text", "v": "📝 今日暂无备注" },
        { "t": "text", "v": "发送\"每日备注 内容\" 记录今天" }
      ]
    },
    {
      key: 'noteSaveEmpty', label: '每日备注（保存·内容为空提示）', scope: ['group'], triggers: ['每日备注 x'],
      lines: [
        { "t": "text", "v": "📝 请填写备注内容" },
        { "t": "text", "v": "格式：每日备注 今天的心情/日记" }
      ]
    },
    {
      key: 'noteSaved', label: '每日备注（保存成功）', scope: ['group'], triggers: ['每日备注 x'],
      lines: [
        { "t": "text", "v": "✅ 今日备注已保存！" },
        { "t": "text", "v": "📝 {note}" }
      ]
    },
    {
      key: 'checkinDup', label: '每日打卡（今日已打卡）', scope: ['group'], triggers: ['每日打卡'],
      lines: [
        { "t": "text", "v": "✅ 今天已经打过卡了！" },
        { "t": "text", "v": "明天再来吧~" }
      ]
    },
    {
      key: 'checkinOk', label: '每日打卡（成功+points/连续/加奖行）', scope: ['group'], triggers: ['每日打卡'],
      lines: [
        { "t": "text", "v": "✅ 打卡成功！" },
        { "t": "text", "v": "获得积分：+{points}" },
        { "t": "text", "v": "累计积分：{total}" },
        { "t": "text", "v": "连续打卡：{streak} 天" },
        { "t": "row", "k": "reward7", "hide": true },
        { "t": "row", "k": "reward30", "hide": true }
      ]
    },
    {
      key: 'nickView', label: '设置昵称（查看当前昵称）', scope: ['group'], triggers: ['设置昵称'],
      lines: [
        { "t": "text", "v": "✏️ 当前昵称：{nick}" },
        { "t": "text", "v": "发送\"设置昵称 新昵称\" 修改" }
      ]
    },
    {
      key: 'nickSet', label: '设置昵称（修改成功）', scope: ['group'], triggers: ['设置昵称 x'],
      lines: [
        { "t": "text", "v": "✅ 昵称已设置为：{nick}" }
      ]
    },
    {
      key: 'nickErr', label: '设置昵称（空/超长错误）', scope: ['group'], triggers: ['设置昵称 x'],
      lines: [
        { "t": "text", "v": "昵称长度1-20个字符" }
      ]
    },
    {
      key: 'weatherHelp', label: '查询天气（帮助句）', scope: ['group'], triggers: ['查询天气', '天气'],
      lines: [
        { "t": "text", "v": "🌤 查询天气" },
        { "t": "text", "v": "格式：查询天气 城市名" },
        { "t": "text", "v": "例：查询天气 北京" }
      ]
    },
    {
      key: 'weatherCityEmpty', label: '查询天气（城市为空提示）', scope: ['group'], triggers: ['查询天气 x'],
      lines: [
        { "t": "text", "v": "🌤 请填写城市名" },
        { "t": "text", "v": "格式：查询天气 城市名" }
      ]
    },
    {
      key: 'weatherFail', label: '天气文本兜底（接口无返回）', scope: ['group'], triggers: ['查询天气 x'],
      lines: [
        { "t": "text", "v": "❌ 查询失败，请检查城市名" }
      ]
    },
    {
      key: 'weatherErr', label: '天气文本兜底（接口异常）', scope: ['group'], triggers: ['查询天气 x'],
      lines: [
        { "t": "text", "v": "❌ 天气查询失败：{msg}" }
      ]
    },
    {
      key: 'fallback', label: '未知指令', scope: ['group'], triggers: ['其他'],
      lines: [
        { "t": "text", "v": "❓ 未知指令" },
        { "t": "text", "v": "发送\"实用功能\"查看所有实用工具" }
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

// ===== ReplySpec 生效规格（config 覆盖内置模板），onEnable 装载后 handleCommand 内渲染 =====
var _curSpec = REPLY_SPEC;
var _curLink = _rsMq;
function _loadReplySpec(ctx) {
  try {
    var raw = (ctx.engine && ctx.engine.getConfigValue) ? ctx.engine.getConfigValue('plugin.file-实用工具.reply') : null;
    if (raw) {
      var parsed = JSON.parse(String(raw));
      if (parsed && Array.isArray(parsed.branches) && parsed.branches.length) _curSpec = parsed;
    }
  } catch (e) { ctx.logger.warn('实用工具 ReplySpec config 解析失败，使用内置模板: ' + String(e && e.message || e)); }
  _curLink = function(t, c) { return (ctx.link && ctx.link.linkify) ? ctx.link.linkify(t, c) : _rsMq(t, c); };
}

module.exports = {
  manifest: {
    id: 'mod-utils',
    name: '实用工具',
    version: '1.2.1',
    description: '每日备注、每日打卡、设置昵称、图片天气、个人信息（头像卡）',
    author: '511742399'
  },

  methods: {
    handleCommand: async function(ctx, data) {
      try {
        var content = (data.content || '').trim().replace(/^\s*<@!?[A-F0-9]+>\s*/, '').trim();
        var userId = data.author.openid;
        var groupId = data.groupId;
        var msgId = data.id;

        var backBtn = function() {
          return { id: '实用功能', render_data: { label: '🛠 返回实用', visited_label: '返回实用', style: 0 }, action: { type: 2, data: '实用功能', enter: true, permission: { type: 2 } } };
        };
        var backRow = function() { return [backBtn()]; };

        var sendReply = async function(text, buttons) {
          try {
            await ctx.engine.callPlugin('主菜单', 'sendMessage', groupId, userId, msgId, text, buttons);
          } catch(e) {
            await ctx.bot.sendGroupMessage(groupId, text + '\n发送"实用功能"返回', msgId);
          }
        };

        // ===== ReplySpec 渲染 helper（baseData 键集同群主.js；动态值经 extra 注入，render 空时回落原文兜底）=====
        function baseData(msg) {
          var a = msg.author || {};
          var botId = msg.botId || '';
          var bName = (ctx.engine && ctx.engine.getBotNameById) ? (ctx.engine.getBotNameById(botId) || '') : '';
          return {
            botId: botId,
            botName: bName,
            botShow: (bName && bName !== botId) ? bName + '（' + botId + '）' : botId,
            gid: msg.groupId || '',
            openid: (a && (a.openid || a.id)) || msg.member_openid || '',
            qq: (a && a.qqId) || '',
            nick: (a && a.username) || ''
          };
        }
        function render(key, msg, extra) {
          var bd = baseData(msg);
          var d = {};
          for (var k in bd) if (Object.prototype.hasOwnProperty.call(bd, k)) d[k] = bd[k];
          if (extra) for (var e in extra) if (Object.prototype.hasOwnProperty.call(extra, e)) d[e] = extra[e];
          return rsRender(key, d, _curSpec, _curLink);
        }

        // ===== 每日备注 =====
        if (content === '每日备注' || content.indexOf('每日备注 ') === 0) {
          var today = new Date().toISOString().split('T')[0];
          var key = 'note_' + userId + '_' + today;
          if (content === '每日备注') {
            var existing = ctx.storage.get(key);
            if (existing) {
              await sendReply(render('noteView', data, { note: existing }) || ('📝 今日备注\n' + existing), [backRow()]);
            } else {
              await sendReply(render('noteEmpty', data) || '📝 今日暂无备注\n发送"每日备注 内容" 记录今天', [backRow()]);
            }
            return;
          }
          var note = content.substring(5).trim();
          if (!note) {
            await sendReply(render('noteSaveEmpty', data) || '📝 请填写备注内容\n格式：每日备注 今天的心情/日记', [backRow()]);
            return;
          }
          ctx.storage.set(key, note);
          await sendReply(render('noteSaved', data, { note: note }) || ('✅ 今日备注已保存！\n📝 ' + note), [backRow()]);
          return;
        }

        // ===== 每日打卡 =====
        if (content === '每日打卡') {
          var today = new Date().toISOString().split('T')[0];
          var key = 'checkin_util_' + userId + '_' + today;
          var streakKey = 'checkin_util_streak_' + userId;
          var totalKey = 'checkin_util_total_' + userId;

          if (ctx.storage.get(key)) {
            await sendReply(render('checkinDup', data) || '✅ 今天已经打过卡了！\n明天再来吧~', [backRow()]);
            return;
          }

          var yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          var yKey = 'checkin_util_' + userId + '_' + yesterday.toISOString().split('T')[0];
          var streak = parseInt(ctx.storage.get(streakKey) || '0');
          if (ctx.storage.get(yKey)) {
            streak += 1;
          } else {
            streak = 1;
          }
          var points = Math.floor(Math.random() * 50) + 10;
          if (streak >= 7) points += 20;
          if (streak >= 30) points += 50;

          var total = parseInt(ctx.storage.get(totalKey) || '0') + points;

          ctx.storage.set(key, '1');
          ctx.storage.set(streakKey, String(streak));
          ctx.storage.set(totalKey, String(total));

          var msg = '✅ 打卡成功！\n' +
            '获得积分：+' + points + '\n' +
            '累计积分：' + total + '\n' +
            '连续打卡：' + streak + ' 天';
          if (streak >= 7) msg += '\n🎉 连续7天奖励+20积分！';
          if (streak >= 30) msg += '\n🌟 满月奖励+50积分！';
          await sendReply(render('checkinOk', data, {
            points: points,
            total: total,
            streak: streak,
            reward7: (streak >= 7) ? '🎉 连续7天奖励+20积分！' : '',
            reward30: (streak >= 30) ? '🌟 满月奖励+50积分！' : ''
          }) || msg, [backRow()]);
          return;
        }

        // ===== 设置昵称 =====
        if (content === '设置昵称' || content.indexOf('设置昵称 ') === 0) {
          if (content === '设置昵称') {
            var current = ctx.storage.get('nickname_' + userId) || '未设置';
            await sendReply(render('nickView', data, { nick: current }) || ('✏️ 当前昵称：' + current + '\n发送"设置昵称 新昵称" 修改'), [backRow()]);
            return;
          }
          var nick = content.substring(5).trim();
          if (!nick || nick.length > 20) {
            await sendReply(render('nickErr', data) || '昵称长度1-20个字符', [backRow()]);
            return;
          }
          ctx.storage.set('nickname_' + userId, nick);
          await sendReply(render('nickSet', data, { nick: nick }) || ('✅ 昵称已设置为：' + nick), [backRow()]);
          return;
        }

         // ===== 查询天气 =====
         var isWeather = content === '查询天气' || content.indexOf('查询天气 ') === 0 || content === '天气' || content.indexOf('天气 ') === 0;
         if (isWeather) {
            if (content === '查询天气' || content === '天气') {
              await sendReply(render('weatherHelp', data) || '🌤 查询天气\n格式：查询天气 城市名\n例：查询天气 北京', [backRow()]);
              return;
            }
            var city = content.indexOf('查询天气 ') === 0 ? content.substring(5).trim() : content.substring(3).trim();
            if (!city) {
              await sendReply(render('weatherCityEmpty', data) || '🌤 请填写城市名\n格式：查询天气 城市名', [backRow()]);
              return;
            }
           try {
            var cityEnc = encodeURIComponent(city);
            var url = 'https://wttr.in/' + cityEnc + '?format=%C+%t+%h+%w&lang=zh';
            // 用 https 模块（原 http 模块请求 https 地址会报 Protocol "https:" not supported）
            var httpMod = require(url.indexOf('https:') === 0 ? 'https' : 'http');
            var result = await new Promise(function(resolve, reject) {
              httpMod.get(url, { headers: { 'User-Agent': 'curl/7.0' } }, function(res) {
                var body = '';
                res.on('data', function(c) { body += c; });
                res.on('end', function() { resolve(body.trim()); });
              }).on('error', reject);
            });
            if (result) {
              var parts = result.split(' ');
              var weather = parts[0] || '未知';
              var temp = parts[1] || '--';
              var humidity = parts[2] || '--';
              var wind = parts[3] || '--';
              // 发图片天气：wttr.in PNG 上传到群富媒体；失败则文本兜底
              var imgSent = false;
              try {
                if (groupId && ctx.bot.uploadGroupImage && ctx.bot.sendGroupImageMessage) {
                  var pngUrl = 'https://wttr.in/' + cityEnc + '_p.png';
                  var up = await ctx.bot.uploadGroupImage(groupId, pngUrl);
                  if (up && up.file_info) {
                    await ctx.bot.sendGroupImageMessage(groupId, up.file_info, msgId);
                    imgSent = true;
                  }
                }
              } catch(e2) { imgSent = false; }
              if (!imgSent) {
                // 文本兜底优先用本地增强天气接口（7天+空气质量+紫外线+日出日落+气压+能见度）
                var localText = null;
                try {
                  var lport = process.env.PORT || '3000';
                  var lmod = require('http');
                  localText = await new Promise(function(resolve, reject) {
                    var req = lmod.get('http://127.0.0.1:' + lport + '/api/bot/weather?city=' + encodeURIComponent(city), { headers: { 'User-Agent': 'curl/7.0' } }, function(res) {
                      var b = '';
                      res.on('data', function(c) { b += c; });
                      res.on('end', function() { resolve(b); });
                    });
                    req.on('error', reject);
                    req.setTimeout(6000, function() { req.destroy(new Error('timeout')); });
                  });
                } catch(e3) { localText = null; }
                if (localText) {
                  try {
                    var lj = JSON.parse(localText);
                    if (lj && lj.ok) {
                      var ldays = (lj.forecast7 && lj.forecast7.length) ? lj.forecast7 : (lj.forecast5 || []);
                      var lwd = ['日','一','二','三','四','五','六'];
                      var lt = '🌤 天气播报（' + (lj.city || city) + '）\n━━━━━━━━━━━━━━\n';
                      lt += '当前：' + (lj.desc || '-') + ' ' + (lj.temp != null ? lj.temp : '-') + '°C';
                      if (lj.feels) lt += '（体感' + lj.feels + '°C）';
                      if (lj.humidity) lt += ' 湿度' + lj.humidity + '%';
                      if (lj.wind) lt += ' ' + (lj.winddir || '') + (lj.windLevel || lj.wind || '') + '级';
                      lt += '\n';
                      if (lj.today) lt += lj.today + '\n';
                      if (lj.warnings && lj.warnings.length) lt += '⚠️ ' + (lj.warnings[0].type || '预警') + (lj.warnings[0].level || '') + '：' + String(lj.warnings[0].content || '').slice(0, 50) + '\n';
                      if (ldays.length) {
                        var extTips = [];
                        for (var xi = 0; xi < ldays.length; xi++) {
                          var xd = ldays[xi];
                          var xmx = Number(xd.maxT), xmn = Number(xd.minT), xdesc = String(xd.desc || '');
                          if (!isNaN(xmx) && xmx >= 35) extTips.push('高温' + xmx + '°C');
                          if (!isNaN(xmn) && xmn <= 0) extTips.push('低温' + xmn + '°C');
                          if (/雷暴/.test(xdesc)) extTips.push('雷暴');
                          if (/大雨|暴雨|强降雨/.test(xdesc)) extTips.push('强降雨');
                        }
                        if (extTips.length) lt += '⚠️ 极端天气提示：' + Array.from(new Set(extTips)).slice(0, 3).join('、') + '\n';
                        lt += '━━━━━━━━━━━━━━\n📅 未来' + ldays.length + '天\n';
                        for (var li = 0; li < ldays.length; li++) {
                          var lday = ldays[li];
                          var lw = new Date(String(lday.date || '')).getDay();
                          lt += (li === 0 ? '今天' : '周' + lwd[lw]) + ' ' + (lday.desc || '-') + ' ' + (lday.minT != null ? lday.minT : '?') + '~' + (lday.maxT != null ? lday.maxT : '?') + '°C\n';
                        }
                      }
                      var linfo = [];
                      if (lj.sunrise || lj.sunset) linfo.push('☀️ 日出' + (lj.sunrise || '-') + ' 日落' + (lj.sunset || '-'));
                      if (lj.air) linfo.push('😷 空气质量：' + (lj.air.level || '-') + ' ' + (lj.air.aqi || '-') + (lj.air.pm25 ? '（PM2.5 ' + lj.air.pm25 + '）' : ''));
                      if (lj.uvIndex) linfo.push('🌞 紫外线：' + (lj.uvLevel || '-') + ' ' + (lj.uvIndex || '-') + (lj.uvTip ? '，' + lj.uvTip : ''));
                      if (lj.pressure || lj.visibility) linfo.push('💨 气压' + (lj.pressure || '-') + 'hPa 能见度' + (lj.visibility || '-') + 'km');
                      if (linfo.length) lt += '━━━━━━━━━━━━━━\n' + linfo.join('\n') + '\n';
                      await sendReply(lt.replace(/\n+$/, ''), [backRow()]);
                      return;
                    }
                  } catch(e4) {}
                }
                await sendReply('🌤 ' + city + '天气\n' +
                  '天气：' + weather + '\n' +
                  '温度：' + temp + '\n' +
                  '湿度：' + humidity + '\n' +
                  '风力：' + wind, [backRow()]);
              }
            } else {
              await sendReply(render('weatherFail', data) || '❌ 查询失败，请检查城市名', [backRow()]);
            }
          } catch(e) {
            await sendReply(render('weatherErr', data, { msg: e.message }) || ('❌ 天气查询失败：' + e.message), [backRow()]);
          }
          return;
        }

        // ===== 个人信息（富媒体头像卡：engine.getUserProfile 本地聚合 + sendGroupMarkdownWithImage 发送头像） =====
        if (content === '个人信息') {
          var nickname = ctx.storage.get('nickname_' + userId) || '未设置';
          var total = ctx.storage.get('checkin_util_total_' + userId) || '0';
          var streak = ctx.storage.get('checkin_util_streak_' + userId) || '0';
          var today = new Date().toISOString().split('T')[0];
          var note = ctx.storage.get('note_' + userId + '_' + today) || '无';
          var lastCheckin = ctx.storage.get('checkin_util_' + userId + '_' + today) ? '已打卡' : '未打卡';

          // 后端聚合资料（与网页面板/菜单同源）：OpenID→QQ/昵称/头像/面板角色/授权角色
          var prof = null;
          try { prof = (ctx.engine && ctx.engine.getUserProfile) ? ctx.engine.getUserProfile(userId, 1) : null; } catch(e) {}
          var qq = (prof && prof.qq_number) || '';
          var uname = (prof && prof.nickname) || nickname;
          var avatar = (prof && prof.avatar) || '';
          var permRole = (prof && prof.permission) || '';
          var authRole = (prof && prof.auth_role) || '';
          var gName = '';
          try { gName = (ctx.engine && ctx.engine.getGroupName) ? ctx.engine.getGroupName(groupId) : ''; } catch(e) {}

          var permLabel = permRole || authRole || '普通用户';
          var authText = authRole ? ('已授权' + (authRole === permRole ? '' : ' · ' + authRole)) : (permRole ? '面板成员' : '未授权');

          var md = '# 👤 个人信息\n' +
            '![头像](__AVATAR__)\n' +
            '👥 所在群：' + (gName || '-') + '\n' +
            '👤 昵称：' + uname + '\n' +
            '🔢 QQ：' + (qq || '未绑定') + '\n' +
            '🆔 用户ID：' + userId + '\n' +
            '🔐 权限：' + permLabel + '\n' +
            '✅ 授权：' + authText + '\n' +
            '━━━━━━━━━━━━━━\n' +
            '📅 打卡：' + lastCheckin + ' · 连续 ' + streak + ' 天 · 积分 ' + total + '\n' +
            '📝 今日备注：' + note + '\n' +
            '━━━━━━━━━━━━━━\n' +
            '发送"实用功能"查看更多';
          // 头像富媒体发送（占位 __AVATAR__ 成功自动删除/失败替换为提示），无头像/失败也回退文本
          try {
            if (ctx.bot && ctx.bot.sendGroupMarkdownWithImage) {
              await ctx.bot.sendGroupMarkdownWithImage(groupId, md, avatar, msgId);
            } else {
              await ctx.bot.sendMarkdownGroup(groupId, md.replace(/!\[头像\]\(__AVATAR__\)\n?/g, ''), undefined, undefined, msgId);
            }
          } catch(e) {
            try { await ctx.bot.sendMarkdownGroup(groupId, md.replace(/!\[头像\]\(__AVATAR__\)\n?/g, ''), undefined, undefined, msgId); } catch(e2) {}
          }
          return;
        }

        await sendReply(render('fallback', data) || '❓ 未知指令\n发送"实用功能"查看所有实用工具', [backRow()]);
      } catch(e) {
        ctx.logger.error('实用工具错误: ' + e.message);
      }
    }
  },

  onEnable: function(ctx) {
    ctx.logger.info('实用工具 v1.2.1 已加载');
    _loadReplySpec(ctx);
  }
};