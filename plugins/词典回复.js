module.exports = {
  manifest: {
    id: 'builtin-dict',
    name: '词典回复',
    version: '1.0.0',
    description: '从dict文件读取问答，支持按钮和Markdown回复',
    author: '系统'
  },

  onEnable: function(ctx) {
    var fs = require('fs');
    var path = require('path');

    function loadDict() {
      var dictPath = path.join(__dirname, 'plugins', 'dict.txt');
      var configPath = ctx.config.dictDir;
      if (configPath) dictPath = configPath;
      try {
        var text = fs.readFileSync(dictPath, 'utf8');
        var lines = text.split('\n');
        var dict = {};
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line || line.startsWith('#')) continue;
          var parts = line.split('|');
          if (parts.length >= 2) {
            dict[parts[0].trim()] = parts[1].trim();
          }
        }
        ctx.logger.info('词典加载成功: ' + Object.keys(dict).length + ' 条, 路径: ' + dictPath);
        return dict;
      } catch (e) {
        ctx.logger.error('词典加载失败: ' + e.message);
        return {};
      }
    }

    var dict = loadDict();
    var gameState = { number: 0, active: false };

    function handleGuessing(data) {
      var content = (data.content || '').trim();
      var cleanContent = content.replace(/<@[A-F0-9]+>/g, '').trim();
      var match = cleanContent.match(/^猜\s*(\d+)$/);
      if (!match) return false;
      var guess = parseInt(match[1], 10);
      if (!gameState.active) {
        var replyText = '请先' + ctx.link.linkify('发送「猜数字」', '猜数字') + '开始游戏';
        if (data.groupId) ctx.bot.sendGroupMessage(data.groupId, replyText, data.id);
        else if (data.author && data.author.id) ctx.bot.sendPrivateMessage(data.author.id, replyText, data.id);
        return true;
      }
      if (guess === gameState.number) {
        gameState.active = false;
        var winText = '恭喜你猜对了！数字就是 ' + gameState.number;
        if (data.groupId) ctx.bot.sendGroupMessage(data.groupId, winText, data.id);
        else if (data.author && data.author.id) ctx.bot.sendPrivateMessage(data.author.id, winText, data.id);
      } else if (guess < gameState.number) {
        var lowText = guess + ' 太小了，再大一点！';
        if (data.groupId) ctx.bot.sendGroupMessage(data.groupId, lowText, data.id);
        else if (data.author && data.author.id) ctx.bot.sendPrivateMessage(data.author.id, lowText, data.id);
      } else {
        var highText = guess + ' 太大了，再小一点！';
        if (data.groupId) ctx.bot.sendGroupMessage(data.groupId, highText, data.id);
        else if (data.author && data.author.id) ctx.bot.sendPrivateMessage(data.author.id, highText, data.id);
      }
      return true;
    }

    function handleDict(data) {
      var content = (data.content || '').trim();

      // check guessing game first
      if (handleGuessing(data)) return;

      // strip @mention prefix like <@USERID>
      var cleanContent = content.replace(/<@[A-F0-9]+>/g, '').trim();

      var matched = null;
      // exact match first
      if (dict[cleanContent] !== undefined) {
        matched = dict[cleanContent];
      } else {
        // substring match (longest key first to avoid partial matches)
        var keys = Object.keys(dict).sort(function(a, b) { return b.length - a.length; });
        for (var i = 0; i < keys.length; i++) {
          if (cleanContent.indexOf(keys[i]) !== -1) {
            matched = dict[keys[i]];
            break;
          }
        }
      }
      if (!matched) return;

      // resolve dynamic placeholders
      var gameNumber = Math.floor(Math.random() * 100) + 1;
      if (matched.indexOf('{{number}}') !== -1) {
        gameState.number = gameNumber;
        gameState.active = true;
      }
      var resolved = matched
        .replace(/{{number}}/g, '')
        .replace(/{{time}}/g, new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }))
        .replace(/{{dice}}/g, String(Math.floor(Math.random() * 6) + 1))
        .replace(/{{joke}}/g, (function(){
          var jokes = [
            '为什么Go语言程序员喜欢游泳？因为他们喜欢用channel通信！',
            '程序员为什么不喜欢坐飞机？因为怕掉线！',
            'SQL注入走进了一家酒吧，发现酒吧的服务员对 OR 条件来者不拒',
            '一个函数式程序员走进了一家完全函数式的酒吧，酒吧里什么都没有',
            'Bug就像一个看不见的幽灵，你说不存在，它就出来证明给你看'
          ];
          return jokes[Math.floor(Math.random() * jokes.length)];
        })())
        .replace(/{{fortune}}/g, (function(){
          var fortunes = ['大吉', '中吉', '小吉', '吉', '末吉', '凶', '大凶'];
          var tips = [
            '宜：写代码，忌：重构',
            '宜：提交代码，忌：删库跑路',
            '宜：写文档，忌：摸鱼',
            '宜：Code Review，忌：直接merge',
            '宜：单元测试，忌：跳过测试',
            '宜：早起，忌：熬夜',
            '宜：喝水，忌：久坐'
          ];
          var f = fortunes[Math.floor(Math.random() * fortunes.length)];
          var t = tips[Math.floor(Math.random() * tips.length)];
          return '今日运势：' + f + '\n' + t;
        })());

      // try to parse as JSON for keyboard/markdown/card
      try {
        var parsed = JSON.parse(resolved);
        if (typeof parsed === 'object') {
          handleStructured(data, parsed);
          return;
        }
      } catch (e) {}

      // plain text reply
      if (data.channelId) {
        ctx.bot.sendMessage(data.channelId, resolved, data.id);
      } else if (data.groupId) {
        ctx.bot.sendGroupMessage(data.groupId, resolved, data.id);
      } else if (data.author && data.author.id) {
        ctx.bot.sendPrivateMessage(data.author.id, resolved, data.id);
      }
    }

    function handleStructured(data, config) {
      var type = config.type || 'text';

      if (type === 'keyboard') {
        var headerText = config.content || '';
        var buttonRows = config.buttons || [];
        var items = [];
        for (var r = 0; r < buttonRows.length; r++) {
          for (var b = 0; b < buttonRows[r].length; b++) {
            var bl = String(buttonRows[r][b] || '');
            if (bl) items.push({ label: bl, action: bl });
          }
        }
        items.push({ label: '🏠 返回主菜单', action: '主菜单' });
        if (data.groupId) {
          try {
            ctx.engine.callPlugin('开关机控制', 'sendMenu', ctx, data, { title: '功能菜单', subtitle: headerText, items: items }).catch(function() {});
            return;
          } catch(e) {}
        }
        if (data.groupId) ctx.bot.sendGroupMessage(data.groupId, headerText, data.id);
        else if (data.author && data.author.id) ctx.bot.sendPrivateMessage(data.author.id, headerText, data.id);
        else if (data.channelId) ctx.bot.sendMessage(data.channelId, headerText, data.id);
        return;
      }

      if (type === 'markdown') {
        var mdText = config.content || '';
        if (data.groupId) {
          ctx.bot.sendMarkdownGroup(data.groupId, mdText, void 0, void 0, data.id);
        } else if (data.author && data.author.id) {
          ctx.bot.sendMarkdownPrivate(data.author.id, mdText, void 0, void 0, data.id);
        } else if (data.channelId) {
          ctx.bot.sendMessage(data.channelId, mdText, data.id);
        }
        return;
      }

      var plainText = config.text || config.content || '';
      if (data.groupId) {
        ctx.bot.sendGroupMessage(data.groupId, plainText, data.id);
      } else if (data.author && data.author.id) {
        ctx.bot.sendPrivateMessage(data.author.id, plainText, data.id);
      } else if (data.channelId) {
        ctx.bot.sendMessage(data.channelId, plainText, data.id);
      }
    }

    ctx.eventBus.on('message.guild', handleDict);
    ctx.eventBus.on('message.c2c', handleDict);
    ctx.eventBus.on('message.group', handleDict);

    ctx.logger.info('词典回复插件已启用');
  },

  onDisable: function(ctx) {
    ctx.logger.info('词典回复插件已禁用');
  }
};
