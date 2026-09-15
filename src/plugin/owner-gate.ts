import { getDb, getConfig, setConfig } from '../db/index';
import { getBotInstance } from '../core/bot';
import { createLogger } from '../utils/logger';

const logger = createLogger('owner-gate');

// 每插件「主人与授权」配置（config 表持久化）
export interface OwnerConfig {
  // 主人列表：QQ 号或 OpenID
  owners: string[];
  // 群聊授权记录：groupId -> { expireAt: 毫秒时间戳，null=永久 }
  groupAuth: Record<string, { expireAt: number | null }>;
  // 群聊未授权提示文字（空=静默跳过）
  unauthText: string;
}

const cache = new Map<string, { cfg: OwnerConfig; at: number }>();
const CACHE_MS = 15000;
// 未授权提示节流：同插件+群 60 秒内只提示一次
const unauthThrottle = new Map<string, number>();

function cfgKey(pluginId: string): string {
  return `plugin.owner.${pluginId}`;
}

export function readOwnerConfig(pluginId: string): OwnerConfig {
  const cached = cache.get(pluginId);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.cfg;
  const defaults: OwnerConfig = { owners: [], groupAuth: {}, unauthText: '' };
  try {
    const raw = getConfig(cfgKey(pluginId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const cfg: OwnerConfig = {
          owners: Array.isArray(parsed.owners) ? parsed.owners.map(String) : [],
          groupAuth: parsed.groupAuth && typeof parsed.groupAuth === 'object' ? parsed.groupAuth : {},
          unauthText: String(parsed.unauthText || ''),
        };
        cache.set(pluginId, { cfg, at: Date.now() });
        return cfg;
      }
    }
  } catch { /* 损坏时用默认 */ }
  cache.set(pluginId, { cfg: defaults, at: Date.now() });
  return defaults;
}

export function writeOwnerConfig(pluginId: string, cfg: OwnerConfig): void {
  setConfig(cfgKey(pluginId), JSON.stringify(cfg));
  cache.set(pluginId, { cfg, at: Date.now() });
}

// OpenID → QQ 号（user_mappings）
function qqOfUser(openid: string): string {
  try {
    const row = getDb().prepare('SELECT qq_number FROM user_mappings WHERE openid = ?').get(String(openid || '')) as any;
    return String(row?.qq_number || '');
  } catch { return ''; }
}

function isOwner(pluginId: string, userId: string): boolean {
  const cfg = readOwnerConfig(pluginId);
  if (!cfg.owners.length) return false;
  const uid = String(userId || '');
  if (cfg.owners.includes(uid)) return true;
  const qq = qqOfUser(uid);
  return Boolean(qq && cfg.owners.includes(qq));
}

// 清理过期授权：返回仍有效的记录
function activeAuth(cfg: OwnerConfig): Record<string, { expireAt: number | null }> {
  const now = Date.now();
  const out: Record<string, { expireAt: number | null }> = {};
  for (const [gid, v] of Object.entries(cfg.groupAuth || {})) {
    if (v && (v.expireAt === null || v.expireAt > now)) out[gid] = v;
  }
  return out;
}

function sendReply(pluginId: string, data: any, text: string): void {
  try {
    const botId = String(data.botId || '');
    const bot = getBotInstance(botId);
    if (!bot) return;
    const msgId = String(data.id || '');
    const groupId = String(data.groupId || '');
    if (groupId) bot.sendGroupMessage(groupId, text, msgId);
    else bot.sendPrivateMessage(String(data.author?.id || ''), text, msgId);
  } catch (e: any) {
    logger.warn(`owner-gate sendReply failed: ${e.message}`);
  }
}

// 毫秒 → 人性化到期描述
function expireText(expireAt: number | null): string {
  if (expireAt === null) return '永久有效';
  const days = Math.max(0, Math.ceil((expireAt - Date.now()) / 86400000));
  return new Date(expireAt).toLocaleString('zh-CN', { hour12: false }) + `（剩余约 ${days} 天）`;
}

// 处理 owner: 指令，返回回复文本；非 owner 返回拒绝提示
function handleOwnerCommand(pluginId: string, data: any, cmd: string, pluginName: string): string {
  const userId = String(data.author?.id || '');
  const cfg = readOwnerConfig(pluginId);
  if (!isOwner(pluginId, userId)) {
    return '你不是主人，无权操作';
  }
  const groupId = String(data.groupId || '');

  if (cmd === 'owner:开启' || cmd === 'owner:打开') {
    try {
      getDb().prepare('UPDATE plugins SET enabled = 1 WHERE id = ?').run(pluginId);
      const engine = require('./engine') as typeof import('./engine');
      const inst = (engine as any).getPluginEngine ? (engine as any).getPluginEngine() : null;
      if (inst) inst.reload(pluginId).catch(() => {});
    } catch (e: any) { return '开启失败：' + e.message; }
    return `✅ 已开启「${pluginName}」`;
  }
  if (cmd === 'owner:关闭' || cmd === 'owner:停用') {
    try {
      getDb().prepare('UPDATE plugins SET enabled = 0 WHERE id = ?').run(pluginId);
      const engine = require('./engine') as typeof import('./engine');
      const inst = (engine as any).getPluginEngine ? (engine as any).getPluginEngine() : null;
      if (inst) inst.disable(pluginId).catch(() => {});
    } catch (e: any) { return '关闭失败：' + e.message; }
    return `⏸ 已停用「${pluginName}」（仅主人可重新开启）`;
  }
  if (cmd === 'owner:授权') {
    if (!groupId) return '❌ 授权仅群聊有效';
    cfg.groupAuth[groupId] = { expireAt: null };
    writeOwnerConfig(pluginId, cfg);
    return `✅ 已永久授权本群使用「${pluginName}」`;
  }
  if (cmd.startsWith('owner:授权:')) {
    if (!groupId) return '❌ 授权仅群聊有效';
    const days = Math.trunc(Number(cmd.split(':')[2]));
    if (!days || days <= 0) return '❌ 天数格式：owner:授权:7（数字为天数）';
    cfg.groupAuth[groupId] = { expireAt: Date.now() + days * 86400000 };
    writeOwnerConfig(pluginId, cfg);
    return `✅ 已授权本群 ${days} 天使用「${pluginName}」`;
  }
  if (cmd === 'owner:取消授权') {
    if (!groupId) return '❌ 仅群聊有效';
    if (!cfg.groupAuth[groupId]) return '本群暂无授权记录';
    delete cfg.groupAuth[groupId];
    writeOwnerConfig(pluginId, cfg);
    return `✅ 已取消本群「${pluginName}」授权`;
  }
  if (cmd === 'owner:查询授权') {
    const active = activeAuth(cfg);
    if (!Object.keys(active).length) return `「${pluginName}」未配置群授权：所有群聊开放`;
    const hit = active[groupId];
    if (hit) return `本群授权状态：${expireText(hit.expireAt)}`;
    return `本群未授权（已授权群数：${Object.keys(active).length}）。主人可发送 owner:授权 开通。`;
  }
  return '';
}

export interface GateResult {
  pass: boolean;
  // 需要回复的文本（未授权提示 / owner 指令确认）
  replyText?: string;
}

// 插件消息门禁：owner: 指令处理 + 群授权检查
export function ownerGate(pluginId: string, pluginName: string, data: any): GateResult {
  try {
    const content = String(data.content || '').trim();
    const groupId = String(data.groupId || '');
    const userId = String(data.author?.id || '');
    const cfg = readOwnerConfig(pluginId);
    const hasOwners = cfg.owners.length > 0;

    // owner: 指令（配置了主人列表才生效）
    if (hasOwners && content.startsWith('owner:')) {
      const reply = handleOwnerCommand(pluginId, data, content, pluginName);
      return { pass: false, replyText: reply || undefined };
    }

    // 群授权门禁（仅群聊；主人不受限；私聊不受限）
    if (groupId) {
      const active = activeAuth(cfg);
      const configured = Object.keys(cfg.groupAuth || {}).length > 0;
      if (configured && !active[groupId]) {
        if (hasOwners && isOwner(pluginId, userId)) return { pass: true };
        const key = pluginId + '|' + groupId;
        const last = unauthThrottle.get(key) || 0;
        if (cfg.unauthText && Date.now() - last > 60000) {
          unauthThrottle.set(key, Date.now());
          return { pass: false, replyText: cfg.unauthText };
        }
        return { pass: false };
      }
    }
    return { pass: true };
  } catch (e: any) {
    logger.error(`ownerGate error: ${e.message}`);
    return { pass: true };
  }
}

export { sendReply };
