// 菜单模式 v1.1.0 - 文字指令菜单 + 全局菜单模式切换
// 发送「文字指令」查看文字版功能指令清单；发送「菜单模式」查看当前菜单模式；
// 发送「切换文字菜单」/「切换图片菜单」切换全局菜单模式（群内仅群主/群管理，单聊本人可用）
// ReplySpec 回复可视化：仅「查看/切换后的确认短文案 + 权限拒绝文案」内置模板
//       可被后台 config plugin.file-菜单模式.reply 覆盖；TEXT_MENU 常量清单属于菜单内容，始终源码原样发送。
// @ts-nocheck
const TEXT_MENU = [
  '🔰 空空 Bot 文字指令版',
  '━━━━━━━━━━━━━━',
  '🔐 免@授权 签到 补签 签到排行',
  '🎵 听唱歌 听清唱 点首歌 唱首歌 我要听',
  '🎵 唱歌/点歌 + 歌名 直接点歌',
  '🎵 清唱 + 歌名 / 怪唱 + 歌名',
  '🐱 哈基米（听魔性神曲）',
  '💕 今日老婆 今天吃啥 今日密码',
  '📋 更新日志 在线时间 报时',
  '🎮 游戏菜单 王者菜单 今日运势',
  '🎲 掷骰子 猜拳 随机数 今日人品 扫雷 敲木鱼',
  '🌾 开心农场 去钓鱼 笑话',
  '❄️ 雪子管理（群主/管理） 群信息',
  '🔎 查询中心 OpenID查询 绑定QQ 绑定QQ群 天气查询',
  '🎨 画图 + 内容  生成主题海报',
  '😂 来段笑话/讲个笑话  语音笑话',
  '🔌 插件管理（群主/管理）',
  '🔀 菜单模式（查看/切换 文字/图片 菜单）',
  '━━━━━━━━━━━━━━',
  '发送「新版菜单」查看按钮版菜单'
].join('\n');

/*__REPLY_SPEC_BEGIN__*/
var REPLY_SPEC = {
  name: '菜单模式',
  version: '1.1.0',
  desc: '菜单模式/文字外显模式的查看、切换确认短文案与权限拒绝文案（文字指令清单 TEXT_MENU 不走模板）',
  branches: [
    {
      key: 'mode',
      label: '「菜单模式」查看当前模式（群内）',
      scope: ['group'],
      triggers: ['菜单模式'],
      lines: [
        { "t": "text", "v": "🔀 菜单模式" },
        { "t": "text", "v": "━━━━━━━━━━━━━━" },
        { "t": "text", "v": "当前全局菜单模式：{modeName}" },
        { "t": "link", "pre": "仅群主/群管理可切换：", "label": "发送「切换文字菜单」", "cmd": "切换文字菜单", "post": "或「切换图片菜单」。" }
      ]
    },
    {
      key: 'mode@c2c',
      label: '「菜单模式」查看当前模式（私聊）',
      scope: ['c2c'],
      triggers: ['菜单模式'],
      lines: [
        { "t": "text", "v": "🔀 菜单模式" },
        { "t": "text", "v": "━━━━━━━━━━━━━━" },
        { "t": "text", "v": "当前全局菜单模式：{modeName}" },
        { "t": "link", "label": "发送「切换文字菜单」", "cmd": "切换文字菜单", "post": "或「切换图片菜单」即可切换。" }
      ]
    },
    {
      key: 'linkMode',
      label: '「文字外显 / 文字外显模式」查看当前外显模式',
      scope: ['group', 'c2c'],
      triggers: ['文字外显', '文字外显模式'],
      lines: [
        { "t": "text", "v": "🔗 文字外显模式" },
        { "t": "text", "v": "━━━━━━━━━━━━━━" },
        { "t": "text", "v": "当前：{lmName}" },
        { "t": "text", "v": "发送「文字外显 开」→ 所有插件菜单入口渲染为链接式" },
        { "t": "text", "v": "发送「文字外显 关」→ 所有插件菜单入口渲染为纯文本" },
        { "t": "text", "v": "开启后点击链接，指令会填入输入框，点发送即可使用" }
      ]
    },
    {
      key: 'linkOn',
      label: '「文字外显 开/链接/on」切换成功确认',
      scope: ['group', 'c2c'],
      triggers: ['文字外显 开', '文字外显 链接', '文字外显 on'],
      lines: [
        { "t": "text", "v": "🔗 已开启文字外显链接模式：所有插件菜单入口渲染为 mqqapi 链接，点击后指令回填输入框。发送「新版菜单」查看效果。" }
      ]
    },
    {
      key: 'linkOff',
      label: '「文字外显 关/文本/off」切换成功确认',
      scope: ['group', 'c2c'],
      triggers: ['文字外显 关', '文字外显 文本', '文字外显 off'],
      lines: [
        { "t": "text", "v": "📝 已关闭文字外显链接模式：所有插件菜单入口渲染为纯文本。" }
      ]
    },
    {
      key: 'permLink',
      label: '切换文字外显模式权限拒绝',
      scope: ['group'],
      triggers: ['文字外显 开', '文字外显 关', '文字外显 链接', '文字外显 文本'],
      lines: [
        { "t": "text", "v": "⛔ 权限不足：切换文字外显模式仅群主/群管理可操作！" }
      ]
    },
    {
      key: 'menuImage',
      label: '「切换图片菜单 / 菜单模式 图片」切换成功确认',
      scope: ['group', 'c2c'],
      triggers: ['切换图片菜单', '菜单模式 图片'],
      lines: [
        { "t": "text", "v": "🖼 已切换为图片模式：菜单将以图片卡片发送。发送「新版菜单」查看效果。" }
      ]
    },
    {
      key: 'menuText',
      label: '「切换文字菜单 / 菜单模式 文字」切换成功确认',
      scope: ['group', 'c2c'],
      triggers: ['切换文字菜单', '菜单模式 文字'],
      lines: [
        { "t": "text", "v": "🔤 已切换为文字模式：菜单将以按钮/文字发送。发送「新版菜单」查看效果。" }
      ]
    },
    {
      key: 'permMenu',
      label: '切换菜单模式权限拒绝',
      scope: ['group'],
      triggers: ['切换文字菜单', '切换图片菜单', '菜单模式 文字', '菜单模式 图片'],
      lines: [
        { "t": "text", "v": "⛔ 权限不足：切换菜单模式仅群主/群管理可操作！" }
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
function _fbModeView(modeName) {
  return '🔀 菜单模式\n━━━━━━━━━━━━━━\n当前全局菜单模式：' + modeName + '\n仅群主/群管理可切换：' + _rsMq('发送「切换文字菜单」', '切换文字菜单') + '或「切换图片菜单」。';
}
function _fbModeViewC2c(modeName) {
  return '🔀 菜单模式\n━━━━━━━━━━━━━━\n当前全局菜单模式：' + modeName + '\n' + _rsMq('发送「切换文字菜单」', '切换文字菜单') + '或「切换图片菜单」即可切换。';
}
function _fbLinkModeView(lmName) {
  return '🔗 文字外显模式\n━━━━━━━━━━━━━━\n当前：' + lmName + '\n发送「文字外显 开」→ 所有插件菜单入口渲染为链接式\n发送「文字外显 关」→ 所有插件菜单入口渲染为纯文本\n开启后点击链接，指令会填入输入框，点发送即可使用';
}
function _fbLinkOn() { return '🔗 已开启文字外显链接模式：所有插件菜单入口渲染为 mqqapi 链接，点击后指令回填输入框。发送「新版菜单」查看效果。'; }
function _fbLinkOff() { return '📝 已关闭文字外显链接模式：所有插件菜单入口渲染为纯文本。'; }
function _fbPermLink() { return '⛔ 权限不足：切换文字外显模式仅群主/群管理可操作！'; }
function _fbMenuImage() { return '🖼 已切换为图片模式：菜单将以图片卡片发送。发送「新版菜单」查看效果。'; }
function _fbMenuText() { return '🔤 已切换为文字模式：菜单将以按钮/文字发送。发送「新版菜单」查看效果。'; }
function _fbPermMenu() { return '⛔ 权限不足：切换菜单模式仅群主/群管理可操作！'; }

module.exports = {
  manifest: {
    id: 'mod-menu-mode',
    name: '菜单模式',
    version: '1.1.0',
    description: '文字指令版菜单（发送"文字指令"查看指令清单）、全局菜单模式切换（文字/图片）、全局文字外显模式切换（链接式/纯文本）',
    author: '511742399'
  },

  async init() {},

  onEnable: function(ctx) {
    ctx.logger.info('菜单模式 v1.1.0 已加载');
    var self = this;

    // ReplySpec：服务器 config 覆盖内置模板（后台「回复编辑器」保存后即时生效）
    var curSpec = REPLY_SPEC;
    try {
      var raw = (ctx.engine && ctx.engine.getConfigValue) ? ctx.engine.getConfigValue('plugin.file-菜单模式.reply') : null;
      if (raw) {
        var parsed = JSON.parse(String(raw));
        if (parsed && Array.isArray(parsed.branches) && parsed.branches.length) curSpec = parsed;
      }
    } catch (e) { ctx.logger.warn('菜单模式 ReplySpec config 解析失败，使用内置模板: ' + String(e && e.message || e)); }
    self._curSpec = curSpec;
    self._rsLinkFn = function(t, c) { return (ctx.link && ctx.link.linkify) ? ctx.link.linkify(t, c) : _rsMq(t, c); };

    ctx.eventBus.on('message.group', async function(data) {
      try { await self.handle(ctx, data); } catch (e) {}
    });
    ctx.eventBus.on('message.c2c', async function(data) {
      try { await self.handle(ctx, data); } catch (e) {}
    });
  },

  handle: async function(ctx, data) {
    try {
      var curSpec = this._curSpec || REPLY_SPEC;
      var linkFn = this._rsLinkFn || function(t, c) { return (ctx.link && ctx.link.linkify) ? ctx.link.linkify(t, c) : _rsMq(t, c); };

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
      async function sendGroup(gid, text, msgId) {
        try {
          if (ctx.bot && ctx.bot.sendMarkdownGroup) {
            var r = await ctx.bot.sendMarkdownGroup(gid, text, msgId);
            if (r) return r;
          }
          return await ctx.bot.sendGroupMessage(gid, text, msgId);
        } catch (e) {
          ctx.logger.error('菜单模式回复失败: ' + String(e && e.message || e));
          try { return await ctx.bot.sendGroupMessage(gid, text, msgId); } catch (e2) { ctx.logger.error('菜单模式文本回复失败: ' + String(e2 && e2.message || e2)); }
          return null;
        }
      }

      var content = String(data.content || '').replace(/^\s*(?:<@!?[A-Za-z0-9_\-]+>|@\S+)\s*/, '').trim();
      var isC2c = !data.groupId;
      var groupId = data.groupId;
      var userId = (data.author && data.author.openid) || '';
      var msgId = data.id;

      // 超级主人判断（isSameUser QQ 兜底）
      var isSuper = function(uid) {
        var raw = ctx.storage.get('super_master_id') || '';
        var superId = '';
        try { var obj = JSON.parse(raw); superId = obj.id || ''; } catch(e) { superId = raw; }
        if (!superId) return false;
        if (superId === uid) return true;
        try { return !!(ctx.identity && ctx.identity.isSameUser && ctx.identity.isSameUser(superId, uid)); } catch(e) { return false; }
      };

      // 文字指令版菜单（TEXT_MENU 常量清单属于菜单内容，原样发送，不走模板）
      if (content === '文字指令' || content === '指令文字' || content === '文字菜单' || content === '指令菜单') {
        if (!groupId) {
          try { await ctx.bot.sendPrivateMessage(userId, TEXT_MENU, msgId); } catch (e) {}
          return;
        }
        try { await ctx.bot.sendGroupMessage(groupId, TEXT_MENU, msgId); } catch (e) {}
        return;
      }

      // 查看当前菜单模式（模板化确认文案）
      if (content === '菜单模式') {
        var mode = (ctx.engine && ctx.engine.getGlobalMode) ? ctx.engine.getGlobalMode() : 'text';
        var modeName = mode === 'image' ? '🖼 图片模式（菜单以图片卡片发送）' : '🔤 文字模式（菜单以按钮/文字发送）';
        var viewText = isC2c
          ? (render('mode@c2c', data, { modeName: modeName }) || _fbModeViewC2c(modeName))
          : (render('mode', data, { modeName: modeName }) || _fbModeView(modeName));
        if (!groupId) { try { await ctx.bot.sendPrivateMessage(userId, viewText, msgId); } catch (e) {} return; }
        try { await sendGroup(groupId, viewText, msgId); } catch (e) {}
        return;
      }

      // 文字外显模式（全局切换：所有插件外显文字在"链接式"与"纯文本"之间切换）
      if (content === '文字外显' || content === '文字外显模式') {
        var lm = (ctx.engine && ctx.engine.getLinkMode) ? ctx.engine.getLinkMode() : 'on';
        var lmName = lm === 'on' ? '🔗 链接式（外显文字为可点击的 mqqapi 链接，点链接回填指令）' : '📝 纯文本（外显文字为普通文字）';
        var lmText = render('linkMode', data, { lmName: lmName }) || _fbLinkModeView(lmName);
        if (!groupId) { try { await ctx.bot.sendPrivateMessage(userId, lmText, msgId); } catch (e) {} return; }
        try { await sendGroup(groupId, lmText, msgId); } catch (e) {}
        return;
      }
      var ml = content.match(/^文字外显\s+(开|关|链接|文本|on|off)$/);
      if (ml) {
        var target = (ml[1] === '开' || ml[1] === '链接' || ml[1] === 'on') ? 'on' : 'off';
        if (!isC2c) {
          var role2 = (ctx.engine && ctx.engine.getGroupMemberRole) ? ctx.engine.getGroupMemberRole(groupId, userId) : '';
          if (!isSuper(userId) && role2 !== 'owner' && role2 !== 'admin' && role2 !== '主' && role2 !== '管理') {
            var pLText = render('permLink', data) || _fbPermLink();
            try { await ctx.bot.sendGroupMessage(groupId, pLText, msgId); } catch (e) {}
            return;
          }
        }
        if (ctx.engine && ctx.engine.setLinkMode) ctx.engine.setLinkMode(target);
        var okText = target === 'on'
          ? (render('linkOn', data) || _fbLinkOn())
          : (render('linkOff', data) || _fbLinkOff());
        if (!groupId) { try { await ctx.bot.sendPrivateMessage(userId, okText, msgId); } catch (e) {} return; }
        try { await sendGroup(groupId, okText, msgId); } catch (e) {}
        return;
      }

      // 切换菜单模式
      var m = content.match(/^切换(文字|图片)(菜单)?$/) || content.match(/^菜单模式\s+(文字|图片)$/);
      if (m) {
        var mTarget = m[1] === '图片' ? 'image' : 'text';
        // 权限：单聊本人可用；群聊需群主/群管理（超主永远可操作）
        if (!isC2c) {
          var role = (ctx.engine && ctx.engine.getGroupMemberRole) ? ctx.engine.getGroupMemberRole(groupId, userId) : '';
          if (!isSuper(userId) && role !== 'owner' && role !== 'admin' && role !== '主' && role !== '管理') {
            var pMText = render('permMenu', data) || _fbPermMenu();
            try { await ctx.bot.sendGroupMessage(groupId, pMText, msgId); } catch (e) {}
            return;
          }
        }
        if (ctx.engine && ctx.engine.setGlobalMode) ctx.engine.setGlobalMode(mTarget);
        var mOkText = mTarget === 'image'
          ? (render('menuImage', data) || _fbMenuImage())
          : (render('menuText', data) || _fbMenuText());
        if (!groupId) { try { await ctx.bot.sendPrivateMessage(userId, mOkText, msgId); } catch (e) {} return; }
        try { await sendGroup(groupId, mOkText, msgId); } catch (e) {}
        return;
      }
    } catch(e) {}
  }
};
