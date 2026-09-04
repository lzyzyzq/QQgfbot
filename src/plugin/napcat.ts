import path from 'path';
import fs from 'fs';
import { getDb, getConfig, getQQByOpenid, getMappingByOpenid } from '../db/index';
import { createLogger } from '../utils/logger';
import type { BotAPI } from './types';
import { callNapcatAction, isNapcatEnabled } from '../core/napcat';

const logger = createLogger('napcat');

export function napcatDataDir(id: string): string {
  return path.join(process.cwd(), 'data', 'napcat', id);
}

export function napcatConfigPath(id: string): string {
  return path.join(napcatDataDir(id), 'config.json');
}

export function isNapcatModule(mod: any): boolean {
  return !!mod && typeof mod.plugin_init === 'function';
}

function groupNumberToOpenid(groupNumber: string | number): string | null {
  const db = getDb();
  try {
    const row = db.prepare('SELECT id FROM groups WHERE group_number = ?').get(String(groupNumber)) as any;
    return row ? row.id : null;
  } catch {
    return null;
  }
}

function groupOpenidToNumber(groupOpenid: string): string | null {
  const db = getDb();
  try {
    const row = db.prepare('SELECT group_number FROM groups WHERE id = ?').get(groupOpenid) as any;
    return row ? String(row.group_number) : null;
  } catch {
    return null;
  }
}

function qqToOpenid(qqNumber: string | number): string | null {
  const db = getDb();
  try {
    const row = db.prepare(
      'SELECT openid FROM user_mappings WHERE qq_number = ? LIMIT 1'
    ).get(String(qqNumber)) as any;
    if (row && row.openid) return row.openid;
  } catch {}
  const mappings = (db.prepare('SELECT openid FROM user_mappings').all() as any[]) || [];
  for (const m of mappings) {
    if (m && m.openid && getQQByOpenid(m.openid) === String(qqNumber)) return m.openid;
  }
  return null;
}

function selfQqNumber(): string {
  const db = getDb();
  try {
    const r = db.prepare("SELECT value FROM config WHERE key = 'bot.qq_number'").get() as any;
    if (r && r.value) return r.value;
  } catch {}
  return '0';
}

function botName(): string {
  return getConfig('bot.name') || '空空';
}

export interface NapcatHandleMessage {
  type: 'message' | 'notice' | 'request';
  data: Record<string, any>;
}

export async function initNapcatPlugin(
  mod: any,
  opts: {
    id: string;
    name: string;
    pluginPath: string;
    botApi: BotAPI;
    engine?: any;
  }
): Promise<{
  ctx: any;
  schema: any[];
  dispatch: (sysEvent: any) => Promise<void>;
  cleanup: () => Promise<void>;
  configFilePath: string;
  mod: any;
}> {
  const { id, name, pluginPath, botApi, engine } = opts;
  const dataDir = napcatDataDir(id);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const configFilePath = napcatConfigPath(id);

  const ctx: any = {
    core: {
      selfInfo: { uid: id, uin: selfQqNumber(), nick: botName() },
    },
    oneBot: null,
    pluginName: name,
    pluginPath,
    configPath: configFilePath,
    dataPath: dataDir,
    adapterName: 'onebot11',
    pluginManager: {
      config: readNapcatConfig(id),
      enable: (pluginId: string) => engine?.enable?.(pluginId),
      disable: (pluginId: string) => engine?.disable?.(pluginId),
      setPluginStatus: (pluginId: string, status: boolean) =>
        status ? engine?.enable?.(pluginId) : engine?.disable?.(pluginId),
      getPlugin: (pluginId: string) => {
        const info = engine?.getPluginInfo?.(pluginId);
        return info ? { id: pluginId, ...info } : null;
      },
      sdk: {
        getPluginExports: (pluginId: string) => engine?.getPluginExports?.(pluginId),
        getPluginPath: (pluginId: string) => engine?.getPluginSourcePath?.(pluginId),
      },
    },
    getPluginExports: (pluginId: string) => engine?.getPluginExports?.(pluginId),
    NapCatConfig: {
      text: (key: string, label: string, value?: any, placeholder?: string) =>
        ({ type: 'text', key, label, value: value ?? '', placeholder: placeholder ?? '' }),
      boolean: (key: string, label: string, value?: any) =>
        ({ type: 'boolean', key, label, value: !!value }),
      select: (key: string, label: string, value?: any, options?: any[]) =>
        ({ type: 'select', key, label, value: value ?? '', options: options ?? [] }),
      number: (key: string, label: string, value?: any, min?: number, max?: number) =>
        ({ type: 'number', key, label, value: value ?? '', min, max }),
      list: (key: string, label: string, value?: any) =>
        ({ type: 'list', key, label, value: value ?? [] }),
      multiSelect: (key: string, label: string, options?: any[], value?: any[]) =>
        ({ type: 'multiSelect', key, label, options: options ?? [], value: value ?? [] }),
      html: (html: string) =>
        ({ type: 'html', html: html ?? '' }),
      combine: (...fields: any[]) => {
        const flat: any[] = [];
        for (const f of fields) {
          if (Array.isArray(f)) flat.push(...f);
          else if (f) flat.push(f);
        }
        return flat;
      },
    },
    logger: {
      info: (...a: any[]) => logger.info(`[${name}] ${a.map(String).join(' ')}`),
      warn: (...a: any[]) => logger.warn(`[${name}] ${a.map(String).join(' ')}`),
      error: (...a: any[]) => logger.error(`[${name}] ${a.map(String).join(' ')}`),
      debug: (...a: any[]) => logger.debug(`[${name}] ${a.map(String).join(' ')}`),
    },
    router: null,
    actions: {
      call: (action: string, params: any = {}, _adapter?: string, _config?: any) =>
        handleNapcatAction(action, params, ctx),
    },
    _botApi: botApi,
    _data: { dataDir, configFilePath },
  };

  if (typeof mod.plugin_init === 'function') {
    await mod.plugin_init(ctx);
  }

  let schema: any[] = [];
  const collectSchema = (src: any) => {
    if (!src) return;
    if (Array.isArray(src)) schema = schema.concat(src);
    else if (typeof src === 'function') {
      const out = src(ctx);
      if (Array.isArray(out)) schema = schema.concat(out);
      else if (out) schema.push(out);
    } else if (typeof src === 'object') schema.push(src);
  };
  collectSchema(mod.plugin_config_ui);
  collectSchema(mod.plugin_config_schema);
  // plugin_config_controller 挂到 schema 上下文，前端暂忽略动态控制
  ctx.plugin_config_controller = typeof mod.plugin_config_controller === 'function' ? mod.plugin_config_controller : undefined;

  generateNapcatWebui(pluginPath, id, name);

  const dispatch = async (sysEvent: any) => {
    try {
      const event = toOneBotEvent(sysEvent);
      if (!event) return;
      if (event.post_type === 'message' && typeof mod.plugin_onmessage === 'function') {
        await mod.plugin_onmessage(ctx, event);
      } else if (typeof mod.plugin_onevent === 'function') {
        await mod.plugin_onevent(ctx, event);
      }
    } catch (e: any) {
      logger.warn(`[${name}] 处理事件失败: ${e.message}`);
    }
  };

  const cleanup = async () => {
    try {
      if (typeof mod.plugin_cleanup === 'function') {
        await mod.plugin_cleanup(ctx);
      }
    } catch (e: any) {
      logger.warn(`[${name}] plugin_cleanup 失败: ${e.message}`);
    }
  };

  // 配置读写：插件导出自定义实现则优先，否则走 data/napcat/<id>/config.json
  ctx._getConfigImpl = () => {
    if (typeof mod.plugin_get_config === 'function') {
      const out = mod.plugin_get_config(ctx);
      if (out && typeof out === 'object') return out;
    }
    return readNapcatConfig(id);
  };
  ctx._setConfigImpl = (config: Record<string, any>) => {
    if (typeof mod.plugin_set_config === 'function') {
      const out = mod.plugin_set_config(ctx, config);
      if (out === false) return false;
    }
    writeNapcatConfig(id, config);
    return true;
  };
  ctx._notifyConfigChange = async (oldCfg: Record<string, any>, newCfg: Record<string, any>) => {
    try {
      if (typeof mod.plugin_on_config_change === 'function') {
        await mod.plugin_on_config_change(oldCfg, newCfg);
      }
    } catch (e: any) {
      logger.warn(`[${name}] plugin_on_config_change 失败: ${e.message}`);
    }
  };

  return { ctx, schema, dispatch, cleanup, configFilePath, mod };
}

export function readNapcatConfig(id: string): Record<string, any> {
  const p = napcatConfigPath(id);
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e: any) {
    logger.warn(`读取 NapCat 配置失败 ${p}: ${e.message}`);
  }
  return {};
}

export function writeNapcatConfig(id: string, config: Record<string, any>): void {
  const p = napcatConfigPath(id);
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(config, null, 2), 'utf-8');
  } catch (e: any) {
    logger.warn(`写入 NapCat 配置失败 ${p}: ${e.message}`);
  }
}

function toOneBotEvent(sysEvent: any): Record<string, any> | null {
  if (!sysEvent) return null;
  const isGroup = !!sysEvent.groupId;
  const openid = sysEvent.author?.openid || sysEvent.author?.id || '';
  const mapping = openid ? getMappingByOpenid(openid) : null;
  const mappedQq = mapping?.qq_number || getQQByOpenid(openid);
  // openid 为纯数字（如测试模拟 user_id）时直接作为 QQ 号，否则走映射
  const qq = mappedQq || (/^\d+$/.test(openid) ? openid : '0');
  const groupNumber = isGroup ? (groupOpenidToNumber(sysEvent.groupId) || '0') : undefined;

  return {
    post_type: 'message',
    message_type: isGroup ? 'group' : 'private',
    message_id: String(sysEvent.id || (Date.now() % 0xffffffff)),
    user_id: Number(qq) || 0,
    group_id: groupNumber !== undefined ? Number(groupNumber) : undefined,
    self_id: Number(selfQqNumber()) || 0,
    raw_message: String(sysEvent.content || ''),
    message: [{ type: 'text', data: { text: String(sysEvent.content || '') } }],
    sender: {
      user_id: Number(qq) || 0,
      nickname: sysEvent.author?.username || sysEvent.author?.qqId || '',
      card: '',
    },
    time: Math.floor((Number(sysEvent.timestamp) || Date.now()) / 1000),
  };
}

function messageToText(message: any): string {
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) {
    return message.map((seg: any) => {
      const data = seg?.data || {};
      switch (seg?.type) {
        case 'text':
          return data.text || '';
        case 'at':
          return data.qq === 'all' ? '@全体成员' : `@${data.qq || ''}`;
        case 'image':
          return data.url || '[图片]';
        case 'face':
          return '[表情]';
        case 'reply':
          return '';
        case 'node':
          return `[转发消息] ${data.name || ''}: ${messageToText(data.content)}`;
        default:
          return '';
      }
    }).join('').trim();
  }
  return String(message || '');
}

async function handleNapcatAction(action: string, params: any, ctx: any): Promise<any> {
  const bot: BotAPI = ctx._botApi;
  const data = params || {};

  // 真实小号能力：NapCat HTTP 已配置时优先走 OneBot 动作（踢人/禁言/全禁/公告/频道/好友/群/群开关），
  // HTTP 失败则回退本地实现（开放平台映射）。
  const httpPriorityActions = new Set([
    'set_group_kick',
    'set_group_ban',
    'set_group_whole_ban',
    'set_group_admin',
    'set_group_special_title',
    'set_group_card',
    'set_group_notice',
    '_send_group_notice',
    'set_group_name',
    'delete_msg',
    'send_group_msg',
    'send_private_msg',
    'get_friend_list',
    'get_group_list',
    'get_group_member_info',
    'get_group_member_list',
    'send_qq_channel_msg',
    'send_qq_channel_guild_msg',
    'get_qq_channel_list',
    'get_qq_channel_info',
    'get_qq_channel_guild_member_list',
    'create_qq_channel',
    'delete_qq_channel',
    'set_qq_channel_role',
    'set_qq_channel_special_title',
    'set_qq_channel_user_permission',
  ]);
  if (httpPriorityActions.has(action) && isNapcatEnabled()) {
    try {
      const resp = await callNapcatAction(action, data);
      return { status: resp.status || 'ok', retcode: resp.retcode ?? 0, data: resp.data ?? null, wording: resp.wording };
    } catch (e: any) {
      logger.warn(`[napcat HTTP] ${action} 失败，回退本地实现: ${e.message}`);
    }
  }

  switch (action) {
    case 'send_msg':
    case 'send_group_msg':
    case 'send_private_msg': {
      const text = messageToText(data.message);
      const toGroup = action === 'send_group_msg' || (action === 'send_msg' && data.message_type === 'group');
      if (toGroup || data.group_id) {
        const groupOpenid = groupNumberToOpenid(data.group_id);
        if (!groupOpenid) throw new Error(`群号映射失败: ${data.group_id}`);
        await bot.sendGroupMessage(groupOpenid, text);
      } else {
        const userOpenid = qqToOpenid(data.user_id);
        if (!userOpenid) throw new Error(`QQ 映射失败: ${data.user_id}`);
        await bot.sendPrivateMessage(userOpenid, text);
      }
      return { status: 'ok', retcode: 0, data: { message_id: String(Date.now() % 0xffffffff) } };
    }

    case 'get_group_member_info': {
      const groupOpenid = groupNumberToOpenid(data.group_id);
      const members = groupOpenid ? await bot.getGroupMembers(groupOpenid).catch(() => []) : [];
      const member = members.find((m: any) => getQQByOpenid(m.openid || m.member_openid) === String(data.user_id)) || {};
      return {
        status: 'ok',
        retcode: 0,
        data: {
          group_id: Number(data.group_id) || 0,
          user_id: Number(data.user_id) || 0,
          nickname: member.nickname || member.username || '',
          card: member.nickname || '',
          role: member.role || 'member',
        },
      };
    }

    case 'set_group_ban': {
      const groupOpenid = groupNumberToOpenid(data.group_id);
      if (!groupOpenid) throw new Error(`群号映射失败: ${data.group_id}`);
      const memberOpenid = qqToOpenid(data.user_id);
      if (!memberOpenid) throw new Error(`QQ 映射失败: ${data.user_id}`);
      const duration = Number(data.duration) || 0;
      if (duration <= 0) await bot.unmuteMember(groupOpenid, memberOpenid);
      else await bot.muteMember(groupOpenid, memberOpenid, duration);
      return { status: 'ok', retcode: 0, data: null };
    }

    case 'set_group_whole_ban': {
      const groupOpenid = groupNumberToOpenid(data.group_id);
      if (!groupOpenid) throw new Error(`群号映射失败: ${data.group_id}`);
      await bot.muteAll(groupOpenid, !!data.enable, 86400 * 365);
      return { status: 'ok', retcode: 0, data: null };
    }

    case 'set_group_kick': {
      const groupOpenid = groupNumberToOpenid(data.group_id);
      if (!groupOpenid) throw new Error(`群号映射失败: ${data.group_id}`);
      const memberOpenid = qqToOpenid(data.user_id);
      if (!memberOpenid) throw new Error(`QQ 映射失败: ${data.user_id}`);
      await bot.kickMember(groupOpenid, memberOpenid, !!data.reject_add_request, Number(data.delete_msg_days) || 0);
      return { status: 'ok', retcode: 0, data: null };
    }

    case 'delete_msg':
      return { status: 'ok', retcode: 0, data: null };

    case 'get_group_list': {
      const db = getDb();
      const groups = (db.prepare('SELECT id, group_number, name FROM groups').all() as any[]) || [];
      return {
        status: 'ok',
        retcode: 0,
        data: groups.map((g: any) => ({
          group_id: Number(g.group_number) || 0,
          group_name: g.name || '',
          member_count: 0,
        })),
      };
    }

    case 'get_friend_list': {
      const db = getDb();
      const mappings = (db.prepare('SELECT qq_number, nickname FROM user_mappings WHERE qq_number IS NOT NULL AND qq_number != \'\'').all() as any[]) || [];
      const seen = new Set<string>();
      const friends: any[] = [];
      for (const m of mappings) {
        const qq = String(m.qq_number);
        if (!qq || seen.has(qq)) continue;
        seen.add(qq);
        friends.push({ user_id: Number(qq) || 0, nickname: m.nickname || '' });
      }
      return { status: 'ok', retcode: 0, data: friends };
    }

    case 'get_login_info': {
      return {
        status: 'ok',
        retcode: 0,
        data: { user_id: Number(selfQqNumber()) || 0, nickname: botName() },
      };
    }

    case 'get_group_member_list': {
      const groupOpenid = groupNumberToOpenid(data.group_id);
      const members = groupOpenid ? await bot.getGroupMembers(groupOpenid).catch(() => []) : [];
      return {
        status: 'ok',
        retcode: 0,
        data: members.map((m: any) => ({
          user_id: Number(getQQByOpenid(m.openid || m.member_openid) || 0),
          nickname: m.nickname || m.username || '',
          card: m.nickname || '',
          role: m.role || 'member',
        })),
      };
    }

    case 'send_group_card':
      return { status: 'ok', retcode: 0, data: null };

    case 'set_group_notice':
    case '_send_group_notice': {
      const groupOpenid = groupNumberToOpenid(data.group_id);
      if (!groupOpenid) throw new Error(`群号映射失败: ${data.group_id}`);
      const text = messageToText(data.content || data.message || '');
      if (!text) throw new Error('公告内容为空');
      const result = await bot.setAnnouncement(groupOpenid, text).catch(() => null);
      return {
        status: 'ok',
        retcode: 0,
        data: result && typeof result === 'object' && (result.id || result.announcement_id)
          ? { id: String(result.id || result.announcement_id), text }
          : { id: String(Date.now() % 0xffffffff), text },
      };
    }

    case 'set_group_admin': {
      // 开放平台无设置群管理员能力，HTTP 优先已覆盖真实场景
      throw new Error('设置群管理员需接入 NapCat HTTP 小号（当前未配置或已断开）');
    }

    case 'set_group_special_title': {
      const groupOpenid = groupNumberToOpenid(data.group_id);
      if (!groupOpenid) throw new Error(`群号映射失败: ${data.group_id}`);
      const memberOpenid = qqToOpenid(data.user_id);
      if (!memberOpenid) throw new Error(`QQ 映射失败: ${data.user_id}`);
      const specialTitle = String(data.special_title || '');
      const duration = Number(data.duration) || -1;
      const extBot = bot as any;
      if (typeof extBot.setGroupSpecialTitle === 'function') {
        await extBot.setGroupSpecialTitle(groupOpenid, memberOpenid, specialTitle, duration);
        return { status: 'ok', retcode: 0, data: null };
      }
      throw new Error('当前 BotAPI 不支持设置群头衔，请接入 NapCat HTTP 小号');
    }

    case 'send_qq_channel_msg':
    case 'send_qq_channel_guild_msg': {
      const channelId = data.channel_id || data.channelId;
      if (!channelId) throw new Error('缺少 channel_id');
      const text = messageToText(data.message);
      const result = await bot.sendMessage(channelId, text);
      return { status: 'ok', retcode: 0, data: { message_id: result?.message_id || String(Date.now() % 0xffffffff) } };
    }

    case 'get_qq_channel_list': {
      const guilds = await bot.getGuilds().catch(() => []);
      return {
        status: 'ok',
        retcode: 0,
        data: (guilds || []).map((g: any) => ({
          guild_id: g.id,
          guild_name: g.name || '',
        })),
      };
    }

    case 'get_qq_channel_guild_member_list': {
      const guildId = data.guild_id || data.guildId;
      const channels = guildId ? await bot.getChannels(guildId).catch(() => []) : [];
      return { status: 'ok', retcode: 0, data: (channels || []).map((c: any) => ({ channel_id: c.id, channel_name: c.name || '' })) };
    }

    case 'get_qq_channel_info': {
      const channelId = data.channel_id || data.channelId;
      const detail = channelId ? await bot.getChannelDetail(channelId).catch(() => null) : null;
      return { status: 'ok', retcode: 0, data: detail || null };
    }

    case 'create_qq_channel':
    case 'delete_qq_channel':
    case 'set_qq_channel_role':
    case 'set_qq_channel_special_title':
    case 'set_qq_channel_user_permission':
      // 这些动作仅 NapCat HTTP 小号支持，HTTP 已优先；走到这里说明未配置 HTTP
      throw new Error(`动作 ${action} 需接入 NapCat HTTP 小号（当前未配置或已断开）`);

    default:
      logger.warn(`NapCat 动作未实现: ${action}`);
      return { status: 'failed', retcode: 1404, data: null };
  }
}

const WEBUI_TEMPLATE = `<!DOCTYPE html>
<!-- wui-v3 -->
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>__PLUGIN_NAME__ · NapCat 兼容配置</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system,"PingFang SC","Microsoft YaHei",sans-serif; background: #eef0f4; color: #333; padding: 20px 16px 120px; }
  .wrap { max-width: 760px; margin: 0 auto; }
  .card { background: #fff; border-radius: 12px; padding: 20px; box-shadow: 0 2px 12px rgba(0,0,0,.06); }
  .card + .card { margin-top: 14px; }
  .head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  h1 { font-size: 18px; }
  .badge { font-size: 11px; color: #2563eb; background: #dbeafe; border-radius: 999px; padding: 2px 10px; }
  .sub { font-size: 12px; color: #999; margin-top: 4px; width: 100%; }
  .field { margin-bottom: 14px; }
  .field label { display: block; font-size: 13px; margin-bottom: 6px; color: #444; font-weight: 600; }
  .field input, .field textarea, .field select { width: 100%; padding: 10px 12px; border: 1px solid #d9d9d9; border-radius: 8px; font-size: 14px; background: #fff; transition: border-color .15s; }
  .field input:focus, .field textarea:focus, .field select:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,.12); }
  .field .hint { font-size: 12px; color: #999; margin-top: 5px; }
  .field.switch-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #f8fafc; border: 1px solid #eef1f5; border-radius: 10px; padding: 12px 14px; }
  .field.switch-row label { margin: 0; font-weight: 600; }
  .field.switch-row .hint { margin: 3px 0 0; }
  .switch { position: relative; width: 52px; height: 30px; flex: none; }
  .switch input { opacity: 0; width: 0; height: 0; }
  .slider { position: absolute; inset: 0; background: #d1d5db; border-radius: 999px; cursor: pointer; transition: .2s; }
  .slider:before { content: ""; position: absolute; width: 24px; height: 24px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: .2s; box-shadow: 0 1px 3px rgba(0,0,0,.25); }
  .switch input:checked + .slider { background: #ec4899; }
  .switch input:checked + .slider:before { transform: translateX(22px); }
  .actions { display: flex; gap: 10px; }
  .btn { flex: 1; padding: 12px 0; border: 0; border-radius: 10px; font-size: 14px; cursor: pointer; color: #fff; font-weight: 600; }
  .btn-primary { background: #ec4899; }
  .btn-default { background: #e2e8f0; color: #475569; }
  .toast { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); background: #16a34a; color: #fff; padding: 10px 20px; border-radius: 8px; font-size: 13px; display: none; z-index: 99; box-shadow: 0 4px 14px rgba(0,0,0,.18); }
  .empty { text-align: center; color: #999; padding: 30px 0; }
  .sticky-bar { position: fixed; left: 0; right: 0; bottom: 0; background: rgba(255,255,255,.96); padding: 10px 16px; border-top: 1px solid #eee; z-index: 20; }
  .sticky-bar .actions { max-width: 760px; margin: 0 auto; }
  @media (min-width: 768px) {
    .sticky-bar { position: static; background: none; border-top: none; padding: 0; margin-top: 18px; }
    .sticky-bar .actions { max-width: 760px; }
    .btn { padding: 10px 0; }
  }
  @media (max-width: 480px) {
    body { padding: 12px 10px 110px; }
    .card { padding: 16px 14px; }
  }
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <div class="head">
      <h1>__PLUGIN_NAME__</h1>
      <span class="badge">NapCat 兼容配置</span>
    </div>
    <div class="sub">配置保存在 data/napcat 目录，保存后重新加载生效</div>
  </div>
  <div class="card">
    <div id="form"></div>
  </div>
  <div class="sticky-bar">
    <div class="actions">
      <button class="btn btn-default" onclick="load()">重新加载</button>
      <button class="btn btn-default" onclick="closePage()">关闭</button>
      <button class="btn btn-primary" onclick="save()">保存配置</button>
    </div>
  </div>
</div>
<div class="toast" id="toast">已保存</div>
<script>
var PLUGIN_ID = new URLSearchParams(location.search).get('pid') || (location.pathname.match(/^\\/api\\/plugins\\/([^/]+)\\/webui/) || [])[1] || '';
if (PLUGIN_ID) PLUGIN_ID = decodeURIComponent(PLUGIN_ID);
function toast(msg){var t=document.getElementById('toast');t.textContent=msg;t.style.display='block';setTimeout(function(){t.style.display='none';},1600);}
function closePage(){if(history.length>1){history.back();}else{window.close();}}
function api(path,method,body){
  var opts={method:method||'GET',headers:{}};
  var token=localStorage.getItem('admin_token');
  if(token)opts.headers['Authorization']='Bearer '+token;
  if(body){opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(body);}
  return fetch('/api/plugins/'+PLUGIN_ID+path,opts).then(function(r){return r.json();});
}
var SCHEMA=[];
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function renderSchema(config){
  var el=document.getElementById('form');
  if(!SCHEMA.length){el.innerHTML='<div class="empty">该插件未提供配置项</div>';return;}
  el.innerHTML=SCHEMA.map(function(f){
    var key=f.key||'';
    var val=(config&&config[key]!=null)?config[key]:(f.value!=null?f.value:'');
    var label=esc(f.label||key);
    var hint=f.placeholder?('<div class="hint">'+esc(f.placeholder)+'</div>'):'';
    if(f.type==='boolean'){
      var chk=val?' checked':'';
      return '<div class="field switch-row"><div style="flex:1"><label>'+label+'</label>'+hint+'</div><label class="switch"><input type="checkbox" id="f_'+esc(key)+'"'+chk+'><span class="slider"></span></label></div>';
    }
    if(f.type==='html'){
      return '<div class="field">'+(f.html||'')+'</div>';
    }
    if(f.type==='multiSelect'){
      var arr=Array.isArray(val)?val:[];
      var opts=(f.options||[]).map(function(o){
        var v=typeof o==='object'?o.value:o;
        var l=typeof o==='object'?(o.label||o.value):o;
        var checked=arr.indexOf(v)!==-1?' checked':'';
        return '<label style="display:block;font-weight:400;font-size:13px;margin:5px 0;cursor:pointer"><input type="checkbox" id="f_'+esc(key)+'_'+esc(v)+'" value="'+esc(v)+'"'+checked+'> '+esc(l)+'</label>';
      }).join('');
      return '<div class="field"><label>'+label+'</label>'+opts+hint+'</div>';
    }
    if(f.type==='select'){
      var opts=(f.options||[]).map(function(o){
        var v=typeof o==='object'?o.value:o;
        var l=typeof o==='object'?(o.label||o.value):o;
        return '<option value="'+esc(v)+'"'+(String(val)===String(v)?' selected':'')+'>'+esc(l)+'</option>';
      }).join('');
      return '<div class="field"><label>'+label+'</label><select id="f_'+esc(key)+'">'+opts+'</select>'+hint+'</div>';
    }
    if(f.type==='number'){
      return '<div class="field"><label>'+label+'</label><input id="f_'+esc(key)+'" type="number" value="'+esc(val)+'"'+(f.min!=null?' min="'+f.min+'"':'')+(f.max!=null?' max="'+f.max+'"':'')+'/>'+hint+'</div>';
    }
    return '<div class="field"><label>'+label+'</label><input id="f_'+esc(key)+'" type="text" value="'+esc(val)+'"/>'+hint+'</div>';
  }).join('');
}
function load(){
  api('/napcat-schema').then(function(r){ if(r&&r.schema)SCHEMA=r.schema; return api('/napcat-config'); }).then(function(cfg){
    if(cfg&&cfg.error){cfg={};}
    renderSchema(cfg||{});
  }).catch(function(){ renderSchema({}); });
}
function save(){
  var body={};
  SCHEMA.forEach(function(f){
    var key=f.key;
    if(!key)return;
    var el=document.getElementById('f_'+key);
    if(!el){
      if(f.type==='multiSelect'){
        var checked=[];
        (f.options||[]).forEach(function(o){
          var v=typeof o==='object'?o.value:o;
          var cb=document.getElementById('f_'+key+'_'+esc(v));
          if(cb&&cb.checked)checked.push(v);
        });
        body[key]=checked;
      }
      return;
    }
    if(f.type==='boolean')body[key]=el.checked;
    else if(f.type==='number')body[key]=Number(el.value);
    else body[key]=el.value;
  });
  api('/napcat-config','PUT',body).then(function(r){
    if(r&&r.success)toast('已保存，重启插件后生效');
    else toast('保存失败');
  }).catch(function(){toast('保存失败');});
}
load();
</script>
</body>
</html>`;

function generateNapcatWebui(pluginPath: string, id: string, name: string): void {
  try {
    if (!pluginPath) return;
    const webuiDir = path.join(pluginPath, 'webui');
    if (!fs.existsSync(webuiDir)) fs.mkdirSync(webuiDir, { recursive: true });
    const html = WEBUI_TEMPLATE
      .replace(/__PLUGIN_NAME__/g, (name || id).replace(/</g, '&lt;'))
      .replace(/__PLUGIN_ID__/g, id);
    const target = path.join(webuiDir, 'index.html');
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf-8').indexOf('wui-v3') === -1) {
      fs.writeFileSync(target, html, 'utf-8');
      logger.info(`[${name}] 已生成 NapCat 兼容 WebUI: ${target}`);
    }
  } catch (e: any) {
    logger.warn(`生成 NapCat WebUI 失败: ${e.message}`);
  }
}
