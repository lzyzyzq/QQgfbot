// ============================================================
// GitHub绑定 v1.0.0 - 群内把 QQ/OpenID 绑定到 GitHub 用户名（轻量验证）
// ------------------------------------------------------------
// 普通用户命令：
//   绑定GitHub <用户名>       → 绑定（例：绑定GitHub lzyzyzq）
//   我的GitHub / 查看GitHub   → 查看当前绑定
//   解绑GitHub                → 解绑
// 主人命令：
//   GitHub绑定列表            → 查看全部绑定（OpenID → GitHub）
// 说明：用户名存在性用 GitHub 公开 API 校验（无需仓库 token，也不入库任何密钥）；
//   绑定结果存 ctx.storage：ghbind_<openid>=用户名（正向），ghbinv_<小写名>=openid（反向）。
//   本绑定供「公开流水挂名 / 昵称展示 / 授权标签」等场景使用。
// ============================================================
module.exports = {
  manifest: {
    id: 'gh-bind',
    name: 'GitHub绑定',
    version: '1.0.0',
    description: '绑定GitHub：OpenID/QQ 绑定到 GitHub 用户名；我的GitHub / 解绑GitHub / GitHub绑定列表',
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
    },

    // ========== 绑定读写 ==========
    getBind: function(ctx, openid) {
      return ctx.storage.get('ghbind_' + openid) || '';
    },
    setBind: function(ctx, openid, name) {
      ctx.storage.set('ghbind_' + openid, name);
      ctx.storage.set('ghbinv_' + String(name).toLowerCase(), openid);
      var list = [];
      try { list = JSON.parse(ctx.storage.get('ghbind_all') || '[]'); } catch(e) { list = []; }
      if (list.indexOf(openid) === -1) list.push(openid);
      if (list.length > 500) list = list.slice(list.length - 500);
      ctx.storage.set('ghbind_all', JSON.stringify(list));
    },
    unsetBind: function(ctx, openid) {
      var old = this.getBind(ctx, openid);
      if (old) ctx.storage.set('ghbinv_' + String(old).toLowerCase(), '');
      ctx.storage.set('ghbind_' + openid, '');
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
      } catch(e) { ctx.logger.error('GitHub绑定发送失败：' + e.message); }
    }

    // GitHub 公开 API 校验用户名是否存在（无鉴权，限流宽松；403 时提示稍后再试）
    async function checkUser(name) {
      var url = 'https://api.github.com/users/' + encodeURIComponent(name);
      var ctrl = new AbortController();
      var t = setTimeout(function() { try { ctrl.abort(); } catch(e) {} }, 6000);
      try {
        var r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'qq-bot-gh-bind', 'Accept': 'application/vnd.github+json' } });
        if (r.status === 200) {
          try { var j = await r.json(); return { ok: true, login: (j && j.login) || name, name: (j && j.name) || '', html: (j && j.html_url) || '' }; } catch(e) { return { ok: true, login: name, name: '', html: '' }; }
        }
        if (r.status === 404) return { ok: false, reason: 'notfound' };
        if (r.status === 403) return { ok: false, reason: 'ratelimit' };
        return { ok: false, reason: 'http' + r.status };
      } catch(e) { return { ok: false, reason: 'net' }; } finally { clearTimeout(t); }
    }

    function bindHelp(data) {
      reply(data, 'GitHub 绑定\n发送「绑定GitHub GitHub用户名」\n例：绑定GitHub lzyzyzq\n绑定后可用于公开流水挂名/昵称展示。\n查看：我的GitHub · 解绑：解绑GitHub');
    }

    async function doBind(data, name) {
      var authorId = (data.author && (data.author.id || data.author.openid)) || '';
      if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})?$/.test(name)) {
        reply(data, 'GitHub 用户名只能包含字母/数字/中划线（最多 39 位），请检查后重试。');
        return;
      }
      var old = self.methods.getBind(ctx, authorId);
      if (old && old.toLowerCase() === name.toLowerCase()) { reply(data, '你已绑定 ' + old + '，无需重复绑定。'); return; }
      var res = await checkUser(name);
      if (!res.ok) {
        if (res.reason === 'notfound') reply(data, 'GitHub 上不存在用户「' + name + '」，请核对拼写（区分大小写不敏感）。');
        else if (res.reason === 'ratelimit') reply(data, 'GitHub 接口临时限流（403），请稍等几分钟再试。');
        else reply(data, 'GitHub 校验失败（' + res.reason + '），请稍后重试。');
        return;
      }
      self.methods.setBind(ctx, authorId, res.login);
      reply(data, 'GitHub 绑定成功\n' + res.login + (res.name ? '（' + res.name + '）' : '') + '\n' + (res.html || '') + '\n查看：我的GitHub · 解绑：解绑GitHub');
    }

    function showBind(data) {
      var authorId = (data.author && (data.author.id || data.author.openid)) || '';
      var name = self.methods.getBind(ctx, authorId);
      if (!name) { reply(data, '你还没绑定 GitHub。发送「绑定GitHub 用户名」即可绑定。'); return; }
      reply(data, '当前绑定 GitHub：' + name + '\n解绑：解绑GitHub');
    }

    function unbind(data) {
      var authorId = (data.author && (data.author.id || data.author.openid)) || '';
      var old = self.methods.getBind(ctx, authorId);
      if (!old) { reply(data, '你当前没有 GitHub 绑定。'); return; }
      self.methods.unsetBind(ctx, authorId);
      reply(data, '已解绑 GitHub：' + old);
    }

    function ownerList(data) {
      var list = [];
      try { list = JSON.parse(ctx.storage.get('ghbind_all') || '[]'); } catch(e) { list = []; }
      var rows = [];
      for (var i = 0; i < list.length; i++) {
        var oid = list[i];
        var name = self.methods.getBind(ctx, oid);
        if (name) rows.push(oid + ' → ' + name);
      }
      if (!rows.length) { reply(data, '暂无任何 GitHub 绑定。'); return; }
      var txt = 'GitHub 绑定列表（' + rows.length + ' 条）：\n' + rows.slice(0, 30).join('\n');
      if (rows.length > 30) txt += '\n…（共 ' + rows.length + ' 条）';
      reply(data, txt);
    }

    async function handle(data) {
      var authorId = (data.author && (data.author.id || data.author.openid)) || '';
      if (!authorId) return;
      var raw = (data.content || '').trim();
      var content = raw.replace(/^\s*(?:<@!?[A-Za-z0-9_-]+>|@\S+)\s*/, '').trim() || raw;
      var lower = content.toLowerCase();
      var m;

      if (lower === '绑定github' || lower === '绑定gh') { bindHelp(data); return; }
      if (m = lower.match(/^绑定github\s+([^\s]+)$/)) { await doBind(data, m[1]); return; }
      if (m = lower.match(/^绑定gh\s+([^\s]+)$/)) { await doBind(data, m[1]); return; }
      if (lower === '我的github' || lower === '查看github') { showBind(data); return; }
      if (lower === '解绑github' || lower === '解绑gh') { unbind(data); return; }

      if (!self.methods.isMaster(ctx, authorId)) return;
      if (lower === 'github绑定列表' || lower === 'gh绑定列表') { ownerList(data); return; }
    }

    var lid1 = ctx.eventBus.on('message.group', function(data) {
      try { handle(data); } catch(e) { ctx.logger.error('GitHub绑定异常：' + (e && e.message || e)); }
    });
    var lid2 = ctx.eventBus.on('message.c2c', function(data) {
      try { handle(data); } catch(e) { ctx.logger.error('GitHub绑定异常：' + (e && e.message || e)); }
    });
    self._listenerIds = [lid1, lid2];
    ctx.logger.info('GitHub绑定 v1.0.0 已启用（绑定GitHub <用户名> / 我的GitHub / 解绑GitHub）');
  },

  onDisable: function(ctx) {
    if (this._listenerIds) {
      for (var i = 0; i < this._listenerIds.length; i++) ctx.eventBus.off(this._listenerIds[i]);
      this._listenerIds = null;
    }
    ctx.logger.info('GitHub绑定已禁用');
  }
};
