// 系统工具 v1.1.0 - 在线时间/版本/更新日志/查巡（数据读取网页后端）
module.exports = {
  manifest: {
    id: 'mod-sys-tools',
    name: '系统工具',
    version: '1.1.0',
    description: '在线时间、版本号、更新日志、查巡（版本卡动态读取实际插件版本）',
    author: '511742399'
  },

  methods: {
    handleCommand: async function(ctx, data) {
      try {
        var content = (data.content || '').trim().replace(/^\s*<@!?[A-F0-9]+>\s*/, '').trim();
        var userId = data.author.openid;
        var groupId = data.groupId;
        var msgId = data.id;

        var backBtn = function() {
          return { id: '系统功能', render_data: { label: '⚙️ 返回系统', visited_label: '返回系统', style: 0 }, action: { type: 2, data: '系统功能', enter: true, permission: { type: 2 } } };
        };
        var backRow = function() { return [backBtn()]; };
        var btn = function(label, data2) {
          return { id: data2, render_data: { label: label, visited_label: data2, style: 1 }, action: { type: 2, data: data2, enter: true, permission: { type: 2 } } };
        };

        var sendReply = async function(text, buttons) {
          try {
            await ctx.engine.callPlugin('主菜单', 'sendMessage', groupId, userId, msgId, text, buttons);
          } catch(e) {
            await ctx.bot.sendGroupMessage(groupId, text + '\n发送"系统功能"返回', msgId);
          }
        };

        // 调用本机网页后端 API（仅系统工具使用，版本/日志/运行时间与网页端同源）
        function callLocalApi(method, apiPath) {
          return new Promise(function(resolve) {
            try {
              var http = require('http');
              var req = http.request({
                host: '127.0.0.1',
                port: (typeof process !== 'undefined' && process.env && process.env.PORT) ? Number(process.env.PORT) : 3000,
                path: apiPath,
                method: method,
                timeout: 5000,
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
              req.end();
            } catch(e) {
              resolve(null);
            }
          });
        }

        // 格式化时长
        function fmtDuration(secs) {
          secs = Math.max(0, Math.floor(secs));
          var days = Math.floor(secs / 86400);
          var hours = Math.floor((secs % 86400) / 3600);
          var minutes = Math.floor((secs % 3600) / 60);
          var seconds = secs % 60;
          var s = '';
          if (days > 0) s += days + '天';
          if (hours > 0) s += hours + '小时';
          if (minutes > 0) s += minutes + '分';
          s += seconds + '秒';
          return s;
        }

        // ===== 系统功能菜单 =====
        if (content === '系统功能' || content === '系统工具') {
          await sendReply('⚙️ 系统工具 · 系统功能大全\n━━━━━━━━━━━━━━\n⏱ 在线时间 · 机器人实际运行时长\n📦 版本 · 查看网页端版本信息\n📜 更新日志 · 查看网页端更新记录\n🔍 查巡 · 系统运行巡查\n━━━━━━━━━━━━━━\n点击下方按钮直接使用 ↓', [
            [btn('⏱ 在线时间', '在线时间'), btn('📦 版本', '版本'), btn('📜 更新日志', '更新日志'), btn('🔍 查巡', '查巡')],
            [backBtn()]
          ]);
          return;
        }

        // ===== 在线时间 =====
        if (content === '在线时间') {
          var up = await callLocalApi('GET', '/api/bot/uptime');
          if (up && up.uptimeSeconds !== undefined) {
            var uptimeStr = fmtDuration(up.uptimeSeconds);
            var startedStr = '';
            if (up.startedAt) {
              var d = new Date(up.startedAt);
              startedStr = (d.getMonth() + 1) + '月' + d.getDate() + '日 ' +
                (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' +
                (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
            }
            await sendReply('⏱ 机器人运行时间\n' +
              '已运行：' + uptimeStr + '\n' +
              '启动于：' + startedStr + '\n' +
              '进程ID：' + (up.pid || '未知'), [backRow()]);
          } else {
            await sendReply('⏱ 机器人在线时间\n' + fmtDuration(process.uptime()), [backRow()]);
          }
          return;
        }

        // ===== 版本 =====
        if (content === '版本') {
          var info = await callLocalApi('GET', '/api/bot/version');
          var versionMsg = '📦 版本信息\n━━━━━━━━━━━━━━\n';
          if (info && info.version) {
            versionMsg += '平台：' + (info.platform || 'QQ Bot Platform') + ' v' + info.version + '\n';
            if (info.framework && info.framework.name) {
              versionMsg += '框架：' + info.framework.name + (info.framework.version ? ' v' + info.framework.version : '') + '\n';
            }
            if (info.node) versionMsg += 'Node：' + info.node + '\n';
          } else {
            versionMsg += '平台：QQ Bot Platform v4.0.0\n';
          }
          // 插件版本优先读接口动态清单（与插件文件同步），接口缺失时才回退静态兜底
          var versionMap = {};
          var hasDynamic = false;
          if (info && Array.isArray(info.plugins) && info.plugins.length > 0) {
            hasDynamic = true;
            for (var pi = 0; pi < info.plugins.length; pi++) {
              if (info.plugins[pi] && info.plugins[pi].name) versionMap[info.plugins[pi].name] = info.plugins[pi].version;
            }
          }
          var names = ['开关机控制', '主菜单', '娱乐中心', '实用工具', '授权系统', '系统工具', '系统设置', 'DIC管理', '群管理工具'];
          var fallback = {
            '开关机控制': '4.0.0', '主菜单': '4.0.0', '娱乐中心': '3.0.0', '实用工具': '1.2.1',
            '授权系统': '1.0.0', '系统工具': '1.1.0', '系统设置': '1.0.0', 'DIC管理': '1.0.0', '群管理工具': '3.0.0'
          };
          versionMsg += '━━━━━━━━━━━━━━\n插件版本：\n';
          for (var ni = 0; ni < names.length; ni++) {
            var nm = names[ni];
            var ver = hasDynamic ? (versionMap[nm] || '—') : (fallback[nm] || '—');
            versionMsg += '• ' + nm + ' v' + ver + '\n';
          }
          versionMsg += '\n🤖 机器人QQ:4010208623';
          await sendReply(versionMsg, [backRow()]);
          return;
        }

        // ===== 更新日志 =====
        if (content === '更新日志') {
          var log = await callLocalApi('GET', '/api/bot/changelog');
          if (log && log.content) {
            var lines = String(log.content).split('\n');
            var out = [];
            for (var li = 0; li < lines.length; li++) {
              var l = lines[li];
              if (!l || /^\s*$/.test(l)) continue;
              if (/^#\s/.test(l)) {
                out.push(l.replace(/^#+\s*/, '📌 ').substring(0, 40));
              } else if (/^-\s/.test(l)) {
                out.push('  ' + l.substring(1).trim().substring(0, 60));
              } else if (/^###/.test(l)) {
                out.push(l.replace(/^#+\s*/, '  ▸ ').substring(0, 30));
              } else {
                out.push(l.trim().substring(0, 50));
              }
            }
            if (out.length > 40) out = out.slice(0, 40);
            await sendReply('📋 更新日志（网页端）\n━━━━━━━━━━━━━━\n' + out.join('\n'), [backRow()]);
          } else {
            await sendReply('📋 更新日志 v4.0.0\n===============\n🎉 全新架构重构\n• 模块化插件体系\n• 完整权限系统\n• 全局按钮/文字模式\n• 整点报时可开关\n\n📩 问题反馈：QQ 511742399', [backRow()]);
          }
          return;
        }

        // ===== 查巡 =====
        if (content === '查巡') {
          var badWords = ['违规词1', '违规词2', '敏感词1', '敏感词2']; // 可配置
          var msg = '🔍 查巡系统\n' +
            '当前敏感词库：' + badWords.length + ' 个\n' +
            '发送"查巡 添加 词" 添加敏感词\n' +
            '发送"查巡 删除 词" 删除敏感词\n' +
            '发送"查巡 列表" 查看所有敏感词';
          await sendReply(msg, [backRow()]);
          return;
        }
        if (content.indexOf('查巡 添加 ') === 0) {
          var word = content.substring(6).trim();
          if (!word) { await sendReply('请指定要添加的敏感词', [backRow()]); return; }
          var words = [];
          try { words = JSON.parse(ctx.storage.get('bad_words') || '[]'); } catch(e) {}
          if (words.indexOf(word) !== -1) {
            await sendReply('该词已存在', [backRow()]); return;
          }
          words.push(word);
          ctx.storage.set('bad_words', JSON.stringify(words));
          await sendReply('✅ 已添加敏感词：' + word, [backRow()]);
          return;
        }
        if (content.indexOf('查巡 删除 ') === 0) {
          var word2 = content.substring(6).trim();
          if (!word2) { await sendReply('请指定要删除的敏感词', [backRow()]); return; }
          var words2 = [];
          try { words2 = JSON.parse(ctx.storage.get('bad_words') || '[]'); } catch(e) {}
          var idx = words2.indexOf(word2);
          if (idx === -1) { await sendReply('该词不存在', [backRow()]); return; }
          words2.splice(idx, 1);
          ctx.storage.set('bad_words', JSON.stringify(words2));
          await sendReply('✅ 已删除敏感词：' + word2, [backRow()]);
          return;
        }
        if (content === '查巡 列表') {
          var words3 = [];
          try { words3 = JSON.parse(ctx.storage.get('bad_words') || '[]'); } catch(e) {}
          if (words3.length === 0) {
            await sendReply('📋 敏感词列表为空', [backRow()]);
          } else {
            await sendReply('📋 敏感词列表\n' + words3.join(', '), [backRow()]);
          }
          return;
        }

        await sendReply('❓ 未知指令\n发送"系统功能"查看所有系统工具', [backRow()]);
      } catch(e) {
        ctx.logger.error('系统工具错误: ' + e.message);
      }
    }
  },

  onEnable: function(ctx) {
    ctx.logger.info('系统工具 v1.1.0 已加载');
  }
};
