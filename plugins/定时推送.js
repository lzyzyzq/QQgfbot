// 定时推送 v1.0.0 - 每日定时消息/生日提醒/间隔推送
module.exports = {
  manifest: {
    id: 'mod-scheduler',
    name: '定时推送',
    version: '1.0.0',
    description: '每日定时消息、生日提醒、间隔推送',
    author: '511742399'
  },

  methods: {
    handleCommand: async function(ctx, data) {
      try {
        var content = (data.content || '').trim().replace(/^\s*<@!?[A-F0-9]+>\s*/, '').trim();
        var userId = data.author.openid;
        var groupId = data.groupId;
        var msgId = data.id;
        var self = this;

        // 权限检查
        function isMaster(uid) {
          var raw = ctx.storage.get('super_master_id') || '';
          var superId = '';
          try { var obj = JSON.parse(raw); superId = obj.id || ''; } catch(e) { superId = raw; }
          if (!superId) return false;
          if (superId === uid) return true;
          try { return !!(ctx.identity && ctx.identity.isSameUser && ctx.identity.isSameUser(superId, uid)); } catch(e) { return false; }
        }

        var backBtn = function() {
          return { id: '设置功能', render_data: { label: '返回设置', visited_label: '返回设置', style: 0 }, action: { type: 2, data: '设置功能', enter: true, permission: { type: 2 } } };
        };
        var backRow = function() { return [backBtn()]; };

        var sendReply = async function(text, buttons) {
          try {
            await ctx.engine.callPlugin('主菜单', 'sendMessage', groupId, userId, msgId, text, buttons || [backRow()]);
          } catch(e) {
            await ctx.bot.sendGroupMessage(groupId, text + '\n发送"设置功能"返回', msgId);
          }
        };

        // 与网页后端定时任务（config 表 schedule_tasks）同一存储，schedule-runner 统一执行
        var genTaskId = function() {
          return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        };
        var globalTasks = function() {
          try {
            var raw = ctx.engine.getConfigValue ? String(ctx.engine.getConfigValue('schedule_tasks') || '') : '';
            var arr = JSON.parse(raw || '[]');
            return Array.isArray(arr) ? arr : [];
          } catch(e) { return []; }
        };
        var saveGlobalTasks = function(list) {
          try { if (ctx.engine.setConfigValue) ctx.engine.setConfigValue('schedule_tasks', JSON.stringify(list)); } catch(e) {}
        };
        var groupTasks = function(list) {
          return list.filter(function(t) {
            return t.type === 'broadcast' && (t.groups || []).indexOf(groupId) !== -1;
          });
        };

        if (!isMaster(userId)) {
          await sendReply('权限不足，仅主人可操作');
          return;
        }

        // ===== 每日早报 =====
        if (content === '每日早报' || content.indexOf('每日早报 ') === 0) {
          if (content === '每日早报') {
            var current = ctx.storage.get('morning_msg_' + groupId) || '未设置';
            await sendReply('[每日早报]\n当前内容：' + current + '\n\n格式：每日早报 HH:MM 内容\n例：每日早报 08:00 早上好！今天也是元气满满的一天！');
            return;
          }
          var parts = content.split(/\s+/);
          if (parts.length < 3) {
            await sendReply('格式：每日早报 HH:MM 内容\n例：每日早报 08:00 早上好！');
            return;
          }
          var time = parts[1];
          if (!/^\d{1,2}:\d{2}$/.test(time)) {
            await sendReply('时间格式错误\n格式：HH:MM 如 08:00');
            return;
          }
          var msg = parts.slice(2).join(' ');
          var tasks = globalTasks();
          tasks = tasks.filter(function(t) {
            return !(t.type === 'broadcast' && t.contentType === 'morning' && (t.groups || []).length === 1 && t.groups[0] === groupId);
          });
          tasks.push({ id: genTaskId(), type: 'broadcast', enabled: true, contentType: 'morning', time: time, groups: [groupId], text: msg });
          saveGlobalTasks(tasks);
          await sendReply('每日早报已设置：' + time + '\n内容：' + msg + '\n（已同步到后台定时任务，可随时编辑/删除）');
          return;
        }

        // ===== 每日晚报 =====
        if (content === '每日晚报' || content.indexOf('每日晚报 ') === 0) {
          if (content === '每日晚报') {
            var current = ctx.storage.get('evening_msg_' + groupId) || '未设置';
            await sendReply('[每日晚报]\n当前内容：' + current + '\n\n格式：每日晚报 HH:MM 内容\n例：每日晚报 22:00 晚安！明天见！');
            return;
          }
          var parts = content.split(/\s+/);
          if (parts.length < 3) {
            await sendReply('格式：每日晚报 HH:MM 内容\n例：每日晚报 22:00 晚安！明天见！');
            return;
          }
          var time = parts[1];
          if (!/^\d{1,2}:\d{2}$/.test(time)) {
            await sendReply('时间格式错误');
            return;
          }
          var msg = parts.slice(2).join(' ');
          var tasks = globalTasks();
          tasks = tasks.filter(function(t) {
            return !(t.type === 'broadcast' && t.contentType === 'evening' && (t.groups || []).length === 1 && t.groups[0] === groupId);
          });
          tasks.push({ id: genTaskId(), type: 'broadcast', enabled: true, contentType: 'evening', time: time, groups: [groupId], text: msg });
          saveGlobalTasks(tasks);
          await sendReply('每日晚报已设置：' + time + '\n内容：' + msg + '\n（已同步到后台定时任务，可随时编辑/删除）');
          return;
        }

        // ===== 生日提醒 =====
        if (content === '生日提醒' || content.indexOf('生日提醒 ') === 0) {
          if (content === '生日提醒') {
            var list = [];
            try { list = JSON.parse(ctx.storage.get('birthdays') || '[]'); } catch(e) { list = []; }
            var info = '当前生日提醒列表：';
            if (list.length === 0) {
              info += '\n（暂无）';
            } else {
              for (var i = 0; i < list.length; i++) {
                info += '\n' + (i + 1) + '. ' + list[i].name + ' - ' + list[i].date;
              }
            }
            info += '\n\n格式：生日提醒 添加 名字 MM-DD\n例：生日提醒 添加 小明 05-20';
            info += '\n格式：生日提醒 删除 序号';
            await sendReply(info);
            return;
          }
          var parts = content.split(/\s+/);
          if (parts.length < 2) {
            await sendReply('格式：生日提醒 添加/删除/列表');
            return;
          }
          var subCmd = parts[1];

          if (subCmd === '列表') {
            var list = [];
            try { list = JSON.parse(ctx.storage.get('birthdays') || '[]'); } catch(e) { list = []; }
            if (list.length === 0) {
              await sendReply('暂无生日提醒');
              return;
            }
            var info2 = '生日提醒列表：';
            for (var j = 0; j < list.length; j++) {
              info2 += '\n' + (j + 1) + '. ' + list[j].name + ' - ' + list[j].date;
            }
            await sendReply(info2);
            return;
          }

          if (subCmd === '删除') {
            var idx = parseInt(parts[2]) - 1;
            var list = [];
            try { list = JSON.parse(ctx.storage.get('birthdays') || '[]'); } catch(e) { list = []; }
            if (isNaN(idx) || idx < 0 || idx >= list.length) {
              await sendReply('序号无效，当前共 ' + list.length + ' 条记录');
              return;
            }
            var removed = list[idx];
            list.splice(idx, 1);
            ctx.storage.set('birthdays', JSON.stringify(list));
            await sendReply('已删除生日提醒：' + removed.name + ' (' + removed.date + ')');
            return;
          }

          if (subCmd === '添加' && parts.length >= 4) {
            var name = parts[2];
            var date = parts[3];
            if (!/^\d{2}-\d{2}$/.test(date)) {
              await sendReply('日期格式错误，请使用 MM-DD 格式');
              return;
            }
            var list = [];
            try { list = JSON.parse(ctx.storage.get('birthdays') || '[]'); } catch(e) { list = []; }
            list.push({ name: name, date: date, addedBy: userId });
            ctx.storage.set('birthdays', JSON.stringify(list));
            await sendReply('已添加生日提醒：' + name + ' - ' + date);
            return;
          }

          await sendReply('格式：生日提醒 添加 名字 MM-DD');
          return;
        }

        // ===== 间隔推送 =====
        if (content === '间隔推送' || content.indexOf('间隔推送 ') === 0) {
          if (content === '间隔推送') {
            await sendReply('[间隔推送]\n格式：间隔推送 开启/关闭/设置 分钟 内容\n例：间隔推送 设置 60 该喝水啦！');
            return;
          }
          var parts = content.split(/\s+/);
          if (parts.length < 2) {
            await sendReply('格式：间隔推送 开启/关闭/设置');
            return;
          }
          var subCmd2 = parts[1];

          if (subCmd2 === '开启') {
            ctx.storage.set('interval_push_enabled_' + groupId, '1');
            await sendReply('间隔推送已开启');
            return;
          }
          if (subCmd2 === '关闭') {
            ctx.storage.set('interval_push_enabled_' + groupId, '0');
            await sendReply('间隔推送已关闭');
            return;
          }
          if (subCmd2 === '设置' && parts.length >= 4) {
            var interval = parseInt(parts[2]);
            var ivMsg = parts.slice(3).join(' ');
            if (isNaN(interval) || interval < 5) {
              await sendReply('间隔时间至少5分钟');
              return;
            }
            var tasks = globalTasks();
            tasks = tasks.filter(function(t) {
              return !(t.type === 'broadcast' && t.contentType === 'text' && !!t.intervalMin && (t.groups || []).length === 1 && t.groups[0] === groupId);
            });
            tasks.push({ id: genTaskId(), type: 'broadcast', enabled: true, contentType: 'text', intervalMin: interval, groups: [groupId], text: ivMsg });
            saveGlobalTasks(tasks);
            ctx.storage.set('interval_push_enabled_' + groupId, '1');
            await sendReply('间隔推送已设置：每' + interval + '分钟\n内容：' + ivMsg + '\n（已同步到后台定时任务，可随时编辑/删除）');
            return;
          }
          await sendReply('格式：间隔推送 开启/关闭/设置 分钟 内容');
          return;
        }

        // ===== 查看所有定时任务 =====
        if (content === '定时任务列表' || content === '定时列表') {
          var tasks = globalTasks();
          var births = [];
          try { births = JSON.parse(ctx.storage.get('birthdays') || '[]'); } catch(e) { births = []; }
          var gTasks = groupTasks(tasks);
          var info3 = '[定时任务列表]';
          if (gTasks.length === 0 && births.length === 0) {
            info3 += '\n暂无任务';
          } else {
            for (var k = 0; k < gTasks.length; k++) {
              var t = gTasks[k];
              var tp = t.contentType === 'morning' ? '每日早报' : (t.contentType === 'evening' ? '每日晚报' : '间隔推送');
              info3 += '\n' + (k + 1) + '. ' + tp + (t.time ? ' ' + t.time : (' 每' + t.intervalMin + '分钟')) + '：' + (t.text || '');
              if (t.enabled === false) info3 += '（已停用）';
            }
            if (births.length > 0) {
              info3 += '\n\n生日提醒：';
              for (var b = 0; b < births.length; b++) {
                info3 += '\n  ' + births[b].name + ' - ' + births[b].date;
              }
            }
          }
          info3 += '\n\n发送"定时任务 删除 序号"删除任务';
          info3 += '\n序号仅包含本群任务（从1开始）';
          await sendReply(info3);
          return;
        }

        // ===== 删除定时任务 =====
        if (content.indexOf('定时任务 删除 ') === 0) {
          var idx = parseInt(content.split(/\s+/)[2]) - 1;
          var tasks = globalTasks();
          var gTasks = groupTasks(tasks);
          if (isNaN(idx) || idx < 0 || idx >= gTasks.length) {
            await sendReply('序号无效，当前本群共 ' + gTasks.length + ' 个定时任务');
            return;
          }
          var toDelete = gTasks[idx];
          var targetId = toDelete.id;
          tasks = tasks.filter(function(t) {
            if (t.id !== targetId) return true;
            if ((t.groups || []).length <= 1) return false;
            t.groups = (t.groups || []).filter(function(g) { return g !== groupId; });
            return true;
          });
          saveGlobalTasks(tasks);
          var typeName = toDelete.contentType === 'morning' ? '每日早报' : (toDelete.contentType === 'evening' ? '每日晚报' : '间隔推送');
          await sendReply('已删除：' + typeName);
          return;
        }

        await sendReply('定时推送命令：\n每日早报/每日晚报/生日提醒/间隔推送/定时任务列表');
      } catch(e) {
        ctx.logger.error('定时推送错误: ' + e.message);
      }
    }
  },

  onEnable: function(ctx) {
    var self = this;

    function getActiveGroupIds() {
      try {
        var groups = JSON.parse(ctx.storage.get('active_groups') || '{}');
        var cutoff = Date.now() - 86400000;
        return Object.keys(groups).filter(function(k) { return groups[k] > cutoff; });
      } catch(e) {
        return [];
      }
    }

    function getBirthdayMsg(dateStr) {
      var births = [];
      try { births = JSON.parse(ctx.storage.get('birthdays') || '[]'); } catch(e) { return null; }
      var matches = births.filter(function(b) { return b.date === dateStr; });
      if (matches.length === 0) return null;
      var names = matches.map(function(b) { return b.name; }).join('、');
      return '今天是' + names + '的生日！大家一起祝TA生日快乐！';
    }

    // 迁移旧版 storage 定时任务到网页后端 schedule_tasks（由 schedule-runner 统一执行，避免双发）
    try {
      var legacy = [];
      try { legacy = JSON.parse(ctx.storage.get('scheduled_tasks') || '[]') || []; } catch(e) { legacy = []; }
      if (legacy.length) {
        var existing = [];
        try { existing = JSON.parse(ctx.engine.getConfigValue ? String(ctx.engine.getConfigValue('schedule_tasks') || '') : '') || []; } catch(e) { existing = []; }
        var merged = Array.isArray(existing) ? existing : [];
        for (var mi = 0; mi < legacy.length; mi++) {
          (function(lg) {
            var ct = lg.type === 'interval' ? 'text' : lg.type;
            var dup = merged.some(function(x) {
              return x.type === 'broadcast' && x.contentType === ct && (x.groups || []).indexOf(lg.groupId) !== -1 && (ct === 'text' ? !!x.intervalMin : x.time === lg.time);
            });
            if (dup) return;
            var nt = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), type: 'broadcast', enabled: true, contentType: ct, groups: [lg.groupId], text: String(lg.content || '') };
            if (ct === 'text') { nt.intervalMin = lg.intervalMin; } else { nt.time = lg.time; }
            merged.push(nt);
          })(legacy[mi]);
        }
        try { if (ctx.engine.setConfigValue) ctx.engine.setConfigValue('schedule_tasks', JSON.stringify(merged)); } catch(e) {}
        ctx.storage.set('scheduled_tasks', '[]');
        ctx.logger.info('定时推送：已将 ' + legacy.length + ' 条旧定时任务迁移到网页后端定时任务');
      }
    } catch(e) {}

    // 分钟级定时器：仅保留生日提醒（早报/晚报/间隔推送已由网页后端 schedule-runner 驱动）
    var lastMinute = '';

    self._timer = setInterval(function() {
      var now = new Date();
      var bjHours = (now.getUTCHours() + 8) % 24;
      var bjMin = now.getUTCMinutes();
      var timeKey = String(bjHours).padStart(2, '0') + ':' + String(bjMin).padStart(2, '0');
      var dateKey = String(now.getUTCMonth() + 1).padStart(2, '0') + '-' + String(now.getUTCDate()).padStart(2, '0');

      if (timeKey === lastMinute) return;
      lastMinute = timeKey;

      // 生日提醒（每天 09:00 提醒一次）
      if (timeKey === '09:00') {
        var bdayMsg = getBirthdayMsg(dateKey);
        if (bdayMsg) {
          var gids = getActiveGroupIds();
          for (var j = 0; j < gids.length; j++) {
            ctx.bot.sendGroupMessage(gids[j], bdayMsg).catch(function() {});
          }
        }
      }
    }, 30000);

    ctx.logger.info('定时推送 v1.0.0 已启用');
  },

  onDisable: function(ctx) {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    ctx.logger.info('定时推送已禁用');
  }
};
