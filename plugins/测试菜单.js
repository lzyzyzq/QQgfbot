// 测试菜单 v1.3.0 - mqqapi 链接式菜单 + 全区块可编辑卡片 + 多页面模型 + 官方能力演示（Node 平台移植）
// 用 mqqapi://aio/inlinecmd 链接做菜单入口：点击后指令回填输入框，点发送即触发对应功能
// 渲染：整张卡片 = 有序区块列表（blocks），每个区块可增删/上移/下移/编辑，后台「测试菜单」编辑页 + 群内「测试菜单设置」串联同一份配置
// 头像：可选用户头像（富媒体上传群文件得 file_info 单独发图 + markdown 卡不渲染图片行；私聊/上传失败回退 URL 直链）
// 区块类型：avatar(头像) / head_links(头部外显链接，如 免@联系群主) / title(标题) / meta(昵称·用户ID·群信息) /
//           divider(分割线) / intro(说明) / rows(菜单项，每行1~N项 cmd回填|link跳转) / tips(提示) /
//           footer_title(底部标题，文字外显) / footer(底部代码块，fence 可改类型名，支持 {time} 实时时间)
// 页面模型：配置 = 主菜单页（默认显示）+ 多个独立页面，每页独立 blocks；页面通过「测试菜单 @页面名」呼出
// 兼容：旧配置（title/intro/rows/tips/footer_* 字段）自动合成为 blocks，不影响既有用户
// 存储：插件配置 config 表（key=plugin.file-测试菜单.config，按 botId 分组），后台管理面板「测试菜单」页可编辑
// 触发词：测试菜单 / 菜单测试 / 测试菜单 @页面名 / 联系群主 / 测试官方 <能力> / 测试菜单设置
var _avatarFileCache = {}; // 头像富媒体缓存：key = gid|url|宽x高 → { fileInfo, ts }，TTL 10 分钟
module.exports = {
  manifest: {
    id: 'mod-test-menu',
    name: '测试菜单',
    version: '1.3.0',
    description: 'mqqapi链接式测试菜单：整卡全区块可编辑/增删/移动（头像/免@联系群主/标题/信息/分割线/说明/菜单项/提示/底部）；多页面模型；群主/管理「测试菜单设置」改内容；后台「测试菜单」页可视化编辑；官方能力演示；头像富媒体上传真图显示',
    author: '511742399',
    // 官方开放平台能力清单（单一来源：后端 capabilities 接口 / 编辑器能力面板 / 官方功能页同步 / 「测试官方」入口均由此驱动）
    capabilities: [
      { label: '📝 文字消息', value: '测试官方 文字消息', desc: '基础文本消息 msg_type=0', available: true },
      { label: '🖼️ 图片消息', value: '测试官方 图片消息', desc: '富媒体图片（图为你头像）', available: true },
      { label: '🔊 语音消息', value: '测试官方 语音消息', desc: '富媒体语音（示例音频）', available: true },
      { label: '🎬 视频消息', value: '测试官方 视频消息', desc: '富媒体视频（示例视频）', available: true },
      { label: '📁 文件消息', value: '测试官方 文件消息', desc: '富媒体文件（示例 PDF）', available: true },
      { label: '📄 Markdown消息', value: '测试官方 Markdown消息', desc: 'markdown 富文本渲染', available: true },
      { label: '🔘 内联按钮', value: '测试官方 内联按钮', desc: '内联键盘按钮（type=11）', available: true },
      { label: '📇 文卡', value: '测试官方 文卡', desc: 'ARK 文卡（template 23）', available: true },
      { label: '🖼️ 大图卡', value: '测试官方 大图卡', desc: 'ARK 大图卡（template 37）', available: true },
      { label: '🔗 跳转卡', value: '测试官方 跳转卡', desc: 'ARK 跳转卡（template 24）', available: true },
      { label: '🗒️ 表单卡', value: '测试官方 表单卡', desc: 'ARK 表单卡（平台暂未接入）', available: false },
      { label: '💨 流式消息', value: '测试官方 流式消息', desc: '流式消息（平台暂未接入）', available: false },
      { label: '🗑️ 撤回消息', value: '测试官方 撤回消息', desc: '删除群内指定消息', available: true },
      { label: '😀 表情表态', value: '测试官方 表情表态', desc: '消息表情表态（平台暂未接入）', available: false },
      { label: '🏠 群信息', value: '测试官方 群信息', desc: '查询群资料（GET 群信息）', available: true },
      { label: '👥 群成员', value: '测试官方 群成员', desc: '群成员列表（前10）', available: true },
      { label: '📢 群公告', value: '测试官方 群公告', desc: '查看/发布群公告', available: true },
      { label: '🔇 全员禁言', value: '测试官方 全员禁言', desc: '查询全员禁言状态', available: true },
      { label: '🔕 禁言列表', value: '测试官方 禁言列表', desc: '查询全员禁言设置', available: true },
      { label: '📥 入群申请', value: '测试官方 入群申请', desc: '查看入群申请列表', available: true },
      { label: '🗂️ 群组列表', value: '测试官方 群组列表', desc: '当前机器人所在频道/群列表', available: true },
      { label: '📡 频道信息', value: '测试官方 频道信息', desc: '频道详情与子频道列表', available: true },
      { label: '🤖 机器人信息', value: '测试官方 机器人信息', desc: '机器人名称/ID/版本', available: true },
      { label: '👤 用户信息', value: '测试官方 用户信息', desc: '绑定QQ用户信息（昵称/头像）', available: true },
      { label: '🆔 OpenID查询', value: '测试官方 OpenID查询', desc: '展示当前消息发送者 openid', available: true }
    ]
  },

  methods: {
    // ========== 配置读写（按 botId 分组） ==========
    readAll: function(ctx) {
      try {
        var raw = ctx.storage.get('config');
        var all = JSON.parse(raw || '{}');
        return (all && typeof all === 'object') ? all : {};
      } catch (e) { return {}; }
    },
    saveAll: function(ctx, all) {
      ctx.storage.set('config', JSON.stringify(all));
      return true;
    },

    // ========== 默认页面集合（blocks 模型：主菜单 + 官方功能演示页） ==========
    defaultPages: function() {
      return {
        '主菜单': {
          blocks: [
            { type: 'avatar', source: 'user' },
            { type: 'head_links', items: [{ label: '免@联系群主', type: 'cmd', value: '联系群主' }] },
            { type: 'title', text: '**🌟 空空 Bot 测试菜单**' },
            { type: 'meta', show: ['nickname', 'userid', 'group'] },
            { type: 'divider', text: '━━━━━━━━━━━━━━' },
            { type: 'intro', text: '点下方链接，指令会填入输入框，点发送即可使用 ↓' },
            {
              type: 'rows',
              rows: [
                [
                  { label: '📅 签到', type: 'cmd', value: '签到' },
                  { label: '📋 我的签到', type: 'cmd', value: '我的签到' }
                ],
                [
                  { label: '📊 签到记录', type: 'cmd', value: '签到记录' }
                ],
                [
                  { label: '🔮 今日运势', type: 'cmd', value: '今日运势' },
                  { label: '🎲 掷骰子', type: 'cmd', value: '掷骰子' }
                ],
                [
                  { label: '😄 笑话', type: 'cmd', value: '笑话' }
                ],
                [
                  { label: '⚙️ 官方功能', type: 'cmd', value: '测试菜单 @官方功能' }
                ]
              ]
            },
            { type: 'tips', text: '📌 Tips: 签到为测试功能，点击后确认输入框指令再发送' },
            { type: 'divider', text: '━━━━━━━━━━━━━━' },
            { type: 'footer_title', text: '⚠️ 测试功能 ⚠️' },
            { type: 'footer', fence: 'text', lines: ['当前时间：{time}', '最后更新：2026-08-28'] }
          ]
        },
        '官方功能': {
          blocks: [
            { type: 'avatar', source: 'user' },
            { type: 'head_links', items: [{ label: '免@联系群主', type: 'cmd', value: '联系群主' }] },
            { type: 'title', text: '**⚙️ 官方开放平台功能**' },
            { type: 'meta', show: ['nickname', 'userid', 'group'] },
            { type: 'divider', text: '━━━━━━━━━━━━━━' },
            { type: 'intro', text: '以下是官方开放平台可实现的能力演示，点某项回填演示指令，点发送即可调用官方接口 ↓' },
            {
              type: 'rows',
              rows: [
                [
                  { label: '📝 文字消息', type: 'cmd', value: '测试官方 文字消息' },
                  { label: '🖼️ 图片消息', type: 'cmd', value: '测试官方 图片消息' }
                ],
                [
                  { label: '🔊 语音消息', type: 'cmd', value: '测试官方 语音消息' },
                  { label: '🎬 视频消息', type: 'cmd', value: '测试官方 视频消息' }
                ],
                [
                  { label: '📄 Markdown消息', type: 'cmd', value: '测试官方 Markdown消息' },
                  { label: '🔘 内联按钮', type: 'cmd', value: '测试官方 内联按钮' }
                ],
                [
                  { label: '📇 文卡', type: 'cmd', value: '测试官方 文卡' },
                  { label: '🖼️ 大图卡', type: 'cmd', value: '测试官方 大图卡' }
                ],
                [
                  { label: '🔗 跳转卡', type: 'cmd', value: '测试官方 跳转卡' },
                  { label: '💨 流式消息', type: 'cmd', value: '测试官方 流式消息' }
                ],
                [
                  { label: '🗑️ 撤回消息', type: 'cmd', value: '测试官方 撤回消息' },
                  { label: '🏠 群信息', type: 'cmd', value: '测试官方 群信息' }
                ],
                [
                  { label: '👥 群成员', type: 'cmd', value: '测试官方 群成员' },
                  { label: '🔇 禁言列表', type: 'cmd', value: '测试官方 禁言列表' }
                ],
                [
                  { label: '🤖 机器人信息', type: 'cmd', value: '测试官方 机器人信息' }
                ],
                [
                  { label: '🏠 返回主菜单', type: 'cmd', value: '测试菜单' }
                ]
              ]
            },
            { type: 'tips', text: '📌 每一项对应一个官方接口，指令格式：测试官方 <能力>；可在此新增/删除/编辑你的功能项' },
            { type: 'divider', text: '━━━━━━━━━━━━━━' },
            { type: 'footer_title', text: '⚠️ 官方能力提示 ⚠️' },
            { type: 'footer', fence: 'text', lines: ['当前时间：{time}', '最后更新：2026-08-28'] }
          ]
        }
      };
    },

    // ========== 读取当前机器人配置（key 为空=主菜单页，否则指定页面） ==========
    readPage: function(ctx, botId, key) {
      var all = this.readAll(ctx);
      var cfg = (all[botId] && typeof all[botId] === 'object') ? all[botId] : {};
      var pages = (cfg.pages && typeof cfg.pages === 'object') ? cfg.pages : this.defaultPages();
      if (!key) {
        var main = (cfg.main_page && pages[cfg.main_page]) ? cfg.main_page : '主菜单';
        if (!pages[main]) {
          var keys = Object.keys(pages);
          main = keys[0] || '';
        }
        key = main;
      }
      var page = pages[key];
      if (!page || typeof page !== 'object') return null;
      var blocks = this.normalizeBlocks(ctx, page, cfg);
      return { key: key, blocks: blocks, cfg: cfg };
    },

    // ========== 规范化页面区块：优先 page.blocks；旧字段自动合成（兼容 1.0.0 配置） ==========
    normalizeBlocks: function(ctx, page, cfg) {
      if (page.blocks && Array.isArray(page.blocks) && page.blocks.length) {
        var out = [];
        for (var i = 0; i < page.blocks.length; i++) {
          var b = page.blocks[i];
          if (!b || typeof b !== 'object') continue;
          var t = String(b.type || '');
          if (!t) continue;
          var nb = { type: t };
          if (t === 'avatar') {
            nb.source = b.source === 'none' ? 'none' : (b.source === 'member' ? 'member' : (b.source === 'fixed' ? 'fixed' : 'user'));
            if (b.source === 'fixed' && b.value) nb.value = String(b.value);
            var nbw = Math.round(Number(b.width));
            var nbh = Math.round(Number(b.height));
            if (nbw >= 20 && nbw <= 640) nb.width = nbw;
            if (nbh >= 20 && nbh <= 640) nb.height = nbh;
          }
          if (t === 'head_links') nb.items = Array.isArray(b.items) ? b.items : [];
          if (t === 'title' || t === 'intro' || t === 'tips' || t === 'divider' || t === 'footer_title') nb.text = String(b.text || '');
          if (t === 'meta') {
            if (Array.isArray(b.meta_fields) && b.meta_fields.length) {
              nb.meta_fields = b.meta_fields.filter(function(f) { return f && f.key; });
            } else {
              var msh = Array.isArray(b.show) ? b.show : [];
              nb.show = msh.filter(function(s) { return (typeof s === 'string' && s) || (s && typeof s === 'object' && s.key); });
            }
          }
          if (t === 'rows') nb.rows = Array.isArray(b.rows) ? b.rows : [];
          if (t === 'footer') {
            nb.fence = b.fence === '' ? '' : String(b.fence || 'text');
            nb.lines = Array.isArray(b.lines) ? b.lines : [];
          }
          out.push(nb);
        }
        return out;
      }
      // 旧字段合成
      var blocks = [];
      if (cfg.show_avatar !== false) blocks.push({ type: 'avatar', source: 'user' });
      blocks.push({ type: 'title', text: String(page.title || '') });
      blocks.push({ type: 'meta', show: ['nickname', 'userid', 'group'] });
      blocks.push({ type: 'divider', text: '━━━━━━━━━━━━━━' });
      blocks.push({ type: 'intro', text: String(page.intro || '') });
      blocks.push({ type: 'rows', rows: Array.isArray(page.rows) ? page.rows : [] });
      if (page.tips) blocks.push({ type: 'tips', text: String(page.tips) });
      blocks.push({ type: 'divider', text: '━━━━━━━━━━━━━━' });
      blocks.push({ type: 'footer_title', text: String(page.footer_title || '') });
      blocks.push({ type: 'footer', fence: 'text', lines: Array.isArray(page.footer_lines) ? page.footer_lines : [] });
      return blocks;
    },

    // ========== 构造菜单链接（委托全局 engine.menuLink：type=link 直接跳转；否则 mqqapi inlinecmd 回填指令） ==========
    menuLink: function(label, item) {
      try {
        if (this._ctx && this._ctx.engine && this._ctx.engine.menuLink) {
          return this._ctx.engine.menuLink(label, item);
        }
      } catch (e) {}
      var type = (item && item.type) || 'cmd';
      var value = String((item && item.value) || '');
      if (type === 'link') return '[' + label + '](' + value + ')';
      if (type === 'image') value = (item.via === 'draw') ? '__draw:' + value : '__img:' + value;
      else if (type === 'page') value = '__page:' + value;
      else if (type === 'plugin') value = '__call:' + value;
      // cmd=点击回填待发送；cmd_auto=点击直接发送（enter=true 一键触发）
      var enter = type === 'cmd_auto';
      return '[' + label + '](mqqapi://aio/%69nlinecmd?command=' + encodeURIComponent(value) + '&enter=' + enter + '&reply=false)';
    },

    // ========== 时间格式化（固定北京时间 UTC+8） ==========
    nowText: function() {
      var d = new Date(Date.now() + 8 * 3600 * 1000);
      var pad = function(n) { return String(n).padStart(2, '0'); };
      return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
    },

    // ========== 渲染整卡（按 blocks 顺序逐区块渲染） ==========
    renderBlocks: function(ctx, data, blocks, avatarMdUrl) {
      var userId = (data.author && data.author.openid) || '';
      var profile = null;
      try { profile = ctx.engine.getUserProfile ? ctx.engine.getUserProfile(userId, 1) : null; } catch (e) {}
      var nickname = (profile && profile.nickname) || (data.author && data.author.username) || '未绑定昵称';
      var qq = (profile && profile.qq_number) || '';
      var avatar = (profile && profile.avatar) || '';
      var gid = data.groupId || '';
      var groupName = '';
      var groupNumber = '';
      if (gid) {
        try { groupName = ctx.engine.getGroupName ? String(ctx.engine.getGroupName(gid) || '') : ''; } catch (e) {}
        try { groupNumber = ctx.engine.getGroupNumber ? String(ctx.engine.getGroupNumber(gid) || '') : ''; } catch (e) {}
      }

      var lines = [];
      for (var i = 0; i < blocks.length; i++) {
        var b = blocks[i];
        if (!b || typeof b !== 'object') continue;
        // QQ markdown 不支持 text-align；用全角空格做右/居中对齐的近似（头像、链接、图片除外，避免破坏解析）
        var pad = this.alignPad(b.align, b.type === 'avatar' ? 'center' : 'left');
        switch (b.type) {
          case 'avatar':
            if (b.source === 'none') break;
            if (b.source === 'fixed' && b.value) avatar = String(b.value);
            if (b.source === 'member' && gid) {
              try {
                var mb = ctx.engine.getGroupMemberAvatar ? ctx.engine.getGroupMemberAvatar(gid, userId) : null;
                if (mb) { avatar = mb; }
              } catch (e) {}
            }
            if (avatar) {
              var aw = Math.round(Number(b.width)) >= 20 && Math.round(Number(b.width)) <= 640 ? Math.round(Number(b.width)) : 50;
              var ah = Math.round(Number(b.height)) >= 20 && Math.round(Number(b.height)) <= 640 ? Math.round(Number(b.height)) : 50;
              // 头像 URL 内嵌进 markdown 卡片同一消息（优先用上传后的 QQ CDN 域名，上传失败回退原始 URL）
              var imgUrl = avatarMdUrl || avatar;
              lines.push('![头像 #' + aw + 'px #' + ah + 'px](' + imgUrl + ')');
            }
            break;
          case 'head_links':
            if (Array.isArray(b.items) && b.items.length) {
              var links = [];
              for (var h = 0; h < b.items.length; h++) {
                var it = b.items[h];
                if (it && typeof it === 'object' && it.label && it.value) links.push(this.menuLink(String(it.label), it));
              }
              if (links.length) lines.push(links.join('　|　'));
            }
            break;
          case 'title':
            if (b.text) lines.push(pad + b.text);
            break;
          case 'meta':
            var metaLines = this.metaLines(ctx, data, b, { nickname: nickname, qq: qq, userId: userId, gid: gid, groupName: groupName, groupNumber: groupNumber });
            for (var mli = 0; mli < metaLines.length; mli++) lines.push(pad + metaLines[mli]);
            break;
          case 'divider':
            lines.push(pad + (b.text || '━━━━━━━━━━━━━━'));
            break;
          case 'intro':
            if (b.text) { lines.push(pad + b.text); lines.push(''); }
            break;
          case 'rows':
            var rows = Array.isArray(b.rows) ? b.rows : [];
            for (var r = 0; r < rows.length; r++) {
              var row = rows[r];
              if (!row || typeof row !== 'object') continue;
              if (!Array.isArray(row)) { row = [row]; }
              var cells = [];
              for (var c = 0; c < row.length; c++) {
                var item = row[c];
                if (item && typeof item === 'object' && item.label && item.value) cells.push(this.menuLink(String(item.label), item));
              }
              if (cells.length) lines.push(cells.join('　|　'));
            }
            break;
          case 'tips':
            if (b.text) { lines.push(''); lines.push(pad + b.text); }
            break;
          case 'footer_title':
            if (b.text) lines.push(pad + b.text);
            break;
          case 'footer':
            var fl = (Array.isArray(b.lines) ? b.lines : []).map(function(s) { return String(s).replace(/\{time\}/g, this.nowText()); }, this);
            if (fl.length) {
              var fence = b.fence === '' ? '' : String(b.fence || 'text');
              lines.push('');
              if (fence) lines.push('```' + fence);
              for (var f = 0; f < fl.length; f++) lines.push(pad + fl[f]);
              if (fence) lines.push('```');
            }
            break;
          case '__group':
            var kids = Array.isArray(b.children) ? b.children : [];
            if (kids.length) {
              var kidRows = [];
              for (var gi = 0; gi < kids.length; gi++) {
                if (!kids[gi] || typeof kids[gi] !== 'object') continue;
                // 子块行内已带各自 align 前缀（renderBlocks 内按块 pad），此处不再重复添加
                kidRows.push({ align: kids[gi].align || 'left', lines: this.renderBlocks(ctx, data, [kids[gi]], avatarMdUrl) });
              }
              // 并排近似：每个子块都只产出 1 行且都不含图片 → 用分隔符连成一行；否则按顺序纵向输出
              var allSingle = kidRows.length > 0 && kidRows.every(function(k) { return k.lines.length === 1; });
              var anyImg = kidRows.some(function(k) { return /^!\[/.test(k.lines[0] || ''); });
              if (allSingle && !anyImg) {
                lines.push(kidRows.map(function(k) { return k.lines[0]; }).join('　|　'));
              } else {
                for (var gj = 0; gj < kidRows.length; gj++) {
                  for (var gk = 0; gk < kidRows[gj].lines.length; gk++) {
                    lines.push(kidRows[gj].lines[gk]);
                  }
                }
              }
            }
            break;
        }
      }
      return lines;
    },

    // 对齐近似：QQ markdown 无 text-align；center 前补 2 个全角空格，right 前补 3 个
    alignPad: function(align, def) {
      if (align === 'right') return '　　　';
      if (align === 'center') return '　　';
      return '';
    },

    // ========== 用户信息行（meta）：可配置字段列表（内置/跨插件/自定义） ==========
    defaultMetaLabel: { nickname: '👤 昵称', userid: '🆔 用户ID', group: '👥 群信息', role: '🔑 群内权限', points: '💰 积分', checkin_streak: '🔥 连续签到', checkin_date: '📅 最近签到', fish_coins: '🎣 钓鱼金币', fish_catches: '🐟 钓鱼收获', farm_coins: '🌾 农场金币' },

    getPluginStorage: function(ctx, target, key) {
      try {
        if (ctx.engine && ctx.engine.getPluginStorage) return ctx.engine.getPluginStorage(target, key);
      } catch (e) {}
      return null;
    },

    normalizeMetaFields: function(b) {
      var out = [];
      if (Array.isArray(b.meta_fields) && b.meta_fields.length) {
        b.meta_fields.forEach(function(f) {
          if (f && typeof f === 'object' && f.key) out.push(f);
        });
        return out;
      }
      var show = b.show || [];
      if (typeof show === 'string') show = [show];
      if (!Array.isArray(show)) show = [];
      show.forEach(function(s) {
        if (typeof s === 'string' && s) out.push({ key: s });
        else if (s && typeof s === 'object' && s.key) out.push(s);
      });
      return out;
    },

    metaLines: function(ctx, data, b, env) {
      var fields = this.normalizeMetaFields(b);
      var lines = [];
      for (var i = 0; i < fields.length; i++) {
        if (fields[i].enabled === false) continue;
        var line = this.renderMetaField(ctx, data, fields[i], env);
        if (line) lines.push(line);
      }
      return lines;
    },

    renderMetaField: function(ctx, data, f, env) {
      var label = (f.label && String(f.label).trim()) || (this.defaultMetaLabel[f.key] || '');
      var key = f.key;
      if (key === 'nickname') return (label || '👤 昵称') + '：' + env.nickname + (env.qq ? '（QQ: ' + env.qq + '）' : '');
      if (key === 'userid') return (label || '🆔 用户ID') + '：' + env.userId;
      if (key === 'group') {
        if (!env.gid) return null;
        var gname = env.groupName || '未命名群';
        var gsuffix = env.groupNumber ? '（群号：' + env.groupNumber + '）' : '（' + env.gid + '）';
        return (label || '👥 群信息') + '：' + gname + gsuffix;
      }
      if (key === 'role') {
        var role = '';
        try { role = ctx.engine.getGroupMemberRole ? String(ctx.engine.getGroupMemberRole(env.gid, env.userId) || '') : ''; } catch (e) {}
        var txt;
        if (role === 'owner') txt = '群主';
        else if (role === 'admin') txt = '管理员';
        else if (role === 'super' || role === 'master') txt = '主人';
        else if (role) txt = role;
        else {
          // 群成员角色未设置时回退实时判断：超主 → 主人；群主 openid 同人 → 群主
          var isS = false;
          try {
            if (ctx.identity && ctx.identity.isSameUser) {
              var sm = null;
              try { sm = ctx.engine.getPluginStorage ? ctx.engine.getPluginStorage('开关机控制', 'super_master_id') : null; } catch (e2) {}
              if (!sm) { try { sm = ctx.storage ? ctx.storage.get('super_master_id') : null; } catch (e2) {} }
              if (sm) {
                var arr = JSON.parse(sm);
                if (Array.isArray(arr)) { for (var si = 0; si < arr.length; si++) { if (ctx.identity.isSameUser(String(arr[si]), env.userId)) { isS = true; break; } } }
                else if (ctx.identity.isSameUser(String(arr), env.userId)) isS = true;
              }
            }
          } catch (e2) {}
          var owner = null;
          try { owner = ctx.engine.findGroupOwner ? ctx.engine.findGroupOwner(env.gid) : null; } catch (e2) {}
          if (isS) txt = '主人';
          else if (owner && ctx.identity && ctx.identity.isSameUser && ctx.identity.isSameUser(owner.openid, env.userId)) txt = '群主';
          else txt = '普通成员';
        }
        return (label || '🔑 群内权限') + '：' + txt;
      }
      if (key === 'points') {
        var pv = this.getPluginStorage(ctx, '签到系统', 'checkin_' + env.userId + '_total');
        return (label || '💰 积分') + '：' + (pv || '0');
      }
      if (key === 'checkin_streak') {
        var sv = this.getPluginStorage(ctx, '签到系统', 'checkin_' + env.userId + '_streak');
        return (label || '🔥 连续签到') + '：' + (sv || '0') + ' 天';
      }
      if (key === 'checkin_date') {
        var dv = this.getPluginStorage(ctx, '签到系统', 'checkin_' + env.userId + '_date');
        return (label || '📅 最近签到') + '：' + (dv || '未签到');
      }
      if (key === 'fish_coins' || key === 'fish_catches') {
        var fsv = this.getPluginStorage(ctx, '娱乐中心', 'fish_' + env.userId);
        var fobj = null; try { fobj = fsv ? JSON.parse(fsv) : null; } catch (e) {}
        if (key === 'fish_coins') return (label || '🎣 钓鱼金币') + '：' + ((fobj && fobj.coins) || 0);
        return (label || '🐟 钓鱼收获') + '：' + ((fobj && fobj.catches) || 0) + ' 条';
      }
      if (key === 'farm_coins') {
        var fmv = this.getPluginStorage(ctx, '娱乐中心', 'farm_' + env.userId);
        var fobj2 = null; try { fobj2 = fmv ? JSON.parse(fmv) : null; } catch (e) {}
        return (label || '🌾 农场金币') + '：' + ((fobj2 && fobj2.coins) || 0);
      }
      if (key === '__custom') {
        var skey = String(f.skey || '').replace(/\{id\}/g, env.userId);
        var pl = String(f.plugin || '').trim();
        if (!pl || !skey) return null;
        if (pl.indexOf('data:') === 0) {
          var fileName = pl.substring(5).trim();
          if (!fileName) return null;
          var segs = skey.split(':');
          var uidTok = (segs[0] || '').trim();
          var field = (segs.slice(1).join(':') || '').trim();
          var uid = uidTok === '{id}' ? env.userId : uidTok;
          var dobj = null;
          try { dobj = (ctx.data && ctx.data.readJSON) ? ctx.data.readJSON(fileName, null) : null; } catch (e2) {}
          if (dobj && typeof dobj === 'object') {
            var member = dobj[uid] !== undefined ? dobj[uid] : (dobj.members ? dobj.members[uid] : undefined);
            if (member !== undefined && member !== null) {
              var dval = field ? member[field] : member;
              return (label || '📊 ' + fileName) + '：' + (dval === undefined || dval === null ? '无' : dval);
            }
          }
          return (label || '📊 ' + fileName) + '：无';
        }
        var cv = this.getPluginStorage(ctx, pl, skey);
        return (label || '📊 ' + skey) + '：' + (cv || '无');
      }
      return null;
    },

    // ========== 解析头像并上传为群富媒体（获取 QQ CDN 域名 URL，供 markdown 同一卡片内嵌） ==========
    // 返回 { fileInfo, url }；url 优先上传后的 QQ 域名（markdown 图片语法可渲染），无 gid/无上传能力/失败时返回 null
    prepareAvatar: async function(ctx, data, blocks) {
      var gid = data.groupId || '';
      if (!gid || !ctx.bot || !ctx.bot.uploadGroupImage) return null;
      var userId = (data.author && data.author.openid) || '';
      var profile = null;
      try { profile = ctx.engine.getUserProfile ? ctx.engine.getUserProfile(userId, 1) : null; } catch (e) {}
      var avatar = (profile && profile.avatar) || '';
      var src = null;
      var w = 208, h = 208;
      var self = this;
      var walk = function(arr) {
        for (var i = 0; i < arr.length; i++) {
          var b = arr[i];
          if (!b || typeof b !== 'object') continue;
          if (b.type === '__group' && Array.isArray(b.children)) { var r = walk(b.children); if (r) return r; continue; }
          if (b.type !== 'avatar' || b.source === 'none') continue;
          src = b.source;
          if (b.source === 'fixed' && b.value) avatar = String(b.value);
          else if (b.source === 'member' && gid) {
            try {
              var mb = ctx.engine.getGroupMemberAvatar ? ctx.engine.getGroupMemberAvatar(gid, userId) : null;
              if (mb) avatar = mb;
            } catch (e) {}
          }
          w = Math.round(Number(b.width)) >= 20 && Math.round(Number(b.width)) <= 640 ? Math.round(Number(b.width)) : 208;
          h = Math.round(Number(b.height)) >= 20 && Math.round(Number(b.height)) <= 640 ? Math.round(Number(b.height)) : 208;
          return true;
        }
        return null;
      };
      walk(blocks);
      if (src === null || !avatar) return null;
      var ck = gid + '|' + avatar + '|' + w + 'x' + h;
      var now = Date.now();
      var hit = _avatarFileCache[ck];
      if (hit && (now - hit.ts) < 10 * 60 * 1000) return hit;
      try {
        var up = await ctx.bot.uploadGroupImage(gid, avatar);
        if (up && (up.file_info || up.url || up.raw_url)) {
          var rec = { fileInfo: up.file_info || '', url: up.url || up.raw_url || avatar, ts: now };
          _avatarFileCache[ck] = rec;
          return rec;
        }
      } catch (e) {
        ctx.logger && ctx.logger.error('测试菜单头像上传失败: ' + String(e && e.message || e));
      }
      return null;
    },

    // ========== 构建 markdown（返回 { md, avatarUrl }；avatarUrl 为头像 markdown 内嵌 URL 或 null） ==========
    buildMd: async function(ctx, data, key) {
      var page = this.readPage(ctx, data.botId || '', key);
      if (!page) return null;
      var avatarUrl = null;
      var av = await this.prepareAvatar(ctx, data, page.blocks);
      if (av && av.url) avatarUrl = av.url;
      var lines = this.renderBlocks(ctx, data, page.blocks, avatarUrl);
      if (!lines.length) return null;
      return { md: lines.join('\n'), avatarUrl: avatarUrl };
    },

    // ========== 发送卡片：头像 URL 内嵌进同一条 markdown 卡片（群聊/私聊），不再单独发图 ==========
    sendMd: async function(ctx, data, res) {
      var gid = data.groupId || '';
      var msgId = data.id;
      var userId = (data.author && data.author.openid) || '';
      var md = res && typeof res === 'object' ? res.md : res;
      try {
        if (gid) {
          return await ctx.bot.sendMarkdownGroup(gid, md, msgId);
        }
        if (userId && ctx.bot.sendMarkdownC2C) return await ctx.bot.sendMarkdownC2C(userId, md, msgId);
      } catch (e) {
        ctx.logger.error('测试菜单发送失败: ' + String(e && e.message || e));
      }
      return null;
    },

    // ========== 发送纯文字 ==========
    reply: async function(ctx, data, text) {
      var gid = data.groupId || '';
      var msgId = data.id;
      var userId = (data.author && data.author.openid) || '';
      try {
        if (gid) return await ctx.bot.sendGroupMessage(gid, text, msgId);
        if (userId) return await ctx.bot.sendPrivateMessage(userId, text, msgId);
      } catch (e) {
        ctx.logger.error('测试菜单文字回复失败: ' + String(e && e.message || e));
      }
      return null;
    },

    // ========== 群管权限判定（群主/群管理/后台管理员；后台未设角色时放行） ==========
    canManage: function(ctx, gid, openid) {
      if (!gid) {
        try {
          var smRaw = ctx.storage.get('super_master_id');
          var smId = '';
          try {
            var smParsed = JSON.parse(smRaw || '');
            if (Array.isArray(smParsed)) {
              // 旧格式数组：逐个比对（含 isSameUser 兜底）
              if (smParsed.indexOf(openid) >= 0) return true;
              for (var si = 0; si < smParsed.length; si++) {
                if (ctx.identity && ctx.identity.isSameUser && ctx.identity.isSameUser(smParsed[si], openid)) return true;
              }
              return false;
            } else if (smParsed && typeof smParsed === 'object') {
              smId = smParsed.id || '';
            }
          } catch (e) { smId = smRaw || ''; }
          if (smId && (smId === openid || (ctx.identity && ctx.identity.isSameUser && ctx.identity.isSameUser(smId, openid)))) return true;
        } catch (e) {}
        return false;
      }
      try {
        var role = ctx.engine.getGroupMemberRole ? ctx.engine.getGroupMemberRole(gid, openid) : '';
        if (role === 'owner' || role === 'admin' || role === 'super' || role === 'master') return true;
        if (!role) return true;
      } catch (e) { return true; }
      return false;
    },

    // ========== 联系群主（点击「免@联系群主」回填指令后触发） ==========
    contactOwner: async function(ctx, data) {
      var gid = data.groupId || '';
      var owner = null;
      try { owner = ctx.engine.findGroupOwner ? ctx.engine.findGroupOwner(gid) : null; } catch (e) {}
      if (owner && (owner.openid || owner.qq_id || owner.nickname)) {
        var qq = owner.qq_id || '';
        var nick = owner.nickname || '群主';
        var at = owner.openid ? '<@!' + owner.openid + '>' : '';
        await this.reply(ctx, data, '👑 当前群群主：' + nick + (qq ? '（QQ: ' + qq + '）' : '') + (at ? '\n' + at + ' 点此 @TA' : '\n发送「联系群主」可获取，需要对接事务请直接 @TA。'));
      } else {
        await this.reply(ctx, data, '👑 当前群暂未记录群主信息，请直接在群里 @群主 联系。');
      }
      return true;
    },

    // ========== 群内主人设置指令（blocks 适配） ==========
    handleSetting: async function(ctx, data, arg) {
      var openid = (data.author && data.author.openid) || '';
      var gid = data.groupId || '';
      var botId = data.botId || '';
      var all = this.readAll(ctx);
      var cfg = (all[botId] && typeof all[botId] === 'object') ? all[botId] : {};
      var pages = (cfg.pages && typeof cfg.pages === 'object') ? cfg.pages : this.defaultPages();
      var main = (cfg.main_page && pages[cfg.main_page]) ? cfg.main_page : '主菜单';
      if (!pages[main]) { var ks = Object.keys(pages); main = ks[0] || ''; }
      var page = pages[main] ? pages[main] : {};
      page = (page && typeof page === 'object') ? page : {};
      var blocks = this.normalizeBlocks(ctx, page, cfg);

      var findBlock = function(t) {
        for (var i = 0; i < blocks.length; i++) if (blocks[i].type === t) return blocks[i];
        return null;
      };

      if (arg === '') {
        var keys = Object.keys(pages);
        var titleB = findBlock('title');
        var rowsB = findBlock('rows');
        var tipsB = findBlock('tips');
        var ftB = findBlock('footer_title');
        var fb = findBlock('footer');
        var avB = findBlock('avatar');
        var preview =
          '· 标题： ' + (titleB ? String(titleB.text || '') : '') + '\n' +
          '· 头像： ' + (avB ? '开' : '关') + '\n' +
          '· 菜单行： ' + (rowsB && Array.isArray(rowsB.rows) ? rowsB.rows.length : 0) + ' 行\n' +
          '· 提示： ' + (tipsB ? String(tipsB.text || '') : '') + '\n' +
          '· 底部标题： ' + (ftB ? String(ftB.text || '') : '') + '\n' +
          '· 底部内容： ' + (fb && Array.isArray(fb.lines) ? fb.lines.join(' / ') : '') + '\n' +
          '· 区块总数： ' + blocks.length + '（后台「测试菜单」页可增删/移动/改每块内容）\n' +
          '· 主菜单页： ' + main + '\n' +
          '· 页面： ' + (keys.length ? keys.join('、') : '无');
        await this.reply(ctx, data, '📋 测试菜单当前配置\n━━━━━━━━━━━━━━\n' + preview + '\n━━━━━━━━━━━━━━\n发送「测试菜单设置 重置」恢复默认\n发送「测试菜单设置 头像 开/关」开关头像\n发送「测试菜单设置 标题 <文本>」改主菜单页标题\n发送「测试菜单设置 提示 <文本>」改主菜单页提示\n发送「测试菜单设置 底部标题 <文本>」改主菜单页底部标题\n发送「测试菜单设置 底部 <文本>|<文本>」改主菜单页底部内容（| 分隔多行）\n发送「测试菜单设置 页面」查看全部页面\n发送「测试菜单设置 新增页 <页面名>」新建页面\n发送「测试菜单设置 删除页 <页面名>」删除页面\n发送「测试菜单设置 主页 <页面名>」切换主菜单页\n发送「测试菜单设置 加菜单 <标签>|<指令>」主菜单加一行（可加页面名前缀）\n发送「测试菜单设置 删菜单 <标签>」主菜单删行（可加页面名前缀）\n发送「测试菜单设置 同步官方」重建官方功能页能力列表\n页面结构与功能请在后台「测试菜单」编辑页配置');
        return true;
      }
      if (arg === '重置') {
        delete all[botId];
        this.saveAll(ctx, all);
        await this.reply(ctx, data, '✅ 测试菜单已恢复默认配置，发送「测试菜单」查看效果。');
        return true;
      }

      // 保存当前 blocks 到页面（含合并 show_avatar 兼容字段）
      var mainCfg = { main_page: main, pages: pages };

      if (arg.indexOf('头像 ') === 0) {
        var v = arg.substring(3).trim();
        var on = (['开', 'on', 'true', '1'].indexOf(v) >= 0);
        if (on) {
          if (!findBlock('avatar')) blocks.unshift({ type: 'avatar', source: 'user' });
        } else {
          blocks = blocks.filter(function(b) { return b.type !== 'avatar'; });
        }
        page.blocks = blocks;
        mainCfg.show_avatar = on;
        pages[main] = page;
        all[botId] = mainCfg;
        this.saveAll(ctx, all);
        await this.reply(ctx, data, '✅ 头像已' + (on ? '开启' : '关闭') + '，发送「测试菜单」查看效果。');
        return true;
      }
      if (arg.indexOf('标题 ') === 0) {
        var tb = findBlock('title');
        if (tb) tb.text = arg.substring(3).trim();
        else blocks.push({ type: 'title', text: arg.substring(3).trim() });
        page.blocks = blocks;
        pages[main] = page;
        all[botId] = mainCfg;
        this.saveAll(ctx, all);
        await this.reply(ctx, data, '✅ 标题已更新为：\n' + arg.substring(3).trim());
        return true;
      }
      if (arg.indexOf('提示 ') === 0) {
        var tp = findBlock('tips');
        if (tp) tp.text = arg.substring(3).trim();
        else blocks.push({ type: 'tips', text: arg.substring(3).trim() });
        page.blocks = blocks;
        pages[main] = page;
        all[botId] = mainCfg;
        this.saveAll(ctx, all);
        await this.reply(ctx, data, '✅ 提示已更新为：\n' + arg.substring(3).trim());
        return true;
      }
      if (arg.indexOf('底部标题 ') === 0) {
        var ft = findBlock('footer_title');
        if (ft) ft.text = arg.substring(5).trim();
        else blocks.push({ type: 'footer_title', text: arg.substring(5).trim() });
        page.blocks = blocks;
        pages[main] = page;
        all[botId] = mainCfg;
        this.saveAll(ctx, all);
        await this.reply(ctx, data, '✅ 底部标题已更新为：\n' + arg.substring(5).trim());
        return true;
      }
      if (arg.indexOf('底部 ') === 0) {
        var lines = arg.substring(3).split('|').map(function(s) { return s.trim(); }).filter(function(s) { return s !== ''; });
        if (!lines.length) {
          await this.reply(ctx, data, '❌ 底部内容不能为空，示例：测试菜单设置 底部 当前时间：{time}|最后更新：2026-08-28');
          return true;
        }
        var fb2 = findBlock('footer');
        if (fb2) fb2.lines = lines;
        else blocks.push({ type: 'footer', fence: 'text', lines: lines });
        page.blocks = blocks;
        pages[main] = page;
        all[botId] = mainCfg;
        this.saveAll(ctx, all);
        await this.reply(ctx, data, '✅ 底部内容已更新，发送「测试菜单」查看效果。');
        return true;
      }
      // ========== 页面管理 ==========
      if (arg === '页面') {
        var pk = Object.keys(pages);
        var plist = pk.map(function(n) { return (n === main ? '★ ' : '· ') + n; });
        await this.reply(ctx, data, '📄 测试菜单页面（' + pk.length + ' 个，★=主菜单页）\n━━━━━━━━━━━━━━\n' + plist.join('\n') + '\n━━━━━━━━━━━━━━\n发送「测试菜单设置 主页 <页面名>」切换主菜单页');
        return true;
      }
      if (arg.indexOf('新增页 ') === 0) {
        var newName = arg.substring(4).trim();
        if (!newName) { await this.reply(ctx, data, '❌ 页面名不能为空，示例：测试菜单设置 新增页 活动菜单'); return true; }
        if (pages[newName]) { await this.reply(ctx, data, '❌ 页面「' + newName + '」已存在'); return true; }
        pages[newName] = {
          blocks: [
            { type: 'title', text: '**📄 ' + newName + '**' },
            { type: 'divider', text: '━━━━━━━━━━━━━━' },
            { type: 'rows', rows: [[{ label: '🏠 返回主菜单', type: 'cmd', value: '测试菜单' }]] },
            { type: 'tips', text: '📌 本页可在后台「测试菜单」编辑页增删/调整区块' }
          ]
        };
        all[botId] = { main_page: main, pages: pages };
        this.saveAll(ctx, all);
        await this.reply(ctx, data, '✅ 已新建页面「' + newName + '」，发送「测试菜单 @' + newName + '」查看。');
        return true;
      }
      if (arg.indexOf('删除页 ') === 0) {
        var delName = arg.substring(4).trim();
        if (!delName) { await this.reply(ctx, data, '❌ 页面名不能为空，示例：测试菜单设置 删除页 活动菜单'); return true; }
        if (!pages[delName]) { await this.reply(ctx, data, '❌ 未找到页面「' + delName + '」'); return true; }
        if (delName === main) { await this.reply(ctx, data, '❌ 不能删除当前主菜单页，请先「测试菜单设置 主页 <其它页>」切换后再删。'); return true; }
        delete pages[delName];
        all[botId] = { main_page: main, pages: pages };
        this.saveAll(ctx, all);
        await this.reply(ctx, data, '✅ 已删除页面「' + delName + '」。');
        return true;
      }
      if (arg.indexOf('主页 ') === 0) {
        var newMain = arg.substring(3).trim();
        if (!newMain) { await this.reply(ctx, data, '❌ 页面名不能为空，示例：测试菜单设置 主页 官方功能'); return true; }
        if (!pages[newMain]) { await this.reply(ctx, data, '❌ 未找到页面「' + newMain + '」，发送「测试菜单设置 页面」查看全部页面。'); return true; }
        main = newMain;
        all[botId] = { main_page: main, pages: pages };
        this.saveAll(ctx, all);
        await this.reply(ctx, data, '✅ 主菜单页已切换为「' + newMain + '」，发送「测试菜单」查看效果。');
        return true;
      }

      // ========== 行级编辑（加菜单/删菜单，可加「页面名 」前缀） ==========
      if (arg.indexOf('加菜单') === 0) {
        var addRest = arg.substring(3).trim();
        var addPageKey = main;
        var pipe = addRest.indexOf('|');
        if (pipe > 0) {
          var cand = addRest.substring(0, pipe).trim();
          if (cand && pages[cand]) { addPageKey = cand; }
        }
        var addPair = (addPageKey === main) ? addRest : addRest.substring(addPageKey.length).trim();
        var pipe2 = addPair.indexOf('|');
        if (pipe2 <= 0) {
          await this.reply(ctx, data, '❌ 加菜单格式：测试菜单设置 加菜单 标签|指令（如：签到|签到），可选前缀页面名。');
          return true;
        }
        var addLabel = addPair.substring(0, pipe2).trim();
        var addValue = addPair.substring(pipe2 + 1).trim();
        if (!addLabel || !addValue) { await this.reply(ctx, data, '❌ 标签与指令不能为空。'); return true; }
        var addPg = pages[addPageKey] && typeof pages[addPageKey] === 'object' ? pages[addPageKey] : { blocks: [] };
        var addBlks = this.normalizeBlocks(ctx, addPg, cfg);
        var addRows = null;
        for (var ar = 0; ar < addBlks.length; ar++) if (addBlks[ar].type === 'rows') { addRows = addBlks[ar]; break; }
        if (!addRows) { addRows = { type: 'rows', rows: [] }; addBlks.push(addRows); }
        if (!Array.isArray(addRows.rows)) addRows.rows = [];
        addRows.rows.push([{ label: addLabel, type: 'cmd', value: addValue }]);
        addPg.blocks = addBlks;
        pages[addPageKey] = addPg;
        all[botId] = { main_page: main, pages: pages };
        this.saveAll(ctx, all);
        await this.reply(ctx, data, '✅ 已在「' + addPageKey + '」新增菜单「' + addLabel + '」，发送「' + (addPageKey === main ? '测试菜单' : '测试菜单 @' + addPageKey) + '」查看。');
        return true;
      }
      if (arg.indexOf('删菜单') === 0) {
        var delRest = arg.substring(3).trim();
        var delPageKey = main;
        var delCand = delRest.indexOf(' ') > 0 ? delRest.substring(0, delRest.indexOf(' ')).trim() : '';
        if (delCand && pages[delCand]) { delPageKey = delCand; }
        var delLabel = (delPageKey === main) ? delRest : delRest.substring(delPageKey.length).trim();
        if (!delLabel) { await this.reply(ctx, data, '❌ 删菜单格式：测试菜单设置 删菜单 标签（如：删菜单 签到），可选前缀页面名。'); return true; }
        var delPg = pages[delPageKey] && typeof pages[delPageKey] === 'object' ? pages[delPageKey] : { blocks: [] };
        var delBlks = this.normalizeBlocks(ctx, delPg, cfg);
        var delRows = null;
        for (var dr = 0; dr < delBlks.length; dr++) if (delBlks[dr].type === 'rows') { delRows = delBlks[dr]; break; }
        var removed = 0;
        if (delRows && Array.isArray(delRows.rows)) {
          delRows.rows = delRows.rows.filter(function(row) {
            if (!Array.isArray(row)) return true;
            var hit = row.some(function(it) { return it && String(it.label || '').trim() === delLabel; });
            if (hit) { removed++; return false; }
            return true;
          });
        }
        if (!removed) { await this.reply(ctx, data, '❌ 在「' + delPageKey + '」未找到标签为「' + delLabel + '」的菜单行。'); return true; }
        delPg.blocks = delBlks;
        pages[delPageKey] = delPg;
        all[botId] = { main_page: main, pages: pages };
        this.saveAll(ctx, all);
        await this.reply(ctx, data, '✅ 已从「' + delPageKey + '」删除 ' + removed + ' 个标签为「' + delLabel + '」的菜单行。');
        return true;
      }

      // ========== 同步官方功能页（以 manifest.capabilities 为权威重建 rows） ==========
      if (arg === '同步官方') {
        var caps = (_manifest && _manifest.capabilities && Array.isArray(_manifest.capabilities)) ? _manifest.capabilities : [];
        if (!caps.length) { await this.reply(ctx, data, '❌ 插件未声明官方能力清单。'); return true; }
        var ofPage = pages['官方功能'] && typeof pages['官方功能'] === 'object' ? pages['官方功能'] : { blocks: [] };
        var ofBlks = this.normalizeBlocks(ctx, ofPage, cfg);
        var ofRows = null;
        for (var oi = 0; oi < ofBlks.length; oi++) if (ofBlks[oi].type === 'rows') { ofRows = ofBlks[oi]; break; }
        var ofNewRows = [];
        for (var cj = 0; cj < caps.length; cj += 2) {
          var crow = [{ label: caps[cj].label, type: 'cmd', value: caps[cj].value }];
          if (caps[cj + 1]) crow.push({ label: caps[cj + 1].label, type: 'cmd', value: caps[cj + 1].value });
          ofNewRows.push(crow);
        }
        ofNewRows.push([{ label: '🏠 返回主菜单', type: 'cmd', value: '测试菜单' }]);
        if (!ofRows) { ofRows = { type: 'rows', rows: ofNewRows }; ofBlks.push(ofRows); }
        else ofRows.rows = ofNewRows;
        ofPage.blocks = ofBlks;
        pages['官方功能'] = ofPage;
        all[botId] = { main_page: main, pages: pages };
        this.saveAll(ctx, all);
        await this.reply(ctx, data, '✅ 已按最新官方能力清单（' + caps.length + ' 项）重建「官方功能」页，发送「测试菜单 @官方功能」查看。');
        return true;
      }

      await this.reply(ctx, data, '❌ 无法识别的设置项。发送「测试菜单设置」查看支持的命令。');
      return true;
    },

    // ========== 官方能力演示（Node 平台映射） ==========
    officialDemo: async function(ctx, data, cmd) {
      var gid = data.groupId || '';
      var msgId = data.id;
      var userId = (data.author && data.author.openid) || '';
      var profile = null;
      try { profile = ctx.engine.getUserProfile ? ctx.engine.getUserProfile(userId, 1) : null; } catch (e) {}
      var avatar = (profile && profile.avatar) || '';
      var now = this.nowText();

      // 无子命令：列出权威能力清单（以 manifest.capabilities 为准，与后端/编辑器同源）
      if (!cmd) {
        var caps = (_manifest && _manifest.capabilities && Array.isArray(_manifest.capabilities)) ? _manifest.capabilities : [];
        if (!caps.length) { await this.reply(ctx, data, '❌ 插件未声明官方能力清单，发送「测试菜单 @官方功能」查看演示页。'); return true; }
        var capLines = caps.map(function(c) { return (c.available === false ? '🚫 ' : '✅ ') + c.label + ' → 「' + c.value + '」' + (c.desc ? '（' + c.desc + '）' : ''); });
        await this.reply(ctx, data, '⚙️ 官方开放平台能力（' + caps.length + ' 项，🚫=暂未接入）\n━━━━━━━━━━━━━━\n' + capLines.join('\n') + '\n━━━━━━━━━━━━━━\n点能力指令回填发送即可调用，如「测试官方 群信息」');
        return true;
      }

      // 子命令：测试官方 发布公告 <内容>
      if (cmd === '发布公告' || cmd.indexOf('发布公告 ') === 0) {
        var annBody = cmd.indexOf(' ') >= 0 ? cmd.substring(cmd.indexOf(' ') + 1).trim() : '';
        if (gid && ctx.bot.setAnnouncement) {
          try {
            if (!annBody) { await this.reply(ctx, data, '❌ 发布公告格式：测试官方 发布公告 公告内容'); return true; }
            await ctx.bot.setAnnouncement(gid, annBody);
            await this.reply(ctx, data, '📢 已发布群公告：' + annBody);
          } catch (e) {
            await this.reply(ctx, data, '❌ 发布公告失败：' + String(e && e.message || e));
          }
        } else {
          await this.reply(ctx, data, '❌ 发布公告接口仅在群聊中可用');
        }
        return true;
      }

      switch (cmd) {
        case '文字消息':
          await this.reply(ctx, data, '📝 官方能力演示：文字消息\n━━━━━━━━━━━━━━\nmsg_type=0，最基础的消息类型。\n发送时间：' + now);
          break;
        case '图片消息':
          await this.reply(ctx, data, '🖼️ 正在发送图片消息（msg_type=7 富媒体图片，图为你的头像）...');
          if (gid && avatar && ctx.bot.uploadGroupImage) {
            try {
              var up = await ctx.bot.uploadGroupImage(gid, avatar);
              if (up && up.file_info) await ctx.bot.sendGroupImageMessage(gid, up.file_info, msgId);
              else await this.reply(ctx, data, '❌ 图片上传失败（未获取到 file_info）');
            } catch (e) {
              await this.reply(ctx, data, '❌ 图片上传/发送失败：' + String(e && e.message || e));
            }
          } else {
            await this.reply(ctx, data, '❌ 图片消息演示仅群聊可用，且需已绑定 QQ 获取头像。');
          }
          break;
        case '语音消息':
          await this.reply(ctx, data, '🔊 正在发送语音消息（msg_type=7 富媒体语音）...');
          if (gid && ctx.bot.uploadGroupVoice) {
            try {
              var upv = await ctx.bot.uploadGroupVoice(gid, 'https://samplelib.com/lib/preview/mp3/sample-3s.mp3', 'demo.mp3');
              if (upv && upv.file_info) await ctx.bot.sendGroupVoiceMessage(gid, upv.file_info, msgId);
              else await this.reply(ctx, data, '❌ 语音上传失败（未获取到 file_info）');
            } catch (e) {
              await this.reply(ctx, data, '❌ 语音上传/发送失败：' + String(e && e.message || e));
            }
          } else {
            await this.reply(ctx, data, '❌ 语音消息演示仅群聊可用。');
          }
          break;
        case '视频消息':
          await this.reply(ctx, data, '🎬 正在发送视频消息（msg_type=7 富媒体视频）...');
          if (gid && ctx.bot.uploadGroupMediaUrl) {
            try {
              var upm = await ctx.bot.uploadGroupMediaUrl(gid, 'https://samplelib.com/lib/preview/mp4/sample-5s.mp4', 2, 'demo.mp4');
              if (upm && upm.file_info) await ctx.bot.sendGroupImageMessage(gid, upm.file_info, msgId);
              else await this.reply(ctx, data, '❌ 视频上传失败（未获取到 file_info）');
            } catch (e) {
              await this.reply(ctx, data, '❌ 视频上传/发送失败：' + String(e && e.message || e));
            }
          } else {
            await this.reply(ctx, data, '❌ 视频消息演示仅群聊可用。');
          }
          break;
        case 'Markdown消息':
          await this.sendMd(ctx, data,
            '**📄 官方能力演示：Markdown 消息**\n\n' +
            '支持 **加粗**、*斜体*、`行内代码`、[链接](https://q.qq.com)\n\n' +
            '- 列表项一\n- 列表项二\n\n' +
            '> 引用块\n\n' +
            '```text\n代码块\n```\n\n' +
            '当前时间：' + now);
          break;
        case '内联按钮':
          if (gid && ctx.bot.sendKeyboardGroup) {
            try {
              await ctx.bot.sendKeyboardGroup(gid, {
                content: '**🔘 官方能力演示：内联键盘按钮**\n点下方按钮触发互动事件（type=11）',
                rows: [
                  [{ id: 'tmbtn1', render_data: { label: '✅ 测试按钮', visited_label: '测试按钮', style: 1 }, action: { type: 2, data: '测试官方 按钮回调', permission: { type: 2 } } }]
                ]
              }, msgId);
            } catch (e) {
              await this.reply(ctx, data, '❌ 按钮发送失败：' + String(e && e.message || e));
            }
          } else {
            await this.reply(ctx, data, '❌ 内联按钮演示仅群聊可用。');
          }
          break;
        case '按钮回调':
          await this.reply(ctx, data, '🔘 已收到按钮回调，data=测试官方 按钮回调');
          break;
        case '文卡':
          await this.reply(ctx, data, '📇 官方能力演示：文卡\n━━━━━━━━━━━━━━\nNode 平台以 markdown 链接卡片呈现等价效果：');
          await this.sendMd(ctx, data,
            '**📇 官方能力演示：文卡**\n\n' +
            'ARK 文卡演示（template 23）\n\n' +
            '[点击访问 q.qq.com](https://q.qq.com)');
          break;
        case '大图卡':
          await this.reply(ctx, data, '🖼️ 正在发送大图卡（ARK template 37，图为你头像）...');
          if (gid && avatar && ctx.bot.uploadGroupImage) {
            try {
              var upg = await ctx.bot.uploadGroupImage(gid, avatar);
              if (upg && upg.file_info) await ctx.bot.sendGroupImageMessage(gid, upg.file_info, msgId);
              else await this.reply(ctx, data, '❌ 大图卡图片上传失败');
            } catch (e) {
              await this.reply(ctx, data, '❌ 大图卡发送失败：' + String(e && e.message || e));
            }
          } else {
            await this.reply(ctx, data, '❌ 大图卡演示仅群聊可用，且需已绑定 QQ 获取头像。');
          }
          break;
        case '跳转卡':
          await this.sendMd(ctx, data,
            '**🔗 官方能力演示：跳转卡**\n\n' +
            'ARK 跳转卡（template 24）\n\n' +
            '[点击跳转 q.qq.com](https://q.qq.com)');
          break;
        case '流式消息':
          await this.reply(ctx, data, '💨 流式消息：当前 Node 平台未接入流式发送接口，暂不支持演示。普通消息内容持续更新可通过定时任务/多次发送实现。');
          break;
        case '撤回消息':
          if (gid && msgId && ctx.bot.deleteMessage) {
            try {
              await ctx.bot.deleteMessage(gid, msgId, true);
              await this.reply(ctx, data, '🗑️ 已调用撤回接口（DELETE /v2/groups/{group_openid}/messages/{msgid}）删除你这条演示消息');
            } catch (e) {
              await this.reply(ctx, data, '❌ 撤回失败：' + String(e && e.message || e));
            }
          } else {
            await this.reply(ctx, data, '❌ 撤回消息需要群聊中的消息ID，当前上下文无法撤回。');
          }
          break;
        case '群信息':
          if (gid && ctx.bot.getGroupInfo) {
            try {
              var gi = await ctx.bot.getGroupInfo(gid);
              if (gi) {
                await this.reply(ctx, data, '🏠 官方能力演示：群信息接口\n群名：' + (gi.group_name || '未知') + '\n成员数：' + (gi.group_member_count !== undefined ? gi.group_member_count : '未知') + '\n群ID：' + (gi.group_openid || gid));
              } else {
                await this.reply(ctx, data, '❌ 群信息接口调用失败，可能未开通该接口权限');
              }
            } catch (e) {
              await this.reply(ctx, data, '❌ 群信息接口调用失败：' + String(e && e.message || e));
            }
          } else {
            await this.reply(ctx, data, '🏠 群信息接口仅在群聊中可用');
          }
          break;
        case '群成员':
          if (gid && ctx.bot.getGroupMembers) {
            try {
              var gms = await ctx.bot.getGroupMembers(gid);
              if (Array.isArray(gms) && gms.length) {
                var names = gms.slice(0, 10).map(function(m) {
                  return '· ' + (m.nickname || '未知') + '（' + (m.member_openid || '') + '）';
                });
                await this.reply(ctx, data, '👥 官方能力演示：群成员接口\n共获取 ' + gms.length + ' 人（展示前10）：\n' + names.join('\n'));
              } else {
                await this.reply(ctx, data, '❌ 群成员接口调用失败，可能未开通该接口权限');
              }
            } catch (e) {
              await this.reply(ctx, data, '❌ 群成员接口调用失败：' + String(e && e.message || e));
            }
          } else {
            await this.reply(ctx, data, '👥 群成员接口仅在群聊中可用');
          }
          break;
        case '禁言列表':
          if (gid && ctx.bot.getRestrictChatSetting) {
            try {
              var rs = await ctx.bot.getRestrictChatSetting(gid);
              await this.reply(ctx, data, '🔇 官方能力演示：全员禁言状态接口\n返回：' + JSON.stringify(rs || {}));
            } catch (e) {
              await this.reply(ctx, data, '❌ 禁言状态接口调用失败，可能未开通该接口权限');
            }
          } else {
            await this.reply(ctx, data, '🔇 禁言状态接口仅在群聊中可用');
          }
          break;
        case '机器人信息':
          var botName = '';
          try { botName = ctx.engine.getBotName ? String(ctx.engine.getBotName() || '') : ''; } catch (e) {}
          await this.reply(ctx, data, '🤖 官方能力演示：机器人信息\n机器人名称：' + (botName || '未知') + '\n机器人ID：' + (data.botId || '默认') + '\n平台版本：4.2.40\n当前时间：' + now);
          break;
        case '文件消息':
          await this.reply(ctx, data, '📁 正在发送文件消息（msg_type=7 富媒体文件，示例 PDF）...');
          if (gid && ctx.bot.uploadGroupMediaUrl) {
            try {
              var upf = await ctx.bot.uploadGroupMediaUrl(gid, 'https://www.w3.org/WHO/static/fonts/pdf/sample.pdf', 5, 'demo.pdf');
              if (upf && upf.file_info) await ctx.bot.sendGroupImageMessage(gid, upf.file_info, msgId);
              else await this.reply(ctx, data, '❌ 文件上传失败（未获取到 file_info）');
            } catch (e) {
              await this.reply(ctx, data, '❌ 文件上传/发送失败：' + String(e && e.message || e));
            }
          } else {
            await this.reply(ctx, data, '❌ 文件消息演示仅群聊可用。');
          }
          break;
        case '群公告':
          if (gid && ctx.bot.getAnnouncements) {
            try {
              var anns = await ctx.bot.getAnnouncements(gid);
              if (Array.isArray(anns) && anns.length) {
                var aList = anns.slice(0, 5).map(function(a) { return '· ' + (a.title || a.content || String(a.announcement_id || '') ).substring(0, 40); });
                await this.reply(ctx, data, '📢 官方能力演示：群公告\n当前公告（前5）：\n' + aList.join('\n') + '\n\n📌 发送「测试官方 发布公告 内容」可发布新公告。');
              } else {
                await this.reply(ctx, data, '📢 官方能力演示：群公告\n当前群暂无公告。\n📌 发送「测试官方 发布公告 内容」可发布新公告。');
              }
            } catch (e) {
              await this.reply(ctx, data, '❌ 群公告接口调用失败：' + String(e && e.message || e));
            }
          } else {
            await this.reply(ctx, data, '❌ 群公告接口仅在群聊中可用');
          }
          break;
        case '发布公告':
          if (gid && ctx.bot.setAnnouncement) {
            try {
              var annContent = cmd.substring(5).trim();
              if (!annContent) { await this.reply(ctx, data, '❌ 发布公告格式：测试官方 发布公告 公告内容'); break; }
              await ctx.bot.setAnnouncement(gid, annContent);
              await this.reply(ctx, data, '📢 已发布群公告：' + annContent);
            } catch (e) {
              await this.reply(ctx, data, '❌ 发布公告失败：' + String(e && e.message || e));
            }
          } else {
            await this.reply(ctx, data, '❌ 发布公告接口仅在群聊中可用');
          }
          break;
        case '全员禁言':
          if (gid && ctx.bot.getGroupBotState) {
            try {
              var gbs = await ctx.bot.getGroupBotState(gid);
              await this.reply(ctx, data, '🔇 官方能力演示：全员禁言状态接口\n返回：' + JSON.stringify(gbs || {}) + '\n\n📌 演示仅查询状态，不实际禁言；如需禁言请用群管理工具插件。');
            } catch (e) {
              await this.reply(ctx, data, '❌ 全员禁言状态接口调用失败：' + String(e && e.message || e));
            }
          } else {
            await this.reply(ctx, data, '❌ 全员禁言状态接口仅在群聊中可用');
          }
          break;
        case '入群申请':
          if (gid && ctx.bot.getJoinRequests) {
            try {
              var jrs = await ctx.bot.getJoinRequests(gid);
              if (Array.isArray(jrs) && jrs.length) {
                var jList = jrs.slice(0, 10).map(function(j) { return '· ' + (j.nickname || '未知') + '（' + (j.member_openid || '') + '）'; });
                await this.reply(ctx, data, '📥 官方能力演示：入群申请列表\n共 ' + jrs.length + ' 条（展示前10）：\n' + jList.join('\n'));
              } else {
                await this.reply(ctx, data, '📥 官方能力演示：入群申请列表\n当前无待处理申请。');
              }
            } catch (e) {
              await this.reply(ctx, data, '❌ 入群申请接口调用失败：' + String(e && e.message || e));
            }
          } else {
            await this.reply(ctx, data, '❌ 入群申请接口仅在群聊中可用');
          }
          break;
        case '群组列表':
          if (ctx.bot.getGuilds) {
            try {
              var gs = await ctx.bot.getGuilds();
              if (Array.isArray(gs) && gs.length) {
                var gList = gs.slice(0, 10).map(function(g) { return '· ' + (g.name || '未知') + '（' + (g.id || '') + '）'; });
                await this.reply(ctx, data, '🗂️ 官方能力演示：频道/群组列表\n共 ' + gs.length + ' 个（展示前10）：\n' + gList.join('\n'));
              } else {
                await this.reply(ctx, data, '🗂️ 官方能力演示：频道/群组列表\n暂无频道数据。');
              }
            } catch (e) {
              await this.reply(ctx, data, '❌ 频道列表接口调用失败：' + String(e && e.message || e));
            }
          } else {
            await this.reply(ctx, data, '🗂️ 频道/群组列表接口不可用');
          }
          break;
        case '频道信息':
          if (ctx.bot.getGuilds) {
            try {
              var gs2 = await ctx.bot.getGuilds();
              var first = Array.isArray(gs2) && gs2.length ? gs2[0] : null;
              if (!first) { await this.reply(ctx, data, '📡 频道信息接口：暂无频道数据。'); break; }
              var gd = ctx.bot.getGuildDetail ? await ctx.bot.getGuildDetail(first.id) : null;
              var chs = ctx.bot.getChannels ? await ctx.bot.getChannels(first.id) : [];
              var chNames = (Array.isArray(chs) ? chs : []).slice(0, 8).map(function(c) { return '· ' + (c.name || '未知'); }).join('\n');
              await this.reply(ctx, data, '📡 官方能力演示：频道信息\n频道：' + ((gd && gd.name) || first.name || '未知') + '（' + (first.id || '') + '）\n子频道（前8）：\n' + (chNames || '（无）'));
            } catch (e) {
              await this.reply(ctx, data, '❌ 频道信息接口调用失败：' + String(e && e.message || e));
            }
          } else {
            await this.reply(ctx, data, '📡 频道信息接口不可用');
          }
          break;
        case '用户信息':
          var up2 = null;
          try { up2 = profile || (ctx.engine.getUserProfile ? ctx.engine.getUserProfile(userId, 1) : null); } catch (e) {}
          if (up2 && (up2.nickname || up2.avatar)) {
            await this.reply(ctx, data, '👤 官方能力演示：用户信息\n昵称：' + (up2.nickname || '未知') + '\n头像：' + (up2.avatar ? '已获取（图为头像）' : '未绑定') + '\nopenid：' + userId);
          } else {
            await this.reply(ctx, data, '👤 官方能力演示：用户信息\n未获取到用户资料（需先通过「绑定QQ」完成绑定）。');
          }
          break;
        case 'OpenID查询':
          await this.reply(ctx, data, '🆔 官方能力演示：OpenID 查询\n当前消息发送者 openid：' + (userId || '未知') + '\n群：' + (gid || '私聊') + '\n📌 OpenID 是平台下发的身份标识，机器人侧通过它与 QQ 用户交互。');
          break;
        case '表单卡':
          await this.reply(ctx, data, '🗒️ 表单卡（ARK 表单）当前平台暂未接入演示接口，可先用「文卡/大图卡/跳转卡」体验富媒体卡片。');
          break;
        case '表情表态':
          await this.reply(ctx, data, '😀 消息表情表态当前平台暂未接入演示接口。');
          break;
        case '流式消息':
          await this.reply(ctx, data, '💨 流式消息：当前 Node 平台未接入流式发送接口，暂不支持演示。普通消息内容持续更新可通过定时任务/多次发送实现。');
          break;
        default:
          await this.reply(ctx, data, '❌ 未知的官方能力项：「' + cmd + '」\n发送「测试菜单 @官方功能」查看全部能力。');
      }
      return true;
    },

    // ========== 消息入口 ==========
    handle: async function(ctx, data) {
      var content = (data.content || '').trim().replace(/^\s*<@!?[A-Fa-f0-9]+>\s*/, '').trim();
      if (!content) return false;
      var openid = (data.author && data.author.openid) || '';
      var gid = data.groupId || '';

      // 特殊触发类型（编辑器配置 image/page/plugin 菜单项点击回填后触发）
      if (content.indexOf('__draw:') === 0) {
        var drawDesc = content.substring(7).trim();
        if (!drawDesc) { await this.reply(ctx, data, '❌ 缺少绘画描述'); return true; }
        var drawData = Object.assign({}, data, { content: '画图 ' + drawDesc });
        try {
          var drawHit = await ctx.engine.callPlugin('画图', 'handleCommand', drawData);
          if (drawHit === false || drawHit === undefined || drawHit === null) {
            await this.reply(ctx, data, '🎨 已请求画图：「' + drawDesc + '」');
          }
        } catch (e) {
          await this.reply(ctx, data, '❌ 画图调用失败（画图插件可能未加载）：' + String(e && e.message || e));
        }
        return true;
      }
      if (content.indexOf('__img:') === 0) {
        var imgUrl = content.substring(6).trim();
        if (!imgUrl) { await this.reply(ctx, data, '❌ 缺少图片 URL'); return true; }
        try {
          if (gid && ctx.bot.uploadGroupImage) {
            var up = await ctx.bot.uploadGroupImage(gid, imgUrl);
            if (up && up.file_info) {
              await ctx.bot.sendGroupImageMessage(gid, up.file_info);
              await this.reply(ctx, data, '🖼️ 图片已发送');
            } else {
              await this.reply(ctx, data, '❌ 图片发送失败（URL 无法访问或文件过大）');
            }
          } else {
            await this.reply(ctx, data, '❌ 当前场景不支持发送图片');
          }
        } catch (e) {
          await this.reply(ctx, data, '❌ 图片发送失败：' + String(e && e.message || e));
        }
        return true;
      }
      if (content.indexOf('__page:') === 0) {
        var pageKey = content.substring(7).trim();
        var resPage = await this.buildMd(ctx, data, pageKey);
        if (resPage) await this.sendMd(ctx, data, resPage);
        else await this.reply(ctx, data, '❌ 未找到页面「' + pageKey + '」，发送「测试菜单」查看入口');
        return true;
      }
      if (content.indexOf('__call:') === 0) {
        var callArgs = content.substring(7).trim();
        var spIdx = callArgs.indexOf(' ');
        var targetName = spIdx > 0 ? callArgs.substring(0, spIdx).trim() : callArgs.trim();
        var targetCmd = spIdx > 0 ? callArgs.substring(spIdx + 1).trim() : '';
        if (!targetName) { await this.reply(ctx, data, '❌ 插件调用格式：__call:插件名 指令'); return true; }
        try {
          var nd = Object.assign({}, data, { content: targetCmd || targetName });
          var hit = await ctx.engine.callPlugin(targetName, 'handleCommand', nd);
          if (hit === false || hit === undefined || hit === null) {
            await this.reply(ctx, data, 'ℹ️ 已调用插件「' + targetName + '」' + (targetCmd ? '，指令：' + targetCmd : ''));
          }
        } catch (e) {
          await this.reply(ctx, data, '❌ 调用插件失败：' + String(e && e.message || e));
        }
        return true;
      }

      // 群内主人设置指令
      if (content === '测试菜单设置' || content.indexOf('测试菜单设置 ') === 0) {
        if (!this.canManage(ctx, gid, openid)) {
          await this.reply(ctx, data, '⛔ 权限不足：仅群主、群管理或后台管理员可设置测试菜单。');
          return true;
        }
        var arg = content.substring(6).trim();
        await this.handleSetting(ctx, data, arg);
        return true;
      }

      // 官方能力演示入口
      if (content === '测试官方' || content.indexOf('测试官方 ') === 0) {
        await this.officialDemo(ctx, data, content.substring(5).trim());
        return true;
      }

      // 联系群主（头部「免@联系群主」回填指令触发）
      if (content === '联系群主') {
        await this.contactOwner(ctx, data);
        return true;
      }

      // 页面入口：测试菜单 @页面名 / 测试菜单 页面名 / 菜单测试 @页面名 / 菜单测试 页面名
      var m = content.match(/^测试菜单[\s@]+(.+)$/) || content.match(/^菜单测试[\s@]+(.+)$/);
      if (m) {
        var key = m[1].trim();
        if (!key) {
          var res0 = await this.buildMd(ctx, data, '');
          if (res0) await this.sendMd(ctx, data, res0);
          return true;
        }
        var pg = this.readPage(ctx, data.botId || '', key);
        if (!pg) {
          await this.reply(ctx, data, '❌ 未找到页面「' + key + '」，发送「测试菜单」查看入口。');
          return true;
        }
        var res = await this.buildMd(ctx, data, key);
        if (res) await this.sendMd(ctx, data, res);
        return true;
      }

      // 菜单入口
      if (content === '测试菜单' || content === '菜单测试') {
        var resMain = await this.buildMd(ctx, data, '');
        if (resMain) await this.sendMd(ctx, data, resMain);
        return true;
      }

      return false;
    }
  },

  onEnable: function(ctx) {
    var self = this;
    self.methods._ctx = ctx;
    ctx.eventBus.on('message.group', async function(data) {
      try {
        if (await self.methods.handle(ctx, data)) return;
      } catch (e) { ctx.logger.error('测试菜单异常: ' + String(e && e.message || e)); }
    });
    ctx.eventBus.on('message.c2c', async function(data) {
      try {
        if (await self.methods.handle(ctx, data)) return;
      } catch (e) { ctx.logger.error('测试菜单异常: ' + String(e && e.message || e)); }
    });
    ctx.logger.info('测试菜单已加载 v1.3.0（全区块可编辑卡片 + 头像富媒体真图 + 免@联系群主 + 官方能力演示·全能力预置）');
  }
};
var _manifest = module.exports.manifest;
