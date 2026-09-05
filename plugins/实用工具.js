// 实用工具 v1.2.1 - 每日备注/打卡/昵称/天气/个人信息（富媒体头像卡）
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

        // ===== 每日备注 =====
        if (content === '每日备注' || content.indexOf('每日备注 ') === 0) {
          var today = new Date().toISOString().split('T')[0];
          var key = 'note_' + userId + '_' + today;
          if (content === '每日备注') {
            var existing = ctx.storage.get(key);
            if (existing) {
              await sendReply('📝 今日备注\n' + existing, [backRow()]);
            } else {
              await sendReply('📝 今日暂无备注\n发送"每日备注 内容" 记录今天', [backRow()]);
            }
            return;
          }
          var note = content.substring(5).trim();
          if (!note) {
            await sendReply('📝 请填写备注内容\n格式：每日备注 今天的心情/日记', [backRow()]);
            return;
          }
          ctx.storage.set(key, note);
          await sendReply('✅ 今日备注已保存！\n📝 ' + note, [backRow()]);
          return;
        }

        // ===== 每日打卡 =====
        if (content === '每日打卡') {
          var today = new Date().toISOString().split('T')[0];
          var key = 'checkin_util_' + userId + '_' + today;
          var streakKey = 'checkin_util_streak_' + userId;
          var totalKey = 'checkin_util_total_' + userId;

          if (ctx.storage.get(key)) {
            await sendReply('✅ 今天已经打过卡了！\n明天再来吧~', [backRow()]);
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
          await sendReply(msg, [backRow()]);
          return;
        }

        // ===== 设置昵称 =====
        if (content === '设置昵称' || content.indexOf('设置昵称 ') === 0) {
          if (content === '设置昵称') {
            var current = ctx.storage.get('nickname_' + userId) || '未设置';
            await sendReply('✏️ 当前昵称：' + current + '\n发送"设置昵称 新昵称" 修改', [backRow()]);
            return;
          }
          var nick = content.substring(5).trim();
          if (!nick || nick.length > 20) {
            await sendReply('昵称长度1-20个字符', [backRow()]);
            return;
          }
          ctx.storage.set('nickname_' + userId, nick);
          await sendReply('✅ 昵称已设置为：' + nick, [backRow()]);
          return;
        }

         // ===== 查询天气 =====
         var isWeather = content === '查询天气' || content.indexOf('查询天气 ') === 0 || content === '天气' || content.indexOf('天气 ') === 0;
         if (isWeather) {
           if (content === '查询天气' || content === '天气') {
             await sendReply('🌤 查询天气\n格式：查询天气 城市名\n例：查询天气 北京', [backRow()]);
             return;
           }
           var city = content.indexOf('查询天气 ') === 0 ? content.substring(5).trim() : content.substring(3).trim();
           if (!city) {
             await sendReply('🌤 请填写城市名\n格式：查询天气 城市名', [backRow()]);
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
              await sendReply('❌ 查询失败，请检查城市名', [backRow()]);
            }
          } catch(e) {
            await sendReply('❌ 天气查询失败：' + e.message, [backRow()]);
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

        await sendReply('❓ 未知指令\n发送"实用功能"查看所有实用工具', [backRow()]);
      } catch(e) {
        ctx.logger.error('实用工具错误: ' + e.message);
      }
    }
  },

  onEnable: function(ctx) {
    ctx.logger.info('实用工具 v1.2.1 已加载');
  }
};