// ============================================================
// 充值系统 v1.0.0 - 群内充值积分（人工确认放行，微信/支付宝经营收款码）
// ------------------------------------------------------------
// 普通用户命令：
//   充值 / 充值菜单       → 显示套餐与步骤
//   我要充值<金额>         → 下单（例：我要充值10）
//   我的订单              → 我的最近订单
//   查积分 / 余额          → 查看当前积分
//   付款完成 <单号>        → 付款后告知已付（等待主人确认）
// 主人（超主/主人）命令：
//   确认充值 <单号>        → 确认到账并给用户加分
//   取消充值 <单号>        → 取消订单
//   充值订单               → 列出最近 20 条订单（含待确认）
//   充值说明 <文案>        → 自定义付款说明
// 积分说明：
//   余额以 ctx.storage 持久化（key pay_balance_<openid>），供其它功能扣减；
//   本插件暴露 methods.getBalance / addPoints / deductPoints 供跨插件调用。
// ============================================================
module.exports = {
  manifest: {
    id: 'pay-center',
    name: '充值系统',
    version: '1.0.0',
    description: '群内充值积分：我要充值/查积分/付款完成，主人确认充值到账',
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

    // ========== 积分读写（可跨插件调用） ==========
    getBalance: function(ctx, openid) {
      try { return parseInt(ctx.storage.get('pay_balance_' + openid) || '0', 10) || 0; } catch(e) { return 0; }
    },
    setBalance: function(ctx, openid, value) {
      ctx.storage.set('pay_balance_' + openid, String(Math.max(0, parseInt(value, 10) || 0)));
    },
    addPoints: function(ctx, openid, points, note) {
      var cur = this.getBalance(ctx, openid);
      var nxt = cur + (parseInt(points, 10) || 0);
      this.setBalance(ctx, openid, nxt);
      this._log(ctx, openid, 'in', points, note || '充值');
      return nxt;
    },
    deductPoints: function(ctx, openid, points, note) {
      var cur = this.getBalance(ctx, openid);
      var need = parseInt(points, 10) || 0;
      if (cur < need) return false;
      this.setBalance(ctx, openid, cur - need);
      this._log(ctx, openid, 'out', need, note || '消费');
      return true;
    },
    _log: function(ctx, openid, type, points, note) {
      var key = 'pay_ledger_' + openid;
      var arr = [];
      try { arr = JSON.parse(ctx.storage.get(key) || '[]'); } catch(e) { arr = []; }
      arr.push({ t: new Date().toLocaleString('zh-CN', { hour12: false }), type: type, points: points, note: String(note || '').slice(0, 80) });
      if (arr.length > 40) arr = arr.slice(arr.length - 40);
      ctx.storage.set(key, JSON.stringify(arr));
    }
  },

  onEnable: function(ctx) {
    var self = this;

    var DEFAULT_PACKS = [
      { yuan: 10, points: 1000 },
      { yuan: 30, points: 3200 },
      { yuan: 50, points: 5500 },
      { yuan: 100, points: 12000 }
    ];
    var DEFAULT_NOTE = '请向管理员微信/支付宝经营收款码付款，付款备注填写订单单号；' +
      '付款后在本群发送「付款完成 单号」，管理员确认到账后自动加积分。';

    function getPacks() {
      try { var p = JSON.parse(ctx.storage.get('pay_packs') || '[]'); if (Array.isArray(p) && p.length) return p; } catch(e) {}
      return DEFAULT_PACKS;
    }
    function getNote() { return ctx.storage.get('pay_note') || DEFAULT_NOTE; }

    function nowStamp() {
      var d = new Date();
      function p(n) { return String(n).padStart(2, '0'); }
      return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
    }
    function newOrderNo() { return 'R' + nowStamp() + Math.floor(Math.random() * 90 + 10); }

    function getOrder(ctx2, no) {
      try { return JSON.parse(ctx2.storage.get('pay_order_' + no) || 'null'); } catch(e) { return null; }
    }
    function saveOrder(ctx2, order) {
      ctx2.storage.set('pay_order_' + order.no, JSON.stringify(order));
      var list = [];
      try { list = JSON.parse(ctx2.storage.get('pay_orders') || '[]'); } catch(e) { list = []; }
      if (list.indexOf(order.no) === -1) list.push(order.no);
      if (list.length > 300) list = list.slice(list.length - 300);
      ctx2.storage.set('pay_orders', JSON.stringify(list));
    }
    function listOrders(ctx2) {
      try { return JSON.parse(ctx2.storage.get('pay_orders') || '[]'); } catch(e) { return []; }
    }
    function statusText(s) {
      if (s === 'pending') return '待付款';
      if (s === 'paid') return '已付款待确认';
      if (s === 'done') return '已完成';
      if (s === 'cancelled') return '已取消';
      return s;
    }

    function reply(data, text) {
      try {
        if (data.groupId) ctx.bot.sendGroupMessage(data.groupId, text, data.id);
        else if (data.author && (data.author.id || data.author.openid)) {
          var pid = data.author.id || data.author.openid;
          if (ctx.bot.sendPrivateMessage) ctx.bot.sendPrivateMessage(pid, text);
          else ctx.bot.sendGroupMessage(data.groupId, text, data.id);
        }
      } catch(e) { ctx.logger.error('充值系统发送失败：' + e.message); }
    }

    // ---------- 套餐与下单 ----------
    function packText() {
      var packs = getPacks();
      var lines = ['充值套餐（1 积分=0.01 元）：'];
      for (var i = 0; i < packs.length; i++) {
        var extra = '';
        var pts = packs[i].points, yuan = packs[i].yuan;
        var base = yuan * 100;
        if (pts > base) extra = '（送 ' + (pts - base) + ' 积分）';
        lines.push((i + 1) + '. ' + yuan + ' 元 = ' + pts + ' 积分' + extra);
      }
      lines.push('');
      lines.push('回复「我要充值<金额>」下单，例如：我要充值30');
      return lines.join('\n');
    }

    function makeOrder(data, yuan) {
      var packs = getPacks();
      var pack = null;
      for (var i = 0; i < packs.length; i++) if (parseInt(packs[i].yuan, 10) === parseInt(yuan, 10)) { pack = packs[i]; break; }
      if (!pack) { reply(data, '没有该金额档位，可用档位：' + packs.map(function(p) { return p.yuan; }).join('/') + ' 元'); return; }
      var authorId = (data.author && (data.author.id || data.author.openid)) || '';
      var order = {
        no: newOrderNo(),
        openid: authorId,
        groupId: data.groupId || '',
        yuan: pack.yuan,
        points: pack.points,
        status: 'pending',
        created: new Date().toLocaleString('zh-CN', { hour12: false }),
        paidAt: '',
        doneAt: ''
      };
      saveOrder(ctx, order);
      reply(data, '下单成功，单号：' + order.no +
        '\n金额：' + order.yuan + ' 元 → ' + order.points + ' 积分' +
        '\n\n【付款步骤】\n' + getNote() +
        '\n付款后请回复：付款完成 ' + order.no);
    }

    function showBalance(data, openid) {
      var bal = self.methods.getBalance(ctx, openid);
      var ledger = [];
      try { ledger = JSON.parse(ctx.storage.get('pay_ledger_' + openid) || '[]'); } catch(e) { ledger = []; }
      var txt = '当前积分：' + bal + '\n最近记录：';
      if (!ledger.length) txt += '（暂无）';
      var tail = ledger.slice(Math.max(0, ledger.length - 5));
      for (var i = 0; i < tail.length; i++) {
        var lg = tail[i];
        txt += '\n' + lg.t + ' ' + (lg.type === 'in' ? '+' : '-') + lg.points + ' ' + (lg.note || '');
      }
      reply(data, txt);
    }

    function myOrders(data, openid) {
      var all = listOrders(ctx).map(function(no) { return getOrder(ctx, no); }).filter(function(o) { return o && o.openid === openid; });
      all.reverse();
      if (!all.length) { reply(data, '你还没有充值订单。回复「我要充值30」试试。'); return; }
      var txt = '我的订单（最近 ' + Math.min(all.length, 8) + ' 条）：';
      var show = all.slice(0, 8);
      for (var i = 0; i < show.length; i++) {
        txt += '\n' + show[i].no + ' ' + show[i].yuan + '元/' + show[i].points + '分 [' + statusText(show[i].status) + '] ' + show[i].created;
      }
      reply(data, txt);
    }

    // ---------- 主人操作 ----------
    function ownerOrders(data) {
      var all = listOrders(ctx).map(function(no) { return getOrder(ctx, no); }).filter(Boolean);
      all.reverse();
      var pending = all.filter(function(o) { return o.status === 'pending' || o.status === 'paid'; });
      if (!all.length) { reply(data, '暂无任何充值订单。'); return; }
      var txt = '充值订单（最近 ' + Math.min(all.length, 20) + ' 条，待确认 ' + pending.length + '）：';
      var show = all.slice(0, 20);
      for (var i = 0; i < show.length; i++) {
        var o = show[i];
        txt += '\n' + o.no + ' ' + o.yuan + '元/' + o.points + '分 [' + statusText(o.status) + '] 群' + (o.groupId ? String(o.groupId).slice(0, 6) : '私聊') + ' ' + o.created;
      }
      txt += '\n\n确认到账：确认充值 <单号>\n取消订单：取消充值 <单号>';
      reply(data, txt);
    }

    function confirmOrder(data, no) {
      var order = getOrder(ctx, no);
      if (!order) { reply(data, '找不到订单：' + no); return; }
      if (order.status === 'done') { reply(data, '订单已确认过，无需重复：' + no); return; }
      if (order.status === 'cancelled') { reply(data, '订单已取消，无法确认：' + no); return; }
      order.status = 'done';
      order.doneAt = new Date().toLocaleString('zh-CN', { hour12: false });
      saveOrder(ctx, order);
      var bal = self.methods.addPoints(ctx, order.openid, order.points, '充值订单 ' + order.no);
      var notify = '充值到账！\n单号：' + order.no + '\n金额：' + order.yuan + ' 元 → +' + order.points + ' 积分\n当前积分：' + bal;
      if (order.groupId) {
        try { ctx.bot.sendGroupMessage(order.groupId, notify); } catch(e) { ctx.logger.error('充值通知失败：' + e.message); }
      }
      reply(data, '已确认 ' + order.no + '（' + order.yuan + ' 元 → +' + order.points + ' 积分），并已通知对方。');
    }

    function cancelOrder(data, no) {
      var order = getOrder(ctx, no);
      if (!order) { reply(data, '找不到订单：' + no); return; }
      if (order.status === 'done' || order.status === 'cancelled') { reply(data, '订单状态为 ' + statusText(order.status) + '，无需取消。'); return; }
      order.status = 'cancelled';
      saveOrder(ctx, order);
      reply(data, '已取消订单 ' + order.no);
    }

    function setNote(data, text) {
      ctx.storage.set('pay_note', text);
      reply(data, '付款说明已更新。');
    }

    // ---------- 消息分发 ----------
    function handle(data) {
      var authorId = (data.author && (data.author.id || data.author.openid)) || '';
      if (!authorId) return;

      var raw = (data.content || '').trim();
      var content = raw.replace(/^\s*(?:<@!?[A-Za-z0-9_-]+>|@\S+)\s*/, '').trim() || raw;
      var m;

      // 普通用户命令
      if (content === '充值' || content === '充值菜单') { reply(data, packText()); return; }
      if (content === '查积分' || content === '余额' || content === '查余额') { showBalance(data, authorId); return; }
      if (content === '我的订单' || content === '充值订单查询') { myOrders(data, authorId); return; }
      if (m = content.match(/^我要充值\s*(\d+)$/)) { makeOrder(data, m[1]); return; }
      if (m = content.match(/^付款完成\s*(R[A-Za-z0-9]+)$/)) {
        var order = getOrder(ctx, m[1]);
        if (!order) { reply(data, '找不到订单：' + m[1]); return; }
        if (order.openid !== authorId) { reply(data, '该订单不属于你，请核对单号。'); return; }
        if (order.status !== 'pending') { reply(data, '订单当前状态：' + statusText(order.status)); return; }
        order.status = 'paid';
        order.paidAt = new Date().toLocaleString('zh-CN', { hour12: false });
        saveOrder(ctx, order);
        reply(data, '已记录付款，等待管理员确认。单号：' + order.no + '\n管理员收到到账后会执行「确认充值 ' + order.no + '」。');
        return;
      }

      // 主人命令
      if (!self.methods.isMaster(ctx, authorId)) return;
      if (content === '充值订单' || content === '充值订单列表') { ownerOrders(data); return; }
      if (m = content.match(/^确认充值\s*(R[A-Za-z0-9]+)$/)) { confirmOrder(data, m[1]); return; }
      if (m = content.match(/^取消充值\s*(R[A-Za-z0-9]+)$/)) { cancelOrder(data, m[1]); return; }
      if (m = content.match(/^充值说明\s+(.+)$/)) { setNote(data, m[1]); return; }
    }

    var lid1 = ctx.eventBus.on('message.group', handle);
    var lid2 = ctx.eventBus.on('message.c2c', handle);
    self._listenerIds = [lid1, lid2];
    ctx.logger.info('充值系统 v1.0.0 已启用（我要充值 / 查积分 / 付款完成；主人：确认充值/取消充值/充值订单/充值说明）');
  },

  onDisable: function(ctx) {
    if (this._listenerIds) {
      for (var i = 0; i < this._listenerIds.length; i++) ctx.eventBus.off(this._listenerIds[i]);
      this._listenerIds = null;
    }
    ctx.logger.info('充值系统已禁用');
  }
};
