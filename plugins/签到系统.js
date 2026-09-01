// 签到系统 v2.1.1 - 每日签到 + 积分 + 排行 + 补签 + 按钮/文字双模式
// v2.1.1: 积分排行显示绑定 QQ（已绑定用户显示 QQ 号，未绑定才显示 UID 前 8 位）
module.exports = {
  manifest: {
    id: 'mod-checkin',
    name: '签到系统',
    version: '2.1.1',
    description: '每日签到、积分系统、补签、排行榜、个人信息',
    author: '511742399',
  },

  methods: {
    _today: function() {
      var d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    },
    _yesterday: function() {
      var d = new Date(); d.setDate(d.getDate() - 1);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    },

    handleCommand: async function(ctx, data) {
      try {
        var content = (data.content || '').trim().replace(/^\s*<@!?[A-F0-9]+>\s*/, '').trim();
        var userId = data.author.openid;
        var groupId = data.groupId;
        var msgId = data.id;

        var backBtn = function() {
          return { id: '返回主菜单', render_data: { label: '返回主菜单', visited_label: '返回主菜单', style: 0 }, action: { type: 2, data: '返回主菜单', enter: true, permission: { type: 2 } } };
        };
        var backRow = function() { return [backBtn()]; };

        var sendReply = async function(text, buttons) {
          try {
            await ctx.engine.callPlugin('主菜单', 'sendMessage', groupId, userId, msgId, text, buttons);
          } catch(e) {
            await ctx.bot.sendGroupMessage(groupId, text + '\n发送"返回主菜单"回到主界面', msgId);
          }
        };

        // 功能开关门控：签到系统总开关（后台「功能开关」可停用）
        try {
          var swVal = ctx.engine.getConfigValue ? String(ctx.engine.getConfigValue('switch.checkin') || '') : '';
          if (swVal === '0') {
            await sendReply('签到系统已停用', [backRow()]);
            return;
          }
        } catch(e) {}

        if (content === '签到') {
          var today = this._today();
          var yesterday = this._yesterday();
          var lastDate = ctx.storage.get('checkin_' + userId + '_date');

          if (lastDate === today) {
            await sendReply('你今天已经签过到了，明天再来吧！', [backRow()]);
            return;
          }

          var streak = 1;
          if (lastDate === yesterday) {
            streak = (parseInt(ctx.storage.get('checkin_' + userId + '_streak'), 10) || 0) + 1;
          }

          var points = Math.floor(Math.random() * 100) + 1;
          var bonusMsg = '';
          if (streak >= 30) { points += 200; bonusMsg = '\n满月签到奖励+200积分！'; }
          else if (streak >= 7) { points += 50; bonusMsg = '\n连续' + streak + '天奖励+50积分！'; }
          else if (streak >= 3) { points += 20; bonusMsg = '\n连续' + streak + '天奖励+20积分！'; }

          var lucky = Math.random();
          if (lucky < 0.05) { points *= 2; bonusMsg += '\n幸运暴击！积分x2！'; }

          ctx.storage.set('checkin_' + userId + '_date', today);
          ctx.storage.set('checkin_' + userId + '_streak', String(streak));

          var totalKey = 'checkin_' + userId + '_total';
          var total = (parseInt(ctx.storage.get(totalKey), 10) || 0) + points;
          ctx.storage.set(totalKey, String(total));

          if (!ctx._checkinUsers) ctx._checkinUsers = [];
          if (ctx._checkinUsers.indexOf(userId) === -1) ctx._checkinUsers.push(userId);

          await sendReply('签到成功！+ ' + points + ' 积分' + bonusMsg + '\n累计积分：' + total + ' | 连续签到：' + streak + '天', [backRow()]);
          return;
        }

        if (content === '补签') {
          var today = this._today();
          var lastDate = ctx.storage.get('checkin_' + userId + '_date');
          if (lastDate === today) {
            await sendReply('你今天已经签到过了，无需补签。', [backRow()]);
            return;
          }
          var yday = this._yesterday();
          if (lastDate === yday) {
            await sendReply('昨天已签到，无需补签。发送"签到"即可。', [backRow()]);
            return;
          }
          var total = parseInt(ctx.storage.get('checkin_' + userId + '_total'), 10) || 0;
          if (total < 30) {
            await sendReply('补签需要消耗30积分，你的积分不足（当前：' + total + '）。', [backRow()]);
            return;
          }
          total -= 30;
          ctx.storage.set('checkin_' + userId + '_total', String(total));
          ctx.storage.set('checkin_' + userId + '_date', yday);

          var streak = (parseInt(ctx.storage.get('checkin_' + userId + '_streak'), 10) || 0) + 1;
          ctx.storage.set('checkin_' + userId + '_streak', String(streak));

          await sendReply('补签成功！消耗30积分，连续签到恢复为' + streak + '天。\n剩余积分：' + total, [backRow()]);
          return;
        }

        if (content === '个人信息') {
          return;
        }

        if (content === '签到排行' || content === '积分排行') {
          var allKeys = this._scanCheckinKeys(ctx);
          if (allKeys.length === 0) {
            await sendReply('暂无签到数据，发送"签到"成为第一名！', [backRow()]);
            return;
          }
          var ranked = allKeys.sort(function(a, b) { return b.total - a.total; }).slice(0, 10);
          var txt = '积分排行榜 TOP' + ranked.length + '：';
          for (var i = 0; i < ranked.length; i++) {
            var showName = this._displayName(ctx, ranked[i].uid);
            txt += '\n' + (i + 1) + '. ' + showName + ' | ' + ranked[i].total + '分';
          }
          await sendReply(txt, [backRow()]);
          return;
        }
      } catch (e) {
        ctx.logger.error('签到系统错误: ' + e.message);
      }
    },

    _displayName: function(ctx, openid) {
      var qq = '';
      try {
        if (ctx.engine && ctx.engine.identity && ctx.engine.identity.getQQ) qq = ctx.engine.identity.getQQ(openid) || '';
        else if (ctx.engine && ctx.engine.getUserProfile) {
          var p = ctx.engine.getUserProfile(openid);
          qq = (p && p.qq) || '';
        }
      } catch (e) {}
      if (qq) return 'QQ:' + qq;
      return 'UID:' + String(openid).substring(0, 8) + '...';
    },

    _scanCheckinKeys: function(ctx) {
      if (!ctx._checkinUsers) ctx._checkinUsers = [];
      var users = ctx._checkinUsers;
      var result = [];
      for (var i = 0; i < users.length; i++) {
        var uid = users[i];
        var total = parseInt(ctx.storage.get('checkin_' + uid + '_total') || '0', 10);
        if (total > 0) result.push({ uid: uid, total: total });
      }
      return result;
    },
  },

  onEnable: function(ctx) {
    if (!ctx._checkinUsers) ctx._checkinUsers = [];
    ctx.logger.info('签到系统已加载 v2.1.0');
  },
};
