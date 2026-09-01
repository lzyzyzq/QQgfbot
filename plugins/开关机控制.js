// 开关机控制 v4.1.0 - 核心控制 + 整点报时 + 欢迎/退群 + 全局模式 + 主菜单入口(复读/频道测试/签到)
module.exports = {
  manifest: {
    id: 'builtin-power',
    name: '开关机控制',
    version: '4.1.0',
    description: '核心控制：开关机、权限管理、整点报时、欢迎退群、全局模式',
    author: '511742399'
  },

  methods: {
    // ========== 权限系统 ==========
    getSuperId: function(ctx) {
      var raw = ctx.storage.get('super_master_id') || '';
      try { var obj = JSON.parse(raw); return obj.id || ''; } catch(e) { return raw; }
    },
    getMinis: function(ctx) {
      try { return JSON.parse(ctx.storage.get('mini_masters') || '[]'); } catch(e) { return []; }
    },
    getMembers: function(ctx) {
      try { return JSON.parse(ctx.storage.get('members') || '[]'); } catch(e) { return []; }
    },
    isSuper: function(ctx, uid) {
      var superId = this.getSuperId(ctx);
      if (superId === uid) return true;
      return ctx.identity.isSameUser(superId, uid);
    },
    isMaster: function(ctx, uid) {
      if (this.isSuper(ctx, uid)) return true;
      var minis = this.getMinis(ctx);
      for (var i = 0; i < minis.length; i++) {
        if (minis[i].activated) {
          if (minis[i].id === uid) return true;
          if (ctx.identity.isSameUser(minis[i].id, uid)) return true;
        }
      }
      return false;
    },
    isMember: function(ctx, uid) {
      if (this.isMaster(ctx, uid)) return true;
      var members = this.getMembers(ctx);
      for (var i = 0; i < members.length; i++) {
        if (members[i].activated) {
          if (members[i].id === uid) return true;
          if (ctx.identity.isSameUser(members[i].id, uid)) return true;
        }
      }
      return false;
    },
    getRole: function(ctx, uid) {
      if (this.isSuper(ctx, uid)) return 'super';
      if (this.isMaster(ctx, uid)) return 'master';
      if (this.isMember(ctx, uid)) return 'member';
      return 'user';
    },

    // ========== 全局模式 ==========
    getGlobalMode: function(ctx) {
      try { if (ctx.engine && ctx.engine.getGlobalMode) return ctx.engine.getGlobalMode(); } catch (e) {}
      return ctx.storage.get('global_mode') || 'text_link';
    },
    setGlobalMode: function(ctx, mode) {
      try { if (ctx.engine && ctx.engine.setGlobalMode) { ctx.engine.setGlobalMode(mode); return; } } catch (e) {}
      ctx.storage.set('global_mode', mode);
    },

    // ========== 整点报时开关 ==========
    isChimeEnabled: function(ctx) {
      return ctx.storage.get('chime_enabled') !== 'false';
    },
    setChimeEnabled: function(ctx, enabled) {
      ctx.storage.set('chime_enabled', String(enabled));
    },

    // ========== 发送者资料（昵称/QQ/头像，OpenID→后端QQ号映射） ==========
    getUserProfile: function(ctx, data) {
      var userId = (data.author && data.author.openid) || '';
      var info = null;
      try { if (ctx.identity && ctx.identity.getInfo) info = ctx.identity.getInfo(userId); } catch(e) {}
      var nickname = (data.author && data.author.username) || (info && info.nickname) || '未知用户';
      var qq = '';
      try { if (ctx.identity && ctx.identity.getQQ) qq = ctx.identity.getQQ(userId) || ''; } catch(e) {}
      if (!qq && info) qq = info.qq_number || '';
      var avatarUrl = qq ? ('https://q1.qlogo.cn/g?b=qq&nk=' + encodeURIComponent(qq) + '&s=640') : '';
      return { userId: userId, nickname: nickname, qq: qq, avatarUrl: avatarUrl };
    },

    // ========== 纯文字菜单 ==========
    menuToPlain: function(opts) {
      var profile = opts.profile || {};
      var lines = [opts.title || '功能菜单'];
      if (opts.subtitle) lines.push(opts.subtitle);
      lines.push('━━━━━━━━━━━━━━');
      lines.push('👤 ' + profile.nickname + '（QQ: ' + (profile.qq || '未绑定') + '）');
      lines.push('');
      var items = opts.items || [];
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        lines.push((i + 1) + '. ' + it.label + (it.desc ? ' - ' + it.desc : '') + (it.action ? '\n   发送「' + it.action + '」' : ''));
      }
      lines.push('━━━━━━━━━━━━━━');
      lines.push(opts.footer || 'PHP · QQ机器人平台');
      lines.push('发送"主菜单"返回');
      return lines.join('\n');
    },

    // ========== 统一菜单发送（text / text_link / image 三模式，带头像昵称QQ与PHP标识） ==========
    sendMenu: async function(ctx, data, opts) {
      var mode = this.getGlobalMode(ctx);
      var groupId = data.groupId;
      var msgId = data.id;
      var profile = this.getUserProfile(ctx, data);
      var title = opts.title || '功能菜单';
      var subtitle = opts.subtitle || '';
      var items = opts.items || [];
      var footer = opts.footer;
      if (!footer) {
        var ad = '';
        try { ad = ctx.storage.get('footer_ad_主菜单') || ''; } catch(e) {}
        if (!ad) {
          try {
            var ads = (ctx.engine && ctx.engine.getConfigValue) ? ctx.engine.getConfigValue('bot.footer_ads') : '';
            if (ads && String(ads).trim()) {
              var list = String(ads).split(/\r?\n/).map(function(s) { return s.trim(); }).filter(function(s) { return s; });
              if (list.length) ad = list[Math.floor(Math.random() * list.length)];
            }
          } catch(e) {}
        }
        footer = 'PHP · QQ机器人平台' + (ad ? '\n' + ad : '');
      }
      if (!groupId) {
        var p = this.menuToPlain({ profile: profile, title: title, subtitle: subtitle, items: items, footer: footer });
        await ctx.bot.sendPrivateMessage(profile.userId, p, msgId);
        return;
      }

      if (mode === 'image' && ctx.bot.sendMenuCard) {
        try {
          var ok = await ctx.bot.sendMenuCard(groupId, {
            title: title,
            avatarUrl: profile.avatarUrl,
            nickname: profile.nickname,
            qq: profile.qq,
            openid: profile.userId,
            subtitle: subtitle,
            items: items.map(function(it) { return { label: it.label, desc: it.desc || '' }; }),
            footer: footer
          }, msgId);
          if (ok) return;
        } catch(e) {}
      }

      if (mode === 'text_link') {
        var groupName = '';
        try { if (ctx.engine && ctx.engine.getGroupName) groupName = ctx.engine.getGroupName(groupId); } catch(e) {}
        var md = this.menuToTextLink({ ctx: ctx, groupId: groupId, groupName: groupName, userId: profile.userId, profile: profile, title: title, subtitle: subtitle, items: items, footer: footer });
        var mdOk = await ctx.bot.sendMarkdownGroup(groupId, md, undefined, undefined, msgId);
        if (!mdOk) {
          await ctx.bot.sendGroupMessage(groupId, this.menuToPlain({ profile: profile, title: title, subtitle: subtitle, items: items, footer: footer }), msgId);
        }
        return;
      }

      await ctx.bot.sendGroupMessage(groupId, this.menuToPlain({ profile: profile, title: title, subtitle: subtitle, items: items, footer: footer }), msgId);
    },

    // ========== 蓝色文字链接菜单 markdown（菜单项为蓝色文字+↗，点击后网页触发、机器人自动回复对应菜单） ==========
    menuToTextLink: function(opts) {
      var profile = opts.profile || {};
      var items = opts.items || [];
      var title = opts.title || '功能菜单';
      var subtitle = opts.subtitle || '';
      var footer = opts.footer || 'PHP · QQ机器人平台';
      var ctx = opts.ctx;
      var groupId = opts.groupId;
      var userId = opts.userId;
      var groupName = opts.groupName || '';
      var rows = [];
      for (var i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
      var hasLink = false;
      for (var li = 0; li < items.length; li++) {
        var la = items[li].action || '';
        if (la.indexOf('url:') === 0 || la.indexOf('panel:') === 0) { hasLink = true; break; }
        var lu = (ctx.engine && ctx.engine.buildClickUrl) ? ctx.engine.buildClickUrl(groupId, userId, la) : '';
        if (lu) { hasLink = true; break; }
      }
      var lines = [];
      lines.push('**' + title + '**');
      if (subtitle) lines.push(subtitle);
      lines.push('');
      lines.push('👤 ' + profile.nickname + '（QQ: ' + (profile.qq || '未绑定') + '）');
      lines.push('🆔 用户ID：' + (profile.userId || ''));
      if (groupId) {
        lines.push('👥 ' + (groupName || '未知群') + '（群ID：' + groupId + '）');
      }
      lines.push('');
      lines.push('━━━━━━━━━━━━━━');
      lines.push(hasLink ? '点击下方蓝色文字按钮即可触发 ↓' : '输入菜单名即可触发 ↓');
      lines.push('');
      for (var r2 = 0; r2 < rows.length; r2++) {
        lines.push(rows[r2].map(function(it) {
          var action = it.action || '';
          var url = '';
          if (action.indexOf('url:') === 0) {
            url = action.substring(4);
          } else if (action.indexOf('panel:') === 0) {
            var pb = (ctx.engine && ctx.engine.getPanelBaseUrl) ? ctx.engine.getPanelBaseUrl() : '';
            url = pb ? pb + action.substring(6) : '';
          } else {
            url = (ctx.engine && ctx.engine.buildClickUrl) ? ctx.engine.buildClickUrl(groupId, userId, action) : '';
          }
          if (url) return '[' + it.label + '↗](' + url + ')';
          return it.label;
        }.bind(this)).join('　'));
      }
      lines.push('');
      lines.push('━━━━━━━━━━━━━━');
      lines.push(footer);
      return lines.join('\n');
    },

    // ========== 统一回复 ==========
    sendReply: async function(ctx, data, text, buttons) {
      var userId = data.author.openid;
      var groupId = data.groupId;
      var msgId = data.id;
      if (!groupId) {
        await ctx.bot.sendPrivateMessage(userId, text, msgId);
        return;
      }
      if (!buttons || buttons.length === 0) {
        await ctx.bot.sendGroupMessage(groupId, text, msgId);
        return;
      }
      var items = [];
      for (var i = 0; i < buttons.length; i++) {
        var row = buttons[i];
        for (var j = 0; j < row.length; j++) {
          var b = row[j];
          var label = (b.render_data && b.render_data.label) || b.text || b.id || '按钮';
          var action = (b.action && b.action.data) || b.value || b.id || '';
          items.push({ label: label, action: action });
        }
      }
      var lines = (text || '').split('\n');
      var title = '';
      for (var k = 0; k < lines.length; k++) {
        if (lines[k].trim()) { title = lines[k].replace(/^[#*>\s]+/, '').trim(); break; }
      }
      await this.sendMenu(ctx, data, { title: title || '功能菜单', subtitle: text, items: items });
    },

    // ========== 处理命令 ==========
    handleCommand: async function(ctx, data) {
      var content = (data.content || '').trim().replace(/^\s*(?:<@!?[A-F0-9]+>|@\S+)\s*/, '').trim();
      var userId = data.author.openid;
      var groupId = data.groupId;
      var msgId = data.id;
      var self = this;

      var backBtn = function() {
        return { id: '主菜单', render_data: { label: '返回主菜单', visited_label: '返回主菜单', style: 0 }, action: { type: 2, data: '主菜单', enter: true, permission: { type: 2 } } };
      };
      var backRow = function() { return [backBtn()]; };

      // 调用本机网页后端 API（与 qq-bot-plugins 同源，激活码统一走后端 auth_codes 表）
      // 端口动态读取：服务器上以 PORT=3100 启动，本机开发为 3000
      function callLocalApi(method, apiPath, bodyString) {
        return new Promise(function(resolve) {
          try {
            var http = require('http');
            var port = (typeof process !== 'undefined' && process.env && process.env.PORT) ? Number(process.env.PORT) : 3000;
            var req = http.request({
              host: '127.0.0.1',
              port: port,
              path: apiPath,
              method: method,
              timeout: 6000,
              headers: { 'Content-Type': 'application/json' }
            }, function(res) {
              var body = '';
              res.on('data', function(chunk) { body += chunk; });
              res.on('end', function() {
                try { resolve(JSON.parse(body)); }
                catch(e) { resolve(null); }
              });
            });
            req.on('error', function() { resolve(null); });
            req.on('timeout', function() { req.destroy(); resolve(null); });
            if (bodyString) req.write(bodyString);
            req.end();
          } catch(e) {
            resolve(null);
          }
        });
      }

      // ===== 开机（任何人可用） =====
      if (content === '开机') {
        // 移除权限检查
        try {
          await ctx.engine.enableAllExcept(ctx.pluginId);
          await self.sendReply(ctx, data, '✅ 已开机，所有插件已启用', [backRow()]);
        } catch(e) {
          await self.sendReply(ctx, data, '❌ 开机失败：' + e.message, [backRow()]);
        }
        return;
      }

      // ===== 关机（任何人可用） =====
      if (content === '关机') {
        // 移除权限检查
        try {
          await ctx.engine.disableAllExcept(ctx.pluginId);
          await self.sendReply(ctx, data, '✅ 已关机，其他插件已停止\n发送"开机"恢复', [backRow()]);
        } catch(e) {
          await self.sendReply(ctx, data, '❌ 关机失败：' + e.message, [backRow()]);
        }
        return;
      }

      // ===== 设置超级主人 =====
      if (content === '设置主人') {
        if (self.getSuperId(ctx)) {
          await self.sendReply(ctx, data, '超级主人已存在，无法重复设置', [backRow()]);
          return;
        }
        ctx.storage.set('super_master_id', JSON.stringify({
          id: userId,
          qqId: data.author.qqId || userId,
          added_at: new Date().toISOString()
        }));
        await self.sendReply(ctx, data, '✅ 已设置超级主人！\n发送"开机"或"关机"管理插件。', [backRow()]);
        return;
      }

      // ===== 主人列表 =====
      if (content === '主人列表') {
        var superId = self.getSuperId(ctx);
        var minis = self.getMinis(ctx);
        var members = self.getMembers(ctx);
        var list = '👑 超级主人：' + (superId || '未设置');
        list += '\n\n👤 小主人：';
        if (minis.length === 0) list += '\n  （暂无）';
        for (var i = 0; i < minis.length; i++) {
          list += '\n  ' + (i + 1) + '. ' + (minis[i].qqId || minis[i].id) + (minis[i].activated ? ' ✅已激活' : ' ⏳未激活');
        }
        list += '\n\n👥 会员：';
        if (members.length === 0) list += '\n  （暂无）';
        for (var j = 0; j < members.length; j++) {
          list += '\n  ' + (j + 1) + '. ' + (members[j].qqId || members[j].id) + (members[j].activated ? ' ✅已激活' : ' ⏳未激活');
        }
        await self.sendReply(ctx, data, list, [backRow()]);
        return;
      }

      // ===== 整点报时开关 =====
      if (content === '整点报时' || content === '报时') {
        if (!self.isMaster(ctx, userId)) {
          await self.sendReply(ctx, data, '权限不足，仅主人可操作', [backRow()]);
          return;
        }
        var parts = content.split(/\s+/);
        var enabled = parts.length >= 2 ? parts[1] === '开' || parts[1] === '开启' || parts[1] === 'on' : null;
        var current = self.isChimeEnabled(ctx);
        if (enabled === null) {
          await self.sendReply(ctx, data, '🕐 整点报时当前：' + (current ? '已开启' : '已关闭') + '\n发送"整点报时 开"或"整点报时 关"切换', [backRow()]);
          return;
        }
        self.setChimeEnabled(ctx, enabled);
        await self.sendReply(ctx, data, '✅ 整点报时已' + (enabled ? '开启' : '关闭'), [backRow()]);
        return;
      }

      // ===== 全局模式切换 =====
      if (content === '切换全局模式' || content === '全局模式') {
        if (!self.isMaster(ctx, userId)) {
          await self.sendReply(ctx, data, '权限不足，仅主人可操作', [backRow()]);
          return;
        }
        var parts = content.split(/\s+/);
        var mode = parts.length >= 2 ? parts[1] : '';
        var current = self.getGlobalMode(ctx);
        var MODE_NAMES = {
          text: '文字模式',
          text_link: '文字链接模式',
          image: '图片菜单模式'
        };
        var name2mode = { '文字': 'text', '文字链接': 'text_link', '链接': 'text_link', '图片': 'image', '图片菜单': 'image', 'text': 'text', 'text_link': 'text_link', 'image': 'image' };
        if (!name2mode[mode]) {
          var seq = ['text', 'text_link', 'image'];
          var idx = seq.indexOf(current);
          if (idx === -1) idx = 1;
          var newMode = seq[(idx + 1) % seq.length];
          self.setGlobalMode(ctx, newMode);
          await self.sendReply(ctx, data, '✅ 全局模式已切换为：' + MODE_NAMES[newMode] + '\n支持：切换全局模式 文字 / 文字链接 / 图片', [backRow()]);
          return;
        }
        var target = name2mode[mode];
        self.setGlobalMode(ctx, target);
        var tip = target === 'text_link' ? '\n（文字链接模式需在面板-系统设置配置 面板域名 panel.host）' : '';
        await self.sendReply(ctx, data, '✅ 全局模式已设置为：' + MODE_NAMES[target] + tip, [backRow()]);
        return;
      }

      // ===== 私聊登录：已授权用户获取面板登录链接（用户名+授权码） =====
      if (!groupId && (content === '登录' || content === '登录链接' || content === '获取登录信息' || content === '获取授权码')) {
        var pinfo = await callLocalApi('GET', '/api/bot/panel-info', null);
        var linfo = await callLocalApi('GET', '/api/bot/auth-codes/login-info?openid=' + encodeURIComponent(userId), null);
        if (!linfo || !linfo.codes || linfo.codes.length === 0) {
          await ctx.bot.sendPrivateMessage(userId, '❌ 未找到你的授权记录\n请在群聊中发送"激活授权码 [激活码]"完成激活后，再私聊发送"登录"获取面板登录信息。', msgId);
          return;
        }
        var baseUrl = (pinfo && pinfo.url) || '';
        var text = '🔐 面板登录信息\n━━━━━━━━━━━━━━\n';
        for (var li = 0; li < linfo.codes.length; li++) {
          var c = linfo.codes[li];
          text += '用户名：' + (linfo.qq_number || linfo.openid) + '\n授权码：' + c.code + '\n角色：' + c.role_label + '（' + (c.is_permanent ? '永久' : '限时') + '）\n━━━━━━━━━━━━━━\n';
        }
        text += baseUrl
          ? '前往面板登录：' + baseUrl + '\n（账号=用户名，密码=授权码）'
          : '前往你的机器人管理面板登录：\n（账号=用户名，密码=授权码）\n提示：面板地址可在系统设置-面板域名中配置';
        await ctx.bot.sendPrivateMessage(userId, text, msgId);
        return;
      }

      // ===== 授权码相关（统一走后端 auth_codes 表，与面板授权码管理同源） =====
      if (content.indexOf('生成激活码') === 0) {
        if (!groupId) {
          if (!self.isSuper(ctx, userId)) {
            await ctx.bot.sendPrivateMessage(userId, '权限不足，仅超级主人可生成激活码', msgId);
            return;
          }
          var parts2 = content.split(/\s+/);
          var targetRole = parts2.length >= 2 ? parts2[1] : 'member';
          var roleVal = 'member';
          if (targetRole === 'super_master' || targetRole === '超级主人' || targetRole === '超主' || targetRole === '超主人') roleVal = 'super_master';
          else if (targetRole === 'master' || targetRole === '小主人' || targetRole === '主人') roleVal = 'master';
          var expireMin = parts2.length >= 3 ? parseInt(parts2[2], 10) : 0;
          var genBody = { role: roleVal, created_by: userId };
          if (expireMin > 0) genBody.expires_in_minutes = expireMin;
          var genRes = await callLocalApi('POST', '/api/bot/auth-codes', JSON.stringify(genBody));
          if (genRes && genRes.ok) {
            await ctx.bot.sendPrivateMessage(userId, '✅ 激活码已生成：' + genRes.code + '\n角色：' + (genRes.role_label || genRes.role) + '\n有效期：' + (genRes.is_permanent ? '永久' : expireMin + ' 分钟') + '\n已同步到后端授权码管理', msgId);
          } else {
            await ctx.bot.sendPrivateMessage(userId, '❌ 生成失败，请稍后重试', msgId);
          }
        } else {
          await self.sendReply(ctx, data, '激活码只能在私聊中生成，请私聊机器人发送"生成激活码 [超级主人|小主人|会员] [分钟]"', [backRow()]);
        }
        return;
      }

      // ===== 激活授权码 =====
      if (content.indexOf('激活授权码') === 0 || content.indexOf('激活码') === 0) {
        if (!groupId) {
          await ctx.bot.sendPrivateMessage(userId, '激活码请在群聊中发送', msgId);
          return;
        }
        var parts3 = content.split(/\s+/);
        if (parts3.length < 2) {
          await self.sendReply(ctx, data, '格式：激活授权码 [激活码]', [backRow()]);
          return;
        }
        var inputCode = parts3[1].toUpperCase();
        // 走后端验证（标记 used_by 并返回角色，与面板授权码管理使用状态保持一致）
        var vres = await callLocalApi('POST', '/api/bot/auth-codes/verify', JSON.stringify({ code: inputCode, openid: userId }));
        if (!vres || !vres.valid) {
          await self.sendReply(ctx, data, '❌ ' + ((vres && vres.error) || '激活码无效或已被使用'), [backRow()]);
          return;
        }
        var roleVal = vres.role === 'super_master' ? 'super_master' : vres.role === 'master' ? 'master' : 'member';

        if (roleVal === 'super_master') {
          var curSuperId = self.getSuperId(ctx);
          if (curSuperId && curSuperId !== userId && !(ctx.identity && ctx.identity.isSameUser && ctx.identity.isSameUser(curSuperId, userId))) {
            await self.sendReply(ctx, data, '❌ 超级主人已存在，无法覆盖', [backRow()]);
            return;
          }
          ctx.storage.set('super_master_id', JSON.stringify({
            id: userId,
            qqId: data.author.qqId || userId,
            added_at: new Date().toISOString()
          }));
          await self.sendReply(ctx, data, '✅ 激活成功！你已成为超级主人！\n可生成激活码、管理面板', [backRow()]);
          return;
        }

        if (roleVal === 'master') {
          var minis = self.getMinis(ctx);
          var exists = minis.some(function(m) { return m.id === userId; });
          if (!exists) {
            minis.push({ id: userId, qqId: data.author.qqId || userId, activated: true, activated_at: new Date().toISOString() });
          } else {
            for (var l = 0; l < minis.length; l++) {
              if (minis[l].id === userId) { minis[l].activated = true; minis[l].activated_at = new Date().toISOString(); break; }
            }
          }
          ctx.storage.set('mini_masters', JSON.stringify(minis));
          var pinfo2 = await callLocalApi('GET', '/api/bot/panel-info', null);
          var adminUrl = (pinfo2 && pinfo2.url) || ('https://' + (data.host || 'localhost') + (process.env.PORT && process.env.PORT !== '3000' ? ':' + process.env.PORT : ''));
          await self.sendReply(ctx, data, '✅ 激活成功！你已成为小主人！\n私聊机器人发送"登录"获取面板账号（用户名=QQ号，授权码=激活码）', [backRow()]);
        } else {
          var members = self.getMembers(ctx);
          var exists2 = members.some(function(m) { return m.id === userId; });
          if (!exists2) {
            members.push({ id: userId, qqId: data.author.qqId || userId, activated: true, activated_at: new Date().toISOString() });
          } else {
            for (var m2 = 0; m2 < members.length; m2++) {
              if (members[m2].id === userId) { members[m2].activated = true; members[m2].activated_at = new Date().toISOString(); break; }
            }
          }
          ctx.storage.set('members', JSON.stringify(members));
          await self.sendReply(ctx, data, '✅ 激活成功！你已成为会员！\n可使用会员专属功能！', [backRow()]);
        }
        return;
      }

      // 其他 → 路由到主菜单
      try { await ctx.engine.callPlugin('主菜单', 'handleCommand', data); } catch(e) {}
    }
  },

  onEnable: function(ctx) {
    var self = this;

    // ========== 权限辅助 ==========
    function getSuper() {
      var raw = ctx.storage.get('super_master_id') || '';
      try { var obj = JSON.parse(raw); return obj.id || ''; } catch(e) { return raw; }
    }
    function getMinis() {
      try { return JSON.parse(ctx.storage.get('mini_masters') || '[]'); } catch(e) { return []; }
    }
    function getMembers() {
      try { return JSON.parse(ctx.storage.get('members') || '[]'); } catch(e) { return []; }
    }
    function isMaster(uid) {
      var superId = getSuper();
      if (superId === uid) return true;
      try { if (superId && ctx.identity && ctx.identity.isSameUser && ctx.identity.isSameUser(superId, uid)) return true; } catch (e) {}
      var minis = getMinis();
      for (var i = 0; i < minis.length; i++) {
        if (minis[i].id === uid && minis[i].activated) return true;
        try { if (minis[i].activated && ctx.identity && ctx.identity.isSameUser && ctx.identity.isSameUser(minis[i].id, uid)) return true; } catch (e) {}
      }
      return false;
    }

    function reply(data, text) {
      try {
        if (data.groupId) {
          ctx.bot.sendGroupMessage(data.groupId, text, data.id);
        } else if (data.author && data.author.id) {
          ctx.bot.sendPrivateMessage(data.author.id, text, data.id);
        } else if (data.channelId) {
          ctx.bot.sendMessage(data.channelId, text, data.id);
        }
      } catch(e) { ctx.logger.error('发送消息失败：' + e.message); }
    }

    function getGlobalMode() { return ctx.storage.get('global_mode') || 'text_link'; }

    // ========== 核心消息处理 ==========
    async function handlePower(data) {
      var authorId = (data.author && data.author.id) || (data.author && data.author.openid) || '';
      if (!authorId) return;

      var rawContent = (data.content || '').trim();
      var content = rawContent.replace(/^\s*(?:<@!?[A-F0-9]+>|@\S+)\s*/, '').trim() || rawContent;

      // 开机/关机（任何人可用）
      if (content === '开机') {
        // 移除权限检查
        if (ctx.engine.isAllOthersEnabled(ctx.pluginId)) { reply(data, '已开机，所有插件已在运行中'); return; }
        try {
          await ctx.engine.enableAllExcept(ctx.pluginId);
          reply(data, '✅ 已开机，所有插件已启用');
        } catch(e) { reply(data, '❌ 开机失败：' + e.message); }
        return;
      }
      if (content === '关机') {
        // 移除权限检查
        if (ctx.engine.isAllOthersDisabled(ctx.pluginId)) { reply(data, '已关机，其他插件均已停止'); return; }
        try {
          await ctx.engine.disableAllExcept(ctx.pluginId);
          reply(data, '✅ 已关机，其他插件已停止\n发送"开机"恢复');
        } catch(e) { reply(data, '❌ 关机失败：' + e.message); }
        return;
      }

      // 主菜单 → 发送主菜单
      if (content === '主菜单' || content === '菜单') {
        var menuItems = [
          { label: '🎮 娱乐', desc: '运势/骰子/笑话/小游戏', action: '娱乐功能' },
          { label: '🛠 实用', desc: '打卡/备注/天气/昵称', action: '实用功能' },
          { label: '🔐 授权', desc: '激活码获取与激活', action: '授权功能' },
          { label: '⚙ 系统', desc: '版本/更新日志/运行时间', action: '系统功能' },
          { label: '🔧 设置', desc: '定时关机/整点提醒', action: '设置功能' },
          { label: '📋 DIC', desc: '词典回复/底部广告', action: 'DIC设置' },
          { label: '👥 群管', desc: '禁言/解禁/踢人', action: '群管系统' },
          { label: '⚡ 系统菜单', desc: '开机/关机/主人管理', action: '系统菜单' },
          { label: '❓ 帮助', desc: '使用帮助', action: '帮助' },
          { label: '📊 群信息', desc: '群活跃统计看板', action: '群信息' },
          { label: '📣 频道管理', desc: '频道列表/权限', action: '频道管理' },
          { label: '🧪 频道测试', desc: '频道管理(测试版)', action: '频道测试' },
          { label: '🔁 复读', desc: '用户/群信息查询', action: '复读功能' },
          { label: '📅 签到', desc: '签到/补签/排行', action: '签到系统' },
          { label: '🎵 唱歌', desc: '点歌搜索/在线试听', action: '唱歌' },
          { label: '💖 赞助', desc: '赞助与广告位', action: 'url:https://www.ifdian.net/a/lzyzqzb5201314' },
          { label: '✉ 拉我进群', desc: '拉机器人进群', action: '拉我进群' },
          { label: '📩 反馈', desc: '提交建议/问题', action: '反馈' },
          { label: '👤 作者', desc: '反馈与商务合作', action: 'url:https://wpa.qq.com/msgrd?v=3&uin=511742399&site=qq&menu=yes' },
          { label: '🔑 登录', desc: '面板登录管理', action: 'panel:/' }
        ];
        await self.methods.sendMenu(ctx, data, { title: '🌟 主菜单 🌟', subtitle: '', items: menuItems });
        return;
      }

      // 系统菜单
      if (content === '系统菜单') {
        var sysItems = [
          { label: '开机', desc: '启用所有插件', action: '开机' },
          { label: '关机', desc: '停用其他插件', action: '关机' },
          { label: '设置主人', desc: '绑定群主/管理员', action: '设置主人' },
          { label: '主人列表', desc: '查看当前主人', action: '主人列表' },
          { label: '整点报时', desc: '开关整点报时', action: '整点报时' },
          { label: '全局模式', desc: '切换文字/链接/图片', action: '全局模式' },
          { label: '返回主菜单', desc: '回到主菜单', action: '主菜单' }
        ];
        await self.methods.sendMenu(ctx, data, { title: '⚡ 系统控制', subtitle: '开机 / 关机 / 主人管理 / 整点报时 / 全局模式', items: sysItems });
        return;
      }

      // ===== 帮助文档 =====
      if (content === '帮助' || content === '帮助文档' || content === 'help') {
        var helpBtn = function() { return { id: '主菜单', render_data: { label: '🏠 返回主菜单', visited_label: '返回主菜单', style: 0 }, action: { type: 2, data: '主菜单', enter: true, permission: { type: 2 } } }; };
        await self.methods.sendReply(ctx, data, '📖 帮助文档\n━━━━━━━━━━━━━━\n🌟 发送"菜单"打开主菜单\n🎮 娱乐功能 · 运势/骰子/猜拳/小游戏\n🛠 实用功能 · 打卡/备注/天气/昵称\n🔐 授权功能 · 激活码获取与激活\n⚙️ 系统功能 · 版本/更新日志/运行时间\n🔧 设置功能 · 定时关机/整点提醒\n📋 DIC设置 · 词典回复管理\n👥 群管系统 · 禁言/解禁/踢人\n📈 群信息 · 群活跃统计看板\n📢 频道管理 · 频道列表/权限\n⚡ 系统控制 · 开机/关机/主人管理\n📅 签到 · 每日签到得积分\n⏰ 定时推送 · 早报/晚报/定时任务\n━━━━━━━━━━━━━━\n点击按钮或发送对应关键词使用', [[helpBtn()]]);
        return;
      }

      // ===== 赞助广告 =====
      if (content === '赞助' || content === '赞助广告' || content === '赞助支持') {
        var sponsorBtn = function() { return { id: '主菜单', render_data: { label: '🏠 返回主菜单', visited_label: '返回主菜单', style: 0 }, action: { type: 2, data: '主菜单', enter: true, permission: { type: 2 } } }; };
        await self.methods.sendReply(ctx, data, '💖 赞助支持\n━━━━━━━━━━━━━━\n感谢你的支持与喜爱！\n如需赞助机器人运营，或想在菜单中投放广告，请联系作者获取报价。\n\n广告位置：各功能菜单底部展示，触达群内所有成员。', [[sponsorBtn()]]);
        return;
      }

      // ===== 邀请入群 =====
      if (content === '拉我进群' || content === '邀请入群' || content === '拉我入群') {
        var inviteBtn = function() { return { id: '主菜单', render_data: { label: '🏠 返回主菜单', visited_label: '返回主菜单', style: 0 }, action: { type: 2, data: '主菜单', enter: true, permission: { type: 2 } } }; };
        await self.methods.sendReply(ctx, data, '📩 邀请入群\n━━━━━━━━━━━━━━\n把机器人拉进你的群：\n1. 打开目标QQ群 → 群设置 → 群管理\n2. 点击"添加/邀请机器人"\n3. 搜索本机器人并邀请加入\n\n若无法搜索到，请私聊作者获取邀请链接或开通白名单。', [[inviteBtn()]]);
        return;
      }

      // ===== 联系作者 =====
      if (content === '作者' || content === '联系作者' || content === '作者信息') {
        var authorBtn = function() { return { id: '主菜单', render_data: { label: '🏠 返回主菜单', visited_label: '返回主菜单', style: 0 }, action: { type: 2, data: '主菜单', enter: true, permission: { type: 2 } } }; };
        await self.methods.sendReply(ctx, data, '👤 联系作者\n━━━━━━━━━━━━━━\nQQ Bot Platform 管理机器人\n作者QQ：511742399\n\n遇到问题、功能建议、广告合作，欢迎私聊联系作者！', [[authorBtn()]]);
        return;
      }

      // 路由到子菜单
      var subMenus = ['娱乐功能', '实用功能', '授权功能', '系统功能', '设置功能', 'DIC设置', '群管系统', '群信息', '频道管理', '复读功能', '频道测试', '签到系统'];
      if (subMenus.indexOf(content) !== -1) {
        try { await ctx.engine.callPlugin('主菜单', 'handleCommand', data); } catch(e) {}
        return;
      }

      // 定时推送命令
      if (content === '定时推送' || content.indexOf('定时推送 ') === 0 ||
          content.indexOf('每日早报') === 0 || content.indexOf('每日晚报') === 0 ||
          content === '生日提醒' || content.indexOf('生日提醒 ') === 0 ||
          content.indexOf('间隔推送') === 0 || content === '定时任务列表' || content === '定时列表' ||
          content.indexOf('定时任务 ') === 0) {
        try { await ctx.engine.callPlugin('定时推送', 'handleCommand', data); } catch(e) {}
        return;
      }

      // 授权码命令 → 路由到 handleCommand
      if (content.indexOf('生成激活码') === 0 || content.indexOf('激活授权码') === 0 || content.indexOf('激活码') === 0) {
        try { await ctx.engine.callPlugin('开关机控制', 'handleCommand', data); } catch(e) {}
        return;
      }

      // 其他 → 路由到主菜单
      try { await ctx.engine.callPlugin('主菜单', 'handleCommand', data); } catch(e) {}
    }

    // ========== 新成员加入 ==========
    async function handleMemberJoin(data) {
      try {
        // 功能开关门控：欢迎语总开关（后台「功能开关」可停用）
        try {
          var swWelcome = ctx.engine.getConfigValue ? String(ctx.engine.getConfigValue('switch.welcome') || '') : '';
          if (swWelcome === '0') return;
        } catch(e) {}
        var groupId = data.groupId || (data.group && data.group.id) || '';
        if (!groupId) return;
        var member = data.member || data.target || data.user || {};
        var nick = member.nickname || member.name || member.card || member.id || '新成员';
        var welcomeText = '🎉 欢迎 ' + nick + ' 加入本群！\n有什么问题随时 @我 哦~';
        await ctx.bot.sendGroupMessage(groupId, welcomeText, null);
        try {
          var wdata = { groupId: groupId, id: null, author: { openid: '', username: nick } };
          await self.methods.sendMenu(ctx, wdata, { title: '欢迎加入', subtitle: '有什么问题随时 @我 哦~', items: [{ label: '📋 查看主菜单', action: '主菜单' }] });
        } catch(e) {}
      } catch(e) { ctx.logger.error('欢迎消息失败：' + e.message); }
    }

    // ========== 成员离开 ==========
    async function handleMemberLeave(data) {
      try {
        // 功能开关门控：退群提示总开关（后台「功能开关」可停用）
        try {
          var swLeave = ctx.engine.getConfigValue ? String(ctx.engine.getConfigValue('switch.leave_notice') || '') : '';
          if (swLeave === '0') return;
        } catch(e) {}
        var gid = data.groupId || (data.group && data.group.id) || '';
        if (!gid) return;
        var member = data.member || data.target || data.user || {};
        var nick = member.nickname || member.name || member.card || member.id || '某位成员';
        await ctx.bot.sendGroupMessage(gid, '👋 ' + nick + ' 离开了本群', null);
      } catch(e) { ctx.logger.error('离开提示失败：' + e.message); }
    }

    // ========== 整点报时（实时整点精确触发） ==========
    function bjHourNow() {
      var d = new Date(Date.now() + 8 * 3600 * 1000);
      return d.getUTCHours();
    }
    var DEFAULT_CHIMES = [
      '🕐 整点报时：现在是北京时间 {H}:00\n祝大家心情愉快！',
      '🕐 北京时间 {H}:00 整\n按时休息，精神满满~',
      '🕐 叮咚！现在是北京时间 {H} 点整\n新的一小时，加油！'
    ];
    function buildChimeText(hours) {
      var list = DEFAULT_CHIMES.slice();
      try {
        var cfg = (ctx.engine && ctx.engine.getConfigValue) ? ctx.engine.getConfigValue('bot.chime_texts') : '';
        if (cfg && String(cfg).trim()) {
          var custom = String(cfg).split(/\r?\n/).map(function(s) { return s.trim(); }).filter(function(s) { return s; });
          if (custom.length) list = custom;
        }
      } catch(e) {}
      var text = list[Math.floor(Math.random() * list.length)];
      text = text.replace(/\{H\}/g, String(hours)).replace(/\{HH\}/g, (hours < 10 ? '0' : '') + hours);
      var mm = new Date(Date.now() + 8 * 3600 * 1000).getUTCMinutes();
      text = text.replace(/\{MM\}/g, (mm < 10 ? '0' : '') + mm);
      return text + '\nPHP · QQ机器人平台';
    }
    // ========== 报时图片（sharp+SVG：时间/日期/天气/广告） ==========
    function chineseWeather(t) {
      var map = {
        'Sunny': '晴', 'Clear': '晴', 'Fair': '晴', 'Partly cloudy': '多云', 'Cloudy': '多云',
        'Overcast': '阴', 'Light rain': '小雨', 'Moderate rain': '中雨', 'Heavy rain': '大雨',
        'Rain': '雨', 'Drizzle': '毛毛雨', 'Showers': '阵雨', 'Thunderstorm': '雷阵雨',
        'Light snow': '小雪', 'Snow': '雪', 'Heavy snow': '大雪', 'Sleet': '雨夹雪',
        'Fog': '雾', 'Mist': '薄雾', 'Haze': '霾', 'Windy': '有风', 'Freezing': '冰冻'
      };
      var s = String(t || '').trim();
      Object.keys(map).forEach(function(k) { s = s.split(k).join(map[k]); });
      return s;
    }
    function escXml(s) {
      return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function chimeCity() {
      try { var c = ctx.engine.getConfigValue('bot.chime_city'); if (c && String(c).trim()) return String(c).trim(); } catch(e) {}
      return '北京';
    }
    function chimeAd() {
      try { var a = ctx.engine.getConfigValue('bot.chime_ad'); if (a && String(a).trim()) return String(a).trim(); } catch(e) {}
      return '';
    }
    function fetchChimeWeather(city) {
      return new Promise(function(resolve) {
        try {
          var httpMod = require('https');
          var url = 'https://wttr.in/' + encodeURIComponent(city) + '?format=%C+%t+%h+%w&lang=zh';
          var req = httpMod.get(url, { headers: { 'User-Agent': 'curl/7.0' }, timeout: 8000 }, function(res) {
            var body = '';
            res.on('data', function(c) { body += c; });
            res.on('end', function() { resolve(body.trim()); });
            res.on('error', function() { resolve(''); });
          });
          req.on('error', function() { resolve(''); });
          setTimeout(function() { try { req.destroy(); } catch(e) {} resolve(''); }, 9000);
        } catch(e) { resolve(''); }
      });
    }
    function buildChimeImage(weatherLine, city, ad) {
      return new Promise(function(resolve) {
        try {
          var sharp = require('sharp');
          var d = new Date(Date.now() + 8 * 3600 * 1000);
          var hh = d.getUTCHours();
          var hhS = (hh < 10 ? '0' : '') + hh;
          var mm = d.getUTCMinutes(); var ss = d.getUTCSeconds();
          var mmS = (mm < 10 ? '0' : '') + mm; var ssS = (ss < 10 ? '0' : '') + ss;
          var dateStr = d.getUTCFullYear() + '年' + (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日 ' + ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][d.getUTCDay()];
          var weather = weatherLine || '天气数据获取中';
          var adLine = ad || '' + ctx.link.linkify('发送「主菜单」', '主菜单') + '发现更多功能';
          var font = 'Noto Sans CJK SC, WenQuanYi Micro Hei, Microsoft YaHei, PingFang SC, sans-serif';
          var svg = '<svg width="800" height="480" xmlns="http://www.w3.org/2000/svg">' +
            '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">' +
            '<stop offset="0%" stop-color="#1b2a52"/><stop offset="55%" stop-color="#3a2a6e"/><stop offset="100%" stop-color="#0f0f2e"/>' +
            '</linearGradient></defs>' +
            '<rect width="800" height="480" fill="url(#bg)"/>' +
            '<rect x="24" y="24" width="752" height="432" rx="18" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>' +
            '<text x="400" y="140" font-size="130" font-family="' + font + '" fill="#ffffff" text-anchor="middle" font-weight="bold">' + hhS + ':00</text>' +
            '<text x="400" y="192" font-size="26" font-family="' + font + '" fill="#b9b9e6" text-anchor="middle">' + escXml(dateStr) + '</text>' +
            '<text x="400" y="240" font-size="40" font-family="' + font + '" fill="#8ec5ff" text-anchor="middle" font-weight="bold">' + hhS + ':' + mmS + '</text>' +
            '<line x1="120" y1="270" x2="680" y2="270" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>' +
            '<text x="400" y="325" font-size="30" font-family="' + font + '" fill="#ffd76a" text-anchor="middle" font-weight="bold">' + escXml(city) + ' · ' + escXml(weather) + '</text>' +
            '<text x="400" y="405" font-size="20" font-family="' + font + '" fill="#7f7fab" text-anchor="middle">' + escXml(adLine) + '</text>' +
            '</svg>';
          sharp(Buffer.from(svg)).png().toBuffer().then(resolve, function() { resolve(null); });
        } catch(e) { resolve(null); }
      });
    }
    async function sendChime(bjHours) {
      try {
        var groups = JSON.parse(ctx.storage.get('active_groups') || '{}');
        var cutoff = Date.now() - 86400000;
        var gids = Object.keys(groups).filter(function(k) { return groups[k] > cutoff; });
        if (gids.length === 0) { ctx.logger.warn('整点报时：无活跃群（active_groups 为空），跳过发送'); return; }
        var city = chimeCity();
        var weather = chineseWeather(await fetchChimeWeather(city));
        var imgBuf = await buildChimeImage(weather, city, chimeAd());
        var chime = buildChimeText(bjHours);
        for (var i = 0; i < gids.length; i++) {
          var sent = false;
          if (imgBuf) {
            try {
              var up = await ctx.bot.uploadGroupImageBuffer(gids[i], imgBuf, 'chime.png');
              if (up && up.file_info) {
                await ctx.bot.sendGroupImageMessage(gids[i], up.file_info, undefined);
                sent = true;
              }
            } catch(e) { ctx.logger.error('报时图片发送失败(' + gids[i] + ')：' + e.message); }
          }
          if (!sent) ctx.bot.sendGroupMessage(gids[i], chime, undefined);
        }
        ctx.logger.info('整点报时已发送至 ' + gids.length + ' 个群' + (imgBuf ? '（图片）' : '（文本降级）'));
      } catch(e) {
        ctx.logger.error('整点报时错误：' + e.message);
      }
    }
    function scheduleChime() {
      if (self._chimeTimer) { clearTimeout(self._chimeTimer); self._chimeTimer = null; }
      var nowBeijingMs = Date.now() + 8 * 3600 * 1000;
      var nextMinute = (Math.floor(nowBeijingMs / 60000) + 1) * 60000;
      var delay = Math.max(200, nextMinute - nowBeijingMs);
      self._chimeTimer = setTimeout(function() {
        try {
          // 功能开关门控：整点报时总开关（后台「功能开关」） + 旧版群内开关（storage chime_enabled）
          var swChime = ctx.engine.getConfigValue ? String(ctx.engine.getConfigValue('switch.chime') || '') : '';
          if (swChime !== '0' && self.methods.isChimeEnabled(ctx)) {
            sendChime(bjHourNow());
          }
        } catch(e) {
          ctx.logger.error('整点报时错误：' + e.message);
        }
        scheduleChime();
      }, delay);
    }
    scheduleChime();

    // ========== 注册事件 ==========
    var lid1 = ctx.eventBus.on('message.guild', handlePower);
    var lid2 = ctx.eventBus.on('message.c2c', handlePower);
    var lid3 = ctx.eventBus.on('message.group', handlePower);
    var jid = ctx.eventBus.on('group.member.add', handleMemberJoin);
    var lid = ctx.eventBus.on('group.member.remove', handleMemberLeave);

    self._listenerIds = [lid1, lid2, lid3, jid, lid];

    ctx.logger.info('开关机控制 v4.0.0 已启用（核心控制 + 整点报时 + 欢迎退群）');
  },

  onDisable: function(ctx) {
    if (this._listenerIds) {
      for (var i = 0; i < this._listenerIds.length; i++) {
        ctx.eventBus.off(this._listenerIds[i]);
      }
      this._listenerIds = null;
    }
    if (this._chimeTimer) {
      clearTimeout(this._chimeTimer);
      this._chimeTimer = null;
    }
    ctx.logger.info('开关机控制已禁用');
  }
};