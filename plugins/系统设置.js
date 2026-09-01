// 系统设置 v1.0.0 - 定时关机/整点提醒/撤回/管理频道/群成员管理/发布群公告
module.exports = {
  manifest: {
    id: 'mod-sys-settings',
    name: '系统设置',
    version: '1.0.0',
    description: '定时关机、整点提醒、撤回信息、管理频道、群成员管理、发布群公告',
    author: '511742399'
  },

  methods: {
    _isSuper: function(ctx, userId) {
      var raw = ctx.storage.get('super_master_id') || '';
      var superId = '';
      try { var obj = JSON.parse(raw); superId = obj.id || ''; } catch(e) { superId = raw; }
      if (!superId) return false;
      if (superId === userId) return true;
      try { return !!(ctx.identity && ctx.identity.isSameUser && ctx.identity.isSameUser(superId, userId)); } catch(e) { return false; }
    },

    // 获取AccessToken（复用bot逻辑，但bot未暴露，故重新获取）
    _getAccessToken: async function(ctx) {
      var appId = ctx.storage.get('bot_app_id') || '';
      var appSecret = ctx.storage.get('bot_app_secret') || '';
      if (!appId || !appSecret) {
        // 尝试从数据库config读取
        var db = require('better-sqlite3')(process.cwd() + '/data/bot.db', { readonly: true });
        var row = db.prepare("SELECT value FROM config WHERE key = 'bot.app_id'").get();
        if (row) appId = row.value;
        row = db.prepare("SELECT value FROM config WHERE key = 'bot.app_secret'").get();
        if (row) appSecret = row.value;
        db.close();
      }
      if (!appId || !appSecret) throw new Error('未配置机器人AppID和AppSecret');
      var https = require('https');
      var postData = JSON.stringify({ appId: appId, clientSecret: appSecret });
      var result = await new Promise((resolve, reject) => {
        var req = https.request({
          hostname: 'bots.qq.com',
          path: '/app/getAppAccessToken',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
        }, (res) => {
          var data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => {
            try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
          });
        });
        req.on('error', reject);
        req.write(postData);
        req.end();
      });
      if (!result.access_token) throw new Error('获取AccessToken失败');
      return result.access_token;
    },

    handleCommand: async function(ctx, data) {
      try {
        var content = (data.content || '').trim().replace(/^\s*<@!?[A-F0-9]+>\s*/, '').trim();
        var userId = data.author.openid;
        var groupId = data.groupId;
        var msgId = data.id;
        var self = this;

        var backBtn = function() {
          return { id: '设置功能', render_data: { label: '🔧 返回设置', visited_label: '返回设置', style: 0 }, action: { type: 2, data: '设置功能', enter: true, permission: { type: 2 } } };
        };
        var backRow = function() { return [backBtn()]; };

        var sendReply = async function(text, buttons) {
          try {
            await ctx.engine.callPlugin('主菜单', 'sendMessage', groupId, userId, msgId, text, buttons);
          } catch(e) {
            await ctx.bot.sendGroupMessage(groupId, text + '\n发送"设置功能"返回', msgId);
          }
        };

        var isSuper = self._isSuper(ctx, userId);

        // ===== 设置定时关机 =====
        if (content === '设置定时关机' || content.indexOf('设置定时关机 ') === 0) {
          if (!isSuper) {
            await sendReply('⛔ 仅超级主人可操作', [backRow()]);
            return;
          }
          if (content === '设置定时关机') {
            var current = ctx.storage.get('shutdown_time') || '未设置';
            await sendReply('⏰ 定时关机\n当前设置：' + current + '\n格式：设置定时关机 HH:MM\n例：设置定时关机 23:00', [backRow()]);
            return;
          }
          var time = content.substring(7).trim();
          if (!/^\d{1,2}:\d{2}$/.test(time)) {
            await sendReply('❌ 格式错误\n格式：设置定时关机 HH:MM\n例：设置定时关机 23:00', [backRow()]);
            return;
          }
          ctx.storage.set('shutdown_time', time);
          await sendReply('✅ 已设置定时关机：' + time, [backRow()]);
          return;
        }

        // ===== 整点提醒 =====
        if (content === '整点提醒' || content.indexOf('整点提醒 ') === 0) {
          if (!isSuper) {
            await sendReply('⛔ 仅超级主人可操作', [backRow()]);
            return;
          }
          if (content === '整点提醒') {
            var currentTip = ctx.storage.get('hourly_tip') || '未设置';
            await sendReply('🔔 整点提醒\n当前内容：' + currentTip + '\n格式：整点提醒 提醒内容', [backRow()]);
            return;
          }
          var tip = content.substring(5).trim();
          if (!tip) {
            await sendReply('请填写提醒内容', [backRow()]);
            return;
          }
          ctx.storage.set('hourly_tip', tip);
          await sendReply('✅ 整点提醒已设置：' + tip, [backRow()]);
          return;
        }

        // ===== 撤回信息 =====
        if (content === '撤回信息' || content.indexOf('撤回信息 ') === 0) {
          if (!isSuper) {
            await sendReply('⛔ 仅超级主人可操作', [backRow()]);
            return;
          }
          if (content === '撤回信息') {
            await sendReply('↩️ 撤回信息\n格式：撤回信息 消息ID\n（消息ID从发送消息的返回值或事件中获取，仅可撤回机器人自己发送的消息，且需在2分钟内）', [backRow()]);
            return;
          }
          var msgIdToRecall = content.substring(5).trim();
          if (!msgIdToRecall) {
            await sendReply('❌ 请提供消息ID', [backRow()]);
            return;
          }
          try {
            // 获取access token
            var token = await self._getAccessToken(ctx);
            var https = require('https');
            var path = '/v2/groups/' + groupId + '/messages/' + msgIdToRecall;
            var result = await new Promise((resolve, reject) => {
              var req = https.request({
                hostname: 'api.sgroup.qq.com',
                path: path,
                method: 'DELETE',
                headers: { 'Authorization': 'QQBot ' + token }
              }, (res) => {
                var data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                  if (res.statusCode >= 400) reject(new Error('HTTP ' + res.statusCode + ': ' + data));
                  else resolve(data);
                });
              });
              req.on('error', reject);
              req.end();
            });
            await sendReply('✅ 消息已撤回', [backRow()]);
          } catch(e) {
            await sendReply('❌ 撤回失败：' + e.message + '\n请确保机器人有管理员权限且消息在2分钟内', [backRow()]);
          }
          return;
        }

        // ===== 管理频道 =====
        if (content === '管理频道' || content.indexOf('管理频道 ') === 0) {
          if (!isSuper) {
            await sendReply('⛔ 仅超级主人可操作', [backRow()]);
            return;
          }
          if (content === '管理频道') {
            await sendReply('📢 管理频道\n格式：管理频道 频道ID 消息内容', [backRow()]);
            return;
          }
          var parts = content.split(/\s+/);
          if (parts.length < 3) {
            await sendReply('格式：管理频道 频道ID 消息内容', [backRow()]);
            return;
          }
          var channelId = parts[1];
          var msgContent = parts.slice(2).join(' ');
          try {
            await ctx.bot.sendMessage(channelId, msgContent);
            await sendReply('✅ 频道消息已发送', [backRow()]);
          } catch(e) {
            await sendReply('❌ 发送失败：' + e.message, [backRow()]);
          }
          return;
        }

        // ===== 群成员管理（原“管理频道人员”） =====
        if (content === '管理频道人员' || content.indexOf('管理频道人员 ') === 0) {
          if (!isSuper) {
            await sendReply('⛔ 仅超级主人可操作', [backRow()]);
            return;
          }
          if (content === '管理频道人员') {
            var help = '👥 群成员管理\n' +
              '• 禁言：管理频道人员 禁言 @用户 分钟\n' +
              '• 解禁：管理频道人员 解禁 @用户\n' +
              '• 踢人：管理频道人员 踢人 @用户\n' +
              '（也可直接使用群管系统的对应命令）';
            await sendReply(help, [backRow()]);
            return;
          }
          var parts2 = content.split(/\s+/);
          var subCmd = parts2[1] || '';
          if (subCmd === '禁言' && parts2.length >= 4) {
            var target = parts2[2].replace(/<@!?([A-F0-9]+)>/, '$1');
            var duration = parseInt(parts2[3]) || 10;
            try {
              await ctx.bot.muteMember(groupId, target, duration * 60);
              await sendReply('✅ 已禁言 ' + duration + ' 分钟', [backRow()]);
            } catch(e) {
              await sendReply('❌ 禁言失败：' + e.message, [backRow()]);
            }
            return;
          } else if (subCmd === '解禁' && parts2.length >= 3) {
            var target2 = parts2[2].replace(/<@!?([A-F0-9]+)>/, '$1');
            try {
              await ctx.bot.unmuteMember(groupId, target2);
              await sendReply('✅ 已解除禁言', [backRow()]);
            } catch(e) {
              await sendReply('❌ 解禁失败：' + e.message, [backRow()]);
            }
            return;
          } else if (subCmd === '踢人' && parts2.length >= 3) {
            var target3 = parts2[2].replace(/<@!?([A-F0-9]+)>/, '$1');
            try {
              await ctx.bot.kickMember(groupId, target3);
              await sendReply('✅ 已踢出', [backRow()]);
            } catch(e) {
              await sendReply('❌ 踢人失败：' + e.message, [backRow()]);
            }
            return;
          } else {
            await sendReply('❌ 格式错误\n请使用：管理频道人员 禁言/解禁/踢人 @用户 [分钟]', [backRow()]);
            return;
          }
        }

        // ===== 发布群公告 =====
        if (content === '发布群公告' || content.indexOf('发布群公告 ') === 0) {
          if (!isSuper) {
            await sendReply('⛔ 仅超级主人可操作', [backRow()]);
            return;
          }
          if (content === '发布群公告') {
            await sendReply('📰 发布群公告\n格式：发布群公告 公告内容', [backRow()]);
            return;
          }
          var announce = content.substring(6).trim();
          if (!announce) {
            await sendReply('请填写公告内容', [backRow()]);
            return;
          }
          try {
            await ctx.bot.setAnnouncement(groupId, announce);
            await sendReply('✅ 公告已发布！', [backRow()]);
          } catch(e) {
            await sendReply('❌ 发布失败：' + e.message + '\n机器人需要管理员权限', [backRow()]);
          }
          return;
        }

        // ===== 删除群公告 =====
        if (content === '删除群公告' || content.indexOf('删除群公告 ') === 0) {
          if (!isSuper) {
            await sendReply('⛔ 仅超级主人可操作', [backRow()]);
            return;
          }
          if (content === '删除群公告') {
            var annList = await ctx.bot.getAnnouncements(groupId);
            if (!annList || annList.length === 0) {
              await sendReply('📭 当前群暂无公告\n格式：删除群公告 公告ID', [backRow()]);
              return;
            }
            var alines = annList.slice(0, 10).map(function(a, i) {
              var txt = (a.content || a.title || '').substring(0, 20);
              return (i + 1) + '. ' + txt + '\n   ID：' + a.announcement_id;
            });
            await sendReply('📰 当前群公告列表\n═══════════════\n' + alines.join('\n') + '\n\n格式：删除群公告 公告ID', [backRow()]);
            return;
          }
          var annId = content.substring(6).trim();
          if (!annId) {
            await sendReply('请填写公告ID\n格式：删除群公告 公告ID', [backRow()]);
            return;
          }
          try {
            await ctx.bot.deleteAnnouncement(groupId, annId);
            await sendReply('✅ 公告已删除！', [backRow()]);
          } catch(e) {
            await sendReply('❌ 删除失败：' + e.message, [backRow()]);
          }
          return;
        }

        await sendReply('❓ 未知指令\n发送"设置功能"查看所有设置', [backRow()]);
      } catch(e) {
        ctx.logger.error('系统设置错误: ' + e.message);
      }
    }
  },

  onEnable: function(ctx) {
    ctx.logger.info('系统设置 v1.0.0 已加载');
  }
};