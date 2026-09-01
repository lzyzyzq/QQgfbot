// 群管理工具 v3.0.0 - 全禁/解禁/禁言/解禁/踢人
module.exports = {
  manifest: {
    id: 'mod-group-admin',
    name: '群管理工具',
    version: '3.0.0',
    description: '开启/关闭群全禁、禁言、解禁、踢人',
    author: '511742399'
  },

  methods: {
    _getSuperId: function(ctx) {
      var raw = ctx.storage.get('super_master_id') || '';
      try { var obj = JSON.parse(raw); return obj.id || ''; } catch(e) { return raw; }
    },
    _getMinis: function(ctx) {
      try { return JSON.parse(ctx.storage.get('mini_masters') || '[]'); } catch(e) { return []; }
    },
    _isAnyMaster: function(ctx, uid) {
      var superId = this._getSuperId(ctx);
      if (superId === uid) return true;
      try { if (superId && ctx.identity && ctx.identity.isSameUser && ctx.identity.isSameUser(superId, uid)) return true; } catch (e) {}
      var minis = this._getMinis(ctx);
      for (var i = 0; i < minis.length; i++) {
        if (!minis[i].activated) continue;
        if (minis[i].id === uid) return true;
        try { if (minis[i].id && ctx.identity && ctx.identity.isSameUser && ctx.identity.isSameUser(minis[i].id, uid)) return true; } catch (e) {}
      }
      return false;
    },
    _extractOpenid: function(text) {
      var m = text.match(/<@!?([A-F0-9]+)>/);
      return m ? m[1] : null;
    },
    // 解析禁言/解禁/踢人目标：优先 @openid → 纯数字QQ号反查 → 群内昵称匹配 → 原样（可能是openid）
    _resolveTarget: function(ctx, groupId, raw) {
      var s = String(raw || '').trim().replace(/^@/, '').replace(/<@!?([A-F0-9]+)>/, '$1');
      if (!s) return null;
      if (/^[A-F0-9]{20,}$/.test(s)) return s;
      if (/^\d{5,12}$/.test(s)) {
        try {
          if (ctx.engine && ctx.engine.resolveOpenidByQq) {
            var oid = ctx.engine.resolveOpenidByQq(s);
            if (oid) return oid;
          }
        } catch (e) {}
        return null;
      }
      try {
        if (ctx.engine && ctx.engine.getGroupMemberOpenidByNickname) {
          var o2 = ctx.engine.getGroupMemberOpenidByNickname(groupId, s);
          if (o2) return o2;
        }
      } catch (e) {}
      return null;
    },

    handleCommand: async function(ctx, data) {
      try {
        var content = (data.content || '').trim().replace(/^\s*<@!?[A-F0-9]+>\s*/, '').trim();
        var groupId = data.groupId;
        var userId = data.author.openid;
        var msgId = data.id;
        var self = this;

        var backBtn = function() {
          return { id: '群管系统', render_data: { label: '👥 返回群管', visited_label: '返回群管', style: 0 }, action: { type: 2, data: '群管系统', enter: true, permission: { type: 2 } } };
        };
        var backRow = function() { return [backBtn()]; };

        var sendReply = async function(text, buttons) {
          try {
            await ctx.engine.callPlugin('主菜单', 'sendMessage', groupId, userId, msgId, text, buttons);
          } catch(e) {
            await ctx.bot.sendGroupMessage(groupId, text + '\n发送"群管系统"返回', msgId);
          }
        };

        var parts = content.split(/\s+/);
        var action = parts[0];

        // ===== 权限检查 =====
        var isMaster = self._isAnyMaster(ctx, userId);

        // ===== 开启群全禁 =====
        if (action === '开启群全禁') {
          if (!isMaster) {
            await sendReply('⛔ 权限不足，仅主人可操作', [backRow()]);
            return;
          }
          ctx.storage.set('group_mute_' + groupId, '1');
          await sendReply('🔒 群全禁已开启\n仅管理员可发言', [backRow()]);
          return;
        }

        // ===== 关闭群全禁 =====
        if (action === '关闭群全禁') {
          if (!isMaster) {
            await sendReply('⛔ 权限不足，仅主人可操作', [backRow()]);
            return;
          }
          ctx.storage.set('group_mute_' + groupId, '0');
          await sendReply('🔓 群全禁已关闭\n所有人可发言', [backRow()]);
          return;
        }

        // ===== 禁言 =====
        if (action === '禁言') {
          if (!isMaster) {
            await sendReply('⛔ 权限不足，仅主人可操作', [backRow()]);
            return;
          }
          if (parts.length < 2) {
            await sendReply('🔇 禁言\n格式：禁言 @用户 分钟\n例：禁言 @小明 10', [backRow()]);
            return;
          }
          var target = self._resolveTarget(ctx, groupId, parts[1]);
          if (!target) {
            await sendReply('❌ 无法识别目标用户（支持 @成员 / QQ号 / 群昵称；QQ号需该用户绑定过）', [backRow()]);
            return;
          }
          var duration = parseInt(parts[2]) || 10;
          if (duration > 43200) { duration = 43200; }
          try {
            await ctx.bot.muteMember(groupId, target, duration * 60);
            await sendReply('✅ 已禁言 ' + duration + ' 分钟', [backRow()]);
          } catch(e) {
            await sendReply('❌ 禁言失败：' + e.message + '\n（机器人需为群主/管理员，且被禁言用户需有绑定记录）', [backRow()]);
          }
          return;
        }

        // ===== 解禁 =====
        if (action === '解禁') {
          if (!isMaster) {
            await sendReply('⛔ 权限不足，仅主人可操作', [backRow()]);
            return;
          }
          if (parts.length < 2) {
            await sendReply('🔊 解禁\n格式：解禁 @用户', [backRow()]);
            return;
          }
          var target2 = self._resolveTarget(ctx, groupId, parts[1]);
          if (!target2) {
            await sendReply('❌ 无法识别目标用户（支持 @成员 / QQ号 / 群昵称）', [backRow()]);
            return;
          }
          try {
            await ctx.bot.unmuteMember(groupId, target2);
            await sendReply('✅ 已解除禁言', [backRow()]);
          } catch(e) {
            await sendReply('❌ 解禁失败：' + e.message, [backRow()]);
          }
          return;
        }

        // ===== 踢人 =====
        if (action === '踢人') {
          if (!isMaster) {
            await sendReply('⛔ 权限不足，仅主人可操作', [backRow()]);
            return;
          }
          if (parts.length < 2) {
            await sendReply('👢 踢人\n格式：踢人 @用户', [backRow()]);
            return;
          }
          var target3 = self._resolveTarget(ctx, groupId, parts[1]);
          if (!target3) {
            await sendReply('❌ 无法识别目标用户（支持 @成员 / QQ号 / 群昵称）', [backRow()]);
            return;
          }
          try {
            await ctx.bot.kickMember(groupId, target3);
            await sendReply('✅ 已踢出', [backRow()]);
          } catch(e) {
            await sendReply('❌ 踢人失败：' + e.message + '\n（机器人需为群主/管理员，且被踢用户需有绑定记录）', [backRow()]);
          }
          return;
        }

        await sendReply('❓ 未知指令\n发送"群管系统"查看所有群管功能', [backRow()]);
      } catch(e) {
        ctx.logger.error('群管理工具错误: ' + e.message);
      }
    }
  },

  onEnable: function(ctx) {
    var self = this;

    // 监听消息，实现群全禁
    async function handleGroupMute(data) {
      if (!data.groupId) return;
      var mute = ctx.storage.get('group_mute_' + data.groupId);
      if (mute !== '1') return;

      var authorId = data.author && data.author.openid;
      if (!authorId) return;

      // 检查是否是管理员（主人）
      var isAdmin = self._isAnyMaster(ctx, authorId);
      if (!isAdmin) {
        // 非管理员消息被拦截
        try {
          await ctx.bot.sendGroupMessage(data.groupId, '🔒 当前群已开启全员禁言，仅管理员可发言', data.id);
        } catch(e) {}
        return;
      }
    }

    var muteId = ctx.eventBus.on('message.group', handleGroupMute);
    self._muteListenerId = muteId;

    ctx.logger.info('群管理工具 v3.0.0 已加载');
  },

  onDisable: function(ctx) {
    if (this._muteListenerId) {
      ctx.eventBus.off(this._muteListenerId);
      this._muteListenerId = null;
    }
    ctx.logger.info('群管理工具已禁用');
  }
};