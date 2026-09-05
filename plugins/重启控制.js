// 重启控制 v1.1.0 - 超级主人群内「重启机器人/重启服务器」10 秒倒计时后本机 pm2 重启；
// 启动后（onEnable）自动向机器人所在全部群广播运行状态：重启路径会显示「重启完成 · 用时 X 秒」，
// 广播含就绪重试（HTTP/WS 未就绪时自动等待重发），不再静默丢失。
// @ts-nocheck
module.exports = {
  manifest: {
    id: 'mod-restart-ctl',
    name: '重启控制',
    version: '1.1.0',
    description: '超主重启机器人/服务器（10秒倒计时），重启完成自动向全部群广播「用时X秒」状态',
    author: '511742399'
  },

  async init() {},

  onEnable: function(ctx) {
    ctx.logger.info('重启控制 v1.1.0 已加载');
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
    var self = this;
    var fs = require('fs');
    var path = require('path');
    // 读取重启时间戳：群命令/面板/服务端重启前写入 .reboot-ts，用于计算「重启用时 X 秒」
    var markerFile = path.join(process.cwd(), '.reboot-ts');
    var rebootMs = 0;
    try {
      if (fs.existsSync(markerFile)) rebootMs = parseInt(String(fs.readFileSync(markerFile, 'utf-8')).trim(), 10) || 0;
    } catch (e) {}
    var restartTxt = '';
    if (rebootMs > 0) {
      var secs = Math.max(0, Math.round((Date.now() - rebootMs) / 1000));
      restartTxt = '✅ 重启完成 · 用时 ' + self.fmtSec(secs) + ' · 服务已就绪';
    }
    var sentAny = false;
    try {
      for (var attempt = 0; attempt < 8; attempt++) {
        if (attempt > 0) await self.sleep(5000);
        // HTTP 服务未就绪时接口返回 null，等待重试
        var st = null;
        var groups = null;
        try { st = await self.getStatus(); } catch (e) {}
        try { groups = await self.getAllGroups(); } catch (e) {}
        if (!st) continue;
        var list = (groups && groups.groups) || [];
        var s = st.status ? st.status : null;
        var text = self.statusText(s, restartTxt);
        for (var i = 0; i < list.length; i++) {
          var gid = list[i] && (list[i].id || list[i].groupId || list[i].groupOpenid);
          if (!gid) continue;
          try {
            await ctx.bot.sendGroupMessage(gid, text);
            sentAny = true;
          } catch (e) {}
          if (st.base64) {
            try { await self.sendImage(ctx, gid, st.base64, 'bot_status.png'); } catch (e) {}
          }
          await self.sleep(900);
        }
        // 已发出至少一条、或本就没有群、或重试足够多次则结束；WS 未就绪时继续等重发
        if (sentAny || list.length === 0 || attempt >= 5) break;
      }
    } catch (e) {}
    // 消费掉重启标记，避免下次普通启动误报「重启完成」
    if (rebootMs > 0) {
      try { if (fs.existsSync(markerFile)) fs.unlinkSync(markerFile); } catch (e) {}
    }
  },

  sleep: function(ms) {
    return new Promise(function(r) { setTimeout(r, ms); });
  },

  fmtSec: function(n) {
    n = Math.max(0, Math.floor(n));
    if (n < 60) return n + '秒';
    var m = Math.floor(n / 60);
    var s = n % 60;
    return m + '分' + (s > 0 ? s + '秒' : '');
  },

  statusText: function(s, restartTxt) {
    var lines = [];
    if (restartTxt) {
      lines.push(restartTxt);
    } else {
      lines.push('🤖 机器人状态');
    }
    lines.push('━━━━━━━━━━━━━━');
    if (s && s.version) lines.push('版本：' + s.version);
    if (s && s.uptimeText) lines.push('运行：' + s.uptimeText);
    if (s && s.botName) lines.push('机器人：' + s.botName);
    if (s && s.groupCount !== undefined) lines.push('所在群：' + s.groupCount + ' 个');
    if (s && s.port) lines.push('端口：' + s.port);
    if (s && s.memory) lines.push('内存：' + s.memory);
    lines.push('━━━━━━━━━━━━━━');
    lines.push(restartTxt ? '服务已重启就绪，开始正常工作' : '服务已就绪');
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
      // 记录重启发起时间戳，重启完成后广播「用时 X 秒」
      var pth = require('path');
      var fss = require('fs');
      try { fss.writeFileSync(pth.join(process.cwd(), '.reboot-ts'), String(Date.now()), 'utf-8'); } catch (e) {}
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
