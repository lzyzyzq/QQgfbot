import { execSync } from 'child_process';
import { state } from '../core/state';
import { callApi, sendMsg } from '../core/actions';
import { todayStr } from '../core/utils';
import { splitList, groupEnabled, enableGroup, disableGroup } from '../config';
import type { PluginContext, GroupEvent } from '../types';

export function uptimeInfo(): string {
  const s = process.uptime();
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `⏱ 在线时间：${d}天 ${h}小时 ${m}分钟`;
}

export function versionInfo(version: string): string {
  return `📦 智能机器人插件 v${version}
运行 NapCat 插件系统
作者：空空爱追剧（QQ 511742399）`;
}

export function changelog(): string {
  return `【更新日志】
v3.1.0
- 群开关支持按群配置（哪些群开启/哪些群关闭，可在设置界面填写）
- TypeScript 工程重构（napcat-plugin-template 风格）
- 设置界面响应式升级（电脑端/手机端）
- 所有功能整合到单一插件，不再重复散落
v3.0.0
- 授权码对接面板授权 API（auth_codes 表同源，激活同步到面板）
- 新增频道管理（频道列表 / 频道测试）
v2.0.0
- TypeScript 模块化重构
- 新增 NapCat 接口命令（群打卡/戳一戳/精华/公告/群名/管理员）
v1.0.0
- 全新智能机器人插件
- 群开关/主人/授权管理
- 三种菜单（文字/按钮/图片）
- 娱乐中心/签到/群管理/定时推送等`;
}

export function sponsorInfo(): string {
  return `【赞助我们】
如果觉得好用，请支持一下开发者～
作者：空空爱追剧（QQ 511742399）
感谢你的支持！`;
}

export function greetingInfo(): string {
  return `你好呀！我是智能机器人。
发送「菜单」查看所有功能吧～`;
}

export function scheduleShutdown(event: GroupEvent, args: string): string {
  const uid = String(event.user_id);
  if (!state.data.owners.includes(uid) && !state.config.ownerIds.includes(uid)) {
    return '该命令仅限主人使用。';
  }
  const m = args.match(/(\d+)\s*分钟/);
  if (!m) return '用法：定时关机 <N> 分钟';
  const min = parseInt(m[1]);
  if (min <= 0 || min > 720) return '时间范围 1-720 分钟。';
  setTimeout(() => {
    try {
      execSync('shutdown -h +1');
    } catch {}
  }, min * 60000);
  return `✅ 已设置 ${min} 分钟后关机。`;
}

export async function setNickname(ctx: PluginContext, event: GroupEvent, name: string): Promise<void> {
  if (!name) {
    await sendMsg(ctx, event, '用法：设置昵称 <名字>');
    return;
  }
  if (event.message_type === 'group') {
    const res = await callApi(ctx, 'set_group_card', {
      group_id: String(event.group_id),
      user_id: String(event.user_id),
      card: name,
    });
    await sendMsg(ctx, event, res === null ? '设置失败，可能没有权限。' : `✅ 已将你的群名片改为：${name}`);
  } else {
    await sendMsg(ctx, event, '群名片只能在群聊中设置。');
  }
}

export function dailyNote(event: GroupEvent, content: string): string {
  if (!content) {
    return '用法：每日备注 <内容>，会每天推送给你。';
  }
  const uid = String(event.user_id);
  state.data.dailyNotes[uid] = content;
  state.saveData();
  return `✅ 每日备注已设置：${content}`;
}

export function dailyCheckin(event: GroupEvent): string {
  const uid = String(event.user_id);
  const today = todayStr();
  const st: any = state.data.checkins[uid] || { last: '', count: 0 };
  if (st.last === today) return '今天已经打过卡了。';
  st.last = today;
  st.count = (st.count || 0) + 1;
  state.data.checkins[uid] = st;
  state.saveData();
  return `✅ 打卡成功！累计打卡 ${st.count} 天。`;
}

export function chatTour(event: GroupEvent): string {
  const uid = String(event.user_id);
  return `🔍 查巡：用户 ${uid} 记录
群开关：${event.group_id ? (groupEnabled(event.group_id) ? '开启' : '关闭') : '-'}
授权码：${Object.keys(state.data.activatedCodes).filter((c) => state.data.activatedCodes[c].owner === String(uid)).length} 个
签到：${(state.data.signin[uid] || {}).points || 0} 积分`;
}

export function ownerInfo(): string {
  const owners = [...state.config.ownerIds, ...state.data.owners];
  return `👑 主人列表：${owners.join('、') || '暂无'}`;
}

export function setOwner(event: GroupEvent, args: string): string {
  const qq = args.match(/\d+/);
  if (!qq) return '用法：设置主人 <QQ号>';
  if (!state.data.owners.includes(qq[0])) state.data.owners.push(qq[0]);
  state.saveData();
  return `✅ 已将 ${qq[0]} 设为主人。`;
}

export function groupSwitchStatus(event: GroupEvent): string {
  if (event.message_type !== 'group') return '该命令仅群聊可用。';
  const gid = String(event.group_id);
  const on = groupEnabled(gid);
  const enabled = splitList(state.config.groupEnabledList);
  const disabled = splitList(state.config.groupDisabledList);
  const lines = [
    `🔘 本群机器人：${on ? '开启' : '关闭'}`,
    `开启的群列表：${enabled.length ? enabled.join('、') : '（空 = 全部开启）'}`,
    `关闭的群列表：${disabled.length ? disabled.join('、') : '（空）'}`,
  ];
  return lines.join('\n');
}

export function setGroupSwitch(event: GroupEvent, on: boolean): string {
  if (event.message_type !== 'group') return '该命令仅群聊可用。';
  const gid = String(event.group_id);
  if (on) {
    enableGroup(gid);
    return '✅ 本群机器人已开启。';
  }
  disableGroup(gid);
  return '✅ 本群机器人已关闭。';
}
