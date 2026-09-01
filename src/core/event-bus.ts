import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../utils/logger';
import { getDb, getConfig } from '../db/index';

const logger = createLogger('event-bus');

type EventHandler = (data: any) => void | Promise<void>;

interface ListenerMeta {
  pluginId?: string;
}

interface Listener {
  id: string;
  event: string;
  handler: EventHandler;
  meta?: ListenerMeta;
}

const BUILT_IN_EVENTS = [
  'message.group',
  'message.c2c',
  'message.guild',
  'guild.member.add',
  'guild.member.remove',
  'bot.connected',
  'bot.disconnected',
  'plugin.loaded',
  'plugin.unloaded',
  'plugin.enabled',
  'plugin.disabled',
  'plugin.error',
] as const;

export type BotEvent = (typeof BUILT_IN_EVENTS)[number] | string;

// 进程内缓存：bot_id+plugin_id → boolean（true=放行 false=跳过）
const assignmentCache = new Map<string, boolean>();
// 记录每个 bot_id 是否已有任何分配记录；无记录（undefined）表示该机器人处于全局模式
const botHasAssignment = new Set<string>();

export function getPluginAssignment(pluginId: string, botId: string): boolean | null {
  try {
    if (!botHasAssignment.has(botId)) return null;
    const key = `${botId}\u0001${pluginId}`;
    if (assignmentCache.has(key)) return assignmentCache.get(key) === true;
    const row = getDb().prepare('SELECT assigned FROM bot_plugins WHERE bot_id = ? AND plugin_id = ?').get(botId, pluginId) as any;
    const val = !!row && row.assigned === 1;
    assignmentCache.set(key, val);
    return val;
  } catch {
    // 查询异常 fail-open：放行，避免阻断消息
    return null;
  }
}

export function resetAssignmentCache(botId?: string, pluginId?: string): void {
  if (botId) {
    for (const key of Array.from(assignmentCache.keys())) {
      if (key.startsWith(botId + '\u0001')) assignmentCache.delete(key);
    }
    if (!pluginId) botHasAssignment.delete(botId);
  } else {
    assignmentCache.clear();
    botHasAssignment.clear();
  }
}

export function markBotHasAssignment(botId: string): void {
  botHasAssignment.add(botId);
}

// ==================== 插件按群开关（plugin_group_config） ====================
// 缓存：pluginId+group_id → 'allow'|'deny'|''（''=未配置）；pluginId → 是否已有 allow 白名单记录
const groupPolicyCache = new Map<string, string>();
const pluginHasAllowCache = new Map<string, boolean>();

// 返回插件在指定群的门控模式：'allow'（仅此群启用）/ 'deny'（此群禁用）/ null（未配置，跟随全局）
export function getPluginGroupMode(pluginId: string, groupId: string): string | null {
  try {
    const key = `${pluginId}\u0001${groupId}`;
    if (groupPolicyCache.has(key)) {
      const v = groupPolicyCache.get(key) || '';
      return v === '' ? null : v;
    }
    const row = getDb().prepare('SELECT mode FROM plugin_group_config WHERE plugin_id = ? AND group_id = ?').get(pluginId, groupId) as any;
    const val = row ? String(row.mode) : '';
    groupPolicyCache.set(key, val);
    return val === '' ? null : val;
  } catch {
    // 查询异常 fail-open：放行，避免阻断消息
    return null;
  }
}

// 该插件是否配置了白名单（allow）记录：配置后未命中的群一律跳过该插件
export function pluginHasAllowPolicy(pluginId: string): boolean {
  try {
    if (pluginHasAllowCache.has(pluginId)) return pluginHasAllowCache.get(pluginId)!;
    const row = getDb().prepare("SELECT COUNT(*) AS c FROM plugin_group_config WHERE plugin_id = ? AND mode = 'allow'").get(pluginId) as any;
    const val = !!row && row.c > 0;
    pluginHasAllowCache.set(pluginId, val);
    return val;
  } catch {
    return false;
  }
}

export function resetGroupPolicyCache(pluginId?: string): void {
  if (pluginId) {
    for (const key of Array.from(groupPolicyCache.keys())) {
      if (key.startsWith(pluginId + '\u0001')) groupPolicyCache.delete(key);
    }
    pluginHasAllowCache.delete(pluginId);
  } else {
    groupPolicyCache.clear();
    pluginHasAllowCache.clear();
  }
}

// 启动时从 DB 重建分配缓存：有任意 bot_plugins 记录的 bot_id 标记为"按分配运行"模式，
// 避免服务重启后历史分配记录失效（丢失后机器人会回到全局模式运行全部插件）。
export function initAssignmentCache(): void {
  try {
    const rows = getDb().prepare(
      'SELECT DISTINCT bot_id FROM bot_plugins WHERE bot_id IS NOT NULL AND bot_id != ?'
    ).all('') as any[];
    assignmentCache.clear();
    botHasAssignment.clear();
    for (const r of rows) {
      if (r && r.bot_id) botHasAssignment.add(String(r.bot_id));
    }
    logger.info(`Assignment cache initialized: ${botHasAssignment.size} bot(s) in per-bot mode`);
  } catch (e: any) {
    logger.warn(`Init assignment cache failed: ${e.message}`);
  }
}

// 该机器人是否有可用的已审核插件（assigned=1）。
// 无任何分配记录（全局模式）视为可用全部启用插件，返回 true。
export function botHasUsableAssignment(botId: string): boolean {
  try {
    if (!botHasAssignment.has(botId)) return true;
    const row = getDb().prepare('SELECT COUNT(*) AS c FROM bot_plugins WHERE bot_id = ? AND assigned = 1').get(botId) as any;
    return !!row && row.c > 0;
  } catch {
    return true;
  }
}

// 超主机器人（config 主机器人 AppID），用于小主人机器人插件回退
let masterBotIdCache = '';
export function getMasterBotId(): string {
  if (masterBotIdCache) return masterBotIdCache;
  try {
    masterBotIdCache = String(getConfig('bot.app_id') || '').trim();
  } catch {}
  return masterBotIdCache;
}

export class EventBus {
  private listeners: Listener[] = [];

  on(event: BotEvent, handler: EventHandler, meta?: ListenerMeta): string {
    const id = uuidv4();
    this.listeners.push({ id, event, handler, meta });
    logger.debug(`Listener ${id} registered for event: ${event}`);
    return id;
  }

  off(listenerId: string): void {
    const before = this.listeners.length;
    this.listeners = this.listeners.filter((l) => l.id !== listenerId);
    if (this.listeners.length < before) {
      logger.debug(`Listener ${listenerId} removed`);
    }
  }

  async emit(event: BotEvent, data: any, waitAll = false): Promise<void> {
    const matched = this.listeners.filter((l) => l.event === event);
    if (matched.length === 0) {
      logger.info(`No listeners for event: ${event}`);
      return;
    }
    logger.debug(`Emitting event: ${event} to ${matched.length} listeners`);

    logger.info(`Emitting event: ${event} to ${matched.length} listeners`);

    const botId = data && typeof data === 'object' ? data.botId : undefined;
    let skippedByPlugin = 0;
    let ran = 0;
    const tasks: Promise<void>[] = [];

    for (const listener of matched) {
      // 按机器人分配过滤：事件带 botId 且监听者带 pluginId 时才判断
      // per-bot 模式（该机器人有 bot_plugins 分配记录）严格独立：只运行勾选的插件，未勾选一律跳过
      if (botId && listener.meta?.pluginId) {
        const assigned = getPluginAssignment(listener.meta.pluginId, String(botId));
        if (assigned === false) {
          skippedByPlugin++;
          continue;
        }
      }
      // 按群开关过滤：仅消息群事件带 groupId 时判断
      // mode='deny' → 该插件在此群禁用；未配置但插件存在 allow 白名单 → 未命中群一律跳过
      if (botId && listener.meta?.pluginId && event === 'message.group' && data && data.groupId) {
        const mode = getPluginGroupMode(listener.meta.pluginId, String(data.groupId));
        if (mode === 'deny') {
          skippedByPlugin++;
          continue;
        }
        if (mode === null && pluginHasAllowPolicy(listener.meta.pluginId)) {
          skippedByPlugin++;
          continue;
        }
      }
      ran++;
      // 并发执行监听者：单个监听者内部慢操作（HTTP/上传）不得阻塞其他监听者与后续消息
      const task = Promise.resolve()
        .then(() => listener.handler(data))
        .catch((err) => { logger.error(`Error in listener ${listener.id} for event ${event}: ${String(err)}`); });
      tasks.push(task);
    }
    if (skippedByPlugin > 0) {
      logger.debug(`Event ${event}: skipped ${skippedByPlugin} plugin listener(s) not assigned to bot ${botId}, ran ${ran}`);
    }
    if (waitAll) {
      await Promise.all(tasks);
    }
  }

  removeAll(): void {
    this.listeners = [];
  }

  getListenerCount(event?: BotEvent): number {
    if (event) {
      return this.listeners.filter((l) => l.event === event).length;
    }
    return this.listeners.length;
  }
}

export const eventBus = new EventBus();
export { BUILT_IN_EVENTS };
