// 唱歌 v2.3.0 - 点歌：发送「唱歌 歌名」，先发歌词，再以语音条播放该歌曲（开放平台富媒体语音）
// 语音源修复 v2.2.1：酷我 antiserver 对部分歌曲返回 5 秒版权提示音（"当前歌曲仅在酷我音乐手机端可播放..."），
//   改为多源级联：① 网易云 player/url（免费歌返回真实 CDN 全曲）→ ② 网易云 outer 直链 → ③ 酷我搜索结果遍历 antiserver 并按 mp3 时长校验（>=20 秒才采用，唱出完整歌曲；不足 20 秒取最长 >=8s 兜底）
//   ④ 全部失败降级单曲卡片，并明确说明未取到语音源的原因（VIP/无版权/源站限制）
// 说明：本插件为「点歌」玩法——将歌曲原唱音频下载后以语音条播放，并非 AI 合成唱腔。
// 新增指令：清唱/听清唱（搜索"歌名 清唱"）、怪唱/听怪唱（搜索"歌名 怪唱"），找不到版本则回退原版
// 歌词源：网易云 LRC（过滤元信息行）
module.exports = {
  manifest: {
    id: 'mod-sing',
    name: '唱歌',
    version: '2.3.0',
    description: '点歌功能：唱歌/点歌/唱首歌 + 歌名，先发歌词再以语音条播放；支持 清唱/怪唱 版本；失败返回单曲试听卡片',
    author: '511742399'
  },

  methods: {
    // ===== 网易云搜索（取第一首） =====
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
                    album: (s.album && s.album.name) || '',
                    cover: (s.album && s.album.picUrl) || '',
                    duration: s.duration || 0
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

    // ===== 网易云歌词（LRC 转纯文本，过滤元信息行） =====
    neteaseLyric: function(id) {
      return new Promise(function(resolve) {
        try {
          var httpMod = require('https');
          var url = 'https://music.163.com/api/song/lyric?id=' + id + '&lv=1&kv=1&tv=-1';
          var req = httpMod.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://music.163.com/' },
            timeout: 10000
          }, function(res) {
            var body = '';
            res.on('data', function(c) { body += c; });
            res.on('end', function() {
              try {
                var j = JSON.parse(body);
                var lrc = (j && j.lrc && j.lrc.lyric) ? String(j.lrc.lyric) : '';
                if (!lrc) return resolve('');
                var lines = lrc.split('\n');
                var out = [];
                for (var i = 0; i < lines.length; i++) {
                  var line = lines[i].replace(/\[[^\]]*\]/g, '').trim();
                  if (!line) continue;
                  if (/^(作词|作曲|编曲|制作|混音|母带|录音|监制|和声|吉他|贝斯|鼓|键盘|弦乐|发行|出品|版权|OP|SP|策划|统筹|视觉|封面|翻译|录音室|混音室|监制|Program|Publisher|Arranger)\s*[:：]/.test(line)) continue;
                  out.push(line);
                  if (out.length >= 26) break;
                }
                resolve(out.join('\n'));
              } catch(e) { resolve(''); }
            });
            res.on('error', function() { resolve(''); });
          });
          req.on('error', function() { resolve(''); });
          setTimeout(function() { try { req.destroy(); } catch(e) {} resolve(''); }, 11000);
        } catch(e) { resolve(''); }
      });
    },

    // ===== 网易云播放直链（player/url 接口）：免费歌返回真实 CDN url，VIP 歌返回 null =====
    neteasePlayUrl: function(id) {
      return new Promise(function(resolve) {
        try {
          var httpMod = require('https');
          var url = 'https://music.163.com/api/song/enhance/player/url?ids=[' + id + ']&br=128000';
          var req = httpMod.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Referer': 'https://music.163.com/' },
            timeout: 10000
          }, function(res) {
            var body = '';
            res.on('data', function(c) { body += c; });
            res.on('end', function() {
              try {
                var j = JSON.parse(body);
                var u = j.data && j.data[0] && j.data[0].url;
                resolve(u && /^https?:/.test(u) ? u : '');
              } catch(e) { resolve(''); }
            });
            res.on('error', function() { resolve(''); });
          });
          req.on('error', function() { resolve(''); });
          setTimeout(function() { try { req.destroy(); } catch(e) {} resolve(''); }, 11000);
        } catch(e) { resolve(''); }
      });
    },

    // ===== mp3 时长估算（跳过 ID3 头，按第一帧 bitrate 估算） =====
    mp3Duration: function(buf) {
      try {
        if (!buf || buf.length < 8) return 0;
        var off = 0;
        if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
          var sz = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
          off = 10 + sz;
        }
        var i = off;
        while (i + 4 <= buf.length) {
          if (buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0) {
            var brIdx = (buf[i + 2] >> 4) & 15;
            var brt = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
            var bitrate = brt[brIdx];
            if (bitrate) {
              var sec = (buf.length - off) / (bitrate * 1000 / 8);
              return Math.round(sec * 10) / 10;
            }
          }
          i++;
        }
      } catch(e) {}
      return 0;
    },

    // ===== 酷我音乐搜索（返回 [{name, artist, rid}]） =====
    kuwoSearch: function(kw) {
      return new Promise(function(resolve) {
        try {
          var httpMod = require('https');
          var url = 'https://search.kuwo.cn/r.s?client=kt&all=' + encodeURIComponent(kw) + '&pn=0&rn=3&encoding=utf8&vipver=1&ver=kwplayer_ar_9.0.0.0&showtype=1&stype=1&strategy=2012&rformat=json&t=8&uid=0&loginUid=0&source=kwplayer_ar_9.0.0.0';
          var req = httpMod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 }, function(res) {
            var body = '';
            res.on('data', function(c) { body += c; });
            res.on('end', function() {
              try {
                var names = body.match(/'NAME':'([^']*)'/g) || [];
                var artists = body.match(/'ARTIST':'([^']*)'/g) || [];
                var rids = body.match(/'MUSICRID':'MUSIC_(\d+)'/g) || [];
                var out = [];
                for (var i = 0; i < rids.length; i++) {
                  var nm = names[i] ? module.exports.methods.decodeHtml(names[i].replace(/'NAME':'/, '').slice(0, -1)) : '';
                  var ar = artists[i] ? module.exports.methods.decodeHtml(artists[i].replace(/'ARTIST':'/, '').slice(0, -1)) : '';
                  var rid = rids[i].replace(/'MUSICRID':'MUSIC_/, '').slice(0, -1);
                  out.push({ name: nm, artist: ar, rid: rid });
                }
                resolve(out);
              } catch(e) { resolve([]); }
            });
            res.on('error', function() { resolve([]); });
          });
          req.on('error', function() { resolve([]); });
          setTimeout(function() { try { req.destroy(); } catch(e) {} resolve([]); }, 11000);
        } catch(e) { resolve([]); }
      });
    },

    // ===== 酷我试听直链解析（antiserver 返回 mp3 真实 URL 文本） =====
    kuwoPlayUrl: function(rid) {
      return new Promise(function(resolve) {
        try {
          var httpMod = require('https');
          var url = 'https://antiserver.kuwo.cn/anti.s?type=convert_url&rid=MUSIC_' + rid + '&format=mp3';
          var req = httpMod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 }, function(res) {
            var body = '';
            res.on('data', function(c) { body += c; });
            res.on('end', function() {
              body = body.trim();
              resolve(/^https?:\/\//.test(body) ? body : '');
            });
            res.on('error', function() { resolve(''); });
          });
          req.on('error', function() { resolve(''); });
          setTimeout(function() { try { req.destroy(); } catch(e) {} resolve(''); }, 11000);
        } catch(e) { resolve(''); }
      });
    },

    decodeHtml: function(s) {
      return String(s).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    },

    // ===== 下载音频（http/https 自适应）到内存 Buffer =====
    downloadAudio: function(audioUrl) {
      return new Promise(function(resolve) {
        try {
          var httpMod = /^https:/.test(audioUrl) ? require('https') : require('http');
          var req = httpMod.get(audioUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 25000
          }, function(res) {
            if (res.statusCode !== 200) { try { res.resume(); } catch(e) {} return resolve(null); }
            var chunks = [];
            var len = 0;
            res.on('data', function(c) { chunks.push(c); len += c.length; if (len > 24 * 1024 * 1024) { try { req.destroy(); } catch(e) {} resolve(null); } });
            res.on('end', function() { resolve(len > 1024 ? Buffer.concat(chunks) : null); });
            res.on('error', function() { resolve(null); });
          });
          req.on('error', function() { resolve(null); });
          setTimeout(function() { try { req.destroy(); } catch(e) {} resolve(null); }, 26000);
        } catch(e) { resolve(null); }
      });
    },

    // ===== 通过开放平台富媒体发送群语音条（msg_type=7 + file_info） =====
    sendVoice: async function(ctx, groupId, audioBuffer, msgId) {
      try {
        var up = await ctx.bot.uploadGroupVoiceBuffer(groupId, audioBuffer, 'song.mp3');
        if (up && up.file_info) {
          var r = await ctx.bot.sendGroupVoiceMessage(groupId, up.file_info, msgId);
          return !!r;
        }
      } catch(e) {}
      return false;
    },

    // ===== 多源级联获取可播放音频 Buffer（网易云 player/url → 网易云 outer 直链 → 酷我 antiserver 遍历 + 时长校验） =====
    fetchPlayable: async function(song) {
      // ① 网易云 player/url（免费歌全曲）
      try {
        var u = await this.neteasePlayUrl(song.id);
        if (u) {
          var a = await this.downloadAudio(u);
          if (a && this.mp3Duration(a) >= 20) return a;
        }
      } catch(e) {}
      // ② 网易云 outer 直链（对多数免费歌可返回全曲重定向；VIP/受限时下载为非 200 或空，自动跳过）
      try {
        var outer = 'https://music.163.com/song/media/outer/url?id=' + song.id + '.mp3';
        var ao = await this.downloadAudio(outer);
        if (ao && this.mp3Duration(ao) >= 20) return ao;
      } catch(e) {}
      // ③ 酷我 antiserver 遍历：多关键词合并候选，按匹配度排序，下载并校验时长（>=20s 即用，否则取最长 >=8s）
      try {
        var cands = [];
        var seen = {};
        var kws = [];
        if (song.artist) kws.push(song.name + ' ' + String(song.artist).split('/')[0].trim());
        kws.push(song.name);
        for (var k = 0; k < kws.length; k++) {
          var rr = await this.kuwoSearch(kws[k]);
          for (var i = 0; i < rr.length; i++) {
            var it = rr[i];
            if (seen[it.rid]) continue;
            seen[it.rid] = 1;
            var nOk = it.name && (it.name.indexOf(song.name) >= 0 || song.name.indexOf(it.name) >= 0);
            var aOk = it.artist && (String(song.artist).split('/')[0].indexOf(it.artist.split('&')[0]) >= 0 || it.artist.indexOf(song.artist) >= 0);
            cands.push({ item: it, score: (nOk && aOk) ? 2 : (nOk ? 1 : 0) });
          }
        }
        cands.sort(function(x, y) { return y.score - x.score; });
        var best = null, bestDur = 0;
        for (var j = 0; j < cands.length && j < 5; j++) {
          var pu = await this.kuwoPlayUrl(cands[j].item.rid);
          if (!pu) continue;
          var a2 = await this.downloadAudio(pu);
          if (a2) {
            var d = this.mp3Duration(a2);
            if (d > bestDur) { bestDur = d; best = a2; }
            if (d >= 20) return a2;
          }
        }
        if (best && bestDur >= 8) return best;
      } catch(e) {}
      return null;
    },

    handleCommand: async function(ctx, data) {
      var content = (data.content || '').trim().replace(/^\s*(?:<@!?[A-F0-9]+>|@\S+)\s*/, '').trim();
      var mode = 'sing';
      var keyword = '';
      var m = content.match(/^(唱歌|点歌|唱首歌|听歌|我要听|听首歌|点首歌|来一首)(.*)$/);
      var m2 = content.match(/^(清唱|听清唱)(.*)$/);
      var m3 = content.match(/^(怪唱|听怪唱)(.*)$/);
      if (m2) { mode = 'qing'; keyword = (m2[2] || '').trim(); }
      else if (m3) { mode = 'guai'; keyword = (m3[2] || '').trim(); }
      else if (m) { keyword = (m[2] || '').trim(); }
      else return false;
      var groupId = data.groupId;
      var userId = (data.author && data.author.openid) || '';
      var msgId = data.id;
      if (!groupId) {
        try { await ctx.bot.sendPrivateMessage(userId, '🎵 点歌请在群聊中使用\n发送「唱歌 歌名」例如：唱歌 海阔天空', msgId); } catch(e) {}
        return true;
      }
      if (!keyword) {
        var helpMode = mode === 'qing' ? '清唱' : (mode === 'guai' ? '怪唱' : '唱歌');
        try { await ctx.bot.sendGroupMessage(groupId, '🎵 ' + helpMode + '\n━━━━━━━━━━━━━━\n发送「' + helpMode + ' 歌名」即可' + (mode === 'sing' ? '点歌' : '') + '\n例：' + helpMode + ' 海阔天空\n也可以：' + (mode === 'sing' ? '点歌 / 唱首歌 / 我要听 + 歌名' : '听' + helpMode + ' + 歌名') + '\n━━━━━━━━━━━━━━\n发送"主菜单"返回', msgId); } catch(e) {}
        return true;
      }
      var enc = encodeURIComponent(keyword);
      var qqUrl = 'https://y.qq.com/n/ryqq/search?w=' + enc;
      var wyUrl = 'https://music.163.com/#/search/m/?s=' + enc;
      var kgUrl = 'https://www.kugou.com/yy/html/search.html#searchType=song&searchKeyWord=' + enc;
      var kwUrl = 'https://www.kuwo.cn/search/list?key=' + enc;

      // 搜索歌曲（清唱/怪唱优先搜版本，歌名不相关视为未命中并回退原版）
      var song = null;
      if (mode === 'qing') {
        song = await this.neteaseSearch(keyword + ' 清唱');
        if (song && song.name.indexOf(keyword) < 0 && keyword.indexOf(song.name) < 0) song = null;
        if (!song) song = await this.neteaseSearch(keyword);
      } else if (mode === 'guai') {
        song = await this.neteaseSearch(keyword + ' 怪唱');
        if (song && song.name.indexOf(keyword) < 0 && keyword.indexOf(song.name) < 0) song = null;
        if (!song) song = await this.neteaseSearch(keyword);
      } else {
        song = await this.neteaseSearch(keyword);
      }
      if (!song) {
        // 降级：四平台搜索链接卡片
        var fallbackMd = '### 🎵 点歌 · ' + keyword + '\n' +
          '暂未找到「' + keyword + '」的单曲直链，为你打开各平台搜索：\n\n' +
          '1. [🎵 QQ音乐](' + qqUrl + ')\n' +
          '2. [🎶 网易云音乐](' + wyUrl + ')\n' +
          '3. [🎧 酷狗音乐](' + kgUrl + ')\n' +
          '4. [🎤 酷我音乐](' + kwUrl + ')\n\n' +
          '---\nPHP · QQ机器人平台';
        try {
          var ok = await ctx.bot.sendMarkdownGroup(groupId, fallbackMd, msgId);
          if (ok) return true;
        } catch(e) {}
        try {
          await ctx.bot.sendGroupMessage(groupId, '🎵 点歌 · ' + keyword + '\n━━━━━━━━━━━━━━\n1. QQ音乐 ' + qqUrl + '\n2. 网易云 ' + wyUrl + '\n3. 酷狗 ' + kgUrl + '\n4. 酷我 ' + kwUrl + '\n━━━━━━━━━━━━━━\n发送"主菜单"返回', msgId);
        } catch(e) {}
        return true;
      }

      var audioUrl = 'https://music.163.com/song/media/outer/url?id=' + song.id + '.mp3';
      var mm = Math.floor((song.duration || 0) / 1000);
      var dur = (mm >= 60 ? Math.floor(mm / 60) + ':' + ((mm % 60) < 10 ? '0' : '') + (mm % 60) + '分' : mm + '秒');

      // 1. 先发歌词
      var lyricSent = false;
      try {
        var lyric = await this.neteaseLyric(song.id);
        if (lyric) {
          await ctx.bot.sendGroupMessage(groupId, '📜 《' + song.name + '》 歌词\n━━━━━━━━━━━━━━\n' + lyric + '\n━━━━━━━━━━━━━━\n🎵 稍后语音播放，请稍候…', msgId);
          lyricSent = true;
        }
      } catch(e) {}

      // 2. 多源级联获取可播放音频并以语音条播放
      var voiceOk = false;
      try {
        var audio = await this.fetchPlayable(song);
        if (audio) {
          voiceOk = await this.sendVoice(ctx, groupId, audio, msgId);
        }
      } catch(e) {}
      var voiceMsg = voiceOk ? '🎤 已在群内语音播放《' + song.name + '》\n' : '';
      var warnMsg = '';
      if (!voiceOk) {
        warnMsg = '⚠️ 未能以语音条播放（该曲多为 VIP / 无版权 / 源站限制，或群内语音接口受限）\n以下为原唱在线试听/搜索入口\n━━━━━━━━━━━━━━\n';
      }

      // 3. 单曲卡片
      var cardMd = '### 🎵 ' + song.name + '\n' +
        (voiceMsg ? voiceMsg : warnMsg) +
        '🎤 歌手：' + song.artist + '\n' +
        (song.album ? '💿 专辑：' + song.album + '\n' : '') +
        '⏱ 时长：' + dur + '\n\n' +
        '▶️ [立即试听](' + audioUrl + ')\n\n' +
        '---\n🔍 各平台搜索\n' +
        '[QQ音乐](' + qqUrl + ') · [网易云](' + wyUrl + ') · [酷狗](' + kgUrl + ') · [酷我](' + kwUrl + ')\n' +
        '---\nPHP · QQ机器人平台';

      // 先发封面图（可选，失败忽略）
      if (song.cover && !voiceOk) {
        try {
          var up = await ctx.bot.uploadGroupImage(groupId, song.cover);
          if (up && (up.file_info || up.url)) {
            await ctx.bot.sendGroupImageMessage(groupId, up.file_info || up.url, msgId);
          }
        } catch(e) {}
      }

      try {
        var ok2 = await ctx.bot.sendMarkdownGroup(groupId, cardMd, msgId);
        if (ok2) return true;
      } catch(e) {}
      try {
        await ctx.bot.sendGroupMessage(groupId, '🎵 ' + song.name + '（' + song.artist + '）\n▶️ 试听：' + audioUrl + '\n🔍 QQ音乐 ' + qqUrl + '\n🔍 网易云 ' + wyUrl + '\n发送"主菜单"返回', msgId);
      } catch(e) {}
      return true;
    }
  },

  onEnable: function(ctx) {
    var self = this;
    ctx.eventBus.on('message.group', async function(data) {
      try { await self.methods.handleCommand(ctx, data); } catch(e) { ctx.logger.error('唱歌插件异常: ' + String(e && e.message || e)); }
    });
    ctx.eventBus.on('message.guild', async function(data) {
      try { await self.methods.handleCommand(ctx, data); } catch(e) { ctx.logger.error('唱歌插件异常: ' + String(e && e.message || e)); }
    });
    ctx.eventBus.on('message.c2c', async function(data) {
      try { await self.methods.handleCommand(ctx, data); } catch(e) { ctx.logger.error('唱歌插件异常: ' + String(e && e.message || e)); }
    });
  }
};
