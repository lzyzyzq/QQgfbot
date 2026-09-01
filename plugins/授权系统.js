// 授权系统 v1.0.0 - 激活码生成/激活
module.exports = {
  manifest: {
    id: 'mod-auth',
    name: '授权系统',
    version: '1.0.0',
    description: '获取激活码、激活授权码',
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
          return { id: '授权功能', render_data: { label: '🔐 返回授权', visited_label: '返回授权', style: 0 }, action: { type: 2, data: '授权功能', enter: true, permission: { type: 2 } } };
        };
        var backRow = function() { return [backBtn()]; };

        var sendReply = async function(text, buttons) {
          try {
            await ctx.engine.callPlugin('主菜单', 'sendMessage', groupId, userId, msgId, text, buttons);
          } catch(e) {
            await ctx.bot.sendGroupMessage(groupId, text + '\n发送"授权功能"返回', msgId);
          }
        };

        // 获取激活码（直接调用开关机控制的处理）
        if (content === '获取激活码') {
          await ctx.engine.callPlugin('开关机控制', 'handleCommand', data);
          return;
        }

        // 激活授权码
        if (content === '激活授权码' || content.indexOf('激活授权码 ') === 0) {
          await ctx.engine.callPlugin('开关机控制', 'handleCommand', data);
          return;
        }

        await sendReply('❓ 未知指令\n发送"授权功能"查看授权菜单', [backRow()]);
      } catch(e) {
        ctx.logger.error('授权系统错误: ' + e.message);
      }
    }
  },

  onEnable: function(ctx) {
    ctx.logger.info('授权系统 v1.0.0 已加载');
  }
};