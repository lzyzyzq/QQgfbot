import type { CtxLike } from '../types';

// 签到系统：按用户 OpenID 存签到记录（连续天数/总天数/积分），key 带插件前缀自动隔离
interface SignRecord {
  lastDate: string;
  streak: number;
  total: number;
  points: number;
}

function today(): string {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function read(ctx: CtxLike, openid: string): SignRecord {
  try {
    const v = JSON.parse(ctx.storage.get('signin.' + openid) || 'null');
    if (v && typeof v === 'object') return { lastDate: v.lastDate || '', streak: v.streak || 0, total: v.total || 0, points: v.points || 0 };
  } catch {}
  return { lastDate: '', streak: 0, total: 0, points: 0 };
}

function write(ctx: CtxLike, openid: string, r: SignRecord): void {
  try { ctx.storage.set('signin.' + openid, JSON.stringify(r)); } catch {}
}

// 排行索引：记录所有签到过的 openid，避免遍历 config 表（PluginStorage 无 keys()）
function indexOf(ctx: CtxLike): string[] {
  try {
    const v = JSON.parse(ctx.storage.get('signin.index') || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function ensureIndex(ctx: CtxLike, openid: string): void {
  const list = indexOf(ctx);
  if (!list.includes(openid)) {
    list.push(openid);
    try { ctx.storage.set('signin.index', JSON.stringify(list)); } catch {}
  }
}

export function checkin(ctx: CtxLike, openid: string): string {
  const t = today();
  const r = read(ctx, openid);
  if (r.lastDate === t) return '📅 今天已签到过啦（已连续 ' + r.streak + ' 天，积分 ' + r.points + '）';
  r.streak = r.lastDate ? r.streak + 1 : 1;
  r.total += 1;
  r.points += 1;
  r.lastDate = t;
  write(ctx, openid, r);
  ensureIndex(ctx, openid);
  return '📅 签到成功！\n连续签到：' + r.streak + ' 天\n总签到：' + r.total + ' 天\n当前积分：' + r.points;
}

export function backcheck(ctx: CtxLike, openid: string): string {
  const t = today();
  const r = read(ctx, openid);
  if (r.lastDate === t) return '📅 今天已签到，无法补签';
  r.streak += 1;
  r.total += 1;
  r.points += 1;
  r.lastDate = t;
  write(ctx, openid, r);
  ensureIndex(ctx, openid);
  return '⏪ 补签成功！\n连续签到：' + r.streak + ' 天\n当前积分：' + r.points;
}

export function myPoints(ctx: CtxLike, openid: string): string {
  const r = read(ctx, openid);
  return '💰 当前积分：' + r.points + '\n连续签到：' + r.streak + ' 天\n总签到：' + r.total + ' 天';
}

function allRecords(ctx: CtxLike): Array<{ openid: string; r: SignRecord }> {
  const out: Array<{ openid: string; r: SignRecord }> = [];
  for (const openid of indexOf(ctx)) {
    const r = read(ctx, openid);
    if (r.total > 0 || r.points > 0) out.push({ openid, r });
  }
  return out;
}

export function signinRank(ctx: CtxLike, limit = 10): string {
  const list = allRecords(ctx).sort((a, b) => b.r.total - a.r.total).slice(0, limit);
  if (!list.length) return '🏆 签到排行：暂无数据，发送「签到」抢占榜首';
  const lines = list.map((it, i) => (i + 1) + '. ' + mask(it.openid) + '（' + it.r.total + '天）');
  return '🏆 签到排行 TOP' + list.length + '：\n' + lines.join('\n');
}

export function pointRank(ctx: CtxLike, limit = 10): string {
  const list = allRecords(ctx).sort((a, b) => b.r.points - a.r.points).slice(0, limit);
  if (!list.length) return '💰 积分排行：暂无数据，发送「签到」获取积分';
  const lines = list.map((it, i) => (i + 1) + '. ' + mask(it.openid) + '（' + it.r.points + '分）');
  return '💰 积分排行 TOP' + list.length + '：\n' + lines.join('\n');
}

function mask(openid: string): string {
  if (!openid) return '未知用户';
  return openid.length <= 8 ? openid : openid.slice(0, 6) + '***' + openid.slice(-4);
}
