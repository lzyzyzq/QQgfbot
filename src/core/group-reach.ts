// 群可达性登记：QQ 开放平台主动群消息返回 11255/已注销（群解散、机器人被移出、无主动消息权限）时，
// 登记该群"不可达"，定时任务/广播自动跳过，避免每个整点反复撞墙刷屏错误日志。
// 恢复：收到该群新消息视为群已重新可达，自动移出登记（自然闭环）。
// 存储：config 键 group_unreachable_list，JSON { gid: { at, botId, reason } }
import { getConfig, setConfig } from '../db/index';
import { createLogger } from '../utils/logger';

const logger = createLogger('group-reach');
const KEY = 'group_unreachable_list';
const MAX_ENTRIES = 200;

interface UnreachableEntry {
  at: number;
  botId: string;
  reason: string;
}

export function isUnreachableGroupError(msg: string): boolean {
  return /(11255|40011028|已注销|群已解散)/.test(String(msg || ''));
}

export function loadUnreachableGroups(): Record<string, UnreachableEntry> {
  try {
    const raw = getConfig(KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

function save(map: Record<string, UnreachableEntry>) {
  try {
    setConfig(KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

// 群已登记过则不重复登记
export function markGroupUnreachable(gid: string, botId: string, reason: string) {
  if (!gid) return;
  try {
    const map = loadUnreachableGroups();
    if (map[gid]) return;
    map[gid] = { at: Date.now(), botId: botId || '', reason: String(reason || '').substring(0, 200) };
    const keys = Object.keys(map);
    if (keys.length > MAX_ENTRIES) {
      const sorted = keys.sort((a, b) => (map[a].at || 0) - (map[b].at || 0));
      for (const k of sorted.slice(0, keys.length - MAX_ENTRIES)) delete map[k];
    }
    save(map);
    logger.warn(`群 ${gid} 主动消息不可达(已注销/无权限)，已自动停发该群定时播报: ${reason}`);
  } catch {
    /* ignore */
  }
}

// 收到该群新消息：视为可达，移出登记
export function reviveGroupUnreachable(gid: string) {
  if (!gid) return;
  try {
    const map = loadUnreachableGroups();
    if (!map[gid]) return;
    delete map[gid];
    save(map);
    logger.info(`群 ${gid} 收到新消息，已恢复定时播报发送资格`);
  } catch {
    /* ignore */
  }
}

export function isGroupUnreachable(gid: string): boolean {
  if (!gid) return false;
  return Object.prototype.hasOwnProperty.call(loadUnreachableGroups(), gid);
}
