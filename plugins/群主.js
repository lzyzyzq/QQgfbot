// 群主 v1.0.0 - 查询本群群主/群管理员：发送「群主 / 谁是群主 / 查群主 / 群主是谁」查看
// 数据源：群成员记录中 role IN ('owner','super') 的成员（引擎 findGroupOwner）
// @ts-nocheck
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
    var self = this;
    // 事件自监听：消息直接进入 handleCommand（标准 JS 插件消息入口）
    var h = function(data) { self.handleCommand(ctx, data).catch(function() {}); };
    ctx.eventBus.on('message.group', h);
    ctx.eventBus.on('message.c2c', h);
    ctx.eventBus.on('message.guild', h);
  },

  handleCommand: async function(ctx, data) {
    try {
      var content = String(data.content || '').replace(/^\s*(?:<@!?[A-Za-z0-9_\-]+>|@\S+)\s*/, '').trim();
      if (content !== '群主' && content !== '谁是群主' && content !== '查群主' && content !== '群主是谁' && content !== '群主信息') return;
      var groupId = data.groupId;
      if (!groupId) return;
      var msgId = data.id;
      var owner = null;
      try { if (ctx.engine && ctx.engine.findGroupOwner) owner = ctx.engine.findGroupOwner(groupId); } catch (e) {}
      if (!owner) {
        try { await ctx.bot.sendGroupMessage(groupId, '👑 尚未记录本群群主信息。\n请先让群主在群内发一条消息，机器人记录后即可查询。', msgId); } catch (e) {}
        return;
      }
      var roleText = owner.role === 'owner' ? '群主' : '群管理员';
      var lines = ['👑 ' + roleText + '信息'];
      lines.push('━━━━━━━━━━━━━━');
      lines.push('昵称：' + (owner.nickname || '未知'));
      if (owner.qq_id) lines.push('QQ：' + owner.qq_id);
      lines.push('角色：' + roleText);
      lines.push('━━━━━━━━━━━━━━');
      lines.push('发送「主菜单」查看更多');
      try { await ctx.bot.sendGroupMessage(groupId, lines.join('\n'), msgId); } catch (e) {}
    } catch (e) {
      ctx.logger.error('群主插件错误: ' + (e && e.message || e));
    }
  }
};
