import { state } from '../core/state';
import { todayStr } from '../core/utils';
import type { GroupEvent } from '../types';

function getSignin(event: GroupEvent): any {
  const uid = String(event.user_id);
  if (!state.data.signin[uid]) {
    state.data.signin[uid] = { points: 0, streak: 0, last: '', history: {} };
  }
  return state.data.signin[uid];
}

export function doSignin(event: GroupEvent): string {
  const st = getSignin(event);
  const today = todayStr();
  if (st.last === today) {
    return `今天已经签过到啦！当前积分 ${st.points}，连续 ${st.streak} 天。`;
  }
  const prev = st.last;
  const prevDate = new Date(today);
  prevDate.setDate(prevDate.getDate() - 1);
  const expected = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}-${String(prevDate.getDate()).padStart(2, '0')}`;
  st.streak = prev === expected ? st.streak + 1 : 1;
  const bonus = st.streak >= 7 ? 10 : st.streak >= 3 ? 5 : 0;
  const base = 5 + Math.floor(Math.random() * 6);
  st.points += base + bonus;
  st.last = today;
  st.history[today] = (st.history[today] || 0) + 1;
  state.saveData();
  return `✅ 签到成功！获得 ${base} 积分${bonus ? ` + ${bonus} 连续奖励` : ''}
连续签到 ${st.streak} 天，当前积分 ${st.points}`;
}

export function makeupSignin(event: GroupEvent): string {
  const st = getSignin(event);
  const cost = 20;
  if (st.points < cost) return `补签需要 ${cost} 积分，当前 ${st.points} 积分不足。`;
  st.points -= cost;
  st.streak += 1;
  state.saveData();
  return `✅ 补签成功！消耗 ${cost} 积分，连续 ${st.streak} 天，剩余积分 ${st.points}`;
}

export function leaderboard(): string {
  const entries = Object.entries(state.data.signin).map(([uid, v]) => ({ uid, ...v }));
  entries.sort((a, b) => b.points - a.points);
  if (!entries.length) return '还没有人签到，快来第一个签到吧！';
  const lines = entries.slice(0, 10).map((e, i) => `${i + 1}. ${e.uid}：${e.points} 积分（连续 ${e.streak} 天）`);
  return `🏆 签到排行榜
${lines.join('\n')}`;
}

export function personalInfo(event: GroupEvent): string {
  const uid = String(event.user_id);
  const st: any = state.data.signin[uid] || { points: 0, streak: 0 };
  const wf = state.data.woodFish[uid] || 0;
  const f: any = state.data.fishing[uid] || { count: 0, score: 0 };
  return `【个人信息】
QQ：${uid}
积分：${st.points}（连续 ${st.streak} 天）
功德：${wf}
钓鱼：${f.count} 次 / ${f.score} 分`;
}
