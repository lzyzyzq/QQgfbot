// 画图 v1.0.1 - 画图：发送「画图 内容」，生成一张艺术字主题海报图（SVG 渲染，离线可用）
// 技术栈：sharp + SVG 渐变背景 + 主题装饰（复用报时图片方案），本地生成 PNG 后经富媒体上传发送
// 降级：sharp 不可用或渲染失败时回退纯文本提示
// v1.0.1: 改为 eventBus 自监听（message.group/message.c2c），普通消息「画图 内容」即可触发，不再依赖 @ 与菜单路由
// @ts-nocheck
module.exports = {
  manifest: {
    id: 'mod-draw',
    name: '画图',
    version: '1.0.1',
    description: '画图：画图/画画/生成图 + 内容，生成艺术字主题海报图，支持颜色主题词（如 蓝色 星空 落日）',
    author: '511742399'
  },

  async init() {},

  // 供引擎 callPlugin('画图','handleCommand') 路由调用（测试菜单 __draw: 图片方式走这里）
  methods: {
    handleCommand: async function(ctx, data) {
      return module.exports.handleMessage(ctx, data);
    }
  },

  onEnable: function(ctx) {
    ctx.logger.info('画图 v1.0.1 已加载');
    var self = this;
    ctx.eventBus.on('message.group', async function(data) {
      try { await self.handleMessage(ctx, data); } catch (e) {}
    });
    ctx.eventBus.on('message.c2c', async function(data) {
      try { await self.handleMessage(ctx, data); } catch (e) {}
    });
  },

  // 兼容旧事件驱动（真实环境由 eventBus 派发，此处保留兜底）
  async onEvent(event, ctx) {
    try {
      if (event.eventType !== 'GROUP_AT_MESSAGE_CREATE') return;
      if (event.msgType === 7 || event.msgType === 3 || event.msgType === 8 || event.msgType === 2) return;
      var content = String(event.content || '').trim();
      var m = content.match(/^(画图|画画|生成图|给我画|画一张)[:：\s]*(.*)$/);
      if (!m || !m[2] || !m[2].trim()) return;
      await this.doDraw(ctx, event.group_openid, event.id, m[2].trim().slice(0, 14));
    } catch(e) {}
  },

  // 普通消息入口（eventBus message.group/c2c）
  handleMessage: async function(ctx, data) {
    try {
      var content = String(data.content || '').replace(/^\s*(?:<@!?[A-Za-z0-9_\-]+>|@\S+)\s*/, '').trim();
      var m = content.match(/^(画图|画画|生成图|给我画|画一张)[:：\s]*(.*)$/);
      if (!m || !m[2] || !m[2].trim()) return;
      var groupId = data.groupId;
      if (!groupId) return;
      await this.doDraw(ctx, groupId, data.id, m[2].trim().slice(0, 14));
    } catch(e) {}
  },

  doDraw: async function(ctx, groupId, msgId, text) {
    try {
      var png = await this.buildDrawImage(text);
      if (!png) {
        await ctx.bot.sendGroupMessage(groupId, '🎨 画图失败，请稍后再试（或换一句更短的内容）。', msgId);
        return;
      }
      var up = await ctx.bot.uploadGroupImageBuffer(groupId, png, 'draw.png');
      if (up && (up.file_info || up.url)) {
        await ctx.bot.sendGroupImageMessage(groupId, up.file_info || up.url, msgId);
      } else {
        await ctx.bot.sendGroupMessage(groupId, '🎨 图片上传失败，请稍后再试。', msgId);
      }
    } catch(e) {}
  },

  // 根据内容中的颜色/意境词挑选渐变主题
  pickTheme: function(text) {
    var themes = [
      { name: '星辰蓝', c1: '#0f2b5b', c2: '#2e5f9e', c3: '#0a1633', glow: '#8ec5ff', dot: 'rgba(142,197,255,0.5)' },
      { name: '落霞橙', c1: '#3d1d10', c2: '#c05a1d', c3: '#8a3a10', glow: '#ffb36a', dot: 'rgba(255,179,106,0.5)' },
      { name: '森林绿', c1: '#0d2f1d', c2: '#1f7a3d', c3: '#0a2415', glow: '#7ddc9a', dot: 'rgba(125,220,154,0.5)' },
      { name: '极光紫', c1: '#2a0f4e', c2: '#7a3ce0', c3: '#1c0a35', glow: '#c9a8ff', dot: 'rgba(201,168,255,0.5)' },
      { name: '暖阳金', c1: '#4e3408', c2: '#e8a010', c3: '#3d2906', glow: '#ffd76a', dot: 'rgba(255,215,106,0.5)' },
      { name: '少女粉', c1: '#4e1634', c2: '#e0608f', c3: '#3a1026', glow: '#ffb3cc', dot: 'rgba(255,179,204,0.5)' },
      { name: '深海青', c1: '#063a4e', c2: '#1295b8', c3: '#04222e', glow: '#8ae8ff', dot: 'rgba(138,232,255,0.5)' },
      { name: '火焰红', c1: '#4e0f0a', c2: '#e8481a', c3: '#3a0a06', glow: '#ff9a6a', dot: 'rgba(255,154,106,0.5)' }
    ];
    var idx = 0;
    if (/星空|夜晚|月亮|宇宙/.test(text)) idx = 0;
    else if (/落日|夕阳|黄昏|橙/.test(text)) idx = 1;
    else if (/森林|绿|草|自然/.test(text)) idx = 2;
    else if (/紫|薰衣草|极光/.test(text)) idx = 3;
    else if (/金|黄|阳光|向日葵/.test(text)) idx = 4;
    else if (/粉|桃|樱花/.test(text)) idx = 5;
    else if (/蓝|海|天空|青/.test(text)) idx = 6;
    else if (/红|火|烈焰/.test(text)) idx = 7;
    return themes[idx];
  },

  escXml: function(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

  buildDrawImage: function(text) {
    var self = this;
    return new Promise(function(resolve) {
      try {
        var sharp = require('sharp');
        var t = self.pickTheme(text);
        var font = 'Noto Sans CJK SC, WenQuanYi Micro Hei, Microsoft YaHei, PingFang SC, sans-serif';
        var esc = self.escXml(text);

        var dots = '';
        for (var i = 0; i < 10; i++) {
          var dx = 40 + Math.round(Math.random() * 820);
          var dy = 40 + Math.round(Math.random() * 480);
          var dr = 3 + Math.round(Math.random() * 7);
          dots += '<circle cx="' + dx + '" cy="' + dy + '" r="' + dr + '" fill="' + t.dot + '"/>';
        }

        var svg = '<svg width="900" height="560" xmlns="http://www.w3.org/2000/svg">' +
          '<defs>' +
          '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">' +
          '<stop offset="0%" stop-color="' + t.c1 + '"/><stop offset="55%" stop-color="' + t.c2 + '"/><stop offset="100%" stop-color="' + t.c3 + '"/>' +
          '</linearGradient>' +
          '<filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
          '</defs>' +
          '<rect width="900" height="560" fill="url(#bg)"/>' +
          dots +
          '<rect x="28" y="28" width="844" height="504" rx="22" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.2)" stroke-width="1.5"/>' +
          '<text x="450" y="120" font-size="26" font-family="' + font + '" fill="rgba(255,255,255,0.55)" text-anchor="middle" letter-spacing="6">AI 画图 · ' + t.name + '</text>' +
          '<text x="450" y="330" font-size="84" font-family="' + font + '" fill="#ffffff" text-anchor="middle" font-weight="bold" filter="url(#glow)">' + esc + '</text>' +
          '<line x1="150" y1="390" x2="750" y2="390" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>' +
          '<text x="450" y="448" font-size="22" font-family="' + font + '" fill="' + t.glow + '" text-anchor="middle">发送「画图 任意内容」即可生成主题海报</text>' +
          '<text x="450" y="500" font-size="16" font-family="' + font + '" fill="rgba(255,255,255,0.4)" text-anchor="middle">PHP · QQ机器人平台</text>' +
          '</svg>';

        sharp(Buffer.from(svg)).png().toBuffer().then(resolve, function() { resolve(null); });
      } catch(e) { resolve(null); }
    });
  }
};
