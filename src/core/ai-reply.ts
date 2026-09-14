import fs from 'fs';
import { getConfig, setConfig, getDb, addSystemLog } from '../db/index';
import { getBotInstance } from './bot';
import { createLogger } from '../utils/logger';
import type { AdminAuth } from '../admin/auth';
import type { AiBotConfig, AiMessage, AiProvider } from '../admin/ai-config';

const logger = createLogger('ai-reply');

// 每次成功调用 AI 兜底回复扣减的金币数
export const COIN_COST_PER_CALL = 1;
// 消息到达后等待插件（词库等）回复的窗口时长
const REPLY_WAIT_MS = 3500;
// 同一会话（bot+target）在窗口期内的去重，防止刷屏重复请求
const pending = new Map<string, boolean>();
// 最近消息平台 id（用于被动回复 msg_id）
const lastMsgId = new Map<string, string>();

let authRef: AdminAuth | null = null;

function key(botId: string, target: string): string {
  return `${botId}|${target}`;
}

export function getBotAiConfig(appId: string): AiBotConfig {
  const defaults: AiBotConfig = {
    enabled: false,
    providerId: '',
    keyMode: 'system',
    ownKey: '',
    baseUrl: '',
    model: '',
    temperature: 0.8,
    maxTokens: 512,
    memoryRounds: 5,
    systemPrompt: '',
    groupEnabled: true,
    c2cEnabled: true,
    groupTrigger: 'at',
    toolsJson: '',
  };
  try {
    const raw = getConfig(`ai.bot.${appId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return { ...defaults, ...parsed };
    }
  } catch (e) { /* 配置损坏时用默认 */ }
  return defaults;
}

export function saveBotAiConfig(appId: string, cfg: AiBotConfig) {
  setConfig(`ai.bot.${appId}`, JSON.stringify(cfg));
}

export function listProviders(): AiProvider[] {
  try {
    const raw = getConfig('ai.providers');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

export function saveProviders(list: AiProvider[]) {
  setConfig('ai.providers', JSON.stringify(list));
}

export function getProvider(id: string): AiProvider | undefined {
  return listProviders().find((p) => p && p.id === id);
}

export function toProviderView(list: AiProvider[]): Array<Omit<AiProvider, 'systemKey'> & { hasSystemKey: boolean }> {
  return list.map((p) => {
    const { systemKey, ...rest } = p || ({} as AiProvider);
    return { ...rest, hasSystemKey: Boolean(systemKey) };
  });
}

// 清理 @ 段（<@openid>）与首尾空白，得到纯文本
function stripAt(content: string): string {
  return String(content || '').replace(/<@\w+>/g, '').trim();
}

function isAtMessage(content: string): boolean {
  return /<@\w+>/.test(String(content || ''));
}

function parseToolsJson(raw: string): any[] | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {}
  return null;
}

// 调用 OpenAI 兼容接口（chat/completions）
export async function callModel(
  provider: AiProvider,
  cfg: AiBotConfig,
  messages: AiMessage[],
): Promise<string> {
  const apiKey = cfg.keyMode === 'own' ? (cfg.ownKey || '').trim() : (provider.systemKey || '');
  const baseUrl = (cfg.baseUrl || provider.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) throw new Error('未配置模型地址');
  if (!apiKey) throw new Error('未配置 API Key');
  const model = (cfg.model || provider.model || '').trim();
  if (!model) throw new Error('未配置模型名称');

  const body: any = {
    model,
    messages,
    temperature: Math.min(2, Math.max(0, Number(cfg.temperature) || 0.8)),
    max_tokens: Math.min(4096, Math.max(16, Number(cfg.maxTokens) || 512)),
  };
  const tools = parseToolsJson(cfg.toolsJson);
  if (tools && tools.length) body.tools = tools;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    } as any);
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`模型接口 ${resp.status}: ${text.substring(0, 200)}`);
    }
    const data: any = await resp.json();
    const content = data?.choices?.[0]?.message?.content;
    const out = typeof content === 'string' ? content.trim() : '';
    if (!out) throw new Error('模型返回空内容');
    return out;
  } finally {
    clearTimeout(timer);
  }
}

// 从消息流水（system_logs）拼装最近对话记忆（user/assistant 交替）
function buildMemory(botId: string, target: string, rounds: number): AiMessage[] {
  const msgs: AiMessage[] = [];
  try {
    const rows = getDb().prepare(
      "SELECT category, message, detail FROM system_logs WHERE bot_id = ? AND group_id = ? AND category IN ('message','send') ORDER BY id DESC LIMIT ?"
    ).all(botId, target, Math.max(1, Math.min(20, rounds)) * 4) as any[];
    for (const row of rows.reverse()) {
      const detail = String(row.detail || '');
      if (row.category === 'message') {
        // 收到消息的 detail 为 JSON（含 content）
        try {
          const d = JSON.parse(detail);
          const c = stripAt(d.content || '');
          if (c) msgs.push({ role: 'user', content: c });
        } catch {}
      } else if (String(row.message || '').indexOf('发送成功') !== -1) {
        // 机器人回复：detail 前段为内容（可能有 " | 错误信息" 后缀）
        const sep = detail.indexOf(' | ');
        const c = (sep === -1 ? detail : detail.substring(0, sep)).trim();
        if (c) msgs.push({ role: 'assistant', content: c });
      }
      if (msgs.length >= rounds * 2) break;
    }
  } catch (e) { /* 记忆构建失败时退化为单轮 */ }
  return msgs;
}

// 判定自 sinceLogId 以来该 bot+target 是否已有回复（recordBotSend 写 category='send'，target 落在 group_id）
function hasReplySince(botId: string, target: string, sinceLogId: number): boolean {
  try {
    const row = getDb().prepare(
      "SELECT COUNT(*) AS c FROM system_logs WHERE category = 'send' AND bot_id = ? AND group_id = ? AND id > ?"
    ).get(botId, target, sinceLogId) as { c: number };
    return (row?.c || 0) > 0;
  } catch {
    return false;
  }
}

function currentMaxLogId(): number {
  try {
    const row = getDb().prepare('SELECT MAX(id) AS m FROM system_logs').get() as { m: number };
    return row?.m || 0;
  } catch {
    return 0;
  }
}

function getBotOwner(appId: string): string {
  try {
    const bots = JSON.parse(fs.readFileSync('data/bots.json', 'utf-8'));
    const b = Array.isArray(bots) ? bots.find((x: any) => x && x.appId === appId) : undefined;
    return String(b?.owner || '');
  } catch {
    return '';
  }
}

async function handleIncoming(data: any, scene: 'group' | 'c2c') {
  try {
    const botId = String(data.botId || '');
    if (!botId) return;
    const content = stripAt(data.content || '');
    if (!content) return;
    const target = scene === 'group' ? String(data.groupId || '') : String(data.author?.id || '');
    if (!target) return;

    const cfg = getBotAiConfig(botId);
    if (!cfg.enabled) return;
    if (scene === 'group') {
      if (!cfg.groupEnabled) return;
      // 仅 @机器人 时回复：AT 事件即代表 @ 了机器人（eventType 由 webhook 传入）
      if (cfg.groupTrigger === 'at') {
        const isAt = data.eventType === 'GROUP_AT_MESSAGE_CREATE' || isAtMessage(data.content);
        if (!isAt) return;
      }
    } else if (!cfg.c2cEnabled) return;

    const k = key(botId, target);
    if (pending.get(k)) return;
    pending.set(k, true);
    // 窗口期后自动释放，超时兜底防泄漏
    setTimeout(() => pending.delete(k), REPLY_WAIT_MS + 60000);

    const sinceId = currentMaxLogId();
    const msgId = String(data.id || '');
    setTimeout(() => {
      pending.delete(k);
      fallbackReply(botId, target, content, cfg, sinceId, scene, msgId).catch((e) =>
        logger.error(`AI fallback error: ${e.message}`)
      );
    }, REPLY_WAIT_MS);
  } catch (e: any) {
    logger.error(`AI handleIncoming error: ${e.message}`);
  }
}

async function fallbackReply(
  botId: string,
  target: string,
  userContent: string,
  cfg: AiBotConfig,
  sinceId: number,
  scene: 'group' | 'c2c',
  msgId: string,
) {
  try {
    // 等待窗口内插件（词库等）已回复则不兜底
    if (hasReplySince(botId, target, sinceId)) return;

    const provider = cfg.providerId ? getProvider(cfg.providerId) : undefined;
    if (!provider) {
      logger.warn(`AI fallback: provider ${cfg.providerId} not found for bot ${botId}`);
      return;
    }

    const bot = getBotInstance(botId);
    if (!bot) return;

    // bot owner 金币校验（余额不足则跳过）
    const owner = getBotOwner(botId);
    if (owner && authRef) {
      const u = authRef.getUser(owner);
      const coins = typeof u?.coins === 'number' ? u.coins : 0;
      if (coins < COIN_COST_PER_CALL) {
        logger.warn(`AI fallback: owner ${owner} 金币不足（${coins}），跳过回复 bot=${botId}`);
        return;
      }
    }

    // 组装消息：系统提示 + 记忆 + 当前消息
    const messages: AiMessage[] = [];
    if (cfg.systemPrompt && cfg.systemPrompt.trim()) {
      messages.push({ role: 'system', content: cfg.systemPrompt.trim() });
    }
    if (cfg.memoryRounds > 0) {
      messages.push(...buildMemory(botId, target, cfg.memoryRounds));
    }
    messages.push({ role: 'user', content: userContent });

    const reply = await callModel(provider, cfg, messages);

    // 成功调用才扣金币
    if (owner && authRef) {
      const next = authRef.adjustCoins(owner, -COIN_COST_PER_CALL, `AI 兜底回复（机器人 ${botId}）`, 'system');
      if (next === null) logger.warn(`AI fallback: 扣金币失败 owner=${owner}`);
    }

    // 发送回复（带 msg_id 被动回复）
    if (scene === 'group') {
      await bot.sendGroupMessage(target, reply, msgId || lastMsgId.get(key(botId, target)) || undefined);
    } else {
      await bot.sendPrivateMessage(target, reply, msgId || lastMsgId.get(key(botId, target)) || undefined);
    }
    addSystemLog('info', 'message', 'AI 兜底回复', JSON.stringify({ scene, content: reply.substring(0, 500) }), '', target, botId);
    logger.info(`AI fallback replied: bot=${botId} target=${target} coins-1`);
  } catch (e: any) {
    logger.error(`AI fallbackReply error: ${e.message}`);
    addSystemLog('warn', 'ai', `AI 兜底回复失败: ${e.message}`, '', '', target, botId);
  }
}

export function initAiReply(eventBus: any, adminAuth: AdminAuth) {
  authRef = adminAuth;
  eventBus.on('message.group', (data: any) => {
    try {
      if (data && typeof data === 'object') {
        lastMsgId.set(key(String(data.botId), String(data.groupId || '')), String(data.id || ''));
      }
    } catch {}
    return handleIncoming(data, 'group');
  });
  eventBus.on('message.c2c', (data: any) => {
    try {
      if (data && typeof data === 'object') {
        lastMsgId.set(key(String(data.botId), String(data.author?.id || '')), String(data.id || ''));
      }
    } catch {}
    return handleIncoming(data, 'c2c');
  });
  logger.info('AI fallback reply listener registered');
}
