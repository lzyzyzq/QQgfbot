// 群可达性登记：QQ 开放平台主动群消息返回 11255/已注销（群解散、机器人被移出、无主动消息权限）时，
// 登记该群"不可达"，定时任务/广播自动跳过，避免每个整点反复撞墙刷屏错误日志。
// 恢复：收到该群新消息视为群已重新可达，自动移出登记（自然闭环）。
// 存储：config 键 group_unreachable_list，JSON { gid: { at, botId, reason } }
import { getConfig, setConfig, getDb } from '../db/index';
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

/** 多机器人场景：发送定时任务时仅跳过「该机器人自己名下」且「曾由该机器人登记不可达」的群。
 *  不同机器人对同一 QQ 群的 OpenID 不同，全库群混发时会出现 A 机器人发 B 机器人视角的群
 *  OpenID → 必报 11255 → 被误登记不可达 → 连带自己名下的群也停发。此处按 botId 维度隔离，避免误停。 */
export function isGroupUnreachableFor(gid: string, botId: string): boolean {
  if (!gid || !botId) return false;
  const map = loadUnreachableGroups();
  if (!Object.prototype.hasOwnProperty.call(map, gid)) return false;
  const e = map[gid];
  return e && String(e.botId || '') === String(botId);
}

/** 自愈：清理「跨机器人误标」的停发记录。
 *  每个群 OpenID 只归属一台机器人（group_members/groups 中该 gid 的 bot_id）。
 *  定时任务曾用 A 机器人发 B 机器人视角的群 OpenID → 平台报 11255 → 误登记成
 *  { gid: { botId: A } }，而 gid 实际归属 B。此类记录应自动删除，否则会连带
 *  B 机器人自己名下的群也停发（isGroupUnreachableFor 已按 bot 隔离，但仍把脏数据清掉更干净）。
 *  返回清理条数。 */
export function pruneCrossBotUnreachableGroups(): number {
  try {
    const db = getDb();
    const map = loadUnreachableGroups();
    let removed = 0;
    for (const gid of Object.keys(map)) {
      const botId = map[gid].botId || '';
      if (!botId) continue;
      const hit = db.prepare(
        "SELECT 1 FROM group_members WHERE group_id = ? AND bot_id = ? LIMIT 1"
      ).get(gid, botId) || db.prepare(
        "SELECT 1 FROM groups WHERE id = ? AND bot_id = ? LIMIT 1"
      ).get(gid, botId);
      if (!hit) {
        delete map[gid];
        removed++;
        logger.warn(`停发记录自愈清除: 群 ${gid} 登记的机器人 ${botId} 与群实际归属不符（疑似跨机器人误标）`);
      }
    }
    if (removed) save(map);
    return removed;
  } catch {
    return 0;
  }
}
