import type { CtxLike } from '../types';

// 每日备注：每个用户每日一条备注，按日期覆盖
function today(): string {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

export function setNote(ctx: CtxLike, openid: string, content: string): string {
  const c = content.trim();
  if (!c) return '📝 每日备注：发送「每日备注 要记录的内容」';
  const t = today();
  const key = 'note.' + openid + '.' + t;
  try { ctx.storage.set(key, c); } catch {}
  return '📝 已记录今日备注：' + c;
}

export function getNote(ctx: CtxLike, openid: string): string {
  const t = today();
  try {
    const v = ctx.storage.get('note.' + openid + '.' + t);
    if (v) return '📝 今日备注：' + v;
  } catch {}
  return '📝 今日暂无备注，发送「每日备注 内容」记录';
}
