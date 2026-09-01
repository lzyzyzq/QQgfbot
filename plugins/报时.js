// 报时 v1.0.1 - 报时：发送「报时 / 时间 / 现在几点 / 几点」，回复当前北京时间（文本 + 图片时间卡）
// v1.0.1 新增定时报时：与网页后端定时任务（schedule_tasks）串联
//   「定时报时 HH:MM」群主/管理员：每天 HH:MM 在该群自动报时（服务端执行器触发，发送 {time} 模板替换为北京时间）
//   「我的定时报时」：查看本群已设置的定时报时
//   「取消定时报时 HH:MM」：取消该时间的定时报时
// 时间统一固定北京时间（UTC+8），任意时区部署均正确
// 图片卡：sharp + SVG 深色渐变时间卡，本地生成 PNG 后经富媒体上传发送；sharp 不可用降级纯文本
// @ts-nocheck
module.exports = {
  manifest: {
    id: 'mod-timer',
    name: '报时',
    version: '1.0.1',
    description: '报时：报时/时间/现在几点/几点，回复当前北京时间（文本+图片时间卡）；定时报时：设置每日定时报时（与网页定时任务串联）',
    author: '511742399'
  },

  async init() {},

  onEnable: function(ctx) {
    ctx.logger.info('报时 v1.0.1 已加载');
    var self = this;
    ctx.eventBus.on('message.group', async function(data) {
      try { await self.handleMessage(ctx, data); } catch (e) {}
    });
    ctx.eventBus.on('message.c2c', async function(data) {
      try { await self.handleMessage(ctx, data); } catch (e) {}
    });
  },

  handleMessage: async function(ctx, data) {
    try {
      var content = String(data.content || '').replace(/^\s*(?:<@!?[A-Za-z0-9_\-]+>|@\S+)\s*/, '').trim();
      if (!content) return;
      var groupId = data.groupId;
      if (!groupId) return;
      var userId = (data.author && data.author.openid) || '';
      var msgId = data.id;

      // 定时报时指令
      var mSet = content.match(/^定时报时\s+([01]?\d|2[0-3]):([0-5]\d)$/);
      var mCancel = content.match(/^取消定时报时\s+([01]?\d|2[0-3]):([0-5]\d)$/);
      if (mSet || mCancel || content === '定时报时' || content === '我的定时报时' || content === '取消定时报时') {
        if (!(await this.canManage(ctx, groupId, userId))) {
          try { await ctx.bot.sendGroupMessage(groupId, '🔒 定时报时仅群主/群管理可设置，其他成员可' + ctx.link.linkify('发送「我的定时报时」', '我的定时报时') + '查看。', msgId); } catch (e) {}
          return;
        }
        await this.handleSchedule(ctx, groupId, msgId, content, mSet, mCancel);
        return;
      }

      if (!/^(报时|现在几点|现在时间|现在几点钟|几点|几点钟|看时间|时间)$/.test(content)) return;
      await this.doReport(ctx, groupId, data.id);
    } catch(e) {}
  },

  canManage: async function(ctx, groupId, userId) {
    try {
      var role = ctx.engine.getGroupMemberRole ? ctx.engine.getGroupMemberRole(groupId, userId) : '';
      if (role === 'owner' || role === 'admin' || role === 'super' || role === 'master') return true;
      if (role === 'member' || role === 'user') return false;
    } catch (e) {}
    return true;
  },

  // 定时报时管理（串联服务端 schedule_tasks）
  handleSchedule: async function(ctx, groupId, msgId, content, mSet, mCancel) {
    try {
      var send = function(text) { return ctx.bot.sendGroupMessage(groupId, text, msgId); };
      var raw = '';
      try { raw = ctx.engine.getConfigValue ? String(ctx.engine.getConfigValue('schedule_tasks') || '') : ''; } catch (e) {}
      var tasks = [];
      try { tasks = JSON.parse(raw || '[]') || []; } catch (e) { tasks = []; }

      // 取消
      if (mCancel) {
        var target = mCancel[1] + ':' + mCancel[2];
        var before = tasks.length;
        tasks = tasks.filter(function(t) {
          return !(t.type === 'broadcast' && t.contentType === 'text' && t.time === target && (t.groups || []).indexOf(groupId) !== -1);
        });
        if (tasks.length === before) {
          await send('❌ 未找到本群 ' + target + ' 的定时报时，无需取消。');
          return;
        }
        try { ctx.engine.setConfigValue('schedule_tasks', JSON.stringify(tasks)); } catch (e) {}
        await send('✅ 已取消本群 ' + target + ' 的定时报时。');
        return;
      }

      // 查看
      if (content === '我的定时报时' || content === '定时报时' || content === '取消定时报时') {
        var mine = tasks.filter(function(t) {
          return t.type === 'broadcast' && t.contentType === 'text' && (t.groups || []).indexOf(groupId) !== -1;
        });
        if (mine.length === 0) {
          await send('📭 本群尚未设置定时报时。\n群主/管理员发送「定时报时 HH:MM」设置，例：定时报时 12:00\n发送「取消定时报时 HH:MM」取消。');
          return;
        }
        var lines = mine.map(function(t) {
          return (t.enabled === false ? '（已停用）' : '') + '🕐 ' + t.time;
        });
        await send('🕐 本群定时报时\n━━━━━━━━━━━━━━\n' + lines.join('\n') + '\n━━━━━━━━━━━━━━\n发送「取消定时报时 时间」可取消对应项。');
        return;
      }

      // 设置
      var hhmm = mSet[1] + ':' + mSet[2];
      var dup = tasks.filter(function(t) {
        return t.type === 'broadcast' && t.contentType === 'text' && t.time === hhmm && (t.groups || []).indexOf(groupId) !== -1;
      });
      if (dup.length > 0) {
        await send('⚠️ 本群 ' + hhmm + ' 已存在定时报时，无需重复设置。\n发送「取消定时报时 ' + hhmm + '」可取消。');
        return;
      }
      var task = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        type: 'broadcast',
        enabled: true,
        contentType: 'text',
        text: '⏰ 定时报时 {time}',
        time: hhmm,
        groups: [groupId]
      };
      tasks.push(task);
      try { ctx.engine.setConfigValue('schedule_tasks', JSON.stringify(tasks)); } catch (e) {}
      await send('✅ 已设置本群每日 ' + hhmm + ' 定时报时！\n到点自动在群里播报当前北京时间（由网页端定时任务驱动）。\n' + ctx.link.linkify('发送「我的定时报时」', '我的定时报时') + '查看，发送「取消定时报时 ' + hhmm + '」取消。');
    } catch(e) {}
  },

  // 兼容旧事件驱动
  async onEvent(event, ctx) {
    try {
      if (event.eventType !== 'GROUP_AT_MESSAGE_CREATE') return;
      if (event.msgType === 7 || event.msgType === 3 || event.msgType === 8 || event.msgType === 2) return;
      var content = String(event.content || '').replace(/^\s*(?:<@!?[A-Za-z0-9_\-]+>|@\S+)\s*/, '').trim();
      if (!/^(报时|现在几点|现在时间|现在几点钟|几点|几点钟|看时间|时间)$/.test(content)) return;
      await this.doReport(ctx, event.group_openid, event.id);
    } catch(e) {}
  },

  doReport: async function(ctx, groupId, msgId) {
    try {
      var t = this.nowParts();
      var text = '🕐 报时\n━━━━━━━━━━━━━━\n' + t.ymd + ' ' + t.hms + ' ' + t.week + '\n· 北京时间（UTC+8）\n━━━━━━━━━━━━━━\n' + ctx.link.linkify('发送「主菜单」', '主菜单') + '返回';
      var imgOk = false;
      try {
        var png = await this.buildTimeImage(t);
        if (png && png.length > 1024) {
          var up = await ctx.bot.uploadGroupImageBuffer(groupId, png, 'time.png');
          if (up && (up.file_info || up.url)) {
            imgOk = !!(await ctx.bot.sendGroupImageMessage(groupId, up.file_info || up.url, msgId));
          }
        }
      } catch(e) {}
      if (!imgOk) {
        try { await ctx.bot.sendGroupMessage(groupId, text, msgId); } catch(e) {}
      }
    } catch(e) {}
  },

  nowParts: function() {
    var d = new Date(Date.now() + 8 * 3600 * 1000);
    var pad = function(n) { return String(n).padStart(2, '0'); };
    var weeks = ['日', '一', '二', '三', '四', '五', '六'];
    return {
      ymd: d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()),
      hms: pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()),
      week: '星期' + weeks[d.getUTCDay()],
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      min: d.getUTCMinutes(),
      sec: d.getUTCSeconds(),
      hm: pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes())
    };
  },

  escXml: function(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

  buildTimeImage: function(t) {
    return new Promise(function(resolve) {
      try {
        var sharp = require('sharp');
        var font = 'Noto Sans CJK SC, WenQuanYi Micro Hei, Microsoft YaHei, PingFang SC, sans-serif';
        var digitFont = 'DejaVu Sans Mono, Noto Sans Mono, monospace';
        var dots = '';
        for (var i = 0; i < 16; i++) {
          var dx = 30 + Math.round(Math.random() * 700);
          var dy = 30 + Math.round(Math.random() * 400);
          var dr = 2 + Math.round(Math.random() * 5);
          dots += '<circle cx="' + dx + '" cy="' + dy + '" r="' + dr + '" fill="rgba(255,255,255,0.12)"/>';
        }
        var svg = '<svg width="760" height="460" xmlns="http://www.w3.org/2000/svg">' +
          '<defs>' +
          '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">' +
          '<stop offset="0%" stop-color="#0f172a"/><stop offset="60%" stop-color="#1e3a8a"/><stop offset="100%" stop-color="#0f2b5b"/>' +
          '</linearGradient>' +
          '</defs>' +
          '<rect width="760" height="460" fill="url(#bg)"/>' +
          dots +
          '<circle cx="700" cy="60" r="110" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="24"/>' +
          '<circle cx="720" cy="380" r="70" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="18"/>' +
          '<text x="380" y="92" font-size="26" font-family="' + font + '" fill="rgba(255,255,255,0.7)" text-anchor="middle" letter-spacing="8">北京时间 UTC+8</text>' +
          '<text x="380" y="260" font-size="118" font-family="' + digitFont + '" font-weight="bold" fill="#ffffff" text-anchor="middle" letter-spacing="4">' + t.hm + '</text>' +
          '<line x1="140" y1="300" x2="620" y2="300" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>' +
          '<text x="380" y="352" font-size="30" font-family="' + font + '" fill="#e2e8f0" text-anchor="middle">' + t.ymd + ' ' + t.week + '</text>' +
          '<text x="380" y="404" font-size="18" font-family="' + font + '" fill="rgba(255,255,255,0.5)" text-anchor="middle">PHP · QQ机器人平台 · 报时</text>' +
          '</svg>';
        sharp(Buffer.from(svg)).png().toBuffer().then(resolve, function() { resolve(null); });
      } catch(e) { resolve(null); }
    });
  }
};
