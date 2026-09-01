import type { CtxLike, Envelope } from '../types';
import { state } from '../core/state';
import { MENU_TREE, rootOf, findNodeByAction, findNodeByLabel, parentOf } from '../menu/tree';
import { sendMenu } from '../menu/render';
import * as randomSvc from '../services/random';
import * as gamesSvc from '../services/games';
import * as learnSvc from '../services/learn';
import * as aiSvc from '../services/ai';
import * as panelSvc from '../services/qq-menu-panel';
import * as userinfoSvc from '../services/userinfo';
import * as signinSvc from '../services/signin';
import * as noteSvc from '../services/note';
import * as authSvc from '../services/authcodes';
import * as groupSvc from '../services/groupadmin';
import * as guildSvc from '../services/guildops';
import { isMaster } from '../services/perms';

const guessState = new Map<string, number>();
const BOOT_TIME = Date.now();

async function reply(ctx: CtxLike, env: Envelope, text: string): Promise<void> {
  const groupId = env.groupId || '';
  const channelId = env.channelId || '';
  const msgId = env.msgId;
  try {
    if (groupId) {
      await ctx.bot.sendGroupMessage(groupId, text, msgId);
    } else if (channelId) {
      await ctx.bot.sendMessage(channelId, text, msgId);
    } else {
      await ctx.bot.sendPrivateMessage(env.userId, text, msgId);
    }
  } catch (e: any) {
    ctx.logger?.error?.('reply failed: ' + (e?.message || String(e)));
  }
}

function renderNodeMenu(ctx: CtxLike, env: Envelope, node: { label: string; children?: any[] }): Promise<void> {
  return sendMenu(ctx, env, node as any);
}

// ===== 功能指令分发（命中返回回复文本，未命中返回 null） =====

function modEnabled(ctx: CtxLike, env: Envelope, mod: string): boolean {
  return state.moduleEnabled(env.botId || '', mod);
}

function setNick(ctx: CtxLike, env: Envelope, args: string): string {
  const uid = env.userId || '';
  const nick = args.trim();
  if (!nick) return '✏️ 设置昵称：发送「设置昵称 我的新昵称」';
  try {
    const info = ctx.identity && ctx.identity.getInfo ? ctx.identity.getInfo(uid) : null;
    const qq = (info && info.qq_number) || (ctx.identity && ctx.identity.getQQ ? ctx.identity.getQQ(uid) : '') || '';
    if (!qq) return '✏️ 请先绑定QQ号后再设置昵称（发送「绑定QQ 你的QQ号」）';
    const r = doBind(ctx, uid, qq, nick);
    if (r && r.ok) return '✅ 昵称已设置为：' + nick;
    return r ? ('❌ 设置昵称失败：' + (r.error || '')) : '❌ 当前环境不支持设置昵称';
  } catch (e: any) {
    return '❌ 设置昵称失败：' + (e?.message || String(e));
  }
}

function doBind(ctx: CtxLike, openid: string, qq: string, nick?: string): { ok: boolean; error?: string } | null {
  // 真实引擎 API 在 ctx.engine；部分宿主/测试 mock 提供 ctx.identity.bindUserQQ
  if (ctx.engine && typeof ctx.engine.bindUserQQ === 'function') {
    return ctx.engine.bindUserQQ(openid, qq, nick);
  }
  if (ctx.identity && typeof ctx.identity.bindUserQQ === 'function') {
    return ctx.identity.bindUserQQ(openid, qq, nick);
  }
  return null;
}

function bindQQ(ctx: CtxLike, env: Envelope, args: string): string {
  const qq = args.trim().split(/\s+/)[0] || '';
  if (!/^\d{5,12}$/.test(qq)) return '📎 格式：绑定QQ <QQ号> [昵称]';
  const nick = args.trim().split(/\s+/).slice(1).join(' ') || '';
  try {
    const r = doBind(ctx, env.userId || '', qq, nick || undefined);
    if (r && r.ok) return '✅ 已绑定QQ：' + qq + (nick ? '（昵称：' + nick + '）' : '');
    if (r) return '❌ 绑定失败：' + (r.error || '');
    return '❌ 当前环境不支持绑定QQ';
  } catch (e: any) {
    return '❌ 绑定失败：' + (e?.message || String(e));
  }
}

function handleFeature(ctx: CtxLike, env: Envelope, content: string): Promise<string | null> {
  const userId = env.userId || '';
  const c = content.trim();

  // ===== 娱乐功能 =====
  if (c === '今日运势' || c === '运势') {
    return modEnabled(ctx, env, 'random') ? Promise.resolve(randomSvc.luck()) : Promise.resolve(null);
  }
  if (c.startsWith('掷骰子')) {
    return modEnabled(ctx, env, 'random') ? Promise.resolve(randomSvc.dice(c.slice(3).trim())) : Promise.resolve(null);
  }
  if (c.startsWith('猜拳')) {
    return modEnabled(ctx, env, 'random') ? Promise.resolve(randomSvc.rps(c.slice(2).trim())) : Promise.resolve(null);
  }
  if (c.startsWith('选择')) {
    return modEnabled(ctx, env, 'random') ? Promise.resolve(randomSvc.pick(c.slice(2).trim())) : Promise.resolve(null);
  }
  if (c.startsWith('随机数')) {
    return modEnabled(ctx, env, 'random') ? Promise.resolve(randomSvc.randnum(c.slice(3).trim())) : Promise.resolve(null);
  }
  if (c === '今天吃什么') {
    return modEnabled(ctx, env, 'random') ? Promise.resolve(randomSvc.food()) : Promise.resolve(null);
  }
  if (c === '今日人品') {
    return modEnabled(ctx, env, 'random') ? Promise.resolve(randomSvc.integrity()) : Promise.resolve(null);
  }
  if (c === '抽老婆' || c === '抽老公') {
    return modEnabled(ctx, env, 'random') ? Promise.resolve(randomSvc.cp(c)) : Promise.resolve(null);
  }
  if (c === '敲木鱼') {
    return modEnabled(ctx, env, 'random') ? Promise.resolve(randomSvc.woodfish()) : Promise.resolve(null);
  }
  if (c === '笑话') {
    return modEnabled(ctx, env, 'random') ? Promise.resolve(randomSvc.joke()) : Promise.resolve(null);
  }
  if (c === '大转盘') {
    return modEnabled(ctx, env, 'random') ? Promise.resolve(randomSvc.wheel()) : Promise.resolve(null);
  }
  if (c === '老虎机') {
    return modEnabled(ctx, env, 'games') ? Promise.resolve(gamesSvc.slots()) : Promise.resolve(null);
  }
  if (c === '点歌') {
    return modEnabled(ctx, env, 'games') ? Promise.resolve('🎤 点歌功能：发送「点歌 歌名」，我会为你挑选好听的歌（演示）。') : Promise.resolve(null);
  }

  // ===== 猜数字小游戏 =====
  if (c === '猜数字') {
    guessState.set(userId, gamesSvc.startGuess());
    return modEnabled(ctx, env, 'games') ? Promise.resolve('🎮 猜数字开始！1-100 之间，发送数字即可') : Promise.resolve(null);
  }
  if (/^\d{1,3}$/.test(c)) {
    const ans = guessState.get(userId);
    if (ans) {
      const r = gamesSvc.guessCompare(ans, parseInt(c, 10));
      if (r.includes('恭喜猜中')) guessState.delete(userId);
      return modEnabled(ctx, env, 'games') ? Promise.resolve(r) : Promise.resolve(null);
    }
    return Promise.resolve(null);
  }

  // ===== 词典学习 =====
  if (c.startsWith('学习 ')) {
    const kv = c.slice(3).split('=');
    if (kv.length === 2) return modEnabled(ctx, env, 'learn') ? Promise.resolve(learnSvc.learn(kv[0].trim(), kv[1].trim())) : Promise.resolve(null);
    return Promise.resolve('❌ 格式：学习 关键词=回复内容');
  }
  if (c === '词条列表') return modEnabled(ctx, env, 'learn') ? Promise.resolve(learnSvc.list()) : Promise.resolve(null);
  if (c.startsWith('删词条 ')) return modEnabled(ctx, env, 'learn') ? Promise.resolve(learnSvc.del(c.slice(4).trim())) : Promise.resolve(null);
  if (c === '开启dic回复') return Promise.resolve(learnSvc.setDicEnabled(env.botId || '', true));
  if (c === '关闭dic回复') return Promise.resolve(learnSvc.setDicEnabled(env.botId || '', false));

  // ===== AI 对话 =====
  if (c === 'AI' || c === 'AI ' || c.startsWith('AI ')) {
    const prompt = c.length > 3 ? c.slice(3).trim() : '';
    if (!prompt) return modEnabled(ctx, env, 'ai') ? Promise.resolve('🤖 AI 对话：发送「AI 你的问题」开始对话') : Promise.resolve(null);
    return modEnabled(ctx, env, 'ai') ? aiSvc.chat(prompt) : Promise.resolve(null);
  }
  if (c.startsWith('AI配置')) return Promise.resolve(aiSvc.setConfig(c, ''));

  // ===== 实用功能 =====
  if (c === '每日打卡' || c === '打卡') return modEnabled(ctx, env, 'sign') ? Promise.resolve(signinSvc.checkin(ctx, userId)) : Promise.resolve(null);
  if (c.startsWith('每日备注')) {
    const arg = c.slice(4).trim();
    return modEnabled(ctx, env, 'note') ? Promise.resolve(arg ? noteSvc.setNote(ctx, userId, arg) : noteSvc.getNote(ctx, userId)) : Promise.resolve(null);
  }
  if (c.startsWith('设置昵称')) return Promise.resolve(setNick(ctx, env, c.slice(4)));
  if (c.startsWith('绑定QQ')) return Promise.resolve(bindQQ(ctx, env, c.slice(4)));
  if (c === '查询天气' || c.startsWith('天气 ')) {
    const city = c === '查询天气' ? '' : c.slice(3).trim();
    return modEnabled(ctx, env, 'util') ? Promise.resolve('🌤 天气功能（演示）：发送「天气 城市名」' + (city ? '，收到查询：' + city : '')) : Promise.resolve(null);
  }
  if (c === '天气') return modEnabled(ctx, env, 'util') ? Promise.resolve('🌤 天气功能（演示）：发送「天气 城市名」') : Promise.resolve(null);
  if (c === '补签') return modEnabled(ctx, env, 'sign') ? Promise.resolve(signinSvc.backcheck(ctx, userId)) : Promise.resolve(null);
  if (c === '签到排行') return modEnabled(ctx, env, 'sign') ? Promise.resolve(signinSvc.signinRank(ctx)) : Promise.resolve(null);
  if (c === '积分排行') return modEnabled(ctx, env, 'sign') ? Promise.resolve(signinSvc.pointRank(ctx)) : Promise.resolve(null);
  if (c === '签到') return modEnabled(ctx, env, 'sign') ? Promise.resolve(signinSvc.checkin(ctx, userId)) : Promise.resolve(null);
  if (c === '积分') return modEnabled(ctx, env, 'sign') ? Promise.resolve(signinSvc.myPoints(ctx, userId)) : Promise.resolve(null);

  // ===== 授权功能（异步走后端） =====
  if (c === '获取激活码' || c.startsWith('获取激活码 ')) {
    if (!modEnabled(ctx, env, 'auth')) return Promise.resolve(null);
    return authSvc.genCode(ctx, env, c.slice(5));
  }
  if (c === '激活授权码' || c.startsWith('激活授权码 ')) {
    if (!modEnabled(ctx, env, 'auth')) return Promise.resolve(null);
    return authSvc.activateCode(ctx, env, c.slice(5));
  }
  if (c === '登录' || c === '登录链接' || c === '获取登录信息') {
    if (!modEnabled(ctx, env, 'auth')) return Promise.resolve(null);
    return authSvc.loginInfo(ctx, env);
  }

  // ===== 群管系统 =====
  if (c === '开启群全禁' || c === '开启全禁') {
    if (!modEnabled(ctx, env, 'groupadm')) return Promise.resolve(null);
    if (!isMaster(ctx, userId)) return Promise.resolve('权限不足，仅主人可操作');
    return groupSvc.muteAll(ctx, env, true);
  }
  if (c === '关闭群全禁' || c === '关闭全禁') {
    if (!modEnabled(ctx, env, 'groupadm')) return Promise.resolve(null);
    if (!isMaster(ctx, userId)) return Promise.resolve('权限不足，仅主人可操作');
    return groupSvc.muteAll(ctx, env, false);
  }
  if (c.startsWith('禁言')) {
    if (!modEnabled(ctx, env, 'groupadm')) return Promise.resolve(null);
    if (!isMaster(ctx, userId)) return Promise.resolve('权限不足，仅主人可操作');
    return groupSvc.muteUser(ctx, env, c.slice(2).trim());
  }
  if (c.startsWith('解禁')) {
    if (!modEnabled(ctx, env, 'groupadm')) return Promise.resolve(null);
    if (!isMaster(ctx, userId)) return Promise.resolve('权限不足，仅主人可操作');
    return groupSvc.unmuteUser(ctx, env, c.slice(2).trim());
  }
  if (c.startsWith('踢人')) {
    if (!modEnabled(ctx, env, 'groupadm')) return Promise.resolve(null);
    if (!isMaster(ctx, userId)) return Promise.resolve('权限不足，仅主人可操作');
    return groupSvc.kickUser(ctx, env, c.slice(2).trim());
  }

  // ===== 频道管理 =====
  if (c === '频道列表' || c.startsWith('频道列表 ')) {
    if (!modEnabled(ctx, env, 'guild')) return Promise.resolve(null);
    return guildSvc.channelList(ctx, c.slice(5).trim());
  }
  if (c === '板块列表' || c.startsWith('板块列表 ')) {
    if (!modEnabled(ctx, env, 'guild')) return Promise.resolve(null);
    return guildSvc.channelList(ctx, c.slice(5).trim());
  }
  if (c === '频道详情' || c.startsWith('频道详情 ')) {
    if (!modEnabled(ctx, env, 'guild')) return Promise.resolve(null);
    return guildSvc.channelDetail(ctx, c.slice(5).trim());
  }
  if (c === '创建频道' || c.startsWith('创建频道 ')) {
    if (!modEnabled(ctx, env, 'guild')) return Promise.resolve(null);
    if (!isMaster(ctx, userId)) return Promise.resolve('权限不足，仅主人可操作');
    return guildSvc.channelCreate(ctx, c.slice(5).trim());
  }
  if (c === '修改频道' || c.startsWith('修改频道 ')) {
    if (!modEnabled(ctx, env, 'guild')) return Promise.resolve(null);
    if (!isMaster(ctx, userId)) return Promise.resolve('权限不足，仅主人可操作');
    return guildSvc.channelRename(ctx, c.slice(5).trim());
  }
  if (c === '删除频道' || c.startsWith('删除频道 ')) {
    if (!modEnabled(ctx, env, 'guild')) return Promise.resolve(null);
    if (!isMaster(ctx, userId)) return Promise.resolve('权限不足，仅主人可操作');
    return guildSvc.channelDelete(ctx, c.slice(5).trim());
  }
  if (c === '频道发帖' || c.startsWith('频道发帖 ')) {
    if (!modEnabled(ctx, env, 'guild')) return Promise.resolve(null);
    return guildSvc.channelPost(ctx, c.slice(5).trim());
  }
  if (c === '频道删帖' || c.startsWith('频道删帖 ')) {
    if (!modEnabled(ctx, env, 'guild')) return Promise.resolve(null);
    if (!isMaster(ctx, userId)) return Promise.resolve('权限不足，仅主人可操作');
    return guildSvc.channelDelMsg(ctx, c.slice(5).trim());
  }
  if (c === '频道公告' || c.startsWith('频道公告 ')) {
    if (!modEnabled(ctx, env, 'guild')) return Promise.resolve(null);
    return guildSvc.channelAnnounce(ctx, c.slice(5).trim());
  }
  if (c === '频道活跃度' || c.startsWith('频道活跃度 ')) {
    if (!modEnabled(ctx, env, 'guild')) return Promise.resolve(null);
    return guildSvc.channelActivity(ctx, c.slice(6).trim());
  }
  if (c === '频道违规' || c.startsWith('频道违规 ')) {
    if (!modEnabled(ctx, env, 'guild')) return Promise.resolve(null);
    if (!isMaster(ctx, userId)) return Promise.resolve('权限不足，仅主人可操作');
    return guildSvc.channelMute(ctx, c.slice(5).trim());
  }
  if (c === '频道签到') return modEnabled(ctx, env, 'sign') ? Promise.resolve(signinSvc.checkin(ctx, userId)) : Promise.resolve(null);

  return Promise.resolve(null);
}

export async function handle(ctx: CtxLike, env: Envelope): Promise<void> {
  const content = (env.content || '').trim();
  if (!content) return;

  const botId = env.botId || '';
  const userId = env.userId || '';

  // 1) 回复去重
  if (state.isDup(botId, env.msgId || '', content)) return;

  // 2) 词典学习命中（learn 模块开启时）
  if (state.moduleEnabled(botId, 'learn')) {
    const hit = learnSvc.lookup(content);
    if (hit) {
      await reply(ctx, env, hit);
      return;
    }
  }

  // 3) 菜单导航
  if (content === '主菜单' || content === '菜单' || content === 'menu' || content === 'menu ') {
    await renderNodeMenu(ctx, env, rootOf());
    return;
  }
  if (content === '返回主菜单') {
    await renderNodeMenu(ctx, env, rootOf());
    return;
  }
  if (content === '返回上级') {
    await renderNodeMenu(ctx, env, rootOf());
    return;
  }

  // 顶层菜单 label（娱乐功能/实用功能/...）→ 渲染子菜单（仅含子项的父节点；叶子节点如「签到/AI」直接走功能指令）
  const topNode = MENU_TREE.find((n) => n.children && n.children.length > 0 && n.label.replace(/[^一-龥a-zA-Z0-9]/g, '') === content.replace(/[^一-龥a-zA-Z0-9]/g, ''));
  if (topNode) {
    await renderNodeMenu(ctx, env, topNode);
    return;
  }

  // 4) 指令面板管理（仅超管）
  if (content.startsWith('/菜单面板')) {
    if (!isMaster(ctx, userId)) {
      await reply(ctx, env, '权限不足，仅超管可操作');
      return;
    }
    const text = await panelSvc.cmd(ctx, content.replace('/菜单面板', '').trim());
    await reply(ctx, env, text);
    return;
  }

  // 5) 全局模式切换（仅超管）
  if (content === '切换全局模式') {
    if (!isMaster(ctx, userId)) {
      await reply(ctx, env, '权限不足，仅超管可操作');
      return;
    }
    const cur = ctx.engine.getGlobalMode ? ctx.engine.getGlobalMode() : 'text';
    const next = cur === 'image' ? 'text' : 'image';
    ctx.engine.setGlobalMode(next);
    await reply(ctx, env, '✅ 全局模式已切换为：' + (next === 'image' ? '图片菜单模式' : '文字模式'));
    return;
  }

  // 6) 报时 / 欢迎提示 设置（仅超管）
  if (content.startsWith('报时')) {
    if (!isMaster(ctx, userId)) {
      await reply(ctx, env, '权限不足，仅超管可操作');
      return;
    }
    const arg = content.replace('报时', '').trim();
    if (arg === '开') { state.setConfig({ chimeEnabled: true }); await reply(ctx, env, '⏰ 报时已开启'); return; }
    if (arg === '关') { state.setConfig({ chimeEnabled: false }); await reply(ctx, env, '⏰ 报时已关闭'); return; }
    if (arg === '图片') { state.setConfig({ chimeMode: 'image', chimeEnabled: true }); await reply(ctx, env, '⏰ 报时已设为图片模式'); return; }
    if (arg === '文字' || arg === '') { state.setConfig({ chimeMode: 'text', chimeEnabled: true }); await reply(ctx, env, '⏰ 报时已设为文字模式'); return; }
    return;
  }
  if (content.startsWith('欢迎提示')) {
    if (!isMaster(ctx, userId)) {
      await reply(ctx, env, '权限不足，仅超管可操作');
      return;
    }
    const arg = content.replace('欢迎提示', '').trim();
    if (arg === '开') { state.setConfig({ welcomeEnabled: true }); await reply(ctx, env, '👋 入群欢迎提示已开启'); return; }
    if (arg === '关') { state.setConfig({ welcomeEnabled: false }); await reply(ctx, env, '👋 入群欢迎提示已关闭'); return; }
    return;
  }

  // 7) 子菜单项 / 功能指令
  const feature = await handleFeature(ctx, env, content);
  if (feature !== null && feature !== undefined) {
    await reply(ctx, env, feature);
    return;
  }

  // 7b) 个人信息（实用功能）：走后端 userinfo，优先信息卡片，失败降级文本
  if (content === '个人信息') {
    if (!state.moduleEnabled(botId, 'util')) return;
    const r = await userinfoSvc.personalInfo(ctx, env);
    if (r.cardData && env.groupId && ctx.bot.sendGroupInfoCard) {
      try {
        const ok = await ctx.bot.sendGroupInfoCard(env.groupId, r.cardData, env.msgId);
        if (ok) return;
      } catch {}
    }
    await reply(ctx, env, r.text);
    return;
  }

  // 8) 系统信息
  if (content === '版本') { await reply(ctx, env, '📦 统一菜单插件 v1.2.0（面板 4.2.23）\n✅ 权限修复 + 按钮菜单 + 全功能补全'); return; }
  if (content === '在线时间' || content === '运行时间') {
    const up = Date.now() - BOOT_TIME;
    const d = Math.floor(up / 86400000);
    const h = Math.floor((up % 86400000) / 3600000);
    const m = Math.floor((up % 3600000) / 60000);
    await reply(ctx, env, '⏱ 在线时间：' + d + '天' + h + '小时' + m + '分钟');
    return;
  }
  if (content === '更新日志') {
    await reply(ctx, env, '📋 更新日志\nv1.2.0：\n• 修复超管权限误判（兼容多机器人对象存储）\n• 文字菜单改为键盘按钮（点击填入输入框，发送即触发）\n• 补全历史功能：娱乐/签到/授权/群管/频道\nv1.1.0：新增个人信息\nv1.0.0：统一菜单+面板管理');
    return;
  }
  if (content === '查巡') {
    await reply(ctx, env, '🔍 查巡（巡查）功能：\n发送「巡查开启」「巡查关闭」控制违规自动禁言；\n发送「巡查设置 词1,词2」设置违规词。\n（当前为演示说明，完整巡查见系统设置）');
    return;
  }
  if (content === '状态') { await reply(ctx, env, '📊 统一菜单插件运行正常\n模式：' + (ctx.engine.getGlobalMode ? ctx.engine.getGlobalMode() : 'text')); return; }
  if (content === '群信息') { await reply(ctx, env, '📈 群信息：当前群 OpenID ' + (env.groupId || '未知') + '\n功能开发中，敬请期待'); return; }
  if (content === '禁言') { await reply(ctx, env, '🔇 禁言：发送「禁言 @用户 分钟」（如：禁言 <@openid> 5）'); return; }
  if (content === '解禁') { await reply(ctx, env, '🔊 解禁：发送「解禁 @用户」（如：解禁 <@openid>）'); return; }
  if (content === '踢人') { await reply(ctx, env, '👢 踢人：发送「踢人 @用户」（如：踢人 <@openid>）'); return; }
}
