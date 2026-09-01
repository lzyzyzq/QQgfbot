// DIC管理 v1.0.0 - 词典回复管理
module.exports = {
  manifest: {
    id: 'mod-dic-manager',
    name: 'DIC管理',
    version: '1.0.0',
    description: '开启/关闭dic回复、写入dic、设置底部广告、模式设置',
    author: '511742399'
  },

  methods: {
    _isSuper: function(ctx, userId) {
      var raw = ctx.storage.get('super_master_id') || '';
      var superId = '';
      try { var obj = JSON.parse(raw); superId = obj.id || ''; } catch(e) { superId = raw; }
      if (!superId) return false;
      if (superId === userId) return true;
      try { return !!(ctx.identity && ctx.identity.isSameUser && ctx.identity.isSameUser(superId, userId)); } catch(e) { return false; }
    },

    handleCommand: async function(ctx, data) {
      try {
        var content = (data.content || '').trim().replace(/^\s*<@!?[A-F0-9]+>\s*/, '').trim();
        var userId = data.author.openid;
        var groupId = data.groupId;
        var msgId = data.id;
        var self = this;

        var backBtn = function() {
          return { id: 'DIC设置', render_data: { label: '📋 返回DIC', visited_label: '返回DIC', style: 0 }, action: { type: 2, data: 'DIC设置', enter: true, permission: { type: 2 } } };
        };
        var backRow = function() { return [backBtn()]; };

        var sendReply = async function(text, buttons) {
          try {
            await ctx.engine.callPlugin('主菜单', 'sendMessage', groupId, userId, msgId, text, buttons);
          } catch(e) {
            await ctx.bot.sendGroupMessage(groupId, text + '\n发送"DIC设置"返回', msgId);
          }
        };

        var isSuper = self._isSuper(ctx, userId);

        // ===== 开启dic回复 =====
        if (content === '开启dic回复') {
          if (!isSuper) {
            await sendReply('⛔ 仅超级主人可操作', [backRow()]);
            return;
          }
          var pluginId = ctx.engine.findPluginByName('词典回复');
          if (!pluginId) {
            await sendReply('❌ 词典回复插件未找到', [backRow()]);
            return;
          }
          try {
            await ctx.engine.enable(pluginId);
            await sendReply('✅ 词典回复已开启', [backRow()]);
          } catch(e) {
            await sendReply('❌ 开启失败：' + e.message, [backRow()]);
          }
          return;
        }

        // ===== 关闭dic回复 =====
        if (content === '关闭dic回复') {
          if (!isSuper) {
            await sendReply('⛔ 仅超级主人可操作', [backRow()]);
            return;
          }
          var pluginId2 = ctx.engine.findPluginByName('词典回复');
          if (!pluginId2) {
            await sendReply('❌ 词典回复插件未找到', [backRow()]);
            return;
          }
          try {
            await ctx.engine.disable(pluginId2);
            await sendReply('✅ 词典回复已关闭', [backRow()]);
          } catch(e) {
            await sendReply('❌ 关闭失败：' + e.message, [backRow()]);
          }
          return;
        }

        // ===== 写入dic =====
        if (content === '写入dic' || content.indexOf('写入dic ') === 0) {
          if (!isSuper) {
            await sendReply('⛔ 仅超级主人可操作', [backRow()]);
            return;
          }
          if (content === '写入dic') {
            await sendReply('📤 写入dic\n私聊发送 dic文件内容\n格式：关键词|回复内容\n支持JSON格式回复', [backRow()]);
            return;
          }
          var dicContent = content.substring(5).trim();
          if (!dicContent) {
            await sendReply('请提供dic内容', [backRow()]);
            return;
          }
          var fs = require('fs');
          var path = require('path');
          var dictPath = path.join(process.cwd(), 'plugins', 'dict.txt');
          try {
            fs.writeFileSync(dictPath, dicContent, 'utf8');
            // 重新加载词典插件
            var pluginId3 = ctx.engine.findPluginByName('词典回复');
            if (pluginId3) {
              await ctx.engine.reload(pluginId3);
            }
            await sendReply('✅ dic文件已写入并重新加载', [backRow()]);
          } catch(e) {
            await sendReply('❌ 写入失败：' + e.message, [backRow()]);
          }
          return;
        }

        // ===== 设置底部广告 =====
        if (content === '设置底部广告' || content.indexOf('设置底部广告 ') === 0) {
          if (!isSuper) {
            await sendReply('⛔ 仅超级主人可操作', [backRow()]);
            return;
          }
          if (content === '设置底部广告') {
            var menus = ['娱乐功能', '实用功能', '授权功能', '系统功能', '设置功能', 'DIC设置', '群管系统'];
            var currentAds = '';
            for (var i = 0; i < menus.length; i++) {
              var ad = ctx.storage.get('footer_ad_' + menus[i]) || '默认';
              currentAds += '\n' + menus[i] + '：' + ad;
            }
            await sendReply('📢 当前底部广告\n' + currentAds + '\n\n格式：设置底部广告 菜单名 广告内容\n例：设置底部广告 娱乐功能 玩游戏找我！', [backRow()]);
            return;
          }
          var parts2 = content.split(/\s+/);
          if (parts2.length < 3) {
            await sendReply('格式：设置底部广告 菜单名 广告内容', [backRow()]);
            return;
          }
          var menuName = parts2[1];
          var adContent = parts2.slice(2).join(' ');
          var validMenus = ['娱乐功能', '实用功能', '授权功能', '系统功能', '设置功能', 'DIC设置', '群管系统'];
          if (validMenus.indexOf(menuName) === -1) {
            await sendReply('❌ 无效菜单名\n可选：' + validMenus.join(', '), [backRow()]);
            return;
          }
          ctx.storage.set('footer_ad_' + menuName, adContent);
          await sendReply('✅ ' + menuName + ' 底部广告已更新', [backRow()]);
          return;
        }

        // ===== 模式设置 =====
        if (content === '模式设置' || content.indexOf('模式设置 ') === 0) {
          if (!isSuper) {
            await sendReply('⛔ 仅超级主人可操作', [backRow()]);
            return;
          }
          var modeNames = { button: '按钮模式(已移除)', text: '文字模式', text_link: '文字链接模式', image: '图片菜单模式' };
          if (content === '模式设置') {
            var currentMode = ctx.storage.get('global_mode') || 'text_link';
            await sendReply('🔄 当前全局模式：' + (modeNames[currentMode] || currentMode) + '\n格式：模式设置 文字 / 文字链接 / 图片', [backRow()]);
            return;
          }
          var mode = content.substring(5).trim();
          if (mode === '按钮' || mode === 'button') {
            await sendReply('❌ 按钮模式已移除\n请使用：文字 / 文字链接 / 图片', [backRow()]);
          } else if (mode === '图片' || mode === 'image' || mode === '图片菜单') {
            ctx.storage.set('global_mode', 'image');
            await sendReply('✅ 已切换为图片菜单模式', [backRow()]);
          } else if (mode === '文字' || mode === 'text') {
            ctx.storage.set('global_mode', 'text');
            await sendReply('✅ 已切换为文字模式', [backRow()]);
          } else if (mode === '文字链接' || mode === 'text_link' || mode === '链接') {
            ctx.storage.set('global_mode', 'text_link');
            await sendReply('✅ 已切换为文字链接模式\n菜单按钮将变为可点击的文字链接', [backRow()]);
          } else {
            await sendReply('❌ 无效模式\n请使用：文字 / 文字链接 / 图片', [backRow()]);
          }
          return;
        }

        await sendReply('❓ 未知指令\n发送"DIC设置"查看所有DIC管理功能', [backRow()]);
      } catch(e) {
        ctx.logger.error('DIC管理错误: ' + e.message);
      }
    }
  },

  onEnable: function(ctx) {
    ctx.logger.info('DIC管理 v1.0.0 已加载');
  }
};