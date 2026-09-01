module.exports = {
  manifest: {
    id: 'builtin-greeting',
    name: '问候插件',
    version: '1.0.0',
    description: '自动回复用户的问候消息',
    author: '系统'
  },

  onEnable: function(ctx) {
    ctx.logger.info('问候插件已启用');

    function handleMsg(data) {
      var content = (data.content || '').trim();
      var greetings = ['你好', 'hello', 'hi', '嗨', '在吗', '早上好', '下午好', '晚上好'];
      if (greetings.some(function(g) { return content.toLowerCase().includes(g.toLowerCase()); })) {
        var hour = new Date().getHours();
        var greeting = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
        if (data.channelId) {
          ctx.bot.sendMessage(data.channelId, greeting + '！有什么可以帮助你的吗？', data.id);
        } else if (data.groupId) {
          ctx.bot.sendGroupMessage(data.groupId, greeting + '！有什么可以帮助你的吗？', data.id);
        } else if (data.author && data.author.id) {
          ctx.bot.sendPrivateMessage(data.author.id, greeting + '！有什么可以帮助你的吗？', data.id);
        }
      }
    }

    ctx.eventBus.on('message.guild', handleMsg);
    ctx.eventBus.on('message.c2c', handleMsg);
    ctx.eventBus.on('message.group', handleMsg);
  },

  onDisable: function(ctx) {
    ctx.logger.info('问候插件已禁用');
  }
};
