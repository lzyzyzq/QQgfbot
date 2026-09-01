// 菜单面板 v1.1.0 - 官方「自定义菜单」与「指令面板」管理
// v1.1.0 新增群聊指令面板：与单聊指令面板并列，按截图样式覆盖听歌/娱乐/管理入口
// 自定义菜单：展示在机器人单聊窗口底部，对所有用户生效（PUT/GET /v2/menu）
// 指令面板：以面板形式展示指令，支持 c2c/group/channel/dm（POST/GET/DELETE /v2/panels）
// 官方文档：https://bot.q.qq.com/wiki/develop/api-v2/server-inter/menu-panel/
// 权限：群聊内仅群主/群管理可操作；单聊本人可直接操作
// @ts-nocheck
const MENU_ITEMS = [
  { type: 'send_message', name: '菜单', send_message: '新版菜单' },
  { type: 'send_message', name: '签到', send_message: '签到' },
  { type: 'send_message', name: '听唱歌', send_message: '听唱歌' },
  { type: 'send_message', name: '点首歌', send_message: '点首歌' },
  { type: 'send_message', name: '今日密码', send_message: '今日密码' },
  { type: 'send_message', name: '更新日志', send_message: '更新日志' },
  { type: 'send_message', name: '报时', send_message: '报时' },
  { type: 'send_message', name: '讲笑话', send_message: '来段笑话' },
  {
    type: 'menu',
    name: '更多',
    sub_menu_items: [
      { type: 'send_message', name: '游戏菜单', send_message: '游戏菜单' },
      { type: 'send_message', name: '今日老婆', send_message: '今日老婆' },
      { type: 'send_message', name: '画图', send_message: '画图' },
      { type: 'send_message', name: '查询中心', send_message: '查询中心' },
      { type: 'link', name: '赞助', link: 'https://www.ifdian.net/a/lzyzqzb5201314' }
    ]
  }
];

const PANEL_C2C = {
  scope: 'c2c',
  target_type: 'all',
  panel: {
    remark: '空空Bot 单聊指令面板',
    items: [
      { type: 'command', name: '新版菜单', desc: '打开完整功能菜单' },
      { type: 'command', name: '报时', desc: '当前北京时间' },
      { type: 'command', name: '来段笑话', desc: '随机笑话语音播放' },
      { type: 'command', name: '画图', desc: '生成艺术字主题海报' },
      { type: 'command', name: '今日密码', desc: '三角洲密码门' },
      { type: 'link', name: '赞助我们', link: 'https://www.ifdian.net/a/lzyzqzb5201314' }
    ]
  }
};

const PANEL_GROUP = {
  scope: 'group',
  target_type: 'all',
  panel: {
    remark: '空空Bot 群聊指令面板（听歌/娱乐/管理）',
    items: [
      { type: 'command', name: '听唱歌', desc: '听带伴奏的唱歌版' },
      { type: 'command', name: '听清唱', desc: '听纯人声清唱版' },
      { type: 'command', name: '哈基米', desc: '魔性神曲/哈基米点歌' },
      { type: 'command', name: '点首歌', desc: '点首歌 歌名' },
      { type: 'command', name: '唱首歌', desc: '唱首歌 歌名' },
      { type: 'command', name: '我要听', desc: '我要听 歌名' },
      { type: 'command', name: '今日密码', desc: '三角洲密码门' },
      { type: 'command', name: '更新日志', desc: '查看机器人更新日志' },
      { type: 'command', name: '游戏菜单', desc: '游戏功能菜单' }
    ]
  }
};

module.exports = {
  manifest: {
    id: 'mod-menu-panel',
    name: '菜单面板',
    version: '1.1.0',
    description: '官方自定义菜单（单聊底部）与指令面板管理（c2c/群聊）：自定义菜单/设置自定义菜单/指令面板/创建指令面板/创建群指令面板/删除指令面板',
    author: '511742399'
  },

  async init() {},

  onEnable: function(ctx) {
    ctx.logger.info('菜单面板 v1.1.0 已加载');
    var self = this;
    ctx.eventBus.on('message.group', async function(data) {
      try { await self.handle(ctx, data); } catch (e) {}
    });
    ctx.eventBus.on('message.c2c', async function(data) {
      try { await self.handle(ctx, data); } catch (e) {}
    });
  },

  async isAdmin(ctx, data) {
    if (!data.groupId) return true; // 单聊本人直接操作
    var userId = (data.author && data.author.openid) || '';
    // 超级主人永远有权限（isSameUser QQ 兜底，多机器人 openid 不同也能识别）
    try {
      if (ctx.identity && ctx.identity.isSameUser) {
        var raw = ctx.storage.get('super_master_id') || '';
        var sm = '';
        try { var obj = JSON.parse(raw); sm = obj.id || ''; } catch (e) { sm = raw; }
        if (sm && ctx.identity.isSameUser(sm, userId)) return true;
      }
    } catch (e) {}
    try {
      if (ctx.engine && ctx.engine.getGroupMemberRole) {
        var role = ctx.engine.getGroupMemberRole(data.groupId, userId) || '';
        if (role === 'owner' || role === 'admin') return true;
        if (role === 'member' || role === 'user') return false;
      }
    } catch (e) {}
    return false;
  },

  handle: async function(ctx, data) {
    try {
      var content = String(data.content || '').replace(/^\s*(?:<@!?[A-Za-z0-9_\-]+>|@\S+)\s*/, '').trim();
      var isC2c = !data.groupId;
      var groupId = data.groupId;
      var userId = (data.author && data.author.openid) || '';
      var msgId = data.id;
      var send = isC2c
        ? function(text) { return ctx.bot.sendPrivateMessage(userId, text, msgId); }
        : function(text) { return ctx.bot.sendGroupMessage(groupId, text, msgId); };

      // 查询自定义菜单
      if (content === '自定义菜单' || content === '查询自定义菜单') {
        var g = null;
        try { if (ctx.bot.getGlobalMenu) g = await ctx.bot.getGlobalMenu(); } catch (e) {}
        var text = g ? JSON.stringify(g).slice(0, 800) : '❌ 查询失败或尚未配置（返回 null）';
        await send('📋 当前单聊底部自定义菜单\n━━━━━━━━━━━━━━\n' + text + '\n━━━━━━━━━━━━━━\n' + ctx.link.linkify('发送「设置自定义菜单」', '设置自定义菜单') + '写入内置菜单项');
        return;
      }

      // 设置自定义菜单
      if (content === '设置自定义菜单' || content === '写入自定义菜单') {
        if (!(await this.isAdmin(ctx, data))) { await send('⛔ 权限不足：设置自定义菜单仅群主/群管理可操作（单聊可直接操作）！'); return; }
        try {
          var r = await ctx.bot.setGlobalMenu({ menu: { items: MENU_ITEMS } });
          await send('✅ 自定义菜单已写入单聊窗口底部！\n菜单项：' + MENU_ITEMS.map(function(it) { return it.name; }).join('、') + '\n（官方返回：' + (r ? JSON.stringify(r) : 'ok') + '）\n重启机器人单聊窗口或重新进入即可看到。');
        } catch (e) {
          await send('❌ 写入失败：' + String(e && e.message || e));
        }
        return;
      }

      // 查询指令面板列表
      if (content === '指令面板' || content === '查询指令面板') {
        var ps = null;
        try { if (ctx.bot.getPanels) ps = await ctx.bot.getPanels(); } catch (e) {}
        var pt = ps ? JSON.stringify(ps).slice(0, 800) : '❌ 查询失败或为空';
        await send('📋 指令面板列表\n━━━━━━━━━━━━━━\n' + pt + '\n━━━━━━━━━━━━━━\n' + ctx.link.linkify('发送「创建指令面板」', '创建指令面板') + '创建 c2c 面板');
        return;
      }

      // 创建指令面板（c2c 全局）
      if (content === '创建指令面板' || content === '创建面板') {
        if (!(await this.isAdmin(ctx, data))) { await send('⛔ 权限不足：创建指令面板仅群主/群管理可操作（单聊可直接操作）！'); return; }
        try {
          var cr = await ctx.bot.createPanel(PANEL_C2C);
          await send('✅ c2c 指令面板创建成功！\npanel_id：' + (cr && cr.panel_id ? cr.panel_id : JSON.stringify(cr)) + '\n' + ctx.link.linkify('发送「指令面板」', '指令面板') + '查看列表。');
        } catch (e) {
          await send('❌ 创建失败：' + String(e && e.message || e));
        }
        return;
      }

      // 创建群指令面板（group 全局，听歌/娱乐/管理入口）
      if (content === '创建群指令面板' || content === '创建群面板') {
        if (!(await this.isAdmin(ctx, data))) { await send('⛔ 权限不足：创建群指令面板仅群主/群管理可操作（单聊可直接操作）！'); return; }
        try {
          var crg = await ctx.bot.createPanel(PANEL_GROUP);
          await send('✅ 群聊指令面板创建成功！\n面板内容：' + PANEL_GROUP.panel.items.map(function(it) { return it.name; }).join(' / ') + '\npanel_id：' + (crg && crg.panel_id ? crg.panel_id : JSON.stringify(crg)) + '\n' + ctx.link.linkify('发送「指令面板」', '指令面板') + '查看列表，发送「删除指令面板 ' + (crg && crg.panel_id ? crg.panel_id : 'panel_id') + '」删除。');
        } catch (e) {
          await send('❌ 创建失败：' + String(e && e.message || e) + '\n（群指令面板需群聊内成员触发后展示）');
        }
        return;
      }

      // 删除指令面板
      var dm = content.match(/^删除指令面板\s+([\w\-]+)$/);
      if (dm) {
        if (!(await this.isAdmin(ctx, data))) { await send('⛔ 权限不足：删除指令面板仅群主/群管理可操作（单聊可直接操作）！'); return; }
        try {
          await ctx.bot.deletePanel(dm[1]);
          await send('✅ 指令面板已删除：' + dm[1]);
        } catch (e) {
          await send('❌ 删除失败：' + String(e && e.message || e));
        }
        return;
      }
    } catch(e) {}
  }
};
