// 重启控制 v1.0.0 - 超级主人群内「重启机器人/重启服务器」10 秒倒计时后本机 pm2 重启；
// 启动后（onEnable）自动向机器人所在全部群广播运行状态（文字 + 状态图）；重启命令失败渲染错误图。
// @ts-nocheck
module.exports = {
  manifest: {
    id: 'mod-restart-ctl',
    name: '重启控制',
    version: '1.0.0',
    description: '超主重启机器人/服务器（10秒倒计时），启动后自动向全部群广播运行状态',
    author: '511742399'
  },

  async init() {},

  onEnable: function(ctx) {
    ctx.logger.info('重启控制 v1.0.0 已加载');
    var self = this;
    // 事件自监听：消息直接进入 handleCommand（标准 JS 插件消息入口）
    var h = function(data) { self.handleCommand(ctx, data).catch(function() {}); };
    ctx.eventBus.on('message.group', h);
    ctx.eventBus.on('message.c2c', h);
    ctx.eventBus.on('message.guild', h);
    // 启动后延迟广播状态到全部群（自启广播，onEnable 触发，不等 PHP 脚本）
    setTimeout(function() { self.broadcastStatus(ctx); }, 5000);
  },

  handleCommand: async function(ctx, data) {
    try {
      var content = String(data.content || '').replace(/^\s*(?:<@!?[A-Za-z0-9_\-]+>|@\S+)\s*/, '').trim();
      if (content !== '重启机器人' && content !== '重启服务器') return;
      var groupId = data.groupId;
      var userId = (data.author && data.author.openid) || '';
      var msgId = data.id;
      if (!this.isSuper(ctx, userId)) {
        try { await ctx.bot.sendGroupMessage(groupId, '🔒 「重启机器人/重启服务器」仅超级主人可使用。', msgId); } catch (e) {}
        return;
      }
      await this.doRestart(ctx, groupId, msgId);
    } catch (e) {
      ctx.logger.error('重启控制错误: ' + (e && e.message || e));
    }
  },

  isSuper: function(ctx, uid) {
    var raw = ctx.storage.get('super_master_id') || '';
    var id = '';
    try { id = JSON.parse(raw).id || ''; } catch (e) { id = raw; }
    if (id === uid) return true;
    try { return ctx.identity.isSameUser(id, uid); } catch (e) { return false; }
  },

  callLocalApi: function(method, apiPath, body) {
    return new Promise(function(resolve) {
      try {
        var http = require('http');
        var port = (typeof process !== 'undefined' && process.env && process.env.PORT) ? Number(process.env.PORT) : 3000;
        var payload = body ? JSON.stringify(body) : null;
        var req = http.request({
          host: '127.0.0.1', port: port, path: apiPath, method: method,
          timeout: 10000, headers: { 'Content-Type': 'application/json' }
        }, function(res) {
          var b = '';
          res.on('data', function(c) { b += c; });
          res.on('end', function() { try { resolve(JSON.parse(b)); } catch (e) { resolve(null); } });
        });
        req.on('error', function() { resolve(null); });
        req.on('timeout', function() { req.destroy(); resolve(null); });
        if (payload) req.write(payload);
        req.end();
      } catch (e) { resolve(null); }
    });
  },

  getAllGroups: function() {
    return this.callLocalApi('GET', '/api/bot/php-bridge/groups');
  },

  getStatus: function() {
    return this.callLocalApi('GET', '/api/bot/php-bridge/bot-status');
  },

  sendImage: async function(ctx, groupId, base64, name) {
    try {
      var buf = Buffer.from(base64, 'base64');
      var up = await ctx.bot.uploadGroupImageBuffer(groupId, buf, name || 'status.png');
      if (up && (up.file_info || up.url)) {
        await ctx.bot.sendGroupImageMessage(groupId, up.file_info || up.url);
        return true;
      }
    } catch (e) {}
    return false;
  },

  broadcastStatus: async function(ctx) {
    try {
      var groups = await this.getAllGroups();
      var list = (groups && groups.groups) || [];
      if (list.length === 0) return;
      var st = await this.getStatus();
      var s = st && st.status ? st.status : null;
      var text = this.statusText(s);
      for (var i = 0; i < list.length; i++) {
        var gid = list[i].id;
        if (!gid) continue;
        try {
          await ctx.bot.sendGroupMessage(gid, text);
          if (st && st.base64) await this.sendImage(ctx, gid, st.base64, 'bot_status.png');
        } catch (e) {}
        await new Promise(function(r) { setTimeout(r, 1200); });
      }
    } catch (e) {}
  },

  statusText: function(s) {
    var lines = ['🤖 机器人状态'];
    lines.push('━━━━━━━━━━━━━━');
    if (s && s.version) lines.push('版本：' + s.version);
    if (s && s.uptimeText) lines.push('运行：' + s.uptimeText);
    if (s && s.groupCount !== undefined) lines.push('所在群：' + s.groupCount + ' 个');
    if (s && s.port) lines.push('端口：' + s.port);
    if (s && s.memory) lines.push('内存：' + s.memory);
    lines.push('━━━━━━━━━━━━━━');
    lines.push('服务已就绪');
    return lines.join('\n');
  },

  doRestart: async function(ctx, groupId, msgId) {
    var self = this;
    var send = function(t) { return ctx.bot.sendGroupMessage(groupId, t, msgId); };
    try {
      await send('🔁 已收到重启指令，服务器将在 10 秒后重启…\n期间服务会短暂断开，重启完成后自动在全部群广播状态。');
    } catch (e) {}
    for (var i = 10; i >= 1; i--) {
      await new Promise(function(r) { setTimeout(r, 1000); });
      try { await send('⏳ ' + i); } catch (e) {}
    }
    var child = null;
    try {
      // 部署终端：cd /var/www/php 根目录后执行 pm2 restart qqbot
      var spawn = require('child_process').spawn;
      child = spawn('sh', ['-c', 'cd /var/www/php && pm2 restart qqbot'], { cwd: '/var/www/php' });
    } catch (e) {
      await self.sendFail(ctx, groupId, 'pm2 启动失败：' + (e && e.message || e));
      return;
    }
    child.on('error', function(e) {
      self.sendFail(ctx, groupId, '重启命令执行失败：' + (e && e.message || e));
    });
    child.on('close', function(code) {
      if (code !== 0) self.sendFail(ctx, groupId, '重启命令执行失败（退出码 ' + code + '）');
    });
  },

  sendFail: async function(ctx, groupId, msg) {
    try {
      var img = await this.buildErrorImage(msg);
      if (img && img.length > 1024) {
        var up = await ctx.bot.uploadGroupImageBuffer(groupId, img, 'restart_error.png');
        if (up && (up.file_info || up.url)) {
          await ctx.bot.sendGroupImageMessage(groupId, up.file_info || up.url);
          return;
        }
      }
    } catch (e) {}
    try { await ctx.bot.sendGroupMessage(groupId, '❌ ' + msg); } catch (e) {}
  },

  buildErrorImage: function(msg) {
    return new Promise(function(resolve) {
      try {
        var sharp = require('sharp');
        var font = 'Noto Sans CJK SC, WenQuanYi Micro Hei, Microsoft YaHei, PingFang SC, sans-serif';
        var esc = String(msg || '未知错误').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        var svg = '<svg width="760" height="300" xmlns="http://www.w3.org/2000/svg">' +
          '<defs><linearGradient id="eBg" x1="0" y1="0" x2="1" y2="1">' +
          '<stop offset="0" stop-color="#7f1d1d"/><stop offset="1" stop-color="#450a0a"/>' +
          '</linearGradient></defs>' +
          '<rect width="760" height="300" rx="24" fill="#0f172a"/>' +
          '<rect width="760" height="110" fill="url(#eBg)"/>' +
          '<text x="40" y="62" font-family="' + font + '" font-size="32" font-weight="bold" fill="#ffffff">重启失败</text>' +
          '<text x="42" y="92" font-family="' + font + '" font-size="13" fill="rgba(255,255,255,.7)">RESTART ERROR</text>' +
          '<text x="40" y="170" font-family="' + font + '" font-size="17" fill="#fecaca">' + esc + '</text>' +
          '<text x="720" y="282" font-family="' + font + '" font-size="13" fill="#64748b" text-anchor="end">QQ机器人 · 重启控制</text>' +
          '</svg>';
        sharp(Buffer.from(svg)).png().toBuffer().then(resolve, function() { resolve(null); });
      } catch (e) { resolve(null); }
    });
  }
};
