// ============================================================
// 列表读取 v1.0.0 - QQ 群内直接回复「读取 GitHub / 云端列表」
// ------------------------------------------------------------
// 命令（仅超级主人 / 主人可使用）：
//   更新内容             → 云端最新版本号 + 本轮更新内容（update-config.json）
//   版本列表             → GitHub 全部 Release 版本列表（版本+日期+补丁/全量包名）
//   插件列表             → 插件与文档包下载列表（releases.json plugins）
//   广播列表             → GitHub 云端广播任务清单（broadcast/broadcast.json）
// 数据源：AI 服务器 8091 唯一（GitHub 不再作机器人内容源，代码仓库仍照常同步）。
// ReplySpec 回复可视化：仅模板化「表头 / 空态 / 错误句」，可被后台 config
//       plugin.file-列表读取.reply 覆盖；远端 JSON 逐行循环主体与尾行指引维持源码拼接。
// ============================================================
/*__REPLY_SPEC_BEGIN__*/
var REPLY_SPEC = {
  name: '列表读取',
  version: '1.0.0',
  desc: '更新内容/版本列表/插件列表/广播列表 的表头、空态与错误文案（列表循环主体与尾行指引源码拼接，不走模板）',
  branches: [
    {
      key: 'update_head',
      label: '更新内容 · 成功表头（版本+来源）',
      scope: ['group', 'c2c'],
      triggers: ['更新内容'],
      lines: [
        { "t": "text", "v": "最新版本：v{version} {host}" }
      ]
    },
    {
      key: 'update_err',
      label: '更新内容 · 读取云端失败',
      scope: ['group', 'c2c'],
      triggers: ['更新内容'],
      lines: [
        { "t": "text", "v": "读取云端更新配置失败：8091 不可用。" }
      ]
    },
    {
      key: 'rel_head',
      label: '版本列表 · 成功表头（数量+来源）',
      scope: ['group', 'c2c'],
      triggers: ['版本列表'],
      lines: [
        { "t": "text", "v": "版本列表（{n} 个，最新 {n} 个） {host}" }
      ]
    },
    {
      key: 'rel_empty',
      label: '版本列表 · 空态',
      scope: ['group', 'c2c'],
      triggers: ['版本列表'],
      lines: [
        { "t": "text", "v": "版本列表为空（仓库暂无 Release）。" }
      ]
    },
    {
      key: 'rel_err',
      label: '版本列表 · 读取云端失败',
      scope: ['group', 'c2c'],
      triggers: ['版本列表'],
      lines: [
        { "t": "text", "v": "读取版本列表失败：8091 不可用。" }
      ]
    },
    {
      key: 'plug_head',
      label: '插件列表 · 成功表头（数量+来源）',
      scope: ['group', 'c2c'],
      triggers: ['插件列表'],
      lines: [
        { "t": "text", "v": "插件 / 文档包（{n} 个） {host}" }
      ]
    },
    {
      key: 'plug_empty',
      label: '插件列表 · 空态',
      scope: ['group', 'c2c'],
      triggers: ['插件列表'],
      lines: [
        { "t": "text", "v": "插件列表为空（site-config.json 未配置插件）。" }
      ]
    },
    {
      key: 'plug_err',
      label: '插件列表 · 读取云端失败',
      scope: ['group', 'c2c'],
      triggers: ['插件列表'],
      lines: [
        { "t": "text", "v": "读取插件列表失败：GitHub Pages / raw / 8091 均不可用。" }
      ]
    },
    {
      key: 'bc_head',
      label: '广播列表 · 成功表头（数量+来源）',
      scope: ['group', 'c2c'],
      triggers: ['广播列表'],
      lines: [
        { "t": "text", "v": "云端广播任务列表（{n} 条） {host}" }
      ]
    },
    {
      key: 'bc_empty',
      label: '广播列表 · 空态',
      scope: ['group', 'c2c'],
      triggers: ['广播列表'],
      lines: [
        { "t": "text", "v": "云端暂无广播任务（broadcast.json 为空）。" }
      ]
    },
    {
      key: 'bc_err',
      label: '广播列表 · 读取云端失败',
      scope: ['group', 'c2c'],
      triggers: ['广播列表'],
      lines: [
        { "t": "text", "v": "读取云端广播目录失败：GitHub Pages / raw / 8091 均不可用。" }
      ]
    },
    {
      key: 'err_gen',
      label: '通用读取异常（fetch/解析抛错）',
      scope: ['group', 'c2c'],
      triggers: ['更新内容', '版本列表', '插件列表', '广播列表'],
      lines: [
        { "t": "text", "v": "读取失败：{msg}" }
      ]
    }
  ]
};
/*__REPLY_SPEC_END__*/

// ===== ReplySpec 行渲染（与后台 src/admin/reply-editor.ts renderBranch 同语义，单文件自包含）=====
function _rsGet(d, k) {
  if (d && k && d[k] !== undefined && String(d[k]).length) return String(d[k]);
  return '';
}
function _rsVal(ln, d) {
  var v = _rsGet(d, ln.k);
  if (v) return v;
  return (ln.fb !== undefined && ln.fb !== null && String(ln.fb).length) ? String(ln.fb) : '';
}
function _rsInterp(s, d) {
  return String(s).replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, function(m, k) { return _rsGet(d, k); });
}
function _rsMq(label, cmd) {
  return '[' + label + '](mqqapi://aio/%69nlinecmd?command=' + encodeURIComponent(cmd) + '&enter=false&reply=false)';
}
function rsRender(branchKey, d, spec, linkFn) {
  var s = spec || REPLY_SPEC;
  if (!s || !s.branches) return '';
  var b = null;
  for (var i = 0; i < s.branches.length; i++) { if (s.branches[i].key === branchKey) { b = s.branches[i]; break; } }
  if (!b) return '';
  var out = [];
  for (var j = 0; j < b.lines.length; j++) {
    var ln = b.lines[j];
    if (!ln) continue;
    if (ln.t === 'blank') { out.push(''); continue; }
    if (ln.t === 'text') { out.push(_rsInterp(ln.v || '', d)); continue; }
    if (ln.t === 'val') { out.push(_rsInterp(_rsVal(ln, d), d)); continue; }
    if (ln.t === 'row') {
      var v = _rsVal(ln, d);
      if (!v && ln.hide) continue;
      out.push(_rsInterp((ln.pre || '') + v + (ln.post || ''), d));
      continue;
    }
    if (ln.t === 'link') {
      var lk = (linkFn || _rsMq)(ln.label || '', ln.cmd || '');
      out.push((ln.pre || '') + lk + (ln.post || ''));
    }
  }
  return out.join('\n');
}

// ===== 固定回复兜底原文（rsRender 因 spec 缺失/异常返回空时使用，保证线上行为不回退）=====
function _fbUpdateHead(version, src) { return '最新版本：v' + version + ' ' + src; }
function _fbUpdateErr() { return '读取云端更新配置失败：8091 不可用。'; }
function _fbRelHead(n, src) { return '版本列表（' + n + ' 个，最新 ' + n + ' 个） ' + src; }
function _fbRelEmpty() { return '版本列表为空（仓库暂无 Release）。'; }
function _fbRelErr() { return '读取版本列表失败：8091 不可用。'; }
function _fbPlugHead(n, src) { return '插件 / 文档包（' + n + ' 个） ' + src; }
function _fbPlugEmpty() { return '插件列表为空（site-config.json 未配置插件）。'; }
function _fbPlugErr() { return '读取插件列表失败：GitHub Pages / raw / 8091 均不可用。'; }
function _fbBcHead(n, src) { return '云端广播任务列表（' + n + ' 条） ' + src; }
function _fbBcEmpty() { return '云端暂无广播任务（broadcast.json 为空）。'; }
function _fbBcErr() { return '读取云端广播目录失败：GitHub Pages / raw / 8091 均不可用。'; }
function _fbErr(msg) { return '读取失败：' + msg; }

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

    // ReplySpec：服务器 config 覆盖内置模板（后台「回复编辑器」保存后即时生效）
    var curSpec = REPLY_SPEC;
    try {
      var raw = (ctx.engine && ctx.engine.getConfigValue) ? ctx.engine.getConfigValue('plugin.file-列表读取.reply') : null;
      if (raw) {
        var parsed = JSON.parse(String(raw));
        if (parsed && Array.isArray(parsed.branches) && parsed.branches.length) curSpec = parsed;
      }
    } catch (e) { ctx.logger.warn('列表读取 ReplySpec config 解析失败，使用内置模板: ' + String(e && e.message || e)); }
    var linkFn = function(t, c) { return (ctx.link && ctx.link.linkify) ? ctx.link.linkify(t, c) : _rsMq(t, c); };

    function baseData(data) {
      var a = data.author || {};
      var botId = data.botId || '';
      var bName = (ctx.engine && ctx.engine.getBotNameById) ? (ctx.engine.getBotNameById(botId) || '') : '';
      return {
        botId: botId,
        botName: bName,
        botShow: (bName && bName !== botId) ? bName + '（' + botId + '）' : botId,
        gid: data.groupId || '',
        openid: (a && (a.openid || a.id)) || data.member_openid || '',
        qq: (a && a.qqId) || '',
        nick: (a && a.username) || ''
      };
    }
    function render(key, data, extra) {
      var bd = baseData(data);
      var d = {};
      for (var k in bd) if (Object.prototype.hasOwnProperty.call(bd, k)) d[k] = bd[k];
      if (extra) for (var e in extra) if (Object.prototype.hasOwnProperty.call(extra, e)) d[e] = extra[e];
      return rsRender(key, d, curSpec, linkFn);
    }

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
        if (!res || !res.json) { reply(data, render('update_err', data) || _fbUpdateErr()); return; }
        var j = res.json;
        var cl = j.changeLog ? String(j.changeLog).split('\n').slice(0, 12).join('\n') : '';
        var head = render('update_head', data, {
          version: j.version || '未知',
          host: fmtSrc(res.source),
          changelog: cl,
          patchUrl: j.patchUrl || ''
        }) || _fbUpdateHead(j.version || '未知', fmtSrc(res.source));
        var lines = [head];
        if (j.changeLog) lines.push('【本轮更新内容】\n' + cl);
        if (j.patchUrl) lines.push('\n补丁包下载：\n' + j.patchUrl);
        reply(data, lines.join('\n'));
      }).catch(function(e) { reply(data, render('err_gen', data, { msg: (e && e.message) || String(e) }) || _fbErr((e && e.message) || String(e))); });
    }

    // ========== 版本列表 ==========
    function versionList(data) {
      return fetchFirstJson(SRC.releases).then(function(res) {
        if (!res || !res.json) { reply(data, render('rel_err', data) || _fbRelErr()); return; }
        var j = res.json;
        var rels = Array.isArray(j.releases) ? j.releases : [];
        if (!rels.length) { reply(data, render('rel_empty', data) || _fbRelEmpty()); return; }
        var lines = [];
        lines.push(render('rel_head', data, { n: rels.length, host: fmtSrc(res.source) }) || _fbRelHead(rels.length, fmtSrc(res.source)));
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
      }).catch(function(e) { reply(data, render('err_gen', data, { msg: (e && e.message) || String(e) }) || _fbErr((e && e.message) || String(e))); });
    }

    // ========== 插件列表 ==========
    function pluginList(data) {
      return fetchFirstJson(SRC.releases).then(function(res) {
        if (!res || !res.json) { reply(data, render('plug_err', data) || _fbPlugErr()); return; }
        var j = res.json;
        var plugs = Array.isArray(j.plugins) ? j.plugins : [];
        if (!plugs.length) { reply(data, render('plug_empty', data) || _fbPlugEmpty()); return; }
        var lines = [];
        lines.push(render('plug_head', data, { n: plugs.length, host: fmtSrc(res.source) }) || _fbPlugHead(plugs.length, fmtSrc(res.source)));
        for (var i = 0; i < plugs.length; i++) {
          var p = plugs[i];
          lines.push((i + 1) + '. ' + p.name + '\n   ' + p.file + (p.desc ? '\n   ' + p.desc : '') + '\n   ' + (p.pages || ''));
        }
        lines.push('\n可在管理面板「插件管理」上传安装。');
        reply(data, lines.join('\n'));
      }).catch(function(e) { reply(data, render('err_gen', data, { msg: (e && e.message) || String(e) }) || _fbErr((e && e.message) || String(e))); });
    }

    // ========== 广播列表 ==========
    function broadcastList(data) {
      return fetchFirstJson(SRC.broadcast).then(function(res) {
        if (!res || !res.json) { reply(data, render('bc_err', data) || _fbBcErr()); return; }
        var j = res.json;
        var tasks = Array.isArray(j.tasks) ? j.tasks : (Array.isArray(j) ? j : (j && j.id !== undefined ? [j] : []));
        if (!tasks.length) { reply(data, render('bc_empty', data) || _fbBcEmpty()); return; }
        var lines = [];
        lines.push(render('bc_head', data, { n: tasks.length, host: fmtSrc(res.source) }) || _fbBcHead(tasks.length, fmtSrc(res.source)));
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
      }).catch(function(e) { reply(data, render('err_gen', data, { msg: (e && e.message) || String(e) }) || _fbErr((e && e.message) || String(e))); });
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
