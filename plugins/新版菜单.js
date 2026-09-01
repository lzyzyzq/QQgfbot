// 新版菜单 v1.0.9 - 截图风格多级菜单（按钮回填式），结合现有插件功能
// v1.0.1: 修复沙箱调用 this 失效导致不回复（全部改为闭包，不依赖 this）
// v1.0.2: 新增「插件管理」：群主/群管理 点插件名 → 回填「插件设置 插件名 开/关」→ 发送后对该群启用/禁用插件
// v1.0.3: 群内角色权限支持后台编辑（group_members.role 优先）
// v1.0.5: 主菜单/子菜单改按钮式：功能项点按钮回填输入框（非跳转），作者/赞助保留跳转链接，头像内嵌菜单 markdown 不单独发图
// v1.0.6: 新增「查询中心」子菜单：查询OpenID / 绑定QQ / 绑定QQ群 / 天气查询
// v1.0.7: 新增「画图」「讲笑话」入口及子菜单
// v1.0.8: 修复菜单功能项被子菜单拦截（签到/更新日志/讲笑话点击只弹子菜单不执行）；菜单头部显示真实群号（getGroupNumber）；
//         画图带参指令放行给画图插件；空空管理→雪子管理；王者菜单补充说明；优化路由优先级
// v1.0.9: 修复"当前时间"时区 bug（固定北京时间 UTC+8，任意时区部署均正确）；主菜单新增 报时/菜单模式/文字指令 入口
// v1.1.0: 主菜单新增 菜单面板 入口及子菜单（创建群指令面板/指令面板/设置自定义菜单/查询自定义菜单/定时报时）
module.exports = (function () {
  'use strict';

  // ============ 菜单树（多级） ============
  const MENU = {
    main: {
      title: '🌟 空空 Bot 功能菜单',
      tips: [],
      rows: [
        [{ label: '🔐 免@授权', action: '免@授权' }, { label: '📅 签到', action: '签到' }],
        [{ label: '🎵 听唱歌', action: '听唱歌' }, { label: '🎤 听清唱', action: '听清唱' }, { label: '🐱 哈基米', action: '哈基米' }],
        [{ label: '🎧 点首歌', action: '点首歌' }, { label: '🎶 唱首歌', action: '唱首歌' }, { label: '🎼 我要听', action: '我要听' }],
        { tips: '点首歌-唱首歌-我要听--指令后面需要-加-歌名' },
        [{ label: '💕 今日老婆', action: '今日老婆' }, { label: '🍜 今天吃啥', action: '今天吃啥' }],
        [{ label: '🔑 今日密码', action: '今日密码' }, { label: '📋 更新日志', action: '更新日志' }],
        { tips: '今日密码，是三角洲密码门' },
        [{ label: '🎮 游戏菜单', action: '游戏菜单' }, { label: '⚔️ 王者菜单', action: '王者菜单' }],
        [{ label: '❄️ 雪子管理', action: '雪子管理' }, { label: '💬 反馈菜单', action: '反馈菜单' }],
        [{ label: '🔎 查询中心', action: '查询中心' }],
        [{ label: '🎨 画图', action: '画图' }, { label: '😂 讲笑话', action: '讲笑话' }],
        [{ label: '🕐 报时', action: '报时' }, { label: '🗂 菜单面板', action: '菜单面板' }, { label: '🔀 菜单模式', action: '菜单模式' }],
        [{ label: '📜 文字指令', action: '文字指令' }, { label: '🔌 插件管理', action: '插件管理' }],
        [{ label: '🧪 测试菜单', action: '测试菜单' }],
        { tips: '机器人目前对安卓系统最新版QQ适配度100%，其他系统适配度未知，如有bug请与开发者反馈！' }
      ],
      test: '⚠️测试功能⚠️ '
    },

    // ---- 免@授权（交互：仅群主可操作） ----
    '免@授权': {
      title: '🔐 免@授权',
      tips: ['点击后输入本群群号', '仅群主可操作！'],
      rows: [
        [{ label: '🏠 返回主菜单', action: '主菜单' }]
      ]
    },

    // ---- 签到 ----
    '签到': {
      title: '📅 签到系统',
      tips: [],
      rows: [
        [{ label: '📅 签到', action: '签到' }, { label: '⏪ 补签', action: '补签' }],
        [{ label: '🏆 签到排行', action: '签到排行' }, { label: '💰 积分排行', action: '积分排行' }],
        [{ label: '🏠 返回主菜单', action: '主菜单' }]
      ]
    },

    // ---- 查询中心（OpenID/绑定QQ/绑定QQ群/天气） ----
    '查询中心': {
      title: '🔎 查询中心',
      tips: ['查询OpenID · 绑定QQ · 绑定QQ群 · 天气查询', '绑定QQ：发送「绑定QQ 你的QQ号」', '绑定QQ群：仅群主/管理员可操作'],
      rows: [
        [{ label: '🔎 查询OpenID', action: 'OpenID查询' }, { label: '📱 绑定QQ', action: '绑定QQ' }],
        [{ label: '👥 绑定QQ群', action: '绑定QQ群' }, { label: '🌤 天气查询', action: '天气查询' }],
        [{ label: '🏠 返回主菜单', action: '主菜单' }]
      ]
    },

    // ---- 画图（艺术字主题海报） ----
    '画图': {
      title: '🎨 画图',
      tips: ['发送「画图 内容」生成艺术字主题海报', '支持主题词：蓝色 星空 落日 森林 粉色 火焰…'],
      rows: [
        [{ label: '🎨 画图 山川大海', action: '画图 山川大海' }, { label: '🎨 画图 星空梦想', action: '画图 星空梦想' }],
        [{ label: '🏠 返回主菜单', action: '主菜单' }]
      ]
    },

    // ---- 讲笑话（文本+语音） ----
    '讲笑话': {
      title: '😂 讲笑话',
      tips: ['发送「讲笑话」随机讲一个笑话', '笑话以文字+语音条发送'],
      rows: [
        [{ label: '😂 讲笑话', action: '讲笑话' }, { label: '🏠 返回主菜单', action: '主菜单' }]
      ]
    },

    // ---- 唱歌类 ----
    '听唱歌': {
      title: '🎵 听唱歌',
      tips: ['发送「听唱歌 歌名」让我为你找歌'],
      rows: [
        [{ label: '🎤 听清唱', action: '听清唱' }, { label: '🐱 哈基米', action: '哈基米' }],
        [{ label: '🎧 点首歌', action: '点首歌' }, { label: '🎶 唱首歌', action: '唱首歌' }, { label: '🎼 我要听', action: '我要听' }],
        { tips: '点首歌-唱首歌-我要听--指令后面需要-加-歌名' },
        [{ label: '🏠 返回主菜单', action: '主菜单' }]
      ]
    },
    '听清唱': {
      title: '🎤 听清唱',
      tips: ['发送「听清唱 歌名」欣赏清唱版'],
      rows: [
        [{ label: '🎵 听唱歌', action: '听唱歌' }, { label: '🐱 哈基米', action: '哈基米' }],
        [{ label: '🏠 返回主菜单', action: '主菜单' }]
      ]
    },
    '哈基米': {
      title: '🐱 哈基米',
      tips: ['发送「哈基米」听魔性神曲', '发送「哈基米 歌名」点歌'],
      rows: [
        [{ label: '🎵 听唱歌', action: '听唱歌' }, { label: '🎤 听清唱', action: '听清唱' }],
        [{ label: '🏠 返回主菜单', action: '主菜单' }]
      ]
    },

    // ---- 点歌类 ----
    '点首歌': {
      title: '🎧 点首歌',
      tips: ['发送「点首歌 歌名」即可点歌', '也可：唱首歌 / 我要听 + 歌名'],
      rows: [
        [{ label: '🎶 唱首歌', action: '唱首歌' }, { label: '🎼 我要听', action: '我要听' }],
        [{ label: '🏠 返回主菜单', action: '主菜单' }]
      ]
    },
    '唱首歌': {
      title: '🎶 唱首歌',
      tips: ['发送「唱首歌 歌名」让我唱给你听'],
      rows: [
        [{ label: '🎧 点首歌', action: '点首歌' }, { label: '🎼 我要听', action: '我要听' }],
        [{ label: '🏠 返回主菜单', action: '主菜单' }]
      ]
    },
    '我要听': {
      title: '🎼 我要听',
      tips: ['发送「我要听 歌名」立即播放'],
      rows: [
        [{ label: '🎧 点首歌', action: '点首歌' }, { label: '🎶 唱首歌', action: '唱首歌' }],
        [{ label: '🏠 返回主菜单', action: '主菜单' }]
      ]
    },

    // ---- 娱乐类 ----
    '今日老婆': {
      title: '💕 今日老婆',
      tips: ['每天随机抽取你的今日CP'],
      rows: [
        [{ label: '💕 抽老婆', action: '抽老婆' }, { label: '💘 抽老公', action: '抽老公' }],
        [{ label: '🍜 今天吃啥', action: '今天吃啥' }],
        [{ label: '🏠 返回主菜单', action: '主菜单' }]
      ]
    },
    '今天吃啥': {
      title: '🍜 今天吃啥',
      tips: ['选择困难？让机器人帮你决定！'],
      rows: [
        [{ label: '🍜 今天吃什么', action: '今天吃什么' }],
        [{ label: '💕 今日老婆', action: '今日老婆' }],
        [{ label: '🏠 返回主菜单', action: '主菜单' }]
      ]
    },

    // ---- 系统类 ----
    '今日密码': {
      title: '🔑 今日密码',
      tips: ['今日密码，是三角洲密码门', '发送「今日密码」获取今日门禁密码'],
      rows: [
        [{ label: '📋 更新日志', action: '更新日志' }],
        [{ label: '🏠 返回主菜单', action: '主菜单' }]
      ]
    },
    '更新日志': {
      title: '📋 更新日志',
      tips: ['查看机器人最新更新记录'],
      rows: [
        [{ label: '🔑 今日密码', action: '今日密码' }],
        [{ label: '🏠 返回主菜单', action: '主菜单' }]
      ]
    },

    // ---- 游戏类 ----
    '游戏菜单': {
      title: '🎮 游戏菜单',
      tips: ['快乐游戏，放松心情！'],
      rows: [
        [{ label: '🔮 今日运势', action: '今日运势' }, { label: '🎲 掷骰子', action: '掷骰子 2d6' }],
        [{ label: '✊ 猜拳', action: '猜拳 石头' }, { label: '🎯 选择', action: '选择' }],
        [{ label: '🔢 随机数', action: '随机数' }, { label: '👤 今日人品', action: '今日人品' }],
        [{ label: '💕 抽老婆', action: '抽老婆' }, { label: '💣 扫雷', action: '扫雷' }],
        [{ label: '🙏 敲木鱼', action: '敲木鱼' }, { label: '🌾 开心农场', action: '开心农场' }],
        [{ label: '🎣 去钓鱼', action: '去钓鱼' }, { label: '😄 笑话', action: '笑话' }],
        [{ label: '⚔️ 王者菜单', action: '王者菜单' }],
        [{ label: '🏠 返回主菜单', action: '主菜单' }]
      ]
    },
    '王者菜单': {
      title: '⚔️ 王者菜单',
      tips: ['王者荣耀相关功能（开发中，敬请期待）'],
      rows: [
        [{ label: '🎮 游戏菜单', action: '游戏菜单' }],
        [{ label: '🏠 返回主菜单', action: '主菜单' }]
      ]
    },

    // ---- 管理/反馈类 ----
    '雪子管理': {
      title: '❄️ 雪子管理',
      tips: ['群管理功能（仅管理/群主）'],
      rows: [
        [{ label: '🔒 开启全禁', action: '开启群全禁' }, { label: '🔓 关闭全禁', action: '关闭群全禁' }],
        [{ label: '🔇 禁言', action: '禁言' }, { label: '🔊 解禁', action: '解禁' }],
        [{ label: '👢 踢人', action: '踢人' }, { label: '🔇 禁言列表', action: '禁言列表' }],
        [{ label: '📊 群状态', action: '群状态' }, { label: '📈 群信息', action: '群信息' }],
        [{ label: '💬 反馈菜单', action: '反馈菜单' }],
        [{ label: '🏠 返回主菜单', action: '主菜单' }]
      ]
    },
    '反馈菜单': {
      title: '💬 反馈菜单',
      tips: ['遇到bug或有建议，请与开发者反馈！'],
      rows: [
        [{ label: '👤 作者', action: '作者' }, { label: '💖 赞助', action: '赞助' }],
        [{ label: '❄️ 空空管理', action: '空空管理' }],
        [{ label: '🏠 返回主菜单', action: '主菜单' }]
      ]
    },

    // ---- 菜单面板（官方自定义菜单/指令面板管理） ----
    '菜单面板': {
      title: '🗂 菜单面板',
      tips: ['单聊底部自定义菜单 + 群聊指令面板', '群指令面板创建后按官方面板规则在群内展示', '定时报时与网页端定时任务联动'],
      rows: [
        [{ label: '➕ 创建群指令面板', action: '创建群指令面板' }, { label: '📋 查看指令面板', action: '指令面板' }],
        [{ label: '🗂 设置自定义菜单', action: '设置自定义菜单' }, { label: '📋 查询自定义菜单', action: '查询自定义菜单' }],
        [{ label: '🕐 定时报时', action: '我的定时报时' }],
        [{ label: '🏠 返回主菜单', action: '主菜单' }]
      ]
    }
  };

  // ========== 获取用户资料（昵称/QQ/头像） ==========
  function getUserProfile(ctx, openid) {
    try {
      if (ctx.engine && ctx.engine.getUserProfile) {
        const p = ctx.engine.getUserProfile(openid, 1);
        if (p) return p;
      }
    } catch (e) {}
    return { openid: openid || '', qq_number: '', nickname: '', avatar: '' };
  }

  // ========== 时间格式化（固定北京时间：UTC+8，任意时区部署均正确） ==========
  function nowText() {
    const d = new Date(Date.now() + 8 * 3600 * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  }

  // ========== 生成菜单 markdown（keyboard 按钮模式：头部信息 + tips，功能项由按钮承载） ==========
  function renderMd(ctx, data, menuKey) {
    const menu = MENU[menuKey] || MENU.main;
    const groupId = data.groupId;
    const userId = (data.author && data.author.openid) || '';
    const profile = getUserProfile(ctx, userId);
    const groupName = (ctx.engine && ctx.engine.getGroupName) ? ctx.engine.getGroupName(groupId) : '';
    const groupNumber = (ctx.engine && ctx.engine.getGroupNumber) ? String(ctx.engine.getGroupNumber(groupId) || '') : '';
    const botName = (ctx.engine && ctx.engine.getBotName) ? ctx.engine.getBotName() : '空空爱追剧';

    const lines = [];
    lines.push('**' + menu.title + '**');
    lines.push('👤 ' + (profile.nickname || '未绑定昵称') + '（QQ: ' + (profile.qq_number || '未绑定') + '）');
    lines.push('🆔 用户ID：' + (profile.openid || ''));
    if (groupId) lines.push('👥 ' + (groupName || '未知群') + '（' + (groupNumber ? '群号：' + groupNumber : '群ID：' + groupId) + '）');
    lines.push('');
    lines.push('━━━━━━━━━━━━━━');
    lines.push('点下方链接，指令会填入输入框，点发送即可使用 ↓');
    lines.push('');
    for (let i = 0; i < menu.rows.length; i++) {
      const row = menu.rows[i];
      if (row.tips) {
        lines.push('📌 ' + row.tips);
        continue;
      }
      if (!Array.isArray(row)) continue;
      const cells = row.map((it) => {
        const url = jumpUrl(ctx, groupId, userId, it.action);
        if (url) return '[' + it.label + ' ↗](' + url + ')';
        // 文字外显模式：on=mqqapi 链接（点链接回填指令），off=纯文字（全局切换控制）
        try {
          if (ctx.link && ctx.link.linkify) return ctx.link.linkify(it.label, it.action);
        } catch (e) {}
        return it.label;
      });
      lines.push(cells.join('　|　'));
    }
    lines.push('━━━━━━━━━━━━━━');
    if (menu.test) lines.push(menu.test);
    lines.push('当前时间：' + nowText());
    lines.push('最后更新：2026-08-13');
    lines.push('_' + botName + '_ · PHP · QQ机器人平台');
    return lines.join('\n');
  }

  // ========== 生成功能项纯文本清单（纯文本兜底用） ==========
  function renderPlainItems(ctx, data, menuKey) {
    const menu = MENU[menuKey] || MENU.main;
    const groupId = data.groupId;
    const userId = (data.author && data.author.openid) || '';
    const lines = [];
    for (let i = 0; i < menu.rows.length; i++) {
      const row = menu.rows[i];
      if (row.tips) {
        lines.push('📌 ' + row.tips);
        continue;
      }
      const cellTexts = row.map((it) => {
        const url = jumpUrl(ctx, groupId, userId, it.action);
        if (url) return '[' + it.label + '↗](' + url + ')';
        return it.label;
      });
      lines.push(cellTexts.join('　'));
    }
    return lines.join('\n');
  }

  // ========== 跳转链接：仅作者/赞助 走真实链接或面板 click，其余返回空（按钮回填） ==========
  function jumpUrl(ctx, groupId, userId, action) {
    try {
      if (action === '赞助') return 'https://www.ifdian.net/a/lzyzqzb5201314';
      if (action === '作者' && ctx.engine && ctx.engine.buildClickUrl) {
        const u = ctx.engine.buildClickUrl(groupId, userId, action);
        if (u) return u;
      }
    } catch (e) {}
    return '';
  }

  // ========== 发送菜单（image 模式卡片 / 链接式 markdown / 纯文本兜底；文字按钮模式已移除） ==========
  async function sendMenu(ctx, data, menuKey) {
    const groupId = data.groupId;
    const msgId = data.id;
    const userId = (data.author && data.author.openid) || '';
    const profile = getUserProfile(ctx, userId);

    // image 模式：菜单卡片（带头像）
    if ((ctx.engine && ctx.engine.getGlobalMode && ctx.engine.getGlobalMode() === 'image') && ctx.bot.sendMenuCard) {
      try {
        const menu = MENU[menuKey] || MENU.main;
        const items = [];
        for (const row of menu.rows) {
          if (row.tips || !Array.isArray(row)) continue;
          for (const it of row) items.push({ label: it.label, desc: '' });
        }
        const ok = await ctx.bot.sendMenuCard(groupId, {
          title: menu.title,
          avatarUrl: profile.avatar,
          nickname: profile.nickname || '未绑定昵称',
          qq: profile.qq_number || '未绑定',
          openid: userId,
          subtitle: '点下方链接，指令会填入输入框',
          items,
          footer: 'PHP · QQ机器人平台'
        }, msgId);
        if (ok) return;
      } catch (e) {}
    }

    // 链接式 markdown：头像内嵌 + 功能项文字外显（受全局开关控制）
    let md = renderMd(ctx, data, menuKey);
    try {
      if (profile.avatar && ctx.bot.uploadGroupImage) {
        const up = await ctx.bot.uploadGroupImage(groupId, profile.avatar);
        const imgUrl = up && (up.url || up.raw_url);
        if (imgUrl) md = '![头像](' + imgUrl + ')\n' + md;
      }
    } catch (e) {}
    md = md.replace(/__AVATAR__/g, '');

    // markdown 发送（文字外显链接式）
    try {
      const ok2 = await ctx.bot.sendMarkdownGroup(groupId, md, msgId);
      if (ok2) return;
    } catch (e) {}

    // 纯文本兜底（含功能项清单）
    const plain = md
      .replace(/^![^\n]*\n?/m, '')
      .replace(/[*_#>`]/g, '');
    const itemsText = renderPlainItems(ctx, data, menuKey);
    try { await ctx.bot.sendGroupMessage(groupId, plain + '\n' + itemsText + '\n发送"主菜单"返回', msgId); } catch (e) {}
  }

  // ========== 路由到子插件 ==========
  async function route(ctx, data, content) {
    const groupId = data.groupId;
    const msgId = data.id;
    try {
      // 娱乐类
      if (content === '抽老婆' || content === '抽老公' || content === '今天吃什么' ||
          content === '今日运势' || content === '掷骰子' || content === '猜拳' || content === '选择' ||
          content === '随机数' || content === '今日人品' || content === '扫雷' || content === '敲木鱼' ||
          content === '开心农场' || content === '去钓鱼' || content === '笑话' || content === '猜数字' ||
          content === '讲笑话') {
        const hit = await ctx.engine.callPlugin('娱乐中心', 'handleCommand', data).catch(() => null);
        if (hit) return true;
      }
      // 签到类
      if (content === '签到' || content === '补签' || content === '签到排行' || content === '积分排行') {
        const hit = await ctx.engine.callPlugin('签到系统', 'handleCommand', data).catch(() => null);
        if (hit) return true;
      }
      // 系统/设置类
      if (content === '更新日志') {
        const hit = await ctx.engine.callPlugin('系统工具', 'handleCommand', data).catch(() => null);
        if (hit) return true;
      }
      // 群管类
      if (content === '开启群全禁' || content === '关闭群全禁' || content === '禁言' || content === '解禁' ||
          content === '踢人' || content === '禁言列表' || content === '群状态') {
        const hit = await ctx.engine.callPlugin('群管理工具', 'handleCommand', data).catch(() => null);
        if (hit) return true;
      }
      // 群信息
      if (content === '群信息') {
        const hit = await ctx.engine.callPlugin('群信息', 'handleCommand', data).catch(() => null);
        if (hit) return true;
      }
      // 基础文本
      if (content === '作者' || content === '作者QQ') {
        try { await ctx.bot.sendGroupMessage(groupId, '👤 作者QQ：511742399\n🤖 机器人QQ：4010208623\n📩 合作/定制/拉群请联系', msgId); } catch (e) {}
        return true;
      }
      if (content === '赞助' || content === '赞助广告') {
        try { await ctx.bot.sendGroupMessage(groupId, '💖 赞助广告\n━━━━━━━━━━━━━━\n🔗 赞助页面：https://www.ifdian.net/a/lzyzqzb5201314\n💰 赞助合作欢迎洽谈！', msgId); } catch (e) {}
        return true;
      }
    } catch (e) {}
    return false;
  }

  // ========== 免@授权流程 ==========
  async function freeAt(ctx, data) {
    const groupId = data.groupId;
    const userId = (data.author && data.author.openid) || '';
    const msgId = data.id;
    const content = (data.content || '').trim();

    // 点击免@授权 或 发「免@授权」 → 引导输入群号
    if (content === '免@授权') {
      try {
        await ctx.bot.sendGroupMessage(groupId,
          '🔐 免@授权\n━━━━━━━━━━━━━━\n请输入本群群号，仅群主可操作！\n\n发送格式：免@授权群号 123456789\n（校验群主身份通过后生效）',
          msgId);
      } catch (e) {}
      return true;
    }

    // 免@授权群号 <群号> → 校验权限后记录
    const m = content.match(/^免@授权群号\s+(\d+)$/);
    if (m) {
      const groupNumber = m[1];
      // 超主永远可操作；其余按群主/群管理权限校验
      const ok = await isGroupAdmin(ctx, data);
      if (!ok) {
        try { await ctx.bot.sendGroupMessage(groupId, '❌ 权限不足：免@授权仅群主可操作！', msgId); } catch (e) {}
        return true;
      }
      try {
        const key = 'freeat_groups';
        let list = [];
        try { const raw = ctx.storage.get(key); if (raw) list = JSON.parse(raw); } catch (e) {}
        if (list.indexOf(groupNumber) === -1) list.push(groupNumber);
        ctx.storage.set(key, JSON.stringify(list));
        await ctx.bot.sendGroupMessage(groupId, '✅ 免@授权已绑定本群（' + groupNumber + '）\n本群成员发送指令无需@机器人！', msgId);
      } catch (e) {}
      return true;
    }
    return false;
  }

  // ========== 群主/群管理权限校验（后台群角色标记优先，真实群角色其次，后台管理员兜底） ==========
  async function isGroupAdmin(ctx, data) {
    const groupId = data.groupId;
    const userId = (data.author && data.author.openid) || '';
    // 0) 超级主人永远有权限（isSameUser QQ 兜底，多机器人 openid 不同也能识别）
    try {
      if (ctx.identity && ctx.identity.isSameUser) {
        const raw = ctx.storage.get('super_master_id') || '';
        let sm = '';
        try { const obj = JSON.parse(raw); sm = obj.id || ''; } catch (e) { sm = raw; }
        if (sm && ctx.identity.isSameUser(sm, userId)) return true;
      }
    } catch (e) {}
    // 1) 后台手动设置的群内角色优先（成员管理页可编辑）：
    //    owner/admin → 直接认可；member/user → 明确标注为普通成员，即使实时查询失败也不予认可
    try {
      if (ctx.engine && ctx.engine.getGroupMemberRole) {
        const backendRole = ctx.engine.getGroupMemberRole(groupId, userId) || '';
        if (backendRole === 'owner' || backendRole === 'admin') return true;
        if (backendRole === 'member' || backendRole === 'user') return false;
      }
    } catch (e) {}
    // 2) 官方群成员列表真实角色：owner/admin
    try {
      if (ctx.bot && ctx.bot.getGroupMembers) {
        const members = await ctx.bot.getGroupMembers(groupId);
        if (Array.isArray(members) && members.length > 0) {
          const me = members.find(function (m) {
            return m && (m.id === userId || m.member_openid === userId || m.openid === userId);
          });
          if (me) {
            const role = me.role || me.member_role || '';
            return role === 'owner' || role === 'admin';
          }
        }
      }
    } catch (e) {}
    // 3) 后台管理员角色兜底（getUserProfile.permission 来自 admin.json）
    try {
      const profile = getUserProfile(ctx, userId);
      const role = profile.permission || '';
      return role === 'owner' || role === 'admin' || role === 'super' || role === 'master';
    } catch (e) {}
    return false;
  }

  // ========== 插件管理：keyboard 按钮，点插件名 → 回填「插件设置 插件名 开/关」 ==========
  async function sendPluginManager(ctx, data) {
    const groupId = data.groupId;
    const msgId = data.id;
    const botId = data.botId || '';

    const isAdmin = await isGroupAdmin(ctx, data);
    if (!isAdmin) {
      try { await ctx.bot.sendGroupMessage(groupId, '⛔ 权限不足：插件管理仅群主/群管理可操作！', msgId); } catch (e) {}
      return;
    }

    let plugins = [];
    try {
      if (ctx.engine && ctx.engine.listAssignedPlugins) plugins = await ctx.engine.listAssignedPlugins(botId);
    } catch (e) {}
    if (!Array.isArray(plugins) || plugins.length === 0) {
      try { await ctx.bot.sendGroupMessage(groupId, '🔌 本机器人暂无可配置的插件，请先在管理面板为机器人分配插件。', msgId); } catch (e) {}
      return;
    }

    const rows = [];
    for (const p of plugins) {
      const name = p.name;
      rows.push([
        {
          id: 'plg_' + name,
          render_data: { label: '✅ 启用 ' + name, visited_label: '启用 ' + name, style: 0 },
          action: { type: 2, data: '插件设置 ' + name + ' 开', permission: { type: 2 } }
        },
        {
          id: 'plgx_' + name,
          render_data: { label: '⛔ 禁用 ' + name, visited_label: '禁用 ' + name, style: 0 },
          action: { type: 2, data: '插件设置 ' + name + ' 关', permission: { type: 2 } }
        }
      ]);
    }
    rows.push([{
      id: 'plg_back',
      render_data: { label: '🏠 返回主菜单', visited_label: '返回主菜单', style: 0 },
      action: { type: 2, data: '主菜单', enter: true, permission: { type: 2 } }
    }]);

    const stateList = plugins.map(function (p) {
      return '· ' + p.name;
    }).join('\n');
    const md = '**🔌 本群插件管理**\n' +
      '点下方「启用/禁用」按钮，指令会填入输入框，点发送后对本群生效。\n' +
      '━━━━━━━━━━━━━━\n' +
      stateList + '\n' +
      '━━━━━━━━━━━━━━\n' +
      '仅群主/群管理可操作';

    try {
      if (ctx.bot && ctx.bot.sendKeyboardGroup) {
        const ok = await ctx.bot.sendKeyboardGroup(groupId, { content: md, rows }, msgId);
        if (ok) return;
      }
    } catch (e) {}
    // 兜底：纯文本
    try { await ctx.bot.sendGroupMessage(groupId, md + '\n发送「插件设置 插件名 开/关」配置（仅群主/群管理）', msgId); } catch (e) {}
  }

  // ========== 主处理 ==========
  async function handleCommand(ctx, data) {
    try {
      const rawContent = (data.content || '').trim();
      const content = rawContent.replace(/^\s*(?:<@!?[A-F0-9]+>|@\S+)\s*/, '').trim() || rawContent;

      // 免@授权交互流程
      if (content === '免@授权' || /^免@授权群号\s+\d+$/.test(content)) {
        return await freeAt(ctx, data);
      }

      // 插件管理入口（keyboard 按钮回填配置）
      if (content === '插件管理') {
        await sendPluginManager(ctx, data);
        return;
      }

      // 插件设置 <插件名> 开/关 → 写入本群门控（allow/deny）
      const pm = content.match(/^插件设置\s+(.+?)\s+(开|关)$/);
      if (pm) {
        const pname = pm[1].trim();
        const op = pm[2];
        const isAdmin = await isGroupAdmin(ctx, data);
        if (!isAdmin) {
          try { await ctx.bot.sendGroupMessage(data.groupId, '⛔ 权限不足：插件开关仅群主/群管理可操作！', data.id); } catch (e) {}
          return;
        }
        let plugins = [];
        try {
          if (ctx.engine && ctx.engine.listAssignedPlugins) plugins = await ctx.engine.listAssignedPlugins(data.botId || '');
        } catch (e) {}
        const target = (Array.isArray(plugins) ? plugins : []).find(function (p) { return p.name === pname; });
        if (!target) {
          try { await ctx.bot.sendGroupMessage(data.groupId, '❌ 未找到插件「' + pname + '」，或未分配到此机器人。', data.id); } catch (e) {}
          return;
        }
        const mode = op === '开' ? 'allow' : 'deny';
        let res = null;
        try {
          if (ctx.engine && ctx.engine.setPluginGroupMode) res = await ctx.engine.setPluginGroupMode(target.id, data.groupId, mode);
        } catch (e) {}
        if (res && res.ok) {
          const tip = mode === 'allow'
            ? '✅ 已在本群启用插件「' + pname + '」\n其他群不受影响。'
            : '⛔ 已在本群禁用插件「' + pname + '」\n其他群不受影响。';
          try { await ctx.bot.sendGroupMessage(data.groupId, tip, data.id); } catch (e) {}
        } else {
          try { await ctx.bot.sendGroupMessage(data.groupId, '❌ 配置失败：' + ((res && res.error) || '未知错误'), data.id); } catch (e) {}
        }
        return;
      }

      // 主菜单入口
      if (content === '新版菜单' || content === '主菜单' || content === '菜单' || content === 'menu' || content === 'menu ') {
        await sendMenu(ctx, data, 'main');
        return;
      }
      if (content === '返回主菜单' || content === '返回上级') {
        await sendMenu(ctx, data, 'main');
        return;
      }

      // 空空管理 → 雪子管理（子菜单入口）
      if (content === '空空管理') {
        await sendMenu(ctx, data, '雪子管理');
        return;
      }

      // 画图带参 → 放行给画图插件（事件自监听处理），无参"画图"仍显示子菜单
      if (/^(画图|画画|生成图|给我画|画一张)[:：\s]+.+/.test(content)) {
        return;
      }

      // 需要带参的唱歌命令：听唱歌/点首歌/唱首歌/我要听/听清唱/哈基米 + 歌名 → 路由到唱歌
      const singMatch = content.match(/^(听唱歌|听清唱|哈基米|点首歌|唱首歌|我要听)\s+(.+)$/);
      if (singMatch) {
        const hit = await ctx.engine.callPlugin('唱歌', 'handleCommand', { ...data, content: '唱歌 ' + singMatch[2] }).catch(() => null);
        if (hit) return;
      }

      // 其余功能路由（精确指令优先执行，签到/更新日志/讲笑话等不被子菜单拦截）
      const routed = await route(ctx, data, content);
      if (routed) return;

      // 子菜单入口（未命中精确指令时）
      if (MENU[content]) {
        await sendMenu(ctx, data, content);
        return;
      }

      // 未知：静默忽略
      return;
    } catch (e) {
      ctx.logger.error('新版菜单错误: ' + e.message);
    }
  }

  // ========== 启用注册 ==========
  function onEnable(ctx) {
    ctx.logger.info('新版菜单 v1.2.0 已加载');
    ctx.eventBus.on('message.group', function (data) {
      handleCommand(ctx, data).catch(function () {});
    });
    ctx.eventBus.on('message.c2c', function (data) {
      handleCommand(ctx, data).catch(function () {});
    });
  }

  return {
    manifest: {
      id: 'mod-new-menu',
      name: '新版菜单',
      version: '1.2.0',
      description: 'mqqapi链接式外显文字菜单（文字按钮模式已移除，全局切换文字外显开关控制），作者/赞助跳转链接，头像内嵌菜单，插件按群开关，测试菜单入口',
      author: '511742399'
    },
    methods: {
      handleCommand: handleCommand
    },
    onEnable: onEnable
  };
})();
