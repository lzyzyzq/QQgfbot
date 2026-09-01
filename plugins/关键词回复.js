module.exports = {
  manifest: {
    id: 'builtin-keyword',
    name: '关键词回复',
    version: '1.0.0',
    description: '根据关键词自动回复消息',
    author: 'System'
  },
  onEnable: function(ctx) {
    ctx.logger.info('关键词回复插件已启用');
    ctx.eventBus.on('message.guild', async function(data) {
      const content = (data.content || '').trim();
      if (!content) return;
      var keys = ['帮助', 'help', '菜单', 'menu'];
      for (var i = 0; i < keys.length; i++) {
        if (content.includes(keys[i])) {
          await ctx.bot.sendMessage(data.channelId, '你好！常用命令：\n- 签到\n- 个人信息\n- 词典\n- 插件列表', data.id);
          return;
        }
      }
    });
  },
  onDisable: function(ctx) { ctx.logger.info('关键词回复插件已禁用'); }
};
