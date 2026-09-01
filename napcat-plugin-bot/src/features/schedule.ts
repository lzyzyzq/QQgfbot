import { state } from '../core/state';
import { nowTime, todayStr } from '../core/utils';
import type { GroupEvent } from '../types';

export function addSchedule(event: GroupEvent, args: string): string {
  const m = args.match(/^(\d{1,2}):(\d{2})\s+(.+)$/);
  if (!m) {
    const iv = args.match(/^每\s*(\d+)\s*分钟\s+(.+)$/);
    if (iv) {
      const s2 = {
        type: 'interval',
        minutes: parseInt(iv[1]),
        message: iv[2],
        target: String(event.group_id || event.user_id),
        isGroup: !!event.group_id,
        createdAt: Date.now(),
      };
      state.data.schedules.push(s2);
      state.saveData();
      return `✅ 已添加间隔推送：每 ${iv[1]} 分钟发送「${iv[2]}」`;
    }
    return '用法：添加定时 08:00 内容，或 添加定时 每30分钟 内容';
  }
  const s = {
    type: 'daily',
    time: `${m[1].padStart(2, '0')}:${m[2]}`,
    message: m[3],
    target: String(event.group_id || event.user_id),
    isGroup: !!event.group_id,
    createdAt: Date.now(),
  };
  state.data.schedules.push(s);
  state.saveData();
  return `✅ 已添加每日定时 ${s.time} 发送「${s.message}」`;
}

export function listSchedules(event: GroupEvent): string {
  const target = String(event.group_id || event.user_id);
  const mine = state.data.schedules.filter((s) => s.target === target);
  if (!mine.length) return '还没有定时任务。';
  return `⏰ 定时列表（${target}）
${mine.map((s, i) => `${i + 1}. ${s.type === 'daily' ? `每日 ${s.time}` : `每${s.minutes}分钟`} - ${s.message}`).join('\n')}
发送「删除定时 <序号>」删除`;
}

export function deleteSchedule(event: GroupEvent, idx: string): string {
  const target = String(event.group_id || event.user_id);
  const mine = state.data.schedules.filter((s2) => s2.target === target);
  const i = parseInt(idx) - 1;
  if (isNaN(i) || i < 0 || i >= mine.length) return '序号无效。';
  const s = mine[i];
  state.data.schedules = state.data.schedules.filter((x) => x !== s);
  state.saveData();
  return `✅ 已删除定时：${s.message}`;
}

export function checkSchedules(): void {
  const ctx = state.ctx;
  if (!ctx) return;
  const now = nowTime();
  for (const s of state.data.schedules) {
    if (!s) continue;
    if (s.type === 'daily' && s.time === now) {
      const params: Record<string, any> = {
        message: s.message,
        message_type: s.isGroup ? 'group' : 'private',
      };
      if (s.isGroup) params.group_id = s.target;
      else params.user_id = s.target;
      ctx.actions.call('send_msg', params, ctx.adapterName, ctx.pluginManager.config).catch(() => {});
    } else if (s.type === 'interval' && s.minutes) {
      const elapsed = Date.now() - s.createdAt;
      const period = s.minutes * 60000;
      const lastTick = Math.floor(elapsed / period);
      if (lastTick > 0) {
        const params: Record<string, any> = {
          message: s.message,
          message_type: s.isGroup ? 'group' : 'private',
        };
        if (s.isGroup) params.group_id = s.target;
        else params.user_id = s.target;
        ctx.actions.call('send_msg', params, ctx.adapterName, ctx.pluginManager.config).catch(() => {});
        s.createdAt = Date.now();
      }
    }
  }
  const today = todayStr();
  if (now === (state.config.dailyPushTime || '08:00')) {
    for (const [uid, note] of Object.entries(state.data.dailyNotes)) {
      ctx.actions
        .call('send_msg', { message: `📝 每日备注提醒：${note}`, message_type: 'private', user_id: uid }, ctx.adapterName, ctx.pluginManager.config)
        .catch(() => {});
    }
  }
  const md = today.slice(5);
  for (const [uid, bd] of Object.entries(state.data.birthdays)) {
    if (String(bd).slice(5) === md) {
      ctx.actions
        .call('send_msg', { message: '🎂 今天是你的生日，祝你生日快乐！', message_type: 'private', user_id: uid }, ctx.adapterName, ctx.pluginManager.config)
        .catch(() => {});
    }
  }
}
