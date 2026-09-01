// 讲笑话 v1.0.1 - 讲笑话语音版：发送「来段笑话 / 讲个笑话 / 讲个段子 / 来段段子 / 语音笑话 / 笑话语音」，
// 随机返回内置笑话，并以语音条朗读
// 语音走官方富媒体：内置文本 → TTS（微软 Edge 免费）→ 分片上传（file_type=3）→ msg_type=7 发语音条
// 离线可用：笑话库内置，不依赖外部 API；TTS 失败仅回退纯文本
// v1.0.1: 改为 eventBus 自监听（message.group/message.c2c），普通消息即可触发；
//         指令避开「笑话/讲笑话」单指令（与娱乐中心文本笑话功能区分），专注语音朗读
// @ts-nocheck
const JOKES = [
  '今天去超市买东西，结账时收银员问我要不要袋子，我说不用了，然后她把东西一件一件扔进了我的口袋。',
  '我问我妈：为什么你老是催我找对象？我妈说：我怕你孤独终老。我说：那你可以养只猫陪我啊。我妈：养猫还得花钱买猫粮，你对象可以自己带饭。',
  '在公司加班到很晚，老板路过说：这么晚了还在啊，注意身体。我感动地说：老板放心，我会注意的。老板接着说：别想多了，我是怕你猝死在公司，要赔钱的。',
  '今天在公交车上给一位大爷让座，大爷摆摆手说：不用，我站得住。我说：您这么大岁数了站不稳的。大爷：我今年才四十五，你是嫌我老吗？',
  '女朋友问我：如果我和你妈同时掉进水里，你先救谁？我说：当然是先救你，因为我妈会游泳。她开心地笑了，然后我又说：我妈游泳还是我教的。',
  '去面试，面试官问我有什么特长，我说我跑步特别快。他说：这算什么特长？我说：因为小时候偷吃邻居家的瓜，跑慢了会被狗咬。',
  '医生安慰病人：别担心，你这病是绝症，但你现在还年轻。病人激动地说：医生，你的意思是我还有救？医生：我是说，你还有几十年时间适应这个绝症。',
  '和朋友去吃火锅，点了很多菜。朋友问我：你觉得咱们点这么多，两个人能吃完吗？我看了看他说：你别说话，我先吃完你那半再说。',
  '昨晚睡觉梦见自己中了五百万，高兴得笑醒了。醒来发现枕头湿了一片，不是因为高兴，是因为流口水了。',
  '我问我弟：你怎么老是玩手机，不看书？他说：哥，书是死的，手机是活的。我说：你再贫，我把你的手机也变成死的。',
  '老婆问我：老公，你觉得我胖吗？我赶紧说：不胖不胖，你一点都不胖。她接着说：那为什么我穿以前的衣服都觉得紧？我说：那不是胖，那是衣服缩水了。',
  '在健身房锻炼，教练对我说：你这样练是没用的，动作不对。我说：那怎么练才对？教练说：你要把卡续上，才是对的。',
  '今天买了个手机壳，老板娘说：这壳防水。我说：真的吗？她点点头：真的，水都进不去，你手机在里面也出不来。',
  '过年回家，七大姑问我在外面混得怎么样。我说：还行，月薪过万。她眼睛一亮：那得存了不少钱吧？我说：存了，存在房东那里，每月自动扣。',
  '我：老板，我想涨工资。老板：你来公司多久了？我：三年了。老板：那你知道三年意味着什么吗？我：意味着我有经验了？老板：意味着你刚过试用期，别想了。',
  '去理发店剪头发，理发师问我：想剪什么发型？我说：剪一个能让我变帅的发型。理发师看了看我的脸，沉默了一会儿说：要不我帮你把镜子擦了？',
  '我买了一本《如何致富》的书，回家一看，里面全是白纸。我打电话问客服，客服说：您没看封底吗？上面写着"致富的秘密就是——想得美"。',
  '早上起来照镜子，发现黑眼圈很重。我问镜子：我是不是熬夜熬太多了？镜子说：你不光是熬夜，还胖了，双下巴都出来了。',
  '室友在宿舍吃泡面，我说：你又吃泡面，不健康。他叹了口气：我也想健康，可是我的钱包不允许。我说：那你可以把泡面煮久一点，多煮一分钟更健康。',
  '有一天我问手机：你说，我长得帅吗？手机没理我。我又问：你倒是说话呀？手机终于弹出一条消息：Siri 正在思考如何委婉地告诉你真相。'
];

module.exports = {
  manifest: {
    id: 'mod-joke',
    name: '讲笑话',
    version: '1.0.1',
    description: '讲笑话语音版：来段笑话/讲个笑话/讲个段子/来段段子/语音笑话，随机讲一个内置笑话并以语音条朗读',
    author: '511742399'
  },

  async init() {},

  onEnable: function(ctx) {
    ctx.logger.info('讲笑话 v1.0.1 已加载');
    var self = this;
    ctx.eventBus.on('message.group', async function(data) {
      try { await self.handleMessage(ctx, data); } catch (e) {}
    });
    ctx.eventBus.on('message.c2c', async function(data) {
      try { await self.handleMessage(ctx, data); } catch (e) {}
    });
  },

  // 兼容旧事件驱动（真实环境由 eventBus 派发，此处保留兜底）
  async onEvent(event, ctx) {
    try {
      if (event.eventType !== 'GROUP_AT_MESSAGE_CREATE') return;
      if (event.msgType === 7 || event.msgType === 3 || event.msgType === 8 || event.msgType === 2) return;
      var content = String(event.content || '').trim();
      var m = content.match(/^(来段笑话|讲个笑话|讲个段子|来段段子|语音笑话|笑话语音)\s*[?!？。，,!！.]*$/);
      if (!m) return;
      await this.doJoke(ctx, event.group_openid, event.id);
    } catch(e) {}
  },

  // 普通消息入口（eventBus message.group/c2c）
  handleMessage: async function(ctx, data) {
    try {
      var content = String(data.content || '').replace(/^\s*(?:<@!?[A-Za-z0-9_\-]+>|@\S+)\s*/, '').trim();
      var m = content.match(/^(来段笑话|讲个笑话|讲个段子|来段段子|语音笑话|笑话语音)\s*[?!？。，,!！.]*$/);
      if (!m) return;
      var groupId = data.groupId;
      if (!groupId) return;
      await this.doJoke(ctx, groupId, data.id);
    } catch(e) {}
  },

  doJoke: async function(ctx, groupId, msgId) {
    try {
      var joke = JOKES[Math.floor(Math.random() * JOKES.length)];
      await ctx.bot.sendGroupMessage(groupId, '😄 讲笑话\n━━━━━━━━━━━━━━\n' + joke + '\n━━━━━━━━━━━━━━\n🎤 语音版同步播放中…', msgId);

      var voiceOk = false;
      try {
        var mp3 = await ctx.bot.textToSpeech(joke, 'zh-CN-XiaoxiaoNeural');
        if (mp3 && mp3.length > 1024) {
          var up = await ctx.bot.uploadGroupVoiceBuffer(groupId, mp3, 'joke.mp3');
          if (up && up.file_info) {
            voiceOk = !!(await ctx.bot.sendGroupVoiceMessage(groupId, up.file_info, msgId));
          }
        }
      } catch(e) {}
      if (!voiceOk) {
        try { await ctx.bot.sendGroupMessage(groupId, '⚠️ 语音生成失败，已改为文字版，请查看上方笑话内容。', msgId); } catch(e) {}
      }
    } catch(e) {}
  }
};
