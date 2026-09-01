// 欢迎新用户 v1.0.0 - 群成员入群自动发送欢迎卡片（blocks 模型，后台「测试菜单」编辑器可编辑）
// 触发：group.member.add 事件（QQ 开放平台群成员增加）
// 卡片内容：config 表 plugin.file-欢迎新用户.config 按 botId 分组；未配置用内置默认
// 占位符：{nickname} = 新成员昵称，{time} = 当前北京时间（footer 区块自动替换）
// 菜单项与「绑定QQ」均为文字外显链接：mqqapi://aio/inlinecmd?command=指令&enter=false&reply=false
// 用法：群里发「欢迎设置」查看说明；「欢迎设置 重置」恢复默认欢迎卡片
module.exports = {
  manifest: {
    id: 'mod-welcome',
    name: '欢迎新用户',
    version: '1.0.0',
    description: '欢迎新用户：群成员入群自动发送欢迎卡片（后台编辑器自定义内容/头像/绑定QQ文字外显链接）；发「欢迎设置」查看说明',
    author: '511742399'
  },

  methods: {
    // ========== 配置读写（按 botId 分组，与后台编辑器共享同一份存储） ==========
    readAll: function(ctx) {
      try {
        var raw = ctx.storage.get('config');
        var all = JSON.parse(raw || '{}');
        return (all && typeof all === 'object') ? all : {};
      } catch (e) { return {}; }
    },

    // ========== 默认欢迎卡片（与后台 API 端默认模板保持一致） ==========
    defaultPages: function() {
      return {
        '欢迎页': {
          blocks: [
            { type: 'avatar', source: 'member' },
            { type: 'title', text: '**🎉 欢迎新用户入群**' },
            { type: 'meta', show: ['nickname', 'group'] },
            { type: 'divider', text: '━━━━━━━━━━━━━━' },
            { type: 'intro', text: '欢迎 {nickname} 加入本群！完成 QQ 绑定后可跨群识别身份、使用签到/运势等功能 ↓' },
            {
              type: 'rows',
              rows: [
                [
                  { label: '📱 绑定QQ', type: 'cmd', value: '绑定QQ' }
                ],
                [
                  { label: '📋 我的签到', type: 'cmd', value: '我的签到' },
                  { label: '🎲 掷骰子', type: 'cmd', value: '掷骰子' }
                ]
              ]
            },
            { type: 'tips', text: '📌 点击「绑定QQ」链接，指令会填入输入框，点发送后按提示回复你的 QQ 号即可' },
            { type: 'divider', text: '━━━━━━━━━━━━━━' },
            { type: 'footer_title', text: '❤️ 欢迎新成员' },
            { type: 'footer', fence: 'text', lines: ['当前时间：{time}', '新人昵称：{nickname}'] }
          ]
        }
      };
    },

    // ========== 规范化页面区块（与编辑器同一套 blocks schema） ==========
    normalizeBlocks: function(page, cfg) {
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
          if (t === 'meta') nb.show = Array.isArray(b.show) ? b.show.filter(function(s) { return ['nickname', 'userid', 'group'].indexOf(s) >= 0; }) : [];
          if (t === 'rows') nb.rows = Array.isArray(b.rows) ? b.rows : [];
          if (t === 'footer') {
            nb.fence = b.fence === '' ? '' : String(b.fence || 'text');
            nb.lines = Array.isArray(b.lines) ? b.lines : [];
          }
          out.push(nb);
        }
        return out;
      }
      var blocks = [];
      if (cfg.show_avatar !== false) blocks.push({ type: 'avatar', source: 'member' });
      blocks.push({ type: 'title', text: String(page.title || '') });
      blocks.push({ type: 'meta', show: ['nickname', 'group'] });
      blocks.push({ type: 'divider', text: '━━━━━━━━━━━━━━' });
      blocks.push({ type: 'intro', text: String(page.intro || '') });
      blocks.push({ type: 'rows', rows: Array.isArray(page.rows) ? page.rows : [] });
      if (page.tips) blocks.push({ type: 'tips', text: String(page.tips) });
      blocks.push({ type: 'divider', text: '━━━━━━━━━━━━━━' });
      blocks.push({ type: 'footer_title', text: String(page.footer_title || '') });
      blocks.push({ type: 'footer', fence: 'text', lines: Array.isArray(page.footer_lines) ? page.footer_lines : [] });
      return blocks;
    },

    // ========== 菜单链接（委托全局 engine.menuLink；否则 mqqapi inlinecmd 文字外显） ==========
    menuLink: function(label, item) {
      try {
        if (this._ctx && this._ctx.engine && this._ctx.engine.menuLink) {
          return this._ctx.engine.menuLink(label, item);
        }
      } catch (e) {}
      var type = (item && item.type) || 'cmd';
      var value = String((item && item.value) || '');
      if (type === 'link') return '[' + label + '](' + value + ')';
      if (type === 'image') value = '__img:' + value;
      else if (type === 'page') value = '__page:' + value;
      else if (type === 'plugin') value = '__call:' + value;
      return '[' + label + '](mqqapi://aio/%69nlinecmd?command=' + encodeURIComponent(value) + '&enter=false&reply=false)';
    },

    // ========== 时间格式化（固定北京时间 UTC+8） ==========
    nowText: function() {
      var d = new Date(Date.now() + 8 * 3600 * 1000);
      var pad = function(n) { return String(n).padStart(2, '0'); };
      return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
    },

    // ========== 渲染整卡（按 blocks 顺序逐区块渲染；nick = 新成员昵称） ==========
    renderBlocks: function(ctx, data, blocks, nick) {
      var userId = (data.member && data.member.id) || (data.author && data.author.openid) || '';
      var profile = null;
      try { profile = ctx.engine.getUserProfile ? ctx.engine.getUserProfile(userId, 1) : null; } catch (e) {}
      var nickname = nick || (profile && profile.nickname) || (data.member && data.member.nickname) || (data.author && data.author.username) || '新成员';
      var qq = (profile && profile.qq_number) || '';
      var avatar = (profile && profile.avatar) || '';
      var gid = data.groupId || '';
      var groupName = '';
      var groupNumber = '';
      if (gid) {
        try { groupName = ctx.engine.getGroupName ? String(ctx.engine.getGroupName(gid) || '') : ''; } catch (e) {}
        try { groupNumber = ctx.engine.getGroupNumber ? String(ctx.engine.getGroupNumber(gid) || '') : ''; } catch (e) {}
      }

      var replaceVars = function(s) {
        return String(s).replace(/\{nickname\}/g, nickname).replace(/\{time\}/g, selfNow());
      };
      var selfNow = this.nowText.bind(this);

      var lines = [];
      for (var i = 0; i < blocks.length; i++) {
        var b = blocks[i];
        if (!b || typeof b !== 'object') continue;
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
              var aw2 = Math.round(Number(b.width)) >= 20 && Math.round(Number(b.width)) <= 640 ? Math.round(Number(b.width)) : 208;
              var ah2 = Math.round(Number(b.height)) >= 20 && Math.round(Number(b.height)) <= 640 ? Math.round(Number(b.height)) : 208;
              lines.push('![头像 #' + aw2 + 'px #' + ah2 + 'px](' + avatar + ')');
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
            if (b.text) lines.push(replaceVars(b.text));
            break;
          case 'meta':
            var show = b.show || [];
            if (show.indexOf('nickname') >= 0) lines.push('👤 ' + nickname + (qq ? '（QQ: ' + qq + '）' : ''));
            if (show.indexOf('userid') >= 0) lines.push('🆔 用户ID：' + userId);
            if (show.indexOf('group') >= 0 && gid) lines.push('👥 ' + (groupName || '群ID: ') + (groupNumber ? groupNumber + '（' + gid + '）' : (groupName ? '（' + gid + '）' : gid)));
            break;
          case 'divider':
            lines.push(replaceVars(b.text || '━━━━━━━━━━━━━━'));
            break;
          case 'intro':
            if (b.text) { lines.push(replaceVars(b.text)); lines.push(''); }
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
            if (b.text) { lines.push(''); lines.push(replaceVars(b.text)); }
            break;
          case 'footer_title':
            if (b.text) lines.push(replaceVars(b.text));
            break;
          case 'footer':
            var fl = (Array.isArray(b.lines) ? b.lines : []).map(replaceVars);
            if (fl.length) {
              var fence = b.fence === '' ? '' : String(b.fence || 'text');
              lines.push('');
              if (fence) lines.push('```' + fence);
              for (var f = 0; f < fl.length; f++) lines.push(fl[f]);
              if (fence) lines.push('```');
            }
            break;
        }
      }
      return lines;
    },

    // ========== 构建 markdown（当前机器人欢迎卡片） ==========
    buildMd: function(ctx, data, nick) {
      var botId = data.botId || '';
      var all = this.readAll(ctx);
      var cfg = (all[botId] && typeof all[botId] === 'object') ? all[botId] : {};
      var pages = (cfg.pages && typeof cfg.pages === 'object' && Object.keys(cfg.pages).length) ? cfg.pages : this.defaultPages();
      var main = (cfg.main_page && pages[cfg.main_page]) ? cfg.main_page : '欢迎页';
      if (!pages[main]) { var ks = Object.keys(pages); main = ks[0] || ''; }
      var page = pages[main];
      if (!page || typeof page !== 'object') return null;
      var blocks = this.normalizeBlocks(page, cfg);
      var lines = this.renderBlocks(ctx, data, blocks, nick);
      if (!lines.length) return null;
      return lines.join('\n');
    },

    // ========== 入群欢迎（markdown 卡片发送到群） ==========
    welcome: async function(ctx, data) {
      // 功能开关门控：欢迎语总开关（后台「功能开关」可停用）
      try {
        var swVal = ctx.engine.getConfigValue ? String(ctx.engine.getConfigValue('switch.welcome') || '') : '';
        if (swVal === '0') return;
      } catch(e) {}
      var gid = data.groupId || '';
      if (!gid) return;
      var nick = (data.member && data.member.nickname) || '';
      var memberId = (data.member && data.member.id) || '';
      var md = this.buildMd(ctx, data, nick);
      if (!md) return;
      var sent = null;
      try {
        if (ctx.bot.sendMarkdownGroup) {
          sent = await ctx.bot.sendMarkdownGroup(gid, md);
        }
      } catch (e) {
        ctx.logger.error('欢迎卡片 markdown 发送失败: ' + String(e && e.message || e));
      }
      if (!sent && ctx.bot.sendGroupMessage) {
        try {
          var plain = md
            .replace(/!\[[^\]]*\]\([^)]*\)/g, '👤 头像')
            .replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1')
            .replace(/```/g, '');
          sent = await ctx.bot.sendGroupMessage(gid, plain);
        } catch (e2) {
          ctx.logger.error('欢迎卡片纯文本降级发送失败: ' + String(e2 && e2.message || e2));
        }
      }
      if (sent) ctx.logger.info('欢迎新用户已发送: group=' + gid + ' member=' + (memberId || nick || '?'));
    },

    // ========== 特殊触发（欢迎卡片 image/page/plugin 链接点击回填） ==========
    handleSpecial: async function(ctx, data) {
      var content = String(data.content || '').trim();
      var gid = data.groupId || '';
      var reply = function(t) {
        try { return ctx.bot.sendGroupMessage(gid, t); } catch (e) { return null; }
      };
      if (content.indexOf('__img:') === 0) {
        var imgUrl = content.substring(6).trim();
        if (!imgUrl) { await reply('❌ 缺少图片 URL'); return; }
        try {
          if (gid && ctx.bot.uploadGroupImage) {
            var up = await ctx.bot.uploadGroupImage(gid, imgUrl);
            if (up && up.file_info) {
              await ctx.bot.sendGroupImageMessage(gid, up.file_info);
              await reply('🖼️ 图片已发送');
            } else {
              await reply('❌ 图片发送失败（URL 无法访问或文件过大）');
            }
          } else {
            await reply('❌ 当前场景不支持发送图片');
          }
        } catch (e) {
          await reply('❌ 图片发送失败：' + String(e && e.message || e));
        }
        return;
      }
      if (content.indexOf('__call:') === 0) {
        var callArgs = content.substring(7).trim();
        var spIdx = callArgs.indexOf(' ');
        var targetName = spIdx > 0 ? callArgs.substring(0, spIdx).trim() : callArgs.trim();
        var targetCmd = spIdx > 0 ? callArgs.substring(spIdx + 1).trim() : '';
        if (!targetName) { await reply('❌ 插件调用格式：__call:插件名 指令'); return; }
        try {
          var nd = Object.assign({}, data, { content: targetCmd || targetName });
          var hit = await ctx.engine.callPlugin(targetName, 'handleCommand', nd);
          if (hit === false || hit === undefined || hit === null) {
            await reply('ℹ️ 已调用插件「' + targetName + '」' + (targetCmd ? '，指令：' + targetCmd : ''));
          }
        } catch (e) {
          await reply('❌ 调用插件失败：' + String(e && e.message || e));
        }
        return;
      }
      await reply('❌ 欢迎卡片不支持跳转页面，请联系群主修改配置');
    },

    // ========== 「欢迎设置」查看/重置 ==========
    setting: async function(ctx, data, arg) {
      var openid = (data.author && data.author.openid) || '';
      var gid = data.groupId || '';
      var msgId = data.id;
      var canManage = false;
      try {
        var role = ctx.engine.getGroupMemberRole ? ctx.engine.getGroupMemberRole(gid, openid) : '';
        canManage = role === 'owner' || role === 'admin' || role === 'super' || role === 'master' || role === '' || !role;
      } catch (e) { canManage = true; }
      var reply = async function(text) {
        try {
          if (gid) await ctx.bot.sendGroupMessage(gid, text, msgId);
          else if (openid) await ctx.bot.sendPrivateMessage(openid, text, msgId);
        } catch (e) {}
      };
      if (!canManage) { await reply('🔒 仅群主/管理员可修改欢迎设置'); return; }
      if (arg === '重置') {
        var botId = data.botId || '';
        var all = this.readAll(ctx);
        delete all[botId];
        try { ctx.storage.set('config', JSON.stringify(all)); } catch (e) {}
        await reply('✅ 欢迎卡片已恢复默认，新成员入群即生效。');
        return;
      }
      var botId2 = data.botId || '';
      var all2 = this.readAll(ctx);
      var cfg2 = (all2[botId2] && typeof all2[botId2] === 'object') ? all2[botId2] : {};
      var pages2 = (cfg2.pages && typeof cfg2.pages === 'object' && Object.keys(cfg2.pages).length) ? cfg2.pages : this.defaultPages();
      var preview = Object.keys(pages2).join('、');
      await reply('🎉 欢迎新用户\n━━━━━━━━━━━━━━\n新成员入群自动发送欢迎卡片（markdown）\n当前页面：' + preview + '\n卡片内容请在后台「测试菜单」编辑器选择「欢迎新用户」插件编辑\n发送「欢迎设置 重置」恢复默认\n占位符：{nickname} 新成员昵称、{time} 当前时间\n群内可关停请删除该插件（引擎管理）');
    }
  },

  onEnable: function(ctx) {
    var self = this;
    this._ctx = ctx;
    ctx.eventBus.on('group.member.add', async function(data) {
      try { await self.methods.welcome(ctx, data); } catch (e) { ctx.logger.error('欢迎新用户异常: ' + String(e && e.message || e)); }
    });
    ctx.eventBus.on('message.group', async function(data) {
      var content = String(data.content || '').trim();
      if (content === '欢迎设置' || content.indexOf('欢迎设置 ') === 0) {
        try { await self.methods.setting(ctx, data, content.substring(4).trim()); } catch (e) { ctx.logger.error('欢迎设置异常: ' + String(e && e.message || e)); }
      } else if (content.indexOf('__img:') === 0 || content.indexOf('__page:') === 0 || content.indexOf('__call:') === 0) {
        try { await self.methods.handleSpecial(ctx, data); } catch (e) { ctx.logger.error('欢迎特殊触发异常: ' + String(e && e.message || e)); }
      }
    });
  }
};
