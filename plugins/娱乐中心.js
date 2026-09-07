// 娱乐中心 v3.0.0 - 完整娱乐功能
// ReplySpec 回复可视化：内置模板可被后台 config plugin.file-娱乐中心.reply 覆盖；渲染优先+原文兜底
/*__REPLY_SPEC_BEGIN__*/
var REPLY_SPEC = {
  name: '娱乐中心',
  version: '3.0.0',
  desc: '今日运势/骰子/猜拳/选择/随机数/吃什么/人品/仙逆/抽老婆老公/扫雷/木鱼/农场/钓鱼/笑话/猜数字 等功能的纯文本回复模板；按钮与主菜单渲染路径不动',
  branches: [
    {
      key: 'fortune', label: '今日运势/运势（结果）', scope: ['group'], triggers: ['今日运势', '运势'],
      lines: [
        { "t": "text", "v": "🔮 今日运势" },
        { "t": "text", "v": "{fortune}" }
      ]
    },
    {
      key: 'dice', label: '掷骰子（单颗骰）', scope: ['group'], triggers: ['掷骰子', '掷骰子 1d6'],
      lines: [
        { "t": "text", "v": "🎲 掷出了 {point} 点" }
      ]
    },
    {
      key: 'diceMulti', label: '掷骰子（多颗骰）', scope: ['group'], triggers: ['掷骰子 2d6'],
      lines: [
        { "t": "text", "v": "🎲 掷骰结果" },
        { "t": "text", "v": "{rolls} = {point}" }
      ]
    },
    {
      key: 'rpsHelp', label: '猜拳（空参/参数无效帮助）', scope: ['group'], triggers: ['猜拳'],
      lines: [
        { "t": "text", "v": "✊ 猜拳" },
        { "t": "text", "v": "请发送：猜拳 石头/剪刀/布" }
      ]
    },
    {
      key: 'rps', label: '猜拳（结果）', scope: ['group'], triggers: ['猜拳 x'],
      lines: [
        { "t": "text", "v": "✊ 猜拳" },
        { "t": "text", "v": "你出：{you}" },
        { "t": "text", "v": "🤖 我出：{bot}" },
        { "t": "text", "v": "{result}" }
      ]
    },
    {
      key: 'chooseHelp', label: '随机选择（选项不足帮助）', scope: ['group'], triggers: ['选择'],
      lines: [
        { "t": "text", "v": "🎯 随机选择" },
        { "t": "text", "v": "格式：选择 选项1 选项2 选项3..." }
      ]
    },
    {
      key: 'choose', label: '随机选择（结果）', scope: ['group'], triggers: ['选择 x'],
      lines: [
        { "t": "text", "v": "🎯 随机选择结果" },
        { "t": "text", "v": "📌 {option}" },
        { "t": "blank" },
        { "t": "text", "v": "从 {count} 个选项中随机选出！" }
      ]
    },
    {
      key: 'random', label: '随机数（结果）', scope: ['group'], triggers: ['随机数'],
      lines: [
        { "t": "text", "v": "🔢 随机数" },
        { "t": "text", "v": "范围：{min} ~ {max}" },
        { "t": "text", "v": "结果：{num}" }
      ]
    },
    {
      key: 'food', label: '今天吃什么（结果）', scope: ['group'], triggers: ['今天吃什么'],
      lines: [
        { "t": "text", "v": "🍽 今天吃什么？" },
        { "t": "text", "v": "推荐：{food}" },
        { "t": "blank" },
        { "t": "text", "v": "快去吃吧！" }
      ]
    },
    {
      key: 'karma', label: '今日人品（结果）', scope: ['group'], triggers: ['今日人品'],
      lines: [
        { "t": "text", "v": "👤 今日人品值" },
        { "t": "text", "v": "分数：{score}/100" },
        { "t": "text", "v": "评价：{level}" }
      ]
    },
    {
      key: 'xianni', label: '仙逆（修炼结果）', scope: ['group'], triggers: ['仙逆'],
      lines: [
        { "t": "text", "v": "🧘 仙逆修炼" },
        { "t": "text", "v": "境界：{realm} (Lv.{realmLv})" },
        { "t": "text", "v": "经验：{exp}/{maxExp}" },
        { "t": "text", "v": "灵石：{stones}" },
        { "t": "text", "v": "修炼次数：{times}" },
        { "t": "blank" },
        { "t": "text", "v": "获得经验：+{expGain} 灵石：+{stoneGain}" }
      ]
    },
    {
      key: 'spouse', label: '抽老婆/抽老公（结果）', scope: ['group'], triggers: ['抽老婆', '抽老公'],
      lines: [
        { "t": "text", "v": "💕 今日{spouse}" },
        { "t": "text", "v": "你的{spouse}是：{name}！" },
        { "t": "text", "v": "💑 要好好珍惜哦~" }
      ]
    },
    {
      key: 'msActive', label: '扫雷（游戏进行中提示）', scope: ['group'], triggers: ['扫雷'],
      lines: [
        { "t": "text", "v": "💣 扫雷游戏正在进行中！" },
        { "t": "text", "v": "发送\"扫雷 1,1\" 翻开格子" }
      ]
    },
    {
      key: 'msStart', label: '扫雷（开始）', scope: ['group'], triggers: ['扫雷'],
      lines: [
        { "t": "text", "v": "💣 扫雷游戏开始！" },
        { "t": "text", "v": "{size}x{size} 共{mines}颗雷" },
        { "t": "text", "v": "发送\"扫雷 行,列\"翻开格子" }
      ]
    },
    {
      key: 'msNone', label: '扫雷（无进行中游戏）', scope: ['group'], triggers: ['扫雷 x'],
      lines: [
        { "t": "text", "v": "💣 没有进行中的游戏，发送\"扫雷\"开始" }
      ]
    },
    {
      key: 'msFormat', label: '扫雷（坐标格式错误）', scope: ['group'], triggers: ['扫雷 x'],
      lines: [
        { "t": "text", "v": "格式：扫雷 行,列" },
        { "t": "text", "v": "例如：扫雷 1,1" }
      ]
    },
    {
      key: 'msRange', label: '扫雷（位置越界）', scope: ['group'], triggers: ['扫雷 x'],
      lines: [
        { "t": "text", "v": "位置超出范围！" }
      ]
    },
    {
      key: 'msOpened', label: '扫雷（已翻开提示）', scope: ['group'], triggers: ['扫雷 x'],
      lines: [
        { "t": "text", "v": "这个格子已经翻开了！" }
      ]
    },
    {
      key: 'msBoom', label: '扫雷（踩雷结束）', scope: ['group'], triggers: ['扫雷 x'],
      lines: [
        { "t": "text", "v": "💥 踩到地雷！游戏结束！" }
      ]
    },
    {
      key: 'msWin', label: '扫雷（胜利）', scope: ['group'], triggers: ['扫雷 x'],
      lines: [
        { "t": "text", "v": "🎉 恭喜你赢了！所有安全格子已翻开！" }
      ]
    },
    {
      key: 'msNext', label: '扫雷（继续·安全格进度）', scope: ['group'], triggers: ['扫雷 x'],
      lines: [
        { "t": "text", "v": "继续扫雷！已翻开 {revealed}/{total} 个安全格子" }
      ]
    },
    {
      key: 'muyu', label: '敲木鱼（结果）', scope: ['group'], triggers: ['敲木鱼'],
      lines: [
        { "t": "text", "v": "🙏 敲木鱼" },
        { "t": "text", "v": "{phrase} (+{gain}功德)" },
        { "t": "text", "v": "总功德：{merit}" },
        { "t": "text", "v": "敲击次数：{count}" }
      ]
    },
    {
      key: 'farmPlant', label: '开心农场（种下）', scope: ['group'], triggers: ['开心农场'],
      lines: [
        { "t": "text", "v": "🌾 开心农场" },
        { "t": "text", "v": "你种下了 {crop}！" },
        { "t": "text", "v": "等待10秒收获..." }
      ]
    },
    {
      key: 'farmWait', label: '开心农场（生长中）', scope: ['group'], triggers: ['开心农场'],
      lines: [
        { "t": "text", "v": "🌾 作物还在生长中..." },
        { "t": "text", "v": "还需 {wait} 秒" }
      ]
    },
    {
      key: 'farmHarvest', label: '开心农场（收获）', scope: ['group'], triggers: ['开心农场'],
      lines: [
        { "t": "text", "v": "🌾 收获成功！" },
        { "t": "text", "v": "获得 {gain} 金币！" },
        { "t": "text", "v": "当前金币：{coins}" },
        { "t": "text", "v": "已种植：{times} 次" }
      ]
    },
    {
      key: 'fish', label: '去钓鱼（结果）', scope: ['group'], triggers: ['去钓鱼'],
      lines: [
        { "t": "text", "v": "🎣 去钓鱼" },
        { "t": "text", "v": "钓到了：{fish}" },
        { "t": "text", "v": "卖了 {value} 金币！" },
        { "t": "text", "v": "总金币：{coins}" },
        { "t": "text", "v": "总收获：{count} 条" }
      ]
    },
    {
      key: 'joke', label: '笑话/讲笑话（结果）', scope: ['group'], triggers: ['笑话', '讲笑话'],
      lines: [
        { "t": "text", "v": "😄 讲笑话" },
        { "t": "text", "v": "━━━━━━━━━━" },
        { "t": "text", "v": "{joke}" }
      ]
    },
    {
      key: 'guessStart', label: '猜数字（新局开始）', scope: ['group'], triggers: ['猜数字'],
      lines: [
        { "t": "text", "v": "🎯 猜数字游戏" },
        { "t": "text", "v": "我已经想好一个 1-100 之间的数字！" },
        { "t": "text", "v": "发送\"猜数字 数字\"开始猜吧！" },
        { "t": "text", "v": "例：猜数字 50" }
      ]
    },
    {
      key: 'guessOver', label: '猜数字（上局结束·再来一局）', scope: ['group'], triggers: ['猜数字'],
      lines: [
        { "t": "text", "v": "🎯 上一局答案：{answer}" },
        { "t": "text", "v": "发送\"猜数字 数字\"或点击按钮再来一局" }
      ]
    },
    {
      key: 'guessPlaying', label: '猜数字（进行中状态）', scope: ['group'], triggers: ['猜数字'],
      lines: [
        { "t": "text", "v": "🎯 猜数字进行中" },
        { "t": "text", "v": "目标在 1-100 之间，已猜 {tries} 次" },
        { "t": "text", "v": "发送\"猜数字 数字\"继续！" }
      ]
    },
    {
      key: 'guessInvalid', label: '猜数字（非法输入）', scope: ['group'], triggers: ['猜数字 x'],
      lines: [
        { "t": "text", "v": "❌ 请输入 1-100 之间的整数" },
        { "t": "text", "v": "例：猜数字 50" }
      ]
    },
    {
      key: 'guessWin', label: '猜数字（猜中）', scope: ['group'], triggers: ['猜数字 x'],
      lines: [
        { "t": "text", "v": "🎉 恭喜猜中！答案就是 {answer}" },
        { "t": "text", "v": "你一共猜了 {tries} 次！" }
      ]
    },
    {
      key: 'guessHint', label: '猜数字（大小提示）', scope: ['group'], triggers: ['猜数字 x'],
      lines: [
        { "t": "text", "v": "🎯 猜数字" },
        { "t": "text", "v": "你猜 {guess} → {hint}" },
        { "t": "text", "v": "已猜 {tries} 次，继续发送\"猜数字 数字\"" }
      ]
    },
    {
      key: 'fallback', label: '未知指令', scope: ['group'], triggers: ['其他'],
      lines: [
        { "t": "text", "v": "❓ 未知指令" },
        { "t": "text", "v": "发送\"娱乐功能\"查看所有娱乐项目" }
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

// ===== ReplySpec 生效规格（config 覆盖内置模板），onEnable 装载后 handleCommand 内渲染 =====
var _curSpec = REPLY_SPEC;
var _curLink = _rsMq;
function _loadReplySpec(ctx) {
  try {
    var raw = (ctx.engine && ctx.engine.getConfigValue) ? ctx.engine.getConfigValue('plugin.file-娱乐中心.reply') : null;
    if (raw) {
      var parsed = JSON.parse(String(raw));
      if (parsed && Array.isArray(parsed.branches) && parsed.branches.length) _curSpec = parsed;
    }
  } catch (e) { ctx.logger.warn('娱乐中心 ReplySpec config 解析失败，使用内置模板: ' + String(e && e.message || e)); }
  _curLink = function(t, c) { return (ctx.link && ctx.link.linkify) ? ctx.link.linkify(t, c) : _rsMq(t, c); };
}

module.exports = {
  manifest: {
    id: 'mod-entertainment',
    name: '娱乐中心',
    version: '3.0.0',
    description: '今日运势/掷骰子/猜拳/选择/随机数/今天吃什么/今日人品/仙逆/抽CP/扫雷/敲木鱼/开心农场/去钓鱼',
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
          return { id: '娱乐功能', render_data: { label: '🎮 返回娱乐', visited_label: '返回娱乐', style: 0 }, action: { type: 2, data: '娱乐功能', enter: true, permission: { type: 2 } } };
        };
        var backRow = function() { return [backBtn()]; };

        var sendReply = async function(text, buttons) {
          try {
            await ctx.engine.callPlugin('主菜单', 'sendMessage', groupId, userId, msgId, text, buttons);
          } catch(e) {
            await ctx.bot.sendGroupMessage(groupId, text + '\n发送"娱乐功能"返回', msgId);
          }
        };

        // ===== ReplySpec 渲染 helper（baseData 键集同群主.js；动态值经 extra 注入，render 空时回落原文兜底）=====
        function baseData(msg) {
          var a = msg.author || {};
          var botId = msg.botId || '';
          var bName = (ctx.engine && ctx.engine.getBotNameById) ? (ctx.engine.getBotNameById(botId) || '') : '';
          return {
            botId: botId,
            botName: bName,
            botShow: (bName && bName !== botId) ? bName + '（' + botId + '）' : botId,
            gid: msg.groupId || '',
            openid: (a && (a.openid || a.id)) || msg.member_openid || '',
            qq: (a && a.qqId) || '',
            nick: (a && a.username) || ''
          };
        }
        function render(key, msg, extra) {
          var bd = baseData(msg);
          var d = {};
          for (var k in bd) if (Object.prototype.hasOwnProperty.call(bd, k)) d[k] = bd[k];
          if (extra) for (var e in extra) if (Object.prototype.hasOwnProperty.call(extra, e)) d[e] = extra[e];
          return rsRender(key, d, _curSpec, _curLink);
        }

        // ===== 今日运势 =====
        if (content === '今日运势' || content === '运势') {
          var fortunes = [
            '🌟 大吉大利！今天你是最幸运的人！\n事事顺心，有意外惊喜！',
            '🍀 吉星高照！今天运势不错，\n适合做重要决定，有望达成目标。',
            '🌤 平平稳稳！保持乐观心态，\n按部就班一切都会好起来的。',
            '🌧 小凶！不宜做重大决定，\n注意人际关系，谨防口舌之争。',
            '💰 财运亨通！今天适合投资理财，\n可能会有意外收入！',
            '💕 桃花运旺！今天适合社交，\n有机会结识新的朋友！',
            '💼 事业运佳！今天工作顺利，\n可能得到上司赏识！'
          ];
          var idx = Math.floor(Math.random() * fortunes.length);
          await sendReply(render('fortune', data, { fortune: fortunes[idx] }) || ('🔮 今日运势\n' + fortunes[idx]), [backRow()]);
          return;
        }

        // ===== 掷骰子 =====
        if (content === '掷骰子' || content.indexOf('掷骰子 ') === 0) {
          var parts = content.split(/\s+/);
          var num = 1, faces = 6;
          if (parts.length >= 2) {
            var match = parts[1].match(/^(\d*)d(\d+)$/);
            if (match) {
              num = parseInt(match[1]) || 1;
              faces = parseInt(match[2]);
              if (num > 10) num = 10;
              if (faces > 100) faces = 100;
              if (faces < 2) faces = 2;
            }
          }
          var results = [];
          var total = 0;
          for (var i = 0; i < num; i++) {
            var roll = Math.floor(Math.random() * faces) + 1;
            results.push(roll);
            total += roll;
          }
          var resultText = '🎲 掷骰结果\n' + results.join(' + ') + ' = ' + total;
          if (num === 1) resultText = '🎲 掷出了 ' + total + ' 点';
          if (num === 1) {
            await sendReply(render('dice', data, { point: total }) || ('🎲 掷出了 ' + total + ' 点'), [backRow()]);
          } else {
            await sendReply(render('diceMulti', data, { rolls: results.join(' + '), point: total }) || resultText, [backRow()]);
          }
          return;
        }

        // ===== 猜拳 =====
        if (content === '猜拳' || content.indexOf('猜拳 ') === 0) {
          var parts = content.split(/\s+/);
          var choices = ['石头', '剪刀', '布'];
          var userChoice = parts.length >= 2 ? parts[1] : '';
          if (['石头', '剪刀', '布'].indexOf(userChoice) === -1) {
            await sendReply(render('rpsHelp', data) || '✊ 猜拳\n请发送：猜拳 石头/剪刀/布', [backRow()]);
            return;
          }
          var botChoice = choices[Math.floor(Math.random() * 3)];
          var result = '';
          if (userChoice === botChoice) result = '🤝 平局！';
          else if ((userChoice === '石头' && botChoice === '剪刀') ||
                   (userChoice === '剪刀' && botChoice === '布') ||
                   (userChoice === '布' && botChoice === '石头')) {
            result = '🎉 你赢了！';
          } else {
            result = '😅 你输了！';
          }
          await sendReply(render('rps', data, { you: userChoice, bot: botChoice, result: result }) || ('✊ 猜拳\n你出：' + userChoice + '\n🤖 我出：' + botChoice + '\n' + result), [backRow()]);
          return;
        }

        // ===== 选择 =====
        if (content === '选择' || content.indexOf('选择 ') === 0) {
          var parts = content.split(/\s+/);
          if (parts.length < 3) {
            await sendReply(render('chooseHelp', data) || '🎯 随机选择\n格式：选择 选项1 选项2 选项3...', [backRow()]);
            return;
          }
          var options = parts.slice(1);
          var chosen = options[Math.floor(Math.random() * options.length)];
          await sendReply(render('choose', data, { option: chosen, count: options.length }) || ('🎯 随机选择结果\n📌 ' + chosen + '\n\n从 ' + options.length + ' 个选项中随机选出！'), [backRow()]);
          return;
        }

        // ===== 随机数 =====
        if (content === '随机数' || content.indexOf('随机数 ') === 0) {
          var parts = content.split(/\s+/);
          var min = 1, max = 100;
          if (parts.length >= 3) {
            min = parseInt(parts[1]) || 1;
            max = parseInt(parts[2]) || 100;
          }
          if (min > max) { var tmp = min; min = max; max = tmp; }
          var num = Math.floor(Math.random() * (max - min + 1)) + min;
          await sendReply(render('random', data, { min: min, max: max, num: num }) || ('🔢 随机数\n范围：' + min + ' ~ ' + max + '\n结果：' + num), [backRow()]);
          return;
        }

        // ===== 今天吃什么 =====
        if (content === '今天吃什么') {
          var foods = [
            '🍜 兰州拉面', '🍱 日式便当', '🥘 麻辣火锅',
            '🍣 寿司拼盘', '🍝 意大利面', '🥩 牛排套餐',
            '🍲 砂锅粥', '🌮 墨西哥卷饼', '🍛 咖喱饭',
            '🥗 沙拉轻食', '🍔 汉堡薯条', '🍕 披萨',
            '🥟 饺子', '🍚 盖浇饭', '🍜 酸辣粉'
          ];
          var choice = foods[Math.floor(Math.random() * foods.length)];
          await sendReply(render('food', data, { food: choice }) || ('🍽 今天吃什么？\n推荐：' + choice + '\n\n快去吃吧！'), [backRow()]);
          return;
        }

        // ===== 今日人品 =====
        if (content === '今日人品') {
          var score = Math.floor(Math.random() * 101);
          var level = '';
          if (score >= 90) level = '🌟 人品爆棚！';
          else if (score >= 70) level = '👍 人品不错！';
          else if (score >= 50) level = '😊 人品一般般~';
          else if (score >= 30) level = '😅 人品有点低...';
          else level = '💀 人品负数！';
          await sendReply(render('karma', data, { score: score, level: level }) || ('👤 今日人品值\n分数：' + score + '/100\n评价：' + level), [backRow()]);
          return;
        }

        // ===== 仙逆 =====
        if (content === '仙逆') {
          if (!ctx._xianni) ctx._xianni = {};
          if (!ctx._xianni[userId]) {
            ctx._xianni[userId] = {
              realm: '凡人',
              realmLevel: 0,
              exp: 0,
              maxExp: 100,
              spiritStones: 0,
              cultivationCount: 0
            };
          }
          var player = ctx._xianni[userId];
          var realms = ['凡人', '炼气期', '筑基期', '金丹期', '元婴期', '化神期', '合体期', '渡劫期', '大乘期', '真仙'];
          var expGain = Math.floor(Math.random() * 30) + 10;
          var spiritGain = Math.floor(Math.random() * 10) + 1;
          player.exp += expGain;
          player.spiritStones += spiritGain;
          player.cultivationCount++;
          while (player.exp >= player.maxExp) {
            player.exp -= player.maxExp;
            player.realmLevel++;
            if (player.realmLevel >= realms.length) player.realmLevel = realms.length - 1;
            player.realm = realms[player.realmLevel];
            player.maxExp = Math.floor(player.maxExp * 1.5);
          }
          var msg = '🧘 仙逆修炼\n' +
            '境界：' + player.realm + ' (Lv.' + (player.realmLevel + 1) + ')\n' +
            '经验：' + player.exp + '/' + player.maxExp + '\n' +
            '灵石：' + player.spiritStones + '\n' +
            '修炼次数：' + player.cultivationCount + '\n\n' +
            '获得经验：+' + expGain + ' 灵石：+' + spiritGain;
          await sendReply(render('xianni', data, {
            realm: player.realm,
            realmLv: player.realmLevel + 1,
            exp: player.exp,
            maxExp: player.maxExp,
            stones: player.spiritStones,
            times: player.cultivationCount,
            expGain: expGain,
            stoneGain: spiritGain
          }) || msg, [backRow()]);
          return;
        }

        // ===== 抽老婆/抽老公 =====
        if (content === '抽老婆' || content === '抽老公') {
          var isWife = content === '抽老婆';
          var names = ['小可爱', '甜甜', '萌萌', '小仙女', '小天使', '小幸运', '小美好', '小确幸', '小温暖', '小幸福'];
          if (!isWife) {
            names = ['帅帅', '酷酷', '暖暖', '小哥哥', '小王子', '小骑士', '小英雄', '小男神', '小太阳', '小暖男'];
          }
          var name = names[Math.floor(Math.random() * names.length)];
          var cp = '💕 今日' + (isWife ? '老婆' : '老公') + '\n' +
            '你的' + (isWife ? '老婆' : '老公') + '是：' + name + '！\n' +
            '💑 要好好珍惜哦~';
          await sendReply(render('spouse', data, { spouse: isWife ? '老婆' : '老公', name: name }) || cp, [backRow()]);
          return;
        }

        // ===== 扫雷 =====
        if (content === '扫雷') {
          if (!ctx._minesweeper) ctx._minesweeper = {};
          if (!ctx._minesweeper[groupId]) {
            ctx._minesweeper[groupId] = {
              active: false,
              grid: [],
              revealed: [],
              mines: [],
              size: 8,
              mineCount: 10
            };
          }
          var game = ctx._minesweeper[groupId];
          if (game.active) {
            await sendReply(render('msActive', data) || '💣 扫雷游戏正在进行中！\n发送"扫雷 1,1" 翻开格子', [backRow()]);
            return;
          }
          // 初始化游戏
          game.size = 8;
          game.mineCount = 10;
          game.grid = [];
          game.revealed = [];
          game.mines = [];
          for (var i = 0; i < game.size; i++) {
            game.grid[i] = [];
            game.revealed[i] = [];
            for (var j = 0; j < game.size; j++) {
              game.grid[i][j] = 0;
              game.revealed[i][j] = false;
            }
          }
          // 布雷
          var placed = 0;
          while (placed < game.mineCount) {
            var r = Math.floor(Math.random() * game.size);
            var c = Math.floor(Math.random() * game.size);
            if (game.grid[r][c] !== -1) {
              game.grid[r][c] = -1;
              placed++;
            }
          }
          // 计算数字
          for (var r2 = 0; r2 < game.size; r2++) {
            for (var c2 = 0; c2 < game.size; c2++) {
              if (game.grid[r2][c2] === -1) continue;
              var count = 0;
              for (var dr = -1; dr <= 1; dr++) {
                for (var dc = -1; dc <= 1; dc++) {
                  if (dr === 0 && dc === 0) continue;
                  var nr = r2 + dr, nc = c2 + dc;
                  if (nr >= 0 && nr < game.size && nc >= 0 && nc < game.size && game.grid[nr][nc] === -1) count++;
                }
              }
              game.grid[r2][c2] = count;
            }
          }
          game.active = true;
          var display = '💣 扫雷游戏开始！\n' + game.size + 'x' + game.size + ' 共' + game.mineCount + '颗雷\n发送"扫雷 行,列"翻开格子';
          await sendReply(render('msStart', data, { size: game.size, mines: game.mineCount }) || display, [backRow()]);
          return;
        }
        if (content.indexOf('扫雷 ') === 0) {
          var game2 = ctx._minesweeper && ctx._minesweeper[groupId];
          if (!game2 || !game2.active) {
            await sendReply(render('msNone', data) || '💣 没有进行中的游戏，发送"扫雷"开始', [backRow()]);
            return;
          }
          var parts2 = content.split(/\s+/);
          var coords = parts2[1].split(',');
          if (coords.length !== 2) {
            await sendReply(render('msFormat', data) || '格式：扫雷 行,列\n例如：扫雷 1,1', [backRow()]);
            return;
          }
          var r3 = parseInt(coords[0]) - 1;
          var c3 = parseInt(coords[1]) - 1;
          if (r3 < 0 || r3 >= game2.size || c3 < 0 || c3 >= game2.size) {
            await sendReply(render('msRange', data) || '位置超出范围！', [backRow()]);
            return;
          }
          if (game2.revealed[r3][c3]) {
            await sendReply(render('msOpened', data) || '这个格子已经翻开了！', [backRow()]);
            return;
          }
          if (game2.grid[r3][c3] === -1) {
            game2.active = false;
            await sendReply(render('msBoom', data) || '💥 踩到地雷！游戏结束！', [backRow()]);
            return;
          }
          // 展开
          function reveal(r, c) {
            if (r < 0 || r >= game2.size || c < 0 || c >= game2.size || game2.revealed[r][c]) return;
            if (game2.grid[r][c] === -1) return;
            game2.revealed[r][c] = true;
            if (game2.grid[r][c] === 0) {
              for (var dr2 = -1; dr2 <= 1; dr2++) {
                for (var dc2 = -1; dc2 <= 1; dc2++) {
                  if (dr2 === 0 && dc2 === 0) continue;
                  reveal(r + dr2, c + dc2);
                }
              }
            }
          }
          reveal(r3, c3);
          // 检查胜利
          var revealedCount = 0;
          for (var r4 = 0; r4 < game2.size; r4++) {
            for (var c4 = 0; c4 < game2.size; c4++) {
              if (game2.revealed[r4][c4]) revealedCount++;
            }
          }
          var totalCells = game2.size * game2.size;
          if (revealedCount === totalCells - game2.mineCount) {
            game2.active = false;
            await sendReply(render('msWin', data) || '🎉 恭喜你赢了！所有安全格子已翻开！', [backRow()]);
            return;
          }
          await sendReply(render('msNext', data, { revealed: revealedCount, total: totalCells - game2.mineCount }) || ('继续扫雷！已翻开 ' + revealedCount + '/' + (totalCells - game2.mineCount) + ' 个安全格子'), [backRow()]);
          return;
        }

        // ===== 敲木鱼 =====
        if (content === '敲木鱼') {
          if (!ctx._muyu) ctx._muyu = {};
          if (!ctx._muyu[userId]) {
            ctx._muyu[userId] = { merit: 0, count: 0 };
          }
          var muyu = ctx._muyu[userId];
          var gain = Math.floor(Math.random() * 3) + 1;
          muyu.merit += gain;
          muyu.count++;
          var responses = ['功德+1', '善哉善哉', '阿弥陀佛', '福报+1', '善心+1'];
          var res = responses[Math.floor(Math.random() * responses.length)];
          await sendReply(render('muyu', data, { phrase: res, gain: gain, merit: muyu.merit, count: muyu.count }) || ('🙏 敲木鱼\n' + res + ' (+' + gain + '功德)\n总功德：' + muyu.merit + '\n敲击次数：' + muyu.count), [backRow()]);
          return;
        }

        // ===== 开心农场 =====
        if (content === '开心农场') {
          var farmKey = 'farm_' + userId;
          var farmStr = (ctx.storage && ctx.storage.get) ? ctx.storage.get(farmKey) : null;
          var farm = null;
          try { farm = farmStr ? JSON.parse(farmStr) : null; } catch (e) { farm = null; }
          if (!farm && ctx._farm && ctx._farm[userId]) farm = ctx._farm[userId];
          if (!farm) {
            farm = {
              coins: 100,
              crops: [],
              planted: false,
              plantTime: 0,
              cropType: ''
            };
          }
          var saveFarm = function() { try { if (ctx.storage && ctx.storage.set) ctx.storage.set(farmKey, JSON.stringify(farm)); } catch (e) {} };
          var crops = ['🌾 小麦', '🌽 玉米', '🍎 苹果', '🍇 葡萄', '🍓 草莓', '🥕 胡萝卜'];
          if (!farm.planted) {
            var crop = crops[Math.floor(Math.random() * crops.length)];
            farm.cropType = crop;
            farm.planted = true;
            farm.plantTime = Date.now();
            saveFarm();
            await sendReply(render('farmPlant', data, { crop: crop }) || ('🌾 开心农场\n你种下了 ' + crop + '！\n等待10秒收获...'), [backRow()]);
            return;
          }
          var elapsed = (Date.now() - farm.plantTime) / 1000;
          if (elapsed < 10) {
            await sendReply(render('farmWait', data, { wait: Math.ceil(10 - elapsed) }) || ('🌾 作物还在生长中...\n还需 ' + Math.ceil(10 - elapsed) + ' 秒'), [backRow()]);
            return;
          }
          var harvest = Math.floor(Math.random() * 30) + 20;
          farm.coins += harvest;
          farm.planted = false;
          farm.crops.push(farm.cropType);
          saveFarm();
          await sendReply(render('farmHarvest', data, { gain: harvest, coins: farm.coins, times: farm.crops.length }) || ('🌾 收获成功！\n获得 ' + harvest + ' 金币！\n当前金币：' + farm.coins + '\n已种植：' + farm.crops.length + ' 次'), [backRow()]);
          return;
        }

        // ===== 去钓鱼 =====
        if (content === '去钓鱼') {
          var fishKey = 'fish_' + userId;
          var fishStr = (ctx.storage && ctx.storage.get) ? ctx.storage.get(fishKey) : null;
          var fish = null;
          try { fish = fishStr ? JSON.parse(fishStr) : null; } catch (e) { fish = null; }
          if (!fish && ctx._fish && ctx._fish[userId]) fish = ctx._fish[userId];
          if (!fish) {
            fish = { coins: 0, catches: 0, lastFish: '' };
          }
          var fishList = [
            '🐟 鲫鱼', '🐠 鲤鱼', '🐡 河豚', '🐟 草鱼',
            '🐠 鲈鱼', '🐟 鳕鱼', '🐡 金鱼', '🐠 热带鱼',
            '🎣 大鱼！', '🐟 小鱼'
          ];
          var result = fishList[Math.floor(Math.random() * fishList.length)];
          var value = Math.floor(Math.random() * 20) + 5;
          fish.coins += value;
          fish.catches++;
          fish.lastFish = result;
          try { if (ctx.storage && ctx.storage.set) ctx.storage.set(fishKey, JSON.stringify(fish)); } catch (e) {}
          var msg = '🎣 去钓鱼\n钓到了：' + result + '\n卖了 ' + value + ' 金币！\n总金币：' + fish.coins + '\n总收获：' + fish.catches + ' 条';
          await sendReply(render('fish', data, { fish: result, value: value, coins: fish.coins, count: fish.catches }) || msg, [backRow()]);
          return;
        }

        // ===== 讲笑话 =====
        if (content === '笑话' || content === '讲笑话') {
          var jokes = [
            '为什么程序员分不清万圣节和圣诞节？\n因为 Oct 31 == Dec 25。',
            '老板：你有微软的证书吗？\n程序员：没有。\n老板：那你怎么写代码？\n程序员：我用电脑写。',
            '一天，0和8在街上相遇，0不屑地看了8一眼说：胖就胖呗，还系什么腰带！',
            '我问我朋友：你为什么老是把"老板"说成"老伴"？\n他说：因为他要陪我一辈子。',
            '数学老师：这次考试，小明得了100分。\n小明：老师，我这次是蒙的！\n老师：那你运气真好，下次再蒙一次。',
            '程序员最讨厌两件事：\n一是写注释，二是别人不写注释。',
            '鱼和熊掌不可兼得，\n但是单身和穷可以。',
            '为什么天空是蓝色的？\n因为海是蓝的，天空是海的镜子！',
            '我有一辆自行车，丢了。\n第二天我又买了一辆，又丢了。\n第三天我又买了一辆，结果骑车的人多了。',
            '当你的对象说"没事"的时候，\n千万不要信，那是大事。'
          ];
          var jk = jokes[Math.floor(Math.random() * jokes.length)];
          await sendReply(render('joke', data, { joke: jk }) || ('😄 讲笑话\n━━━━━━━━━━\n' + jk), [backRow()]);
          return;
        }

        // ===== 猜数字 =====
        if (content === '猜数字' || content.indexOf('猜数字 ') === 0) {
          if (!ctx._guess) ctx._guess = {};
          var guess = ctx._guess[userId];
          var gParts = content.split(/\s+/);
          if (!guess) {
            guess = ctx._guess[userId] = { target: Math.floor(Math.random() * 100) + 1, tries: 0, over: false };
            await sendReply(render('guessStart', data) || '🎯 猜数字游戏\n我已经想好一个 1-100 之间的数字！\n发送"猜数字 数字"开始猜吧！\n例：猜数字 50', [backRow()]);
            return;
          }
          if (gParts.length < 2) {
            if (guess.over) {
              var againBtn = { id: '猜数字', render_data: { label: '🎯 再来一局', visited_label: '再来一局', style: 1 }, action: { type: 2, data: '猜数字', enter: true, permission: { type: 2 } } };
              await sendReply(render('guessOver', data, { answer: guess.target }) || ('🎯 上一局答案：' + guess.target + '\n发送"猜数字 数字"或点击按钮再来一局'), [[againBtn], backRow()]);
            } else {
              await sendReply(render('guessPlaying', data, { tries: guess.tries }) || ('🎯 猜数字进行中\n目标在 1-100 之间，已猜 ' + guess.tries + ' 次\n发送"猜数字 数字"继续！'), [backRow()]);
            }
            return;
          }
          var gNum = parseInt(gParts[1]);
          if (isNaN(gNum) || gNum < 1 || gNum > 100) {
            await sendReply(render('guessInvalid', data) || '❌ 请输入 1-100 之间的整数\n例：猜数字 50', [backRow()]);
            return;
          }
          guess.tries++;
          if (gNum === guess.target) {
            var greatBtn = { id: '猜数字', render_data: { label: '🎯 再来一局', visited_label: '再来一局', style: 1 }, action: { type: 2, data: '猜数字', enter: true, permission: { type: 2 } } };
            await sendReply(render('guessWin', data, { answer: guess.target, tries: guess.tries }) || ('🎉 恭喜猜中！答案就是 ' + guess.target + '\n你一共猜了 ' + guess.tries + ' 次！'), [[greatBtn], backRow()]);
            delete ctx._guess[userId];
            return;
          }
          var hint = gNum < guess.target ? '小了，往大猜！' : '大了，往小猜！';
          await sendReply(render('guessHint', data, { guess: gNum, hint: hint, tries: guess.tries }) || ('🎯 猜数字\n你猜 ' + gNum + ' → ' + hint + '\n已猜 ' + guess.tries + ' 次，继续发送"猜数字 数字"'), [backRow()]);
          return;
        }

        await sendReply(render('fallback', data) || '❓ 未知指令\n发送"娱乐功能"查看所有娱乐项目', [backRow()]);
      } catch(e) {
        ctx.logger.error('娱乐中心错误: ' + e.message);
      }
    }
  },

  onEnable: function(ctx) {
    ctx.logger.info('娱乐中心 v3.0.0 已加载');
    _loadReplySpec(ctx);
  }
};