import { state } from '../core/state';
import { sendMsg } from '../core/actions';
import { stripCQ } from '../core/utils';
import { groupEnabled } from '../config';
import { PLUGIN_VERSION } from '../config';
import { checkOwner, checkManagePermission, extractTarget, isOwner } from '../features/group';
import {
  groupInfo, groupStats, groupMuteAll, groupMute, groupKick, groupPunchCard,
  sendPoke, markEssence, sendGroupAnnouncement, setGroupName, setGroupAdmin,
  removeGroupAdmin, deleteMsg,
} from '../features/group';
import {
  dailyFortune, dailyLuck, rockPaperScissors, randomInRange, pickChoice,
  whatToEat, drawCp, minesweeperInit, minesweeperReveal, woodFish, fishing,
  farmView, farmPlant, farmHarvest, farmExpand, xianNi,
} from '../features/entertainment';
import { doSignin, makeupSignin, leaderboard, personalInfo } from '../features/signin';
import { addSchedule, listSchedules, deleteSchedule } from '../features/schedule';
import { addKeyword, delKeyword, keywordMatch, keywordList } from '../features/keyword';
import { showMenu } from '../features/menu';
import {
  uptimeInfo, versionInfo, changelog, sponsorInfo, greetingInfo, scheduleShutdown,
  setNickname, dailyNote, dailyCheckin, chatTour, ownerInfo, setOwner,
  groupSwitchStatus, setGroupSwitch,
} from '../features/misc';
import { grantCode, activateCode, authStatus } from '../services/auth';
import { channelList, channelTest } from '../services/channel';
import { weather } from '../services/weather';
import { song } from '../services/song';
import type { PluginContext, GroupEvent } from '../types';

function parseCommand(raw: string): { cmd: string; args: string; parts: string[] } {
  const text = stripCQ(raw);
  const prefix = state.config.commandPrefix || '';
  let body = text;
  if (prefix && body.startsWith(prefix)) {
    body = body.slice(prefix.length).trim();
  }
  const parts = body.trim().split(/\s+/);
  return {
    cmd: (parts[0] || '').toLowerCase(),
    args: body.trim().slice((parts[0] || '').length).trim(),
    parts,
  };
}

function matchTextButton(raw: string): string | null {
  if (!raw) return null;
  const t = stripCQ(raw);
  const lower = t.toLowerCase();
  if (lower.includes('按钮菜单')) return 'button';
  if (lower.includes('图片菜单')) return 'image';
  return null;
}

export async function handleMessage(ctx: PluginContext, event: GroupEvent): Promise<void> {
  if (event.post_type !== 'message') return;
  if (!state.config.enabled) return;
  const rawMsg = stripCQ(event.raw_message);
  if (event.message_type === 'group' && !groupEnabled(event.group_id)) {
    if (isOwner(event.user_id) && /^(开启机器人|打开机器人|开机器人)$/.test(rawMsg)) {
      await sendMsg(ctx, event, setGroupSwitch(event, true));
    }
    return;
  }
  const raw = rawMsg;
  const { cmd, args, parts } = parseCommand(raw);
  const groupId = event.group_id ? String(event.group_id) : '';
  const btnStyle = matchTextButton(raw);
  if (btnStyle) {
    await showMenu(ctx, event, btnStyle);
    return;
  }
  const kwReply = keywordMatch(raw, groupId);
  if (kwReply && !cmd) {
    await sendMsg(ctx, event, kwReply);
    return;
  }
  switch (cmd) {
    case '菜单':
    case '主菜单':
    case '帮助':
      await showMenu(ctx, event, 'text');
      break;
    case '按钮菜单':
      await showMenu(ctx, event, 'button');
      break;
    case '图片菜单':
      await showMenu(ctx, event, 'image');
      break;
    case '今日运势':
      await sendMsg(ctx, event, dailyFortune(event));
      break;
    case '今日人品':
      await sendMsg(ctx, event, dailyLuck(event));
      break;
    case '掷骰子':
    case '骰子':
      await sendMsg(ctx, event, `🎲 ${1 + Math.floor(Math.random() * 6)}`);
      break;
    case '猜拳':
      await sendMsg(ctx, event, rockPaperScissors(args));
      break;
    case '选择':
      await sendMsg(ctx, event, pickChoice(args));
      break;
    case '随机数':
      await sendMsg(ctx, event, randomInRange(args));
      break;
    case '今天吃什么':
      await sendMsg(ctx, event, whatToEat());
      break;
    case '抽cp':
      await sendMsg(ctx, event, drawCp(parts, parts.slice(1).filter(Boolean)));
      break;
    case '扫雷':
      await sendMsg(ctx, event, args ? minesweeperReveal(event, args) : minesweeperInit(event));
      break;
    case '敲木鱼':
      await sendMsg(ctx, event, woodFish(event));
      break;
    case '开心农场':
      await sendMsg(ctx, event, farmView(event));
      break;
    case '种植':
      await sendMsg(ctx, event, farmPlant(event, args));
      break;
    case '收获':
      await sendMsg(ctx, event, farmHarvest(event, args));
      break;
    case '开垦':
      await sendMsg(ctx, event, farmExpand(event));
      break;
    case '去钓鱼':
    case '钓鱼':
      await sendMsg(ctx, event, fishing(event));
      break;
    case '仙逆':
      await sendMsg(ctx, event, xianNi(event));
      break;
    case '签到':
      await sendMsg(ctx, event, doSignin(event));
      break;
    case '补签':
      await sendMsg(ctx, event, makeupSignin(event));
      break;
    case '排行榜':
      await sendMsg(ctx, event, leaderboard());
      break;
    case '个人信息':
    case '我的信息':
      await sendMsg(ctx, event, personalInfo(event));
      break;
    case '天气':
      await weather(ctx, event, args);
      break;
    case '每日打卡':
    case '打卡':
      await sendMsg(ctx, event, dailyCheckin(event));
      break;
    case '每日备注':
      await sendMsg(ctx, event, dailyNote(event, args));
      break;
    case '设置昵称':
    case '改群名片':
      await setNickname(ctx, event, args);
      break;
    case '查巡':
      await sendMsg(ctx, event, chatTour(event));
      break;
    case '添加定时':
      await sendMsg(ctx, event, addSchedule(event, args));
      break;
    case '定时列表':
      await sendMsg(ctx, event, listSchedules(event));
      break;
    case '删除定时':
      await sendMsg(ctx, event, deleteSchedule(event, args));
      break;
    case '群信息':
      await groupInfo(ctx, event);
      break;
    case '群统计':
      await groupStats(ctx, event);
      break;
    case '全员禁言':
      if (!checkManagePermission(event)) {
        await sendMsg(ctx, event, '没有权限');
        break;
      }
      await groupMuteAll(ctx, event, true);
      break;
    case '解禁全员':
      if (!checkManagePermission(event)) {
        await sendMsg(ctx, event, '没有权限');
        break;
      }
      await groupMuteAll(ctx, event, false);
      break;
    case '禁言':
      if (!checkManagePermission(event)) {
        await sendMsg(ctx, event, '没有权限');
        break;
      }
      {
        const t = extractTarget(event, args);
        if (!t) {
          await sendMsg(ctx, event, '用法：禁言 @某人 [分钟]');
          break;
        }
        const dur = (parseInt(t.duration || '5') || 5) * 60;
        await groupMute(ctx, event, t.qq, dur);
      }
      break;
    case '解禁':
      if (!checkManagePermission(event)) {
        await sendMsg(ctx, event, '没有权限');
        break;
      }
      {
        const t = extractTarget(event, args);
        if (!t) {
          await sendMsg(ctx, event, '用法：解禁 @某人');
          break;
        }
        await groupMute(ctx, event, t.qq, 0);
      }
      break;
    case '踢人':
      if (!checkManagePermission(event)) {
        await sendMsg(ctx, event, '没有权限');
        break;
      }
      {
        const t = extractTarget(event, args);
        if (!t) {
          await sendMsg(ctx, event, '用法：踢人 @某人');
          break;
        }
        await groupKick(ctx, event, t.qq);
      }
      break;
    case '群打卡':
      await groupPunchCard(ctx, event);
      break;
    case '戳一戳':
      {
        const t = extractTarget(event, args);
        await sendPoke(ctx, event, t ? t.qq : '');
      }
      break;
    case '设为精华':
      if (!checkManagePermission(event)) {
        await sendMsg(ctx, event, '没有权限');
        break;
      }
      await markEssence(ctx, event, args);
      break;
    case '群公告':
      if (!checkManagePermission(event)) {
        await sendMsg(ctx, event, '没有权限');
        break;
      }
      await sendGroupAnnouncement(ctx, event, args);
      break;
    case '设置群名':
      if (!checkManagePermission(event)) {
        await sendMsg(ctx, event, '没有权限');
        break;
      }
      await setGroupName(ctx, event, args);
      break;
    case '设管理':
      if (!checkOwner(event)) {
        await sendMsg(ctx, event, '没有权限');
        break;
      }
      {
        const t = extractTarget(event, args);
        if (!t) {
          await sendMsg(ctx, event, '用法：设管理 @某人');
          break;
        }
        await setGroupAdmin(ctx, event, t.qq);
      }
      break;
    case '取消管理':
      if (!checkOwner(event)) {
        await sendMsg(ctx, event, '没有权限');
        break;
      }
      {
        const t = extractTarget(event, args);
        if (!t) {
          await sendMsg(ctx, event, '用法：取消管理 @某人');
          break;
        }
        await removeGroupAdmin(ctx, event, t.qq);
      }
      break;
    case '添加关键词':
      await sendMsg(ctx, event, addKeyword(event, args));
      break;
    case '删除关键词':
      await sendMsg(ctx, event, delKeyword(args));
      break;
    case '关键词列表':
      await sendMsg(ctx, event, keywordList('💡 关键词列表'));
      break;
    case '获取激活码':
    case '获取授权码':
      await grantCode(ctx, event);
      break;
    case '激活':
      await activateCode(ctx, event, args);
      break;
    case '授权状态':
      await authStatus(ctx, event);
      break;
    case '频道列表':
      if (!checkOwner(event)) {
        await sendMsg(ctx, event, '没有权限');
        break;
      }
      await channelList(ctx, event);
      break;
    case '频道测试':
      if (!checkOwner(event)) {
        await sendMsg(ctx, event, '没有权限');
        break;
      }
      await channelTest(ctx, event);
      break;
    case '设置主人':
      if (!isOwner(event.user_id)) {
        await sendMsg(ctx, event, '没有权限');
        break;
      }
      await sendMsg(ctx, event, setOwner(event, args));
      break;
    case '主人列表':
      if (!isOwner(event.user_id)) {
        await sendMsg(ctx, event, '没有权限');
        break;
      }
      await sendMsg(ctx, event, ownerInfo());
      break;
    case '开启机器人':
    case '打开机器人':
      if (!checkOwner(event)) {
        await sendMsg(ctx, event, '没有权限');
        break;
      }
      await sendMsg(ctx, event, setGroupSwitch(event, true));
      break;
    case '关闭机器人':
      if (!checkOwner(event)) {
        await sendMsg(ctx, event, '没有权限');
        break;
      }
      await sendMsg(ctx, event, setGroupSwitch(event, false));
      break;
    case '群开关状态':
    case '本群状态':
      await sendMsg(ctx, event, groupSwitchStatus(event));
      break;
    case '全局开启':
      if (!isOwner(event.user_id)) {
        await sendMsg(ctx, event, '没有权限');
        break;
      }
      state.config.globalEnabled = true;
      state.saveConfig();
      await sendMsg(ctx, event, '✅ 全局模式已开启。');
      break;
    case '全局关闭':
      if (!isOwner(event.user_id)) {
        await sendMsg(ctx, event, '没有权限');
        break;
      }
      state.config.globalEnabled = false;
      state.saveConfig();
      await sendMsg(ctx, event, '✅ 全局模式已关闭，所有群停止响应。');
      break;
    case '定时关机':
      await sendMsg(ctx, event, scheduleShutdown(event, args));
      break;
    case '撤回':
      if (!isOwner(event.user_id)) {
        await sendMsg(ctx, event, '没有权限');
        break;
      }
      await deleteMsg(ctx, event, args.match(/\d+/)?.[0] || '');
      break;
    case '运行时间':
    case '在线时间':
      await sendMsg(ctx, event, uptimeInfo());
      break;
    case '版本':
      await sendMsg(ctx, event, versionInfo(PLUGIN_VERSION));
      break;
    case '更新日志':
      await sendMsg(ctx, event, changelog());
      break;
    case '赞助':
      await sendMsg(ctx, event, sponsorInfo());
      break;
    case '问候':
    case '你好':
    case 'hello':
      await sendMsg(ctx, event, greetingInfo());
      break;
    case '点歌':
    case '唱歌':
    case '唱首歌':
      await song(ctx, event, args);
      break;
    case '添加词典':
      await sendMsg(ctx, event, addKeyword(event, args));
      break;
    case '词典列表':
      await sendMsg(ctx, event, keywordList('📖 词典列表'));
      break;
  }
}
