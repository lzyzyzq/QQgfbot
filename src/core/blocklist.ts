import { getConfig, setConfig } from '../db/index';

// 全局用户黑名单（封用户）：config KV 持久化，同时容纳 QQ 号与 OpenID。
// webhook 消息入口命中黑名单时直接丢弃事件（含群聊与私聊），封禁后该用户所有消息机器人不再响应。
const KEY = 'bot.blocklist';
const CACHE_MS = 15000;
let cache: { list: string[]; at: number } | null = null;

export function getBlocklist(): string[] {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.list;
  try {
    const raw = getConfig(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    cache = { list, at: Date.now() };
    return list;
  } catch {
    cache = { list: [], at: Date.now() };
    return cache.list;
  }
}

function writeBlocklist(list: string[]): void {
  setConfig(KEY, JSON.stringify(list));
  cache = { list, at: Date.now() };
}

export function addBlocked(id: string): void {
  const v = String(id || '').trim();
  if (!v) return;
  const list = getBlocklist();
  if (!list.includes(v)) writeBlocklist([...list, v]);
}

export function removeBlocked(id: string): void {
  const v = String(id || '').trim();
  if (!v) return;
  writeBlocklist(getBlocklist().filter((x) => x !== v));
}

// 命中判定：openid 或 QQ 号任一在黑名单即封禁
export function isBlocked(openid: string, qqId: string): boolean {
  const list = getBlocklist();
  if (!list.length) return false;
  const o = String(openid || '');
  const q = String(qqId || '');
  const hit = (o && list.includes(o)) || (q && list.includes(q));
  return Boolean(hit);
}
