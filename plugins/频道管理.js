// 频道管理 v1.0.0 - 频道列表/详情/发送/成员/撤回/权限（框架，仅超级主人可操作）
module.exports = {
  manifest: {
    id: 'mod-channel-admin',
    name: '频道管理',
    version: '1.0.0',
    description: '频道列表、详情、发消息、成员查看、撤回、权限设置',
    author: '511742399'
  },

  methods: {
    _getSuperId: function(ctx) {
      var raw = ctx.storage.get('super_master_id') || '';
      try { var obj = JSON.parse(raw); return obj.id || ''; } catch(e) { return raw; }
    },
    _isSuper: function(ctx, uid) {
      var superId = this._getSuperId(ctx);
      if (!superId) return false;
      if (superId === uid) return true;
      try { return !!(ctx.identity && ctx.identity.isSameUser && ctx.identity.isSameUser(superId, uid)); } catch(e) { return false; }
    },

    handleCommand: async function(ctx, data) {
      try {
        var content = (data.content || '').trim().replace(/^\s*<@!?[A-F0-9]+>\s*/, '').trim();
        var groupId = data.groupId;
        var userId = data.author.openid;
        var msgId = data.id;
        var self = this;

        var backBtn = function() {
          return { id: '设置功能', render_data: { label: '⚙️ 返回设置', visited_label: '返回设置', style: 0 }, action: { type: 2, data: '设置功能', enter: true, permission: { type: 2 } } };
        };
        var backRow = function() { return [backBtn()]; };

        var sendReply = async function(text, buttons) {
          try {
            await ctx.engine.callPlugin('主菜单', 'sendMessage', groupId, userId, msgId, text, buttons);
          } catch(e) {
            await ctx.bot.sendGroupMessage(groupId, text + '\n发送"设置功能"返回', msgId);
          }
        };

        var parts = content.split(/\s+/);
        var action = parts[0];

        if (!self._isSuper(ctx, userId)) {
          await sendReply('⛔ 仅超级主人可操作', [backRow()]);
          return;
        }

        if (action === '频道管理') {
          var help = '📢 频道管理\n═══════════════\n' +
            '• 频道管理 列表 - 频道列表\n' +
            '• 频道管理 详情 频道ID - 频道详情\n' +
            '• 频道管理 子频道 频道ID - 子频道列表\n' +
            '• 频道管理 发送 频道ID 消息内容 - 发文字\n' +
            '• 频道管理 图片 频道ID 图片URL - 发图片\n' +
            '• 频道管理 撤回 频道ID 消息ID - 撤回消息\n' +
            '• 频道管理 成员 频道ID - 成员列表\n' +
            '• 频道管理 权限 频道ID 用户ID 权限码 1/0 - 授权/收回';
          await sendReply(help, [backRow()]);
          return;
        }

        if (parts.length >= 2 && parts[0] === '频道管理') {
          var sub = parts[1];
          var arg = parts[2] || '';

          if (sub === '列表') {
            var guilds = await ctx.bot.getGuilds();
            if (!guilds || guilds.length === 0) {
              await sendReply('📭 暂无频道列表\n（需要机器人已加入频道且有权限）', [backRow()]);
              return;
            }
            var lines = guilds.slice(0, 20).map(function(g, i) {
              return (i + 1) + '. ' + (g.name || '未命名') + '（' + g.id + '）';
            });
            await sendReply('📢 频道列表\n═══════════════\n' + lines.join('\n'), [backRow()]);
            return;
          }

          if (sub === '详情') {
            if (!arg) { await sendReply('格式：频道管理 详情 频道ID', [backRow()]); return; }
            var g = await ctx.bot.getGuildDetail(arg);
            if (!g) { await sendReply('❌ 获取频道详情失败', [backRow()]); return; }
            await sendReply('📢 频道详情\n═══════════════\n名称：' + (g.name || '未命名') + '\nID：' + g.id + '\n描述：' + (g.description || '-'), [backRow()]);
            return;
          }

          if (sub === '子频道') {
            if (!arg) { await sendReply('格式：频道管理 子频道 频道ID', [backRow()]); return; }
            var channels = await ctx.bot.getChannels(arg);
            if (!channels || channels.length === 0) {
              await sendReply('📭 暂无子频道或获取失败', [backRow()]);
              return;
            }
            var clines = channels.slice(0, 20).map(function(c, i) {
              return (i + 1) + '. ' + (c.name || '未命名') + '（' + c.id + '）';
            });
            await sendReply('📢 子频道列表\n═══════════════\n' + clines.join('\n'), [backRow()]);
            return;
          }

          if (sub === '发送') {
            if (parts.length < 4) { await sendReply('格式：频道管理 发送 频道ID 消息内容', [backRow()]); return; }
            var cid = parts[2];
            var text = parts.slice(3).join(' ');
            try {
              await ctx.bot.sendMessage(cid, text);
              await sendReply('✅ 频道消息已发送', [backRow()]);
            } catch(e) {
              await sendReply('❌ 发送失败：' + e.message, [backRow()]);
            }
            return;
          }

          if (sub === '图片') {
            if (parts.length < 4) { await sendReply('格式：频道管理 图片 频道ID 图片URL', [backRow()]); return; }
            var cid2 = parts[2];
            var img = parts[3];
            try {
              await ctx.bot.sendImageMessage(cid2, img);
              await sendReply('✅ 频道图片已发送', [backRow()]);
            } catch(e) {
              await sendReply('❌ 发送失败：' + e.message, [backRow()]);
            }
            return;
          }

          if (sub === '撤回') {
            if (parts.length < 4) { await sendReply('格式：频道管理 撤回 频道ID 消息ID', [backRow()]); return; }
            var cid3 = parts[2];
            var mid = parts[3];
            try {
              await ctx.bot.deleteChannelMessage(cid3, mid);
              await sendReply('✅ 频道消息已撤回', [backRow()]);
            } catch(e) {
              await sendReply('❌ 撤回失败：' + e.message, [backRow()]);
            }
            return;
          }

          if (sub === '成员') {
            if (!arg) { await sendReply('格式：频道管理 成员 频道ID', [backRow()]); return; }
            var members = await ctx.bot.getChannelMembers(arg);
            if (!members || members.length === 0) {
              await sendReply('📭 暂无成员或获取失败\n（需要机器人为频道管理员）', [backRow()]);
              return;
            }
            var mlines = members.slice(0, 20).map(function(m, i) {
              return (i + 1) + '. ' + (m.nick || m.username || '成员') + '（' + (m.user && m.user.id || m.id || '?') + '）';
            });
            await sendReply('👥 频道成员\n═══════════════\n' + mlines.join('\n'), [backRow()]);
            return;
          }

          if (sub === '权限') {
            if (parts.length < 6) { await sendReply('格式：频道管理 权限 频道ID 用户ID 权限码 1/0\n例：频道管理 权限 12345 USERID 1024 1', [backRow()]); return; }
            var cid4 = parts[2];
            var uid4 = parts[3];
            var bit = parseInt(parts[4]);
            var add = parts[5] === '1';
            if (isNaN(bit)) { await sendReply('❌ 权限码必须是数字', [backRow()]); return; }
            try {
              await ctx.bot.setChannelUserPermission(cid4, uid4, bit, add);
              await sendReply('✅ 频道用户权限已' + (add ? '授权' : '收回'), [backRow()]);
            } catch(e) {
              await sendReply('❌ 权限设置失败：' + e.message, [backRow()]);
            }
            return;
          }

          await sendReply('❓ 未知频道命令\n发送"频道管理"查看帮助', [backRow()]);
          return;
        }

        await sendReply('❓ 未知指令\n发送"频道管理"查看帮助', [backRow()]);
      } catch(e) {
        ctx.logger.error('频道管理错误: ' + e.message);
      }
    }
  },

  onEnable: function(ctx) {
    ctx.logger.info('频道管理 v1.0.0 已加载');
  }
};
