// OpenID查询插件 v1.0.0 - 查询自己的 OpenID / 群 OpenID / 频道 OpenID，支持 @ 其他用户查询其 OpenID
// 用法：
//   群里发「OpenID查询」→ 返回你的 OpenID（含昵称/QQ/所属机器人）
//   群里发「OpenID查询 @xxx」→ 返回被 @ 用户的 OpenID（对方需在本群与机器人交互过）
//   群里发「群OpenID查询」→ 返回当前群的 OpenID（群OpenID/群id）
//   私聊发「OpenID查询」→ 返回你的 OpenID
//   频道里发「OpenID查询」/「频道OpenID查询」→ 返回频道 OpenID
// 说明：每个机器人下同一用户的 OpenID 不同，此命令用于跨机器人对账与身份识别
module.exports = {
  manifest: {
    id: 'mod-openid-query',
    name: 'OpenID查询',
    version: '1.0.0',
    description: '查询自己的 OpenID、群 OpenID、频道 OpenID，可 @ 其他用户查询其 OpenID（帮助多机器人 OpenID 对账与身份识别）',
    author: '511742399',
  },

  onEnable: function(ctx) {
    ctx.logger.info('OpenID查询插件已启用 v1.0.0');

    function normalize(content) {
      return (content || '').trim().replace(/^\s*<@!?[A-Fa-f0-9]+>\s*/, '').trim();
    }

    function selfOpenid(data) {
      var a = data.author || {};
      return a.openid || a.id || data.member_openid || '';
    }

    function botLine(botId) {
      if (!botId) return '';
      var name = (ctx.engine && ctx.engine.getBotNameById) ? ctx.engine.getBotNameById(botId) : '';
      if (name && name !== botId) return '所属机器人：' + name + '（' + botId + '）';
      return '所属机器人：' + botId;
    }

    // 群内回复：外显文字链接（mqqapi）需 markdown 才可点击，优先 sendMarkdownGroup，失败回退普通文本
    async function sendGroup(gid, text, msgId) {
      try {
        if (ctx.bot && ctx.bot.sendMarkdownGroup) {
          var r = await ctx.bot.sendMarkdownGroup(gid, text, msgId);
          if (r) return r;
        }
        return await ctx.bot.sendGroupMessage(gid, text, msgId);
      } catch (e) {
        ctx.logger.error('OpenID查询回复失败: ' + String(e && e.message || e));
        try { return await ctx.bot.sendGroupMessage(gid, text, msgId); } catch (e2) { ctx.logger.error('OpenID查询文本回复失败: ' + String(e2 && e2.message || e2)); }
        return null;
      }
    }

    // 提取消息中被 @ 的 openid（QQ 开放平台富文本 @ 格式 <@!xxxx> 或 <@xxxx>）
    function extractAtOpenids(content) {
      var ids = [];
      var re = /<@!?([A-Fa-f0-9]+)>/g;
      var m;
      while ((m = re.exec(content || '')) !== null) ids.push(m[1]);
      return ids;
    }

    function isQuery(content) {
      return content === 'OpenID查询' || content === 'openid查询' || content === '我的OpenID' || content === '我的openid';
    }
    function isGroupQuery(content) {
      return content === '群OpenID查询' || content === '群OpenID' || content === '群openid' || content === '频道OpenID查询' || content === '频道OpenID';
    }

    // ===== 群消息 =====
    ctx.eventBus.on('message.group', async function(data) {
      try {
        var content = normalize(data.content || '');
        var gid = data.groupId || data.channelId || '';
        var msgId = data.id;
        var myOpenid = selfOpenid(data);
        var a = data.author || {};
        var myQq = a.qqId || '';
        var myNick = a.username || '';

        if (isQuery(content)) {
          var lines = ['你的 OpenID：', myOpenid || '(未获取到，请确认已通过机器人所在群/私聊交互过)'];
          if (myQq) lines.push('QQ号：' + myQq);
          if (myNick) lines.push('昵称：' + myNick);
          var bl = botLine(data.botId);
          if (bl) lines.push(bl);
          lines.push('群 OpenID 请' + ctx.link.linkify('发送「群OpenID查询」', '群OpenID查询') + '');
          if (gid) await sendGroup(gid, lines.join('\n'), msgId);
          return;
        }

        if ((content === 'OpenID查询 @' || content.indexOf('OpenID查询 @') === 0 || content.indexOf('openid查询 @') === 0) && !isQuery(content)) {
          var ats = extractAtOpenids(content);
          if (ats.length === 0) {
            if (gid) await sendGroup(gid, '请 @ 一个用户来查询他的 OpenID，例如：OpenID查询 @张三');
            return;
          }
          var oLines = ['被 @ 用户' + (ats.length > 1 ? '们' : '') + '的 OpenID：'];
          for (var i = 0; i < ats.length; i++) oLines.push((i + 1) + '. ' + ats[i]);
          oLines.push('（每个机器人下 OpenID 不同，请在使用对应机器人的群内查询）');
          if (gid) await sendGroup(gid, oLines.join('\n'));
          return;
        }

        if (isGroupQuery(content)) {
          var gl = ['当前群 OpenID：', gid || '(未获取到)'];
          var bl2 = botLine(data.botId);
          if (bl2) gl.push(bl2);
          gl.push('你的 OpenID 请' + ctx.link.linkify('发送「OpenID查询」', 'OpenID查询') + '');
          if (gid) await sendGroup(gid, gl.join('\n'));
          return;
        }
      } catch (e) {
        ctx.logger.error('OpenID查询插件处理异常: ' + String(e && e.message || e));
      }
    });

    // ===== 频道消息（message.guild）=====
    ctx.eventBus.on('message.guild', async function(data) {
      try {
        var content = normalize(data.content || '');
        var channelId = data.channelId || '';
        var myOpenid = selfOpenid(data);
        var a = data.author || {};

        if (isQuery(content)) {
          var lines = ['你的 OpenID：', myOpenid || '(未获取到)'];
          if (a.username) lines.push('昵称：' + a.username);
          var bl = botLine(data.botId);
          if (bl) lines.push(bl);
          if (channelId) {
            try { await ctx.bot.sendChannelMessage(channelId, { content: lines.join('\n') }); }
            catch(e) { try { await ctx.bot.sendMessage(channelId, lines.join('\n')); } catch(e2) { ctx.logger.error('频道回复失败: ' + String(e2 && e2.message || e2)); } }
          }
          return;
        }

        if (isGroupQuery(content)) {
          var gl = ['当前频道 OpenID：', channelId || '(未获取到)', '频道ID：' + (data.guildId || '-')];
          var bl2 = botLine(data.botId);
          if (bl2) gl.push(bl2);
          if (channelId) {
            try { await ctx.bot.sendChannelMessage(channelId, { content: gl.join('\n') }); }
            catch(e) { try { await ctx.bot.sendMessage(channelId, gl.join('\n')); } catch(e2) { ctx.logger.error('频道回复失败: ' + String(e2 && e2.message || e2)); } }
          }
          return;
        }
      } catch (e) {
        ctx.logger.error('OpenID查询插件频道处理异常: ' + String(e && e.message || e));
      }
    });

    // ===== 私聊消息（message.c2c）=====
    ctx.eventBus.on('message.c2c', async function(data) {
      try {
        var content = normalize(data.content || '');
        var myOpenid = selfOpenid(data);
        var a = data.author || {};
        if (isQuery(content)) {
          var lines = ['你的 OpenID：', myOpenid || '(未获取到)'];
          if (a.username) lines.push('昵称：' + a.username);
          var bl = botLine(data.botId);
          if (bl) lines.push(bl);
          if (myOpenid) {
            try { await ctx.bot.sendPrivateMessage(myOpenid, lines.join('\n')); } catch(e) { ctx.logger.error('私聊回复失败: ' + String(e && e.message || e)); }
          }
          return;
        }
      } catch (e) {
        ctx.logger.error('OpenID查询插件私聊处理异常: ' + String(e && e.message || e));
      }
    });
  },
};
