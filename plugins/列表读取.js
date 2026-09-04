// ============================================================
// 列表读取 v1.0.0 - QQ 群内直接回复「读取 GitHub / 云端列表」
// ------------------------------------------------------------
// 命令（仅超级主人 / 主人可使用）：
//   更新内容             → 云端最新版本号 + 本轮更新内容（update-config.json）
//   版本列表             → GitHub 全部 Release 版本列表（版本+日期+补丁/全量包名）
//   插件列表             → 插件与文档包下载列表（releases.json plugins）
//   广播列表             → GitHub 云端广播任务清单（broadcast/broadcast.json）
// 数据源：AI 服务器 8091 唯一（GitHub 不再作机器人内容源，代码仓库仍照常同步）。
// ============================================================
module.exports = {
  manifest: {
    id: 'builtin-lists',
    name: '列表读取',
    version: '1.0.0',
    description: '群内直接回复读取列表：更新内容 / 版本列表 / 插件列表 / 广播列表（仅超主/主人）',
    author: '511742399'
  },

  methods: {
    // ========== 权限：超主 + 主人（mini_masters） ==========
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
    }
  },

  onEnable: function(ctx) {
    var self = this;

    var SI = 'https://8091-6f61dc7363389b7a.monkeycode-ai.online';
    var SRC = {
      config: [SI + '/update-config.json'],
      releases: [SI + '/releases.json'],
      broadcast: [SI + '/broadcast/broadcast.json']
    };

    async function fetchText(url, timeoutMs) {
      var ctrl = new AbortController();
      var t = setTimeout(function() { try { ctrl.abort(); } catch(e) {} }, timeoutMs || 6000);
      try {
        var r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'qq-bot-list-reader' } });
        if (!r.ok) return null;
        return await r.text();
      } catch(e) { return null; } finally { clearTimeout(t); }
    }

    // 多源依次取第一份可用 JSON
    async function fetchFirstJson(urls) {
      for (var i = 0; i < urls.length; i++) {
        var text = await fetchText(urls[i]);
        if (text) {
          try { return { source: urls[i], json: JSON.parse(text) }; } catch(e) {}
        }
      }
      return null;
    }

    function reply(data, text) {
      try {
        if (data.groupId) ctx.bot.sendGroupMessage(data.groupId, text);
        else if (data.author && data.author.id) ctx.bot.sendPrivateMessage(data.author.id, text);
      } catch(e) { ctx.logger.error('列表读取发送失败：' + e.message); }
    }

    function fmtSrc(src) {
      if (!src) return '';
      var h = src.replace(/^https?:\/\//, '').split('/')[0] || '';
      return '（来源 ' + h + '）';
    }

    // ========== 更新内容 ==========
    function updateContent(data) {
      return fetchFirstJson(SRC.config).then(function(res) {
        if (!res || !res.json) { reply(data, '读取云端更新配置失败：8091 不可用。'); return; }
        var j = res.json;
        var lines = [];
        lines.push('最新版本：v' + (j.version || '未知') + ' ' + fmtSrc(res.source));
        if (j.changeLog) lines.push('【本轮更新内容】\n' + String(j.changeLog).split('\n').slice(0, 12).join('\n'));
        if (j.patchUrl) lines.push('\n补丁包下载：\n' + j.patchUrl);
        reply(data, lines.join('\n'));
      }).catch(function(e) { reply(data, '读取失败：' + e.message); });
    }

    // ========== 版本列表 ==========
    function versionList(data) {
      return fetchFirstJson(SRC.releases).then(function(res) {
        if (!res || !res.json) { reply(data, '读取版本列表失败：8091 不可用。'); return; }
        var j = res.json;
        var rels = Array.isArray(j.releases) ? j.releases : [];
        if (!rels.length) { reply(data, '版本列表为空（仓库暂无 Release）。'); return; }
        var lines = [];
        lines.push('版本列表（' + rels.length + ' 个，最新 ' + rels.length + ' 个） ' + fmtSrc(res.source));
        var show = rels.slice(0, 12);
        for (var i = 0; i < show.length; i++) {
          var r = show[i];
          var mark = r.isCurrent ? '（当前）' : '';
          var patch = (r.patch && r.patch.main) ? r.patch.main.split('/').pop() : '';
          var full = (r.full && r.full.main) ? r.full.main.split('/').pop() : '';
          lines.push((i + 1) + '. v' + r.version + mark + (r.date ? '（' + r.date + '）' : '') + '\n   补丁 ' + patch + '\n   全量 ' + full);
        }
        lines.push('\n下载目录：https://8091-6f61dc7363389b7a.monkeycode-ai.online/');
        reply(data, lines.join('\n'));
      }).catch(function(e) { reply(data, '读取失败：' + e.message); });
    }

    // ========== 插件列表 ==========
    function pluginList(data) {
      return fetchFirstJson(SRC.releases).then(function(res) {
        if (!res || !res.json) { reply(data, '读取插件列表失败：GitHub Pages / raw / 8091 均不可用。'); return; }
        var j = res.json;
        var plugs = Array.isArray(j.plugins) ? j.plugins : [];
        if (!plugs.length) { reply(data, '插件列表为空（site-config.json 未配置插件）。'); return; }
        var lines = [];
        lines.push('插件 / 文档包（' + plugs.length + ' 个） ' + fmtSrc(res.source));
        for (var i = 0; i < plugs.length; i++) {
          var p = plugs[i];
          lines.push((i + 1) + '. ' + p.name + '\n   ' + p.file + (p.desc ? '\n   ' + p.desc : '') + '\n   ' + (p.pages || ''));
        }
        lines.push('\n可在管理面板「插件管理」上传安装。');
        reply(data, lines.join('\n'));
      }).catch(function(e) { reply(data, '读取失败：' + e.message); });
    }

    // ========== 广播列表 ==========
    function broadcastList(data) {
      return fetchFirstJson(SRC.broadcast).then(function(res) {
        if (!res || !res.json) { reply(data, '读取云端广播目录失败：GitHub Pages / raw / 8091 均不可用。'); return; }
        var j = res.json;
        var tasks = Array.isArray(j.tasks) ? j.tasks : (Array.isArray(j) ? j : (j && j.id !== undefined ? [j] : []));
        if (!tasks.length) { reply(data, '云端暂无广播任务（broadcast.json 为空）。'); return; }
        var lines = [];
        lines.push('云端广播任务列表（' + tasks.length + ' 条） ' + fmtSrc(res.source));
        var show = tasks.slice(0, 20);
        for (var i = 0; i < show.length; i++) {
          var t = show[i];
          var sch = t.schedule ? (t.schedule.time ? '每天 ' + t.schedule.time : '每 ' + t.schedule.intervalMin + ' 分钟') : '手动';
          var tgt = t.target === 'all' ? '全部群' : (t.target === 'one' ? '单群' : '目标群');
          var st = t.enabled === false ? '停用' : '启用';
          lines.push((i + 1) + '. [' + st + '] ' + (t.name || t.id) + '（' + tgt + ' · ' + sch + '）');
        }
        lines.push('\n执行/定时发送请发送「云端广播」（测试.py 插件）。');
        reply(data, lines.join('\n'));
      }).catch(function(e) { reply(data, '读取失败：' + e.message); });
    }

    async function handle(data) {
      var authorId = (data.author && (data.author.id || data.author.openid)) || '';
      if (!authorId) return;
      if (!self.methods.isMaster(ctx, authorId)) return;

      var raw = (data.content || '').trim();
      var content = raw.replace(/^\s*(?:<@!?[A-Za-z0-9_-]+>|@\S+)\s*/, '').trim() || raw;

      if (content === '更新内容') { updateContent(data); return; }
      if (content === '版本列表') { versionList(data); return; }
      if (content === '插件列表') { pluginList(data); return; }
      if (content === '广播列表') { broadcastList(data); return; }
    }

    var lid1 = ctx.eventBus.on('message.group', handle);
    var lid2 = ctx.eventBus.on('message.c2c', handle);
    self._listenerIds = [lid1, lid2];
    ctx.logger.info('列表读取 v1.0.0 已启用（命令：更新内容 / 版本列表 / 插件列表 / 广播列表，仅超主/主人）');
  },

  onDisable: function(ctx) {
    if (this._listenerIds) {
      for (var i = 0; i < this._listenerIds.length; i++) ctx.eventBus.off(this._listenerIds[i]);
      this._listenerIds = null;
    }
    ctx.logger.info('列表读取已禁用');
  }
};
