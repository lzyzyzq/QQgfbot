// ============================================================
// AI唱歌 v1.0.0 - 「AI唱 歌名」：搜歌 → 调本地换声服务(GPU/CPU 均可) → 语音条发回
// ------------------------------------------------------------
// 普通用户命令：
//   AI唱 <歌名> / AI唱歌 <歌名>  → 点歌换声（例：AI唱 海阔天空）
// 主人命令：
//   AI唱配置 <服务地址> [音色名]  → 设置换声服务（例：AI唱配置 http://127.0.0.1:8765 ayaka）
//   AI唱状态                     → 查看服务状态与可用音色
// 说明：本插件只负责「搜歌 + 调 HTTP 服务 + 发语音条」，换声由部署在服务器上的
//   tools/ai-sing-server 完成（RVC 纯 CPU/GPU 推理）。20 秒片段 CPU 合成约需 1~4 分钟，
//   完成后自动把语音条发进群。
// 换声服务协议：POST /job {url, model, start, dur} → {job_id}；
//   GET /job/<id> → {status: pending|done|error, audio_url}；GET /audio/<id>.mp3 取音频。
// ============================================================
module.exports = {
  manifest: {
    id: 'ai-sing',
    name: 'AI唱歌',
    version: '1.0.0',
    description: 'AI唱歌：AI唱/唱歌歌名 + 歌名，搜歌后用 RVC 换声并以语音条播放（需本地换声服务）',
    author: '511742399'
  },

  methods: {
    // ========== 权限：超主 + 主人 ==========
    getSuperId: function(ctx) {
      var raw = ctx.storage.get('super_master_id') || '';
      try { var obj = JSON.parse(raw); return obj.id || ''; } catch(e) { return raw; }
    },
    getMinis: function(ctx) {
      try { return JSON.parse(ctx.storage.get('mini_masters') || '[]'); } catch(e) { return []; }
    },
    isMaster: function(ctx, uid) {
      var self = this;
      var superId = self.getSuperId(ctx);
      if (superId && (superId === uid || (ctx.identity && ctx.identity.isSameUser && ctx.identity.isSameUser(superId, uid)))) return true;
      var minis = self.getMinis(ctx);
      for (var i = 0; i < minis.length; i++) {
        if (!minis[i] || !minis[i].activated) continue;
        if (minis[i].id === uid) return true;
        try { if (ctx.identity && ctx.identity.isSameUser && ctx.identity.isSameUser(minis[i].id, uid)) return true; } catch(e) {}
      }
      return false;
    },

    // ========== 配置读写 ==========
    getCfg: function(ctx) {
      try { return JSON.parse(ctx.storage.get('aising_cfg') || '{}'); } catch(e) { return {}; }
    },
    setCfg: function(ctx, base, model) {
      var cfg = this.getCfg(ctx);
      if (base) cfg.base = String(base).replace(/\/+$/, '');
      if (model) cfg.model = String(model).trim();
      ctx.storage.set('aising_cfg', JSON.stringify(cfg));
      return cfg;
    },

    // ========== 网易云搜索（取第一首） ==========
    neteaseSearch: function(keyword) {
      return new Promise(function(resolve) {
        try {
          var httpMod = require('https');
          var url = 'https://music.163.com/api/search/get/web?s=' + encodeURIComponent(keyword) + '&type=1&limit=1';
          var req = httpMod.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Referer': 'https://music.163.com/' },
            timeout: 10000
          }, function(res) {
            var body = '';
            res.on('data', function(c) { body += c; });
            res.on('end', function() {
              try {
                var j = JSON.parse(body);
                var songs = j && j.result && j.result.songs;
                if (songs && songs.length) {
                  var s = songs[0];
                  resolve({
                    id: s.id,
                    name: s.name,
                    artist: ((s.artists || []).map(function(a) { return a.name; }).join(' / ')) || '未知歌手',
                    album: (s.album && s.album.name) || ''
                  });
                } else resolve(null);
              } catch(e) { resolve(null); }
            });
            res.on('error', function() { resolve(null); });
          });
          req.on('error', function() { resolve(null); });
          setTimeout(function() { try { req.destroy(); } catch(e) {} resolve(null); }, 11000);
        } catch(e) { resolve(null); }
      });
    },

    // ========== HTTP JSON 请求（Node https/http 自适应） ==========
    httpJson: function(url, options) {
      return new Promise(function(resolve, reject) {
        try {
          var httpMod = /^https:/.test(url) ? require('https') : require('http');
          var opt = { method: 'GET', timeout: 20000 };
          if (options) { if (options.method) opt.method = options.method; if (options.headers) opt.headers = options.headers; if (options.body) { opt.method = options.method || 'POST'; opt.headers = Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(options.body) }, opt.headers); } }
          var req = httpMod.request(url, opt, function(res) {
            var body = '';
            res.on('data', function(c) { body += c; });
            res.on('end', function() { resolve({ status: res.statusCode, body: body }); });
            res.on('error', function(e) { reject(e); });
          });
          req.on('error', function(e) { reject(e); });
          if (options && options.body) req.write(options.body);
          req.end();
          setTimeout(function() { try { req.destroy(); } catch(e) {} reject(new Error('timeout')); }, 22000);
        } catch(e) { reject(e); }
      });
    },

    // ========== 下载二进制（mp3） ==========
    httpBuffer: function(url, maxBytes) {
      return new Promise(function(resolve, reject) {
        try {
          var httpMod = /^https:/.test(url) ? require('https') : require('http');
          var req = httpMod.get(url, { timeout: 20000 }, function(res) {
            if (res.statusCode !== 200) { try { res.resume(); } catch(e) {} return reject(new Error('http' + res.statusCode)); }
            var chunks = [], len = 0;
            res.on('data', function(c) { chunks.push(c); len += c.length; if (len > (maxBytes || 15 * 1024 * 1024)) { try { req.destroy(); } catch(e) {} reject(new Error('too large')); } });
            res.on('end', function() { resolve(Buffer.concat(chunks)); });
            res.on('error', function(e) { reject(e); });
          });
          req.on('error', function(e) { reject(e); });
          setTimeout(function() { try { req.destroy(); } catch(e) {} reject(new Error('timeout')); }, 22000);
        } catch(e) { reject(e); }
      });
    },

    // ========== 通过开放平台富媒体发送群语音条 ==========
    sendVoice: async function(ctx, groupId, audioBuffer, msgId) {
      try {
        var up = await ctx.bot.uploadGroupVoiceBuffer(groupId, audioBuffer, 'ai-sing.mp3');
        if (up && up.file_info) {
          var r = await ctx.bot.sendGroupVoiceMessage(groupId, up.file_info, msgId);
          return !!r;
        }
      } catch(e) {}
      return false;
    }
  },

  onEnable: function(ctx) {
    var self = this;

    function reply(data, text) {
      try {
        if (data.groupId) ctx.bot.sendGroupMessage(data.groupId, text, data.id);
        else if (data.author && (data.author.id || data.author.openid)) {
          var pid = data.author.id || data.author.openid;
          if (ctx.bot.sendPrivateMessage) ctx.bot.sendPrivateMessage(pid, text, data.id);
          else ctx.bot.sendGroupMessage(data.groupId, text, data.id);
        }
      } catch(e) { ctx.logger.error('AI唱歌发送失败：' + e.message); }
    }

    async function doSing(data, keyword) {
      var cfg = self.methods.getCfg(ctx);
      if (!cfg.base) { reply(data, 'AI 唱歌未配置服务地址。请主人发送「AI唱配置 服务地址 音色名」\n例：AI唱配置 http://127.0.0.1:8765 ayaka'); return; }
      var model = cfg.model || '';
      var song = await self.methods.neteaseSearch(keyword);
      if (!song) { reply(data, '未找到「' + keyword + '」，换个歌名试试。'); return; }
      var url = 'https://music.163.com/song/media/outer/url?id=' + song.id + '.mp3';
      reply(data, '🎤 AI唱《' + song.name + '》' + (song.artist ? '（' + song.artist + '）' : '') + '\n已交给换声服务合成（CPU 约 1-4 分钟，完成后自动发语音条）\n请稍候…');
      var jr = await self.methods.httpJson(cfg.base + '/job', { method: 'POST', body: JSON.stringify({ url: url, model: model, start: 30, dur: 25 }) });
      var jid = '';
      try { jid = (JSON.parse(jr.body).job_id) || ''; } catch(e) {}
      if (!jid) {
        var msg = 'AI 换声服务调用失败：' + (jr.status || '') + ' ' + String(jr.body || '').slice(0, 120);
        reply(data, msg);
        return;
      }
      // 轮询任务（最长 8 分钟，每 10 秒一次）
      var ok = false;
      for (var i = 0; i < 48; i++) {
        await new Promise(function(r) { setTimeout(r, 10000); });
        var st;
        try {
          var gr = await self.methods.httpJson(cfg.base + '/job/' + jid);
          st = JSON.parse(gr.body);
        } catch(e) {}
        if (!st) continue;
        if (st.status === 'done' && st.audio_url) {
          var mp3 = await self.methods.httpBuffer(cfg.base + st.audio_url);
          if (mp3 && mp3.length > 4096) {
            var voiceOk = await self.methods.sendVoice(ctx, data.groupId, mp3, data.id);
            reply(data, voiceOk ? '🎤《' + song.name + '》AI 版已发语音条' : '✅ 换声完成，但语音条发送失败（请主人检查机器人富媒体语音权限）');
          } else { reply(data, '换声完成但音频为空，请重试。'); }
          ok = true;
          break;
        } else if (st.status === 'error') {
          reply(data, 'AI 换声失败：' + String(st.message || '').slice(0, 200));
          ok = true;
          break;
        }
      }
      if (!ok) reply(data, '⏱ AI 换声超时（超过 8 分钟），请主人检查换声服务是否正常。');
    }

    function helpAI(data) {
      reply(data, 'AI 唱歌\n━━━━━━━━━━━━━━\n发送「AI唱 歌名」即可让机器人换声演唱\n例：AI唱 海阔天空\n（截取副歌段约 25 秒，CPU 合成 1-4 分钟）\n━━━━━━━━━━━━━━\n主人配置：AI唱配置 <服务地址> [音色名]\n状态查看：AI唱状态\n发送"主菜单"返回');
    }

    async function handle(data) {
      var authorId = (data.author && (data.author.id || data.author.openid)) || '';
      if (!authorId) return;
      var content = String(data.content || '').replace(/^\s*(?:<@!?[A-Za-z0-9_-]+>|@\S+)\s*/, '').trim();
      var m = content.match(/^(?:AI唱|AI唱歌|ai唱|aic?h?[a-z]*唱|机器人唱|换声唱)(?:\s+(\S.*))?$/i);
      if (!m) return;
      var kw = (m[1] || '').trim();
      if (!kw) { helpAI(data); return; }
      await doSing(data, kw);
    }

    async function handleOwner(data) {
      var authorId = (data.author && (data.author.id || data.author.openid)) || '';
      if (!authorId || !self.methods.isMaster(ctx, authorId)) return;
      var content = String(data.content || '').trim();
      var m = content.match(/^AI唱配置\s+(\S+)(?:\s+(\S+))?$/i);
      if (m) {
        var cfg = self.methods.setCfg(ctx, m[1], m[2] || '');
        reply(data, 'AI 唱歌服务已配置：' + cfg.base + (cfg.model ? '\n音色：' + cfg.model : '\n未指定音色，可用「AI唱状态」查看') + '\n试试发送「AI唱 歌名」');
        return;
      }
      if (/^AI唱状态$/i.test(content)) {
        var c2 = self.methods.getCfg(ctx);
        var st = 'AI 唱歌服务状态\n━━━━━━━━━━━━━━\n服务地址：' + (c2.base || '未配置') + '\n音色：' + (c2.model || '未指定') + '\n━━━━━━━━━━━━━━\n';
        if (c2.base) {
          try {
            var r = await self.methods.httpJson(c2.base + '/health');
            var h = JSON.parse(r.body);
            st += '服务在线 ✅\n可用音色：' + ((h.models || []).join(' / ') || '（无）');
          } catch(e) { st += '服务离线 ❌\n请确认 tools/ai-sing-server 已启动（bash run.sh）'; }
        }
        reply(data, st);
        return;
      }
    }

    ctx.eventBus.on('message.group', async function(data) {
      try { await handleOwner(data); await handle(data); } catch(e) { ctx.logger.error('AI唱歌异常：' + String(e && e.message || e)); }
    });
    ctx.eventBus.on('message.c2c', async function(data) {
      try { await handleOwner(data); await handle(data); } catch(e) { ctx.logger.error('AI唱歌异常：' + String(e && e.message || e)); }
    });
    ctx.logger.info('AI唱歌 v1.0.0 已启用（AI唱 歌名 / AI唱配置 / AI唱状态）');
  }
};
