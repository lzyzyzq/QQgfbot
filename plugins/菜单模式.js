// 菜单模式 v1.0.0 - 文字指令菜单 + 全局菜单模式切换
// 发送「文字指令」查看文字版功能指令清单；发送「菜单模式」查看当前菜单模式；
// 发送「切换文字菜单」/「切换图片菜单」切换全局菜单模式（群内仅群主/群管理，单聊本人可用）
// @ts-nocheck
const TEXT_MENU = [
  '🔰 空空 Bot 文字指令版',
  '━━━━━━━━━━━━━━',
  '🔐 免@授权 签到 补签 签到排行',
  '🎵 听唱歌 听清唱 点首歌 唱首歌 我要听',
  '🎵 唱歌/点歌 + 歌名 直接点歌',
  '🎵 清唱 + 歌名 / 怪唱 + 歌名',
  '🐱 哈基米（听魔性神曲）',
  '💕 今日老婆 今天吃啥 今日密码',
  '📋 更新日志 在线时间 报时',
  '🎮 游戏菜单 王者菜单 今日运势',
  '🎲 掷骰子 猜拳 随机数 今日人品 扫雷 敲木鱼',
  '🌾 开心农场 去钓鱼 笑话',
  '❄️ 雪子管理（群主/管理） 群信息',
  '🔎 查询中心 OpenID查询 绑定QQ 绑定QQ群 天气查询',
  '🎨 画图 + 内容  生成主题海报',
  '😂 来段笑话/讲个笑话  语音笑话',
  '🔌 插件管理（群主/管理）',
  '🔀 菜单模式（查看/切换 文字/图片 菜单）',
  '━━━━━━━━━━━━━━',
  '发送「新版菜单」查看按钮版菜单'
].join('\n');

module.exports = {
  manifest: {
    id: 'mod-menu-mode',
    name: '菜单模式',
    version: '1.1.0',
    description: '文字指令版菜单（发送"文字指令"查看指令清单）、全局菜单模式切换（文字/图片）、全局文字外显模式切换（链接式/纯文本）',
    author: '511742399'
  },

  async init() {},

  onEnable: function(ctx) {
    ctx.logger.info('菜单模式 v1.1.0 已加载');
    var self = this;
    ctx.eventBus.on('message.group', async function(data) {
      try { await self.handle(ctx, data); } catch (e) {}
    });
    ctx.eventBus.on('message.c2c', async function(data) {
      try { await self.handle(ctx, data); } catch (e) {}
    });
  },

  handle: async function(ctx, data) {
    try {
      var content = String(data.content || '').replace(/^\s*(?:<@!?[A-Za-z0-9_\-]+>|@\S+)\s*/, '').trim();
      var isC2c = !data.groupId;
      var groupId = data.groupId;
      var userId = (data.author && data.author.openid) || '';
      var msgId = data.id;

      // 超级主人判断（isSameUser QQ 兜底）
      var isSuper = function(uid) {
        var raw = ctx.storage.get('super_master_id') || '';
        var superId = '';
        try { var obj = JSON.parse(raw); superId = obj.id || ''; } catch(e) { superId = raw; }
        if (!superId) return false;
        if (superId === uid) return true;
        try { return !!(ctx.identity && ctx.identity.isSameUser && ctx.identity.isSameUser(superId, uid)); } catch(e) { return false; }
      };

      // 文字指令版菜单
      if (content === '文字指令' || content === '指令文字' || content === '文字菜单' || content === '指令菜单') {
        if (!groupId) {
          try { await ctx.bot.sendPrivateMessage(userId, TEXT_MENU, msgId); } catch (e) {}
          return;
        }
        try { await ctx.bot.sendGroupMessage(groupId, TEXT_MENU, msgId); } catch (e) {}
        return;
      }

      // 查看当前菜单模式
      if (content === '菜单模式') {
        var mode = (ctx.engine && ctx.engine.getGlobalMode) ? ctx.engine.getGlobalMode() : 'text';
        var modeName = mode === 'image' ? '🖼 图片模式（菜单以图片卡片发送）' : '🔤 文字模式（菜单以按钮/文字发送）';
        var tip = isC2c
          ? '' + ctx.link.linkify('发送「切换文字菜单」', '切换文字菜单') + '或「切换图片菜单」即可切换。'
          : '仅群主/群管理可切换：' + ctx.link.linkify('发送「切换文字菜单」', '切换文字菜单') + '或「切换图片菜单」。';
        var text = '🔀 菜单模式\n━━━━━━━━━━━━━━\n当前全局菜单模式：' + modeName + '\n' + tip;
        if (!groupId) { try { await ctx.bot.sendPrivateMessage(userId, text, msgId); } catch (e) {} return; }
        try { await ctx.bot.sendGroupMessage(groupId, text, msgId); } catch (e) {}
        return;
      }

      // 文字外显模式（全局切换：所有插件外显文字在"链接式"与"纯文本"之间切换）
      if (content === '文字外显' || content === '文字外显模式') {
        var lm = (ctx.engine && ctx.engine.getLinkMode) ? ctx.engine.getLinkMode() : 'on';
        var lmName = lm === 'on' ? '🔗 链接式（外显文字为可点击的 mqqapi 链接，点链接回填指令）' : '📝 纯文本（外显文字为普通文字）';
        var lmText = '🔗 文字外显模式\n━━━━━━━━━━━━━━\n当前：' + lmName + '\n发送「文字外显 开」→ 所有插件菜单入口渲染为链接式\n发送「文字外显 关」→ 所有插件菜单入口渲染为纯文本\n开启后点击链接，指令会填入输入框，点发送即可使用';
        if (!groupId) { try { await ctx.bot.sendPrivateMessage(userId, lmText, msgId); } catch (e) {} return; }
        try { await ctx.bot.sendGroupMessage(groupId, lmText, msgId); } catch (e) {}
        return;
      }
      var ml = content.match(/^文字外显\s+(开|关|链接|文本|on|off)$/);
      if (ml) {
        var target = (ml[1] === '开' || ml[1] === '链接' || ml[1] === 'on') ? 'on' : 'off';
        if (!isC2c) {
          var role2 = (ctx.engine && ctx.engine.getGroupMemberRole) ? ctx.engine.getGroupMemberRole(groupId, userId) : '';
          if (!isSuper(userId) && role2 !== 'owner' && role2 !== 'admin' && role2 !== '主' && role2 !== '管理') {
            try { await ctx.bot.sendGroupMessage(groupId, '⛔ 权限不足：切换文字外显模式仅群主/群管理可操作！', msgId); } catch (e) {}
            return;
          }
        }
        if (ctx.engine && ctx.engine.setLinkMode) ctx.engine.setLinkMode(target);
        var okText = target === 'on'
          ? '🔗 已开启文字外显链接模式：所有插件菜单入口渲染为 mqqapi 链接，点击后指令回填输入框。发送「新版菜单」查看效果。'
          : '📝 已关闭文字外显链接模式：所有插件菜单入口渲染为纯文本。';
        if (!groupId) { try { await ctx.bot.sendPrivateMessage(userId, okText, msgId); } catch (e) {} return; }
        try { await ctx.bot.sendGroupMessage(groupId, okText, msgId); } catch (e) {}
        return;
      }

      // 切换菜单模式
      var m = content.match(/^切换(文字|图片)(菜单)?$/) || content.match(/^菜单模式\s+(文字|图片)$/);
      if (m) {
        var target = m[1] === '图片' ? 'image' : 'text';
        // 权限：单聊本人可用；群聊需群主/群管理（超主永远可操作）
        if (!isC2c) {
          var role = (ctx.engine && ctx.engine.getGroupMemberRole) ? ctx.engine.getGroupMemberRole(groupId, userId) : '';
          if (!isSuper(userId) && role !== 'owner' && role !== 'admin' && role !== '主' && role !== '管理') {
            try { await ctx.bot.sendGroupMessage(groupId, '⛔ 权限不足：切换菜单模式仅群主/群管理可操作！', msgId); } catch (e) {}
            return;
          }
        }
        if (ctx.engine && ctx.engine.setGlobalMode) ctx.engine.setGlobalMode(target);
        var okText = target === 'image'
          ? '🖼 已切换为图片模式：菜单将以图片卡片发送。发送「新版菜单」查看效果。'
          : '🔤 已切换为文字模式：菜单将以按钮/文字发送。发送「新版菜单」查看效果。';
        if (!groupId) { try { await ctx.bot.sendPrivateMessage(userId, okText, msgId); } catch (e) {} return; }
        try { await ctx.bot.sendGroupMessage(groupId, okText, msgId); } catch (e) {}
        return;
      }
    } catch(e) {}
  }
};
