// 绑定管理 v1.1.0 - 群内绑定QQ号 / 绑定QQ群号 / 群主绑定指定用户
// 用法：
//   群里发「绑定QQ 123456789」→ 把当前 OpenID 绑定到 QQ 号（跨机器人身份识别）
//   群里发「绑定QQ群 123456789」→ 群主/管理员把当前群绑定到数字群号（成员行自动带群号）
//   群里发「绑定用户 123456789 <OpenID>」→ 群主/管理员把指定 OpenID 绑定到 QQ 号（用户本人不便操作时用）
//   私聊发「绑定QQ 123456789」→ 同样可绑定自己的 QQ 号
module.exports = {
  manifest: {
    id: 'mod-bind-manage',
    name: '绑定管理',
    version: '1.1.0',
    description: '绑定QQ：OpenID 绑定到 QQ 号；绑定QQ群：把当前群绑定到数字群号；绑定用户：群主/管理员给指定用户绑定（QQ+OpenID）',
    author: '511742399'
  },

  methods: {
    handle: async function(ctx, data) {
      var content = (data.content || '').trim().replace(/^\s*<@!?[A-Fa-f0-9]+>\s*/, '').trim();
      var openid = (data.author && data.author.openid) || '';
      var nickname = (data.author && data.author.username) || '';
      var gid = data.groupId || '';
      var msgId = data.id;

      var reply = async function(text) {
        try {
          if (gid) {
            // 外显文字链接（mqqapi）需 markdown 才可点击，优先 sendMarkdownGroup，失败回退普通文本
            if (ctx.bot.sendMarkdownGroup) {
              var r = await ctx.bot.sendMarkdownGroup(gid, text, msgId);
              if (r) return r;
            }
            return await ctx.bot.sendGroupMessage(gid, text, msgId);
          }
          else if (openid) await ctx.bot.sendPrivateMessage(openid, text, msgId);
        } catch (e) {
          ctx.logger.error('绑定管理回复失败: ' + String(e && e.message || e));
          try { if (gid) await ctx.bot.sendGroupMessage(gid, text, msgId); } catch (e2) { ctx.logger.error('绑定管理文本回复失败: ' + String(e2 && e2.message || e2)); }
        }
      };

      // 当前机器人标识（OpenID 绑定按机器人隔离，提示绑定发生在哪个机器人下）
      var botTag = function() {
        var b = (data && data.botId) || '';
        if (!b) return '';
        var name = (ctx.engine && ctx.engine.getBotNameById) ? ctx.engine.getBotNameById(b) : '';
        if (name && name !== b) return '｜机器人：' + name + '（' + b + '）';
        return '｜机器人：' + b;
      };

      var mBindQQ = content === '绑定QQ' || content === '绑定qq';
      var mBindQQPre = content.indexOf('绑定QQ ') === 0 || content.indexOf('绑定qq ') === 0;
      var mBindGroup = content === '绑定QQ群' || content === '绑定qq群';
      var mBindGroupPre = content.indexOf('绑定QQ群 ') === 0 || content.indexOf('绑定qq群 ') === 0;
      var mUnbind = content === '解绑QQ' || content === '解绑qq' || content === '解绑绑定';
      var mBindUserHelp = content === '绑定用户' || content === '绑定指定用户';
      var mBindUser = content.indexOf('绑定用户 ') === 0;

      if (mUnbind) {
        var ures = ctx.engine.unbindUser ? ctx.engine.unbindUser(openid) : null;
        await reply(ures && ures.ok ? '✅ 已解绑当前 OpenID 的 QQ 绑定' + botTag() : '❌ 解绑失败：' + ((ures && ures.error) || '无解绑权限或未绑定'));
        return true;
      }

      if (mBindUserHelp) {
        await reply('👤 绑定指定用户\n发送「绑定用户 QQ号 OpenID」\n例：绑定用户 123456789 ' + (openid || 'abc...DEF') + '\n仅群主/管理员可操作，用于帮成员绑定身份（成员不便操作时使用）\nOpenID 可通过成员' + ctx.link.linkify('发送「OpenID查询」', 'OpenID查询') + '获取');
        return true;
      }
      if (mBindUser) {
        var parts = content.substring(5).trim().split(/\s+/);
        var uqq = (parts[0] || '').trim();
        var uoid = (parts[1] || '').trim();
        if (!/^\d{5,11}$/.test(uqq)) { await reply('❌ QQ 号应为 5-11 位数字，请检查后重试'); return true; }
        if (!/^[A-Za-z0-9_\-]+$/.test(uoid) || uoid.length < 6) { await reply('❌ OpenID 格式不正确，请通过「OpenID查询」获取完整 OpenID'); return true; }
        if (gid) {
          var canBind = false;
          try {
            var role = ctx.engine.getGroupMemberRole ? ctx.engine.getGroupMemberRole(gid, openid) : '';
            canBind = role === 'owner' || role === 'admin' || role === 'super' || role === 'master' || role === '' || !role;
          } catch (e) { canBind = true; }
          if (!canBind) { await reply('🔒 仅群主/管理员可绑定指定用户'); return true; }
        }
        var res = ctx.engine.bindUserQQ ? ctx.engine.bindUserQQ(uoid, uqq, '') : { ok: false, error: '引擎不支持绑定' };
        if (res.ok) await reply('✅ 绑定成功\nOpenID：' + uoid + '\nQQ：' + uqq + botTag() + '\n该用户已可跨机器人识别身份');
        else await reply('❌ 绑定失败：' + (res.error || '未知错误'));
        return true;
      }

      if (mBindQQ) {
        await reply('📱 绑定QQ\n发送「绑定QQ 你的QQ号」\n例：绑定QQ 123456789\n绑定后可跨机器人识别你的身份\n需要解绑发「解绑QQ」');
        return true;
      }
      if (mBindQQPre) {
        var qq = content.substring(5).trim();
        if (!/^\d{5,11}$/.test(qq)) { await reply('❌ QQ 号应为 5-11 位数字，请检查后重试'); return true; }
        var res = ctx.engine.bindUserQQ ? ctx.engine.bindUserQQ(openid, qq, nickname) : { ok: false, error: '引擎不支持绑定' };
        if (res.ok) await reply('✅ 绑定成功\nQQ：' + qq + '\n昵称：' + (nickname || '未知') + botTag() + '\n' + ctx.link.linkify('发送「OpenID查询」', 'OpenID查询') + '可查看绑定信息');
        else await reply('❌ 绑定失败：' + (res.error || '未知错误'));
        return true;
      }

      // 群管理操作：绑定QQ群（需群主/管理员；后台未设置角色时放行，便于私域群使用）
      var canManage = false;
      try {
        var role = ctx.engine.getGroupMemberRole ? ctx.engine.getGroupMemberRole(gid, openid) : '';
        canManage = role === 'owner' || role === 'admin' || role === 'super' || role === 'master' || role === '' || !role;
      } catch (e) { canManage = true; }

      if (mBindGroup) {
        if (!canManage) {
          await reply('🔒 仅群主/管理员或机器人管理员可绑定QQ群\n发送「绑定QQ群 群号」绑定当前群到数字群号');
          return true;
        }
        await reply('👥 绑定QQ群\n发送「绑定QQ群 群号」\n例：绑定QQ群 123456789\n绑定后群成员行自动带群号');
        return true;
      }
      if (mBindGroupPre) {
        if (!canManage) {
          await reply('🔒 仅群主/管理员或机器人管理员可绑定QQ群');
          return true;
        }
        var gnum = content.substring(6).trim();
        var gname = '';
        try { gname = ctx.engine.getGroupName ? ctx.engine.getGroupName(gid) : ''; } catch (e) {}
        var res2 = ctx.engine.bindGroupNumber ? ctx.engine.bindGroupNumber(gid, gnum, gname) : { ok: false, error: '引擎不支持绑定群' };
        if (res2.ok) await reply('✅ 群绑定成功\n群 OpenID：' + gid + '\n群号：' + gnum + botTag() + '\n群成员行已自动关联该群号');
        else await reply('❌ 绑定失败：' + (res2.error || '未知错误'));
        return true;
      }

      return false;
    }
  },

  onEnable: function(ctx) {
    var self = this;
    ctx.eventBus.on('message.group', async function(data) {
      try { await self.methods.handle(ctx, data); } catch (e) { ctx.logger.error('绑定管理异常: ' + String(e && e.message || e)); }
    });
    ctx.eventBus.on('message.c2c', async function(data) {
      try { await self.methods.handle(ctx, data); } catch (e) { ctx.logger.error('绑定管理异常: ' + String(e && e.message || e)); }
    });
  }
};
