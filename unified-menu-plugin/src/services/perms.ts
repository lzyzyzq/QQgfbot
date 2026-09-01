import type { CtxLike } from '../types';

function getSuperId(ctx: CtxLike): string {
  const raw = ctx.storage.get('super_master_id') || '';
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object' && obj.id) return String(obj.id);
    return raw;
  } catch {
    return raw;
  }
}

function getMinis(ctx: CtxLike): Array<{ id?: string; activated?: boolean }> {
  try {
    const v = JSON.parse(ctx.storage.get('mini_masters') || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function sameUser(ctx: CtxLike, a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  try {
    if (ctx.identity && typeof ctx.identity.isSameUser === 'function') return !!ctx.identity.isSameUser(a, b);
  } catch {}
  return false;
}

export function isSuper(ctx: CtxLike, userId: string): boolean {
  const superId = getSuperId(ctx);
  if (superId === userId) return true;
  return sameUser(ctx, superId, userId);
}

export function isMaster(ctx: CtxLike, userId: string): boolean {
  if (isSuper(ctx, userId)) return true;
  for (const m of getMinis(ctx)) {
    if (!m || !m.activated || !m.id) continue;
    if (m.id === userId) return true;
    if (sameUser(ctx, m.id, userId)) return true;
  }
  return false;
}
