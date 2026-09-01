// 群信息插件 v1.0.0 - 查看群的详细信息与活跃统计（数据看板卡片）
// 用法：群里发「群信息」/「群活跃」/「群数据」，机器人渲染并发送群活跃统计看板图片
module.exports = {
  manifest: {
    id: 'mod-group-info',
    name: '群信息',
    version: '1.0.0',
    description: '查看群的详细信息与活跃统计（成员数/消息数/活跃成员/加退群等数据看板）',
    author: '511742399',
  },

  onEnable: function(ctx) {
    ctx.logger.info('群信息插件已启用 v1.0.0');

    ctx.eventBus.on('message.group', async function(data) {
      try {
        var content = (data.content || '').trim().replace(/^\s*<@!?[A-F0-9]+>\s*/, '').trim();
        var groupId = data.groupId;
        var msgId = data.id;

        if (content !== '群信息' && content !== '群活跃' && content !== '群数据' && content !== '活跃统计') return;

        ctx.logger.info('群信息命令触发: group=' + groupId + ' user=' + (data.author && data.author.id));

        if (!ctx.bot.sendGroupDashboard) {
          ctx.logger.warn('sendGroupDashboard 不可用，请升级服务端');
          try { await ctx.bot.sendGroupMessage(groupId, '当前版本不支持群信息看板，请升级服务端'); } catch(e) {}
          return;
        }

        // 渲染耗时可能较长，先提示用户正在生成
        try { await ctx.bot.sendGroupMessage(groupId, '⏳ 正在生成群活跃统计看板...'); } catch(e) {}

        var ok = await ctx.bot.sendGroupDashboard(groupId, msgId);
        if (!ok) {
          try { await ctx.bot.sendGroupMessage(groupId, '❌ 群信息看板生成失败，请查看运行记录'); } catch(e) {}
        }
      } catch (e) {
        ctx.logger.error('群信息命令处理异常: ' + String(e && e.message || e));
      }
    });
  },
};
