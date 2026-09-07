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
// ------------------------------------------------------------
// ReplySpec 回复可视化：回复文案已接入后台「回复编辑器」，生效优先级
//   config（plugin.file-充值系统.reply）> 内置 REPLY_SPEC 常量；
//   渲染为空/异常时自动回退源码兜底原文，保证线上行为不回退。
// ============================================================
/*__REPLY_SPEC_BEGIN__*/
var REPLY_SPEC = {
  name: '充值系统',
  version: '1.0.0',
  desc: '充值/充值菜单、查积分/余额、我的订单、我要充值、付款完成；主人：确认充值/取消充值/充值订单/充值说明',
  branches: [
    {
      key: 'menu', label: '充值菜单（充值/充值菜单）', scope: ['group', 'c2c'], triggers: ['充值', '充值菜单'],
      lines: [
        { t: 'text', v: '充值套餐（1 积分=0.01 元）：' },
        { t: 'val', k: 'packRows' },
        { t: 'blank' },
        { t: 'text', v: '回复「我要充值<金额>」下单，例如：我要充值30' }
      ]
    },
    {
      key: 'orderNoPack', label: '我要充值-没有该金额档位（提示可用档位）', scope: ['group', 'c2c'], triggers: ['我要充值<金额>'],
      lines: [
        { t: 'text', v: '没有该金额档位，可用档位：{packs} 元' }
      ]
    },
    {
      key: 'orderPlaced', label: '我要充值-下单成功（单号/金额/付款步骤）', scope: ['group', 'c2c'], triggers: ['我要充值<金额>'],
      lines: [
        { t: 'text', v: '下单成功，单号：{no}' },
        { t: 'text', v: '金额：{yuan} 元 → {points} 积分' },
        { t: 'blank' },
        { t: 'text', v: '【付款步骤】' },
        { t: 'val', k: 'note' },
        { t: 'text', v: '付款后请回复：付款完成 {no}' }
      ]
    },
    {
      key: 'balance', label: '查积分/余额-当前积分与最近记录', scope: ['group', 'c2c'], triggers: ['查积分', '余额', '查余额'],
      lines: [
        { t: 'text', v: '当前积分：{bal}' },
        { t: 'row', pre: '最近记录：', k: 'ledger', fb: '（暂无）' }
      ]
    },
    {
      key: 'myOrdersEmpty', label: '我的订单-暂无订单', scope: ['group', 'c2c'], triggers: ['我的订单', '充值订单查询'],
      lines: [
        { t: 'text', v: '你还没有充值订单。回复「我要充值30」试试。' }
      ]
    },
    {
      key: 'myOrders', label: '我的订单-最近订单列表', scope: ['group', 'c2c'], triggers: ['我的订单', '充值订单查询'],
      lines: [
        { t: 'text', v: '我的订单（最近 {count} 条）：' },
        { t: 'val', k: 'rows' }
      ]
    },
    {
      key: 'paidNoOrder', label: '付款完成-找不到订单', scope: ['group', 'c2c'], triggers: ['付款完成 <单号>'],
      lines: [
        { t: 'text', v: '找不到订单：{no}' }
      ]
    },
    {
      key: 'paidNotYours', label: '付款完成-该订单不属于你', scope: ['group', 'c2c'], triggers: ['付款完成 <单号>'],
      lines: [
        { t: 'text', v: '该订单不属于你，请核对单号。' }
      ]
    },
    {
      key: 'paidStatus', label: '付款完成-订单非待付款（当前状态）', scope: ['group', 'c2c'], triggers: ['付款完成 <单号>'],
      lines: [
        { t: 'text', v: '订单当前状态：{status}' }
      ]
    },
    {
      key: 'paidOk', label: '付款完成-已记录付款等待管理员确认', scope: ['group', 'c2c'], triggers: ['付款完成 <单号>'],
      lines: [
        { t: 'text', v: '已记录付款，等待管理员确认。单号：{no}' },
        { t: 'text', v: '管理员收到到账后会执行「确认充值 {no}」。' }
      ]
    },
    {
      key: 'ordersEmpty', label: '充值订单列表-暂无任何订单（主人）', scope: ['group', 'c2c'], triggers: ['充值订单', '充值订单列表'],
      lines: [
        { t: 'text', v: '暂无任何充值订单。' }
      ]
    },
    {
      key: 'orders', label: '充值订单列表-最近20条含待确认与操作指引（主人）', scope: ['group', 'c2c'], triggers: ['充值订单', '充值订单列表'],
      lines: [
        { t: 'text', v: '充值订单（最近 {count} 条，待确认 {pending}）：' },
        { t: 'val', k: 'rows' },
        { t: 'blank' },
        { t: 'text', v: '确认到账：确认充值 <单号>' },
        { t: 'text', v: '取消订单：取消充值 <单号>' }
      ]
    },
    {
      key: 'confirmNoOrder', label: '确认充值-找不到订单（主人）', scope: ['group', 'c2c'], triggers: ['确认充值 <单号>'],
      lines: [
        { t: 'text', v: '找不到订单：{no}' }
      ]
    },
    {
      key: 'confirmDone', label: '确认充值-订单已确认过无需重复（主人）', scope: ['group', 'c2c'], triggers: ['确认充值 <单号>'],
      lines: [
        { t: 'text', v: '订单已确认过，无需重复：{no}' }
      ]
    },
    {
      key: 'confirmCancelled', label: '确认充值-订单已取消无法确认（主人）', scope: ['group', 'c2c'], triggers: ['确认充值 <单号>'],
      lines: [
        { t: 'text', v: '订单已取消，无法确认：{no}' }
      ]
    },
    {
      key: 'confirmOk', label: '确认充值-成功并已通知对方（主人）', scope: ['group', 'c2c'], triggers: ['确认充值 <单号>'],
      lines: [
        { t: 'text', v: '已确认 {no}（{yuan} 元 → +{points} 积分），并已通知对方。' }
      ]
    },
    {
      key: 'notifyCredited', label: '充值到账-确认后对下单人的主动推送通知（主人触发）', scope: ['group', 'c2c'], triggers: ['确认充值 <单号>'],
      lines: [
        { t: 'text', v: '充值到账！' },
        { t: 'text', v: '单号：{no}' },
        { t: 'text', v: '金额：{yuan} 元 → +{points} 积分' },
        { t: 'text', v: '当前积分：{bal}' }
      ]
    },
    {
      key: 'cancelNoOrder', label: '取消充值-找不到订单（主人）', scope: ['group', 'c2c'], triggers: ['取消充值 <单号>'],
      lines: [
        { t: 'text', v: '找不到订单：{no}' }
      ]
    },
    {
      key: 'cancelBadStatus', label: '取消充值-订单已完成或已取消（主人）', scope: ['group', 'c2c'], triggers: ['取消充值 <单号>'],
      lines: [
        { t: 'text', v: '订单状态为 {status}，无需取消。' }
      ]
    },
    {
      key: 'cancelOk', label: '取消充值-成功（主人）', scope: ['group', 'c2c'], triggers: ['取消充值 <单号>'],
      lines: [
        { t: 'text', v: '已取消订单 {no}' }
      ]
    },
    {
      key: 'noteSet', label: '充值说明-付款说明已更新（主人）', scope: ['group', 'c2c'], triggers: ['充值说明 <文案>'],
      lines: [
        { t: 'text', v: '付款说明已更新。' }
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

    // ===== ReplySpec 渲染支持 =====
    // 生效优先级：config（plugin.file-充值系统.reply）> 内置 REPLY_SPEC 常量；
    // 渲染为空时回退兜底原文函数，保证线上行为不回退。
    var curSpec = REPLY_SPEC;
    try {
      var raw = (ctx.engine && ctx.engine.getConfigValue) ? ctx.engine.getConfigValue('plugin.file-充值系统.reply') : null;
      if (raw) {
        var parsed = JSON.parse(String(raw));
        if (parsed && Array.isArray(parsed.branches) && parsed.branches.length) curSpec = parsed;
      }
    } catch (e) { ctx.logger.warn('充值系统 ReplySpec config 解析失败，使用内置模板: ' + String(e && e.message || e)); }
    var linkFn = function(t, c) { return (ctx.link && ctx.link.linkify) ? ctx.link.linkify(t, c) : _rsMq(t, c); };

    function botNameOf(botId) {
      return (ctx.engine && ctx.engine.getBotNameById) ? (ctx.engine.getBotNameById(botId) || '') : '';
    }
    function baseData(data) {
      var a = data.author || {};
      var botId = data.botId || '';
      var bName = botNameOf(botId);
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
      if (extra) for (var e in extra) if (Object.prototype.hasOwnProperty.call(extra, e) && extra[e] !== undefined && extra[e] !== null) d[e] = extra[e];
      return rsRender(key, d, curSpec, linkFn);
    }

    // 群发送：sendMarkdownGroup 优先，失败/空结果回退 sendGroupMessage
    function groupSend(gid, text, msgId) {
      var sent = false;
      function plain() {
        if (sent) return null;
        sent = true;
        try {
          var gp = ctx.bot.sendGroupMessage(gid, text, msgId);
          if (gp && typeof gp.then === 'function') gp.catch(function(e) { ctx.logger.error('充值系统群文本发送失败：' + String(e && e.message || e)); });
          return gp;
        } catch (e) { ctx.logger.error('充值系统群文本发送失败：' + String(e && e.message || e)); return null; }
      }
      try {
        if (ctx.bot && ctx.bot.sendMarkdownGroup) {
          var p = ctx.bot.sendMarkdownGroup(gid, text, msgId);
          if (p && typeof p.then === 'function') {
            p.then(function(r) { if (r) sent = true; else return plain(); }, function() { return plain(); });
            return p;
          }
          if (p) return p;
        }
      } catch (e) {}
      return plain();
    }
    // 统一发送：群消息发群（markdown 优先）；否则私聊发回发送者
    function reply(data, text) {
      try {
        if (data.groupId) {
          groupSend(data.groupId, text, data.id);
        } else if (data.author && (data.author.id || data.author.openid)) {
          var pid = data.author.id || data.author.openid;
          if (ctx.bot.sendPrivateMessage) {
            try {
              var pp = ctx.bot.sendPrivateMessage(pid, text);
              if (pp && typeof pp.then === 'function') pp.catch(function(e) { ctx.logger.error('充值系统私聊发送失败：' + String(e && e.message || e)); });
            } catch (e) { ctx.logger.error('充值系统私聊发送失败：' + String(e && e.message || e)); }
          } else if (ctx.bot.sendGroupMessage) {
            ctx.bot.sendGroupMessage(data.groupId, text, data.id);
          }
        }
      } catch (e) { ctx.logger.error('充值系统发送失败：' + String(e && e.message || e)); }
    }
    // 渲染优先发送：rsRender(key) 命中且非空则发渲染串，空则发兜底原文 fb
    function replySpec(data, key, extra, fb) {
      var t = render(key, data, extra);
      if (!t) t = (typeof fb === 'function') ? fb() : (fb || '');
      if (!t) return;
      reply(data, t);
    }

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

    // ---------- 套餐与下单 ----------
    // 套餐档位行块（菜单模板 {packRows} 用）
    function packLines() {
      var packs = getPacks();
      var lines = [];
      for (var i = 0; i < packs.length; i++) {
        var extra = '';
        var pts = packs[i].points, yuan = packs[i].yuan;
        var base = yuan * 100;
        if (pts > base) extra = '（送 ' + (pts - base) + ' 积分）';
        lines.push((i + 1) + '. ' + yuan + ' 元 = ' + pts + ' 积分' + extra);
      }
      return lines.join('\n');
    }
    // 充值菜单兜底原文
    function fbMenu() {
      return '充值套餐（1 积分=0.01 元）：\n' + packLines() + '\n\n回复「我要充值<金额>」下单，例如：我要充值30';
    }

    function makeOrder(data, yuan) {
      var packs = getPacks();
      var pack = null;
      for (var i = 0; i < packs.length; i++) if (parseInt(packs[i].yuan, 10) === parseInt(yuan, 10)) { pack = packs[i]; break; }
      if (!pack) {
        var avail = packs.map(function(p) { return p.yuan; }).join('/');
        replySpec(data, 'orderNoPack', { packs: avail }, '没有该金额档位，可用档位：' + avail + ' 元');
        return;
      }
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
      replySpec(data, 'orderPlaced', { no: order.no, yuan: order.yuan, points: order.points, note: getNote() },
        '下单成功，单号：' + order.no +
        '\n金额：' + order.yuan + ' 元 → ' + order.points + ' 积分' +
        '\n\n【付款步骤】\n' + getNote() +
        '\n付款后请回复：付款完成 ' + order.no);
    }

    function showBalance(data, openid) {
      var bal = self.methods.getBalance(ctx, openid);
      var ledger = [];
      try { ledger = JSON.parse(ctx.storage.get('pay_ledger_' + openid) || '[]'); } catch(e) { ledger = []; }
      var tail = ledger.slice(Math.max(0, ledger.length - 5));
      var rows = [];
      for (var i = 0; i < tail.length; i++) {
        var lg = tail[i];
        rows.push(lg.t + ' ' + (lg.type === 'in' ? '+' : '-') + lg.points + ' ' + (lg.note || ''));
      }
      // 兜底原文（rsRender 空时用）
      var fb = '当前积分：' + bal + '\n最近记录：' + (rows.length ? '\n' + rows.join('\n') : '（暂无）');
      // 模板 {ledger} 值以换行开头，使「最近记录：」后紧跟首行（与源码原文一致）
      var ledgerTxt = rows.length ? '\n' + rows.join('\n') : '';
      replySpec(data, 'balance', { bal: bal, ledger: ledgerTxt }, fb);
    }

    function myOrders(data, openid) {
      var all = listOrders(ctx).map(function(no) { return getOrder(ctx, no); }).filter(function(o) { return o && o.openid === openid; });
      all.reverse();
      if (!all.length) { replySpec(data, 'myOrdersEmpty', null, '你还没有充值订单。回复「我要充值30」试试。'); return; }
      var show = all.slice(0, 8);
      var rows = [];
      for (var i = 0; i < show.length; i++) {
        rows.push(show[i].no + ' ' + show[i].yuan + '元/' + show[i].points + '分 [' + statusText(show[i].status) + '] ' + show[i].created);
      }
      var fb = '我的订单（最近 ' + Math.min(all.length, 8) + ' 条）：\n' + rows.join('\n');
      replySpec(data, 'myOrders', { count: String(Math.min(all.length, 8)), rows: rows.join('\n') }, fb);
    }

    // ---------- 主人操作 ----------
    function ownerOrders(data) {
      var all = listOrders(ctx).map(function(no) { return getOrder(ctx, no); }).filter(Boolean);
      all.reverse();
      var pending = all.filter(function(o) { return o.status === 'pending' || o.status === 'paid'; });
      if (!all.length) { replySpec(data, 'ordersEmpty', null, '暂无任何充值订单。'); return; }
      var show = all.slice(0, 20);
      var rows = [];
      for (var i = 0; i < show.length; i++) {
        var o = show[i];
        rows.push(o.no + ' ' + o.yuan + '元/' + o.points + '分 [' + statusText(o.status) + '] 群' + (o.groupId ? String(o.groupId).slice(0, 6) : '私聊') + ' ' + o.created);
      }
      var fb = '充值订单（最近 ' + Math.min(all.length, 20) + ' 条，待确认 ' + pending.length + '）：\n' + rows.join('\n') +
        '\n\n确认到账：确认充值 <单号>\n取消订单：取消充值 <单号>';
      replySpec(data, 'orders', { count: String(Math.min(all.length, 20)), pending: String(pending.length), rows: rows.join('\n') }, fb);
    }

    function confirmOrder(data, no) {
      var order = getOrder(ctx, no);
      if (!order) { replySpec(data, 'confirmNoOrder', { no: no }, '找不到订单：' + no); return; }
      if (order.status === 'done') { replySpec(data, 'confirmDone', { no: no }, '订单已确认过，无需重复：' + no); return; }
      if (order.status === 'cancelled') { replySpec(data, 'confirmCancelled', { no: no }, '订单已取消，无法确认：' + no); return; }
      order.status = 'done';
      order.doneAt = new Date().toLocaleString('zh-CN', { hour12: false });
      saveOrder(ctx, order);
      var bal = self.methods.addPoints(ctx, order.openid, order.points, '充值订单 ' + order.no);
      // 对下单人的主动推送（发往订单所在群）——文案也接入 ReplySpec
      var notifyFb = '充值到账！\n单号：' + order.no + '\n金额：' + order.yuan + ' 元 → +' + order.points + ' 积分\n当前积分：' + bal;
      var notifyT = render('notifyCredited', { botId: data.botId || '', groupId: order.groupId || data.groupId || '', author: data.author }, { no: order.no, yuan: order.yuan, points: order.points, bal: bal });
      if (order.groupId) {
        try { groupSend(order.groupId, notifyT || notifyFb); } catch(e) { ctx.logger.error('充值通知失败：' + String(e && e.message || e)); }
      }
      replySpec(data, 'confirmOk', { no: order.no, yuan: order.yuan, points: order.points },
        '已确认 ' + order.no + '（' + order.yuan + ' 元 → +' + order.points + ' 积分），并已通知对方。');
    }

    function cancelOrder(data, no) {
      var order = getOrder(ctx, no);
      if (!order) { replySpec(data, 'cancelNoOrder', { no: no }, '找不到订单：' + no); return; }
      if (order.status === 'done' || order.status === 'cancelled') { replySpec(data, 'cancelBadStatus', { status: statusText(order.status) }, '订单状态为 ' + statusText(order.status) + '，无需取消。'); return; }
      order.status = 'cancelled';
      saveOrder(ctx, order);
      replySpec(data, 'cancelOk', { no: order.no }, '已取消订单 ' + order.no);
    }

    function setNote(data, text) {
      ctx.storage.set('pay_note', text);
      replySpec(data, 'noteSet', null, '付款说明已更新。');
    }

    // ---------- 消息分发 ----------
    function handle(data) {
      var authorId = (data.author && (data.author.id || data.author.openid)) || '';
      if (!authorId) return;

      var raw = (data.content || '').trim();
      var content = raw.replace(/^\s*(?:<@!?[A-Za-z0-9_-]+>|@\S+)\s*/, '').trim() || raw;
      var m;

      // 普通用户命令
      if (content === '充值' || content === '充值菜单') { replySpec(data, 'menu', { packRows: packLines() }, fbMenu()); return; }
      if (content === '查积分' || content === '余额' || content === '查余额') { showBalance(data, authorId); return; }
      if (content === '我的订单' || content === '充值订单查询') { myOrders(data, authorId); return; }
      if (m = content.match(/^我要充值\s*(\d+)$/)) { makeOrder(data, m[1]); return; }
      if (m = content.match(/^付款完成\s*(R[A-Za-z0-9]+)$/)) {
        var order = getOrder(ctx, m[1]);
        if (!order) { replySpec(data, 'paidNoOrder', { no: m[1] }, '找不到订单：' + m[1]); return; }
        if (order.openid !== authorId) { replySpec(data, 'paidNotYours', null, '该订单不属于你，请核对单号。'); return; }
        if (order.status !== 'pending') { replySpec(data, 'paidStatus', { status: statusText(order.status) }, '订单当前状态：' + statusText(order.status)); return; }
        order.status = 'paid';
        order.paidAt = new Date().toLocaleString('zh-CN', { hour12: false });
        saveOrder(ctx, order);
        replySpec(data, 'paidOk', { no: order.no }, '已记录付款，等待管理员确认。单号：' + order.no + '\n管理员收到到账后会执行「确认充值 ' + order.no + '」。');
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
