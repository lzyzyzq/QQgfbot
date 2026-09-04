// QQ Bot API 封装核心模块
// 负责：消息发送、群管理、成员操作、Token管理
import { EventBus, BotEvent } from './event-bus';
import { createLogger } from '../utils/logger';
import { getConfig, addSystemLog, getDb } from '../db/index';
import { renderInfoCard, renderGroupDashboard, renderMenuCard, type InfoCardData, type MenuCardData } from './card';
import { collectGroupStats } from './group-stats';
import { applyPhpTemplate } from './php-footer';
import { isNapcatEnabled, callNapcatAction, groupOpenidToGroupNumber, memberOpenidToQQ, openidToQQ } from './napcat';
import { noteSelfSend } from './self-echo';
import { isUnreachableGroupError, markGroupUnreachable } from './group-reach';
import https from 'https';
import { AsyncLocalStorage } from 'async_hooks';

// msedge-tts 无内置类型声明，动态导入使用
declare module 'msedge-tts';

const logger = createLogger('bot');

export type BotStatus = 'stopped' | 'connecting' | 'connected' | 'error';

export interface BotConfig {
  appId: string;
  appSecret: string;
}

export interface KeyboardConfig {
  content?: string;
  rows: { buttons: { id?: string; render_data?: { label: string; visited_label: string; style: number }; action?: { type: number; permission?: { type: number }; data: string; enter?: boolean; unsupport_tips?: string } }[] }[];
}

export const MSG_TYPE = {
  TEXT: 0,
  MARKDOWN: 2,
  ARK: 3,
  EMBED: 4,
  KEYBOARD: 2,
  RICH_MEDIA: 7,
};

const QQ_API_BASE = 'api.sgroup.qq.com';

let msgSeqCounter = 0;

// 生成唯一消息ID：时间戳+随机数+计数器，避免重复消息被QQ平台拒绝
function generateMsgId(): string {
  const ts = Date.now();
  const rand = Math.floor(Math.random() * 100000);
  msgSeqCounter++;
  return `${ts}_${rand}_${msgSeqCounter}`;
}

// 生成递增消息序号：同一 msg_id 下多次回复（如图片消息+markdown）必须使用不同 msg_seq，
// 否则 QQ 会判定重复消息（40054005 消息被去重）。msg_seq 须在 uint32 范围（0~4294967295），
// 不能用毫秒时间戳（13 位会超范围导致 40011000 请求数据异常）
function nextMsgSeq(): number {
  msgSeqCounter++;
  return msgSeqCounter % 0xFFFFFFFF;
}

// 生成 RFC3339 格式时间（如 2026-08-05T11:23:05+08:00），供禁言到期时间 mute_expire_at 使用
function formatRfc3339(ms: number): string {
  const d = new Date(ms);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  const pad = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
const QQ_AUTH_BASE = 'bots.qq.com';

export class BotCore {
  private status: BotStatus = 'stopped';
  private eventBus: EventBus;
  private config: BotConfig | null = null;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;
  private explicitAppId: string = '';

  constructor(eventBus: EventBus, opts?: { appId?: string; appSecret?: string }) {
    this.eventBus = eventBus;
    if (opts?.appId) {
      this.explicitAppId = opts.appId;
      this.config = { appId: opts.appId, appSecret: opts.appSecret || '' };
    }
  }

  getBotId(): string {
    return this.config?.appId || this.explicitAppId || getConfig('bot.app_id') || '';
  }

  getStatus(): BotStatus {
    return this.status;
  }

  getConfig(): BotConfig | null {
    return this.config;
  }

  // 更新 AppSecret：换 Secret 后立即生效，清空旧 token 下次刷新用新密钥
  updateSecret(appSecret: string): void {
    if (!appSecret) return;
    if (this.config) this.config.appSecret = appSecret;
    this.accessToken = null;
    this.tokenExpiresAt = 0;
    logger.info(`BotCore secret updated for ${this.getBotId()}`);
  }

  async start(config?: BotConfig): Promise<void> {
    if (config) this.config = config;
    if (!this.config) {
      const appId = getConfig('bot.app_id');
      const appSecret = getConfig('bot.app_secret');
      if (!appId || !appSecret) throw new Error('BotAppID or BotSecret not configured');
      this.config = { appId, appSecret };
    }
    if (!this.config.appSecret) throw new Error('BotSecret not configured');

    this.status = 'connecting';
    logger.info('Bot initializing...');

    try {
      await this.refreshAccessToken();
      this.status = 'connected';
      logger.info('Bot ready (webhook mode)');
      this.eventBus.emit('bot.connected', { appId: this.config.appId });
    } catch (err: any) {
      this.status = 'error';
      logger.error(`Bot init failed: ${err.message}`);
      throw err;
    }
  }

  // 刷新 AccessToken（Token 过期前5分钟自动续期）
  private async refreshAccessToken(): Promise<void> {
    const { appId, appSecret } = this.config!;
    if (this.accessToken && Date.now() < this.tokenExpiresAt) return;

    const body = JSON.stringify({ appId, clientSecret: appSecret });
    const result = await this.rawHttp(QQ_AUTH_BASE, 'POST', '/app/getAppAccessToken', body);
    const data = JSON.parse(result);

    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in - 300) * 1000;
    logger.info('Access token refreshed');
  }

  private async ensureToken(): Promise<string> {
    await this.refreshAccessToken();
    return this.accessToken!;
  }

  private rawHttp(
    hostname: string,
    method: string,
    path: string,
    body?: string,
    extraHeaders?: Record<string, string>
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...extraHeaders,
      };
      if (body) headers['Content-Length'] = String(Buffer.byteLength(body));

      const req = https.request({ hostname, port: 443, path, method, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => { chunks.push(chunk); });
        res.on('end', () => {
          const data = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 500)}`));
          } else {
            resolve(data);
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout')); });
      if (body) req.write(body);
      req.end();
    });
  }

  private isTokenInvalidError(err: any): boolean {
    const msg = String((err && (err.message || err)) || '');
    return msg.indexOf('11244') !== -1 || msg.indexOf('AccessToken') !== -1 || msg.indexOf('access_token') !== -1 || /HTTP 40[13]/.test(msg);
  }

  private async apiCall(method: string, path: string, body?: string, retried = false): Promise<any> {
    const token = await this.ensureToken();
    try {
      const result = await this.rawHttp(QQ_API_BASE, method, path, body, {
        'Authorization': `QQBot ${token}`,
      });
      return JSON.parse(result);
    } catch (err: any) {
      // AccessToken 无效/过期（可能被平台提前吊销或本地时钟偏差）：清空后重新获取，重试一次
      if (!retried && this.isTokenInvalidError(err)) {
        logger.warn(`AccessToken invalid/expired, refreshing and retrying: ${method} ${path}`);
        this.accessToken = null;
        this.tokenExpiresAt = 0;
        return this.apiCall(method, path, body, true);
      }
      throw err;
    }
  }

  // 互动事件确认：收到 INTERACTION_CREATE(type=11 消息按钮 / type=12 快捷菜单)后，
  // 必须按官方文档调用 PUT /interactions/{interaction_id} 回应，否则客户端一直 loading 直到超时。
  // code: 0=成功 1=操作失败 2=操作频繁 3=重复操作 4=没有权限 5=仅管理员操作
  async respondInteraction(interactionId: string, code = 0): Promise<any> {
    if (!interactionId) return null;
    try {
      const result = await this.apiCall('PUT', `/interactions/${interactionId}`, JSON.stringify({ code }));
      logger.info(`Interaction responded: id=${interactionId} code=${code}`);
      return result;
    } catch (err: any) {
      logger.warn(`Interaction respond failed: id=${interactionId} err=${err.message}`);
      return null;
    }
  }

  async stop(): Promise<void> {
    this.accessToken = null;
    this.status = 'stopped';
    logger.info('Bot stopped');
  }

  // 机器人发送消息的运行记录（写入 system_logs，供运行记录页面判断机器人是否回复）
  private recordBotSend(target: string, type: string, summary: string, ok: boolean, errMsg: string = '') {
    try {
      // 主动群消息返回 11255/群已注销：登记该群不可达，定时任务/广播自动停发，避免每整点反复失败刷屏
      if (!ok && type.indexOf('群') === 0 && errMsg && isUnreachableGroupError(errMsg)) {
        markGroupUnreachable(target, this.getBotId(), errMsg);
      }
      addSystemLog(ok ? 'info' : 'error', 'send', `机器人回复[${type}] ${ok ? '发送成功' : '发送失败'}`, (summary || '').substring(0, 300) + (errMsg ? ` | ${errMsg}` : ''), '', target, this.getBotId());
    } catch {}
  }

  async sendMessage(channelId: string, content: string, msgId?: string): Promise<any> {
    const body: any = { content, msg_type: 0 };
    if (msgId) body.msg_id = msgId;
    try {
      const result = await this.apiCall('POST', `/channels/${channelId}/messages`, JSON.stringify(body));
      logger.info(`Channel message sent: ${channelId}`);
      return result;
    } catch (err: any) {
      logger.error(`Send message failed: ${err.message}`);
      return null;
    }
  }

  async sendImageMessage(channelId: string, imageUrl: string, _msgId?: string): Promise<any> {
    try {
      return await this.apiCall('POST', `/channels/${channelId}/messages`, JSON.stringify({ image: imageUrl, msg_type: 3 }));
    } catch (err: any) {
      logger.error(`Send image failed: ${err.message}`);
      return null;
    }
  }

  async sendPrivateMessage(openid: string, content: string, msgId?: string): Promise<any> {
    const qq = openidToQQ(openid);
    if (qq) {
      const r = await this.napcatHttp('send_private_msg', { user_id: qq, message: content });
      if (r) {
        logger.info(`[NapCat] PRIVATE SEND OK to ${qq}`);
        this.recordBotSend(openid, '私聊文本', content, true);
        noteSelfSend(`c2c:${this.getBotId()}:${openid}`, content);
        return r.data ?? r;
      }
    }
    try {
      content = applyPhpTemplate(content);
      const body: any = { content, msg_type: 0 };
      if (msgId) body.msg_id = msgId;
      const result = await this.apiCall('POST', `/v2/users/${openid}/messages`, JSON.stringify(body));
      logger.info(`Private message sent to ${openid}`);
      this.recordBotSend(openid, '私聊文本', content, true);
      noteSelfSend(`c2c:${this.getBotId()}:${openid}`, content);
      return result;
    } catch (err: any) {
      // C2C 被动回复带 msg_id 不被支持（40011002）时，降级为主动发送（不带 msg_id）重试一次
      if (msgId && String(err.message || '').indexOf('40011002') !== -1) {
        try {
          const body2: any = { content, msg_type: 0 };
          const result = await this.apiCall('POST', `/v2/users/${openid}/messages`, JSON.stringify(body2));
          logger.info(`Private message (retry without msg_id) sent to ${openid}`);
          this.recordBotSend(openid, '私聊文本', content, true);
          noteSelfSend(`c2c:${this.getBotId()}:${openid}`, content);
          return result;
        } catch (err2: any) {
          logger.error(`Send private msg (retry) failed: ${err2.message}`);
          this.recordBotSend(openid, '私聊文本', content, false, String(err2.message || ''));
          return this.privateReplyFallbackToGroup(openid, content);
        }
      }
      logger.error(`Send private msg failed: ${err.message}`);
      this.recordBotSend(openid, '私聊文本', content, false, String(err.message || ''));
      return this.privateReplyFallbackToGroup(openid, content);
    }
  }

  // 私聊无法送达（未开通 C2C/官方接口失败）时，降级到该用户最近活跃的群内 @ 该用户回复，保证插件私聊消息有回应
  private async privateReplyFallbackToGroup(openid: string, content: string): Promise<any> {
    try {
      const db = getDb();
      const row = db
        .prepare("SELECT group_id FROM group_members WHERE member_openid = ? AND group_id != '' ORDER BY last_seen DESC LIMIT 1")
        .get(openid || '') as any;
      const gid = row && row.group_id;
      if (!gid) {
        logger.info(`私聊降级回群：用户 ${openid} 无群记录，跳过`);
        return null;
      }
      const groupNum = groupOpenidToGroupNumber(gid);
      const qq = openidToQQ(openid);
      // 通道1：NapCat 真实 @（CQ 码），仅当用户有 QQ 映射且 NapCat 可用时，避免 CQ 码落入开放平台
      if (qq && groupNum && isNapcatEnabled()) {
        try {
          const atContent = `[CQ:at,qq=${qq}] ${content}`;
          const r = await this.napcatHttp('send_group_msg', { group_id: groupNum, message: atContent });
          if (r) {
            logger.info(`私聊降级回群：NapCat 已 @ 用户 ${qq}（群 ${gid}）`);
            this.recordBotSend(gid, '群聊文本(私聊降级@)', atContent, true);
            return r.data ?? r;
          }
        } catch (e: any) {
          logger.warn(`私聊降级回群 NapCat @ 失败: ${e.message}`);
        }
      }
      // 通道2：开放平台群 markdown @（官方机器人 at 语法）
      try {
        const md = `<at user_id="${openid}"></at> ${content}`;
        const mdResult = await this.sendMarkdownGroup(gid, md);
        if (mdResult) {
          logger.info(`私聊降级回群：已在群 ${gid} @ 用户 ${openid}（markdown）`);
          return mdResult;
        }
      } catch (e: any) {
        logger.warn(`私聊降级回群 markdown @ 失败: ${e.message}`);
      }
      // 通道3：普通群文本兜底
      const result = await this.sendGroupMessage(gid, content);
      if (result) {
        logger.info(`私聊降级回群：已发送到用户 ${openid} 所在群 ${gid}`);
        this.recordBotSend(gid, '群聊文本(私聊降级)', content, true);
      }
      return result;
    } catch (e: any) {
      logger.error(`私聊降级回群失败: ${e.message}`);
      return null;
    }
  }

  // 群管/发消息 NapCat HTTP 优先：真实 QQ 小号能力。调用成功(retcode 0)返回结果，否则返回 null 走开放平台兜底
  private async napcatHttp(action: string, params: Record<string, any>, timeoutMs = 15000): Promise<any | null> {
    if (!isNapcatEnabled()) return null;
    try {
      const r = await callNapcatAction(action, params, timeoutMs);
      if (r && (r.retcode === 0 || r.status === 'ok')) return r;
      logger.warn(`[NapCat] ${action} 返回异常: ${JSON.stringify(r).substring(0, 200)}`);
      return null;
    } catch (e: any) {
      logger.warn(`[NapCat] ${action} 失败，回退开放平台: ${e.message}`);
      return null;
    }
  }

  // 发送群聊消息
  async sendGroupMessage(groupOpenid: string, content: string, msgId?: string): Promise<any> {
    const groupId = groupOpenidToGroupNumber(groupOpenid);
    if (groupId) {
      const r = await this.napcatHttp('send_group_msg', { group_id: groupId, message: content });
      if (r) {
        logger.info(`[NapCat] GROUP SEND OK via ${groupId}`);
        this.recordBotSend(groupOpenid, '群文本', content, true);
        noteSelfSend(`group:${this.getBotId()}:${groupOpenid}`, content);
        return r.data ?? r;
      }
    }
    try {
      content = applyPhpTemplate(content);
      const body: any = { content, msg_type: 0 };
      if (msgId) body.msg_id = msgId;
      const result = await this.apiCall('POST', `/v2/groups/${groupOpenid}/messages`, JSON.stringify(body));
      logger.info(`GROUP SEND OK: ${JSON.stringify(result).substring(0, 300)}`);
      this.recordBotSend(groupOpenid, '群文本', content, true);
      noteSelfSend(`group:${this.getBotId()}:${groupOpenid}`, content);
      return result;
    } catch (err: any) {
      logger.error(`Send group msg failed: ${err.message}`);
      this.recordBotSend(groupOpenid, '群文本', content, false, String(err.message || ''));
      return null;
    }
  }

  onEvent(event: BotEvent, handler: (data: any) => void): string {
    return this.eventBus.on(event, handler);
  }

  async sendKeyboardC2C(openid: string, keyboard: KeyboardConfig, msgId?: string): Promise<any> {
    logger.info(`SENDING KEYBOARD C2C: user=${openid}`);
    try {
      const mdContent = keyboard.content || ' ';
      const kbRows = (keyboard.rows || []).map(r => Array.isArray(r) ? { buttons: r } : r);
      const body: any = {
        keyboard: { content: { rows: kbRows } },
        markdown: { content: mdContent },
        msg_type: MSG_TYPE.MARKDOWN,
      };
      if (msgId) body.msg_id = msgId;
      const result = await this.apiCall('POST', `/v2/users/${openid}/messages`, JSON.stringify(body));
      logger.info(`Keyboard C2C OK: ${JSON.stringify(result).substring(0, 200)}`);
      this.recordBotSend(openid, '私聊键盘', mdContent, true);
      return result;
    } catch (err: any) {
      logger.error(`Send keyboard c2c failed: ${err.message}`);
      this.recordBotSend(openid, '私聊键盘', keyboard.content || '', false, String(err.message || ''));
      return null;
    }
  }

  async sendKeyboardGroup(groupOpenid: string, keyboard: KeyboardConfig, msgId?: string): Promise<any> {
    try {
      const mdContent = keyboard.content || ' ';
      const kbRows = (keyboard.rows || []).map(r => Array.isArray(r) ? { buttons: r } : r);
      logger.info(`SENDING KEYBOARD GROUP: group=${groupOpenid} rows=${kbRows.length} stack=${(new Error().stack || '').split('\n').slice(1,4).join(' <- ')}`);
      const body: any = {
        keyboard: { content: { rows: kbRows } },
        markdown: { content: mdContent },
        msg_type: MSG_TYPE.MARKDOWN,
      };
      if (msgId) body.msg_id = msgId;
      const result = await this.apiCall('POST', `/v2/groups/${groupOpenid}/messages`, JSON.stringify(body));
      logger.info(`Keyboard GROUP OK: ${JSON.stringify(result).substring(0, 300)}`);
      this.recordBotSend(groupOpenid, '群键盘', mdContent, true);
      return result;
    } catch (err: any) {
      logger.error(`Send keyboard group failed: ${err.message}`);
      this.recordBotSend(groupOpenid, '群键盘', keyboard.content || '', false, String(err.message || ''));
      return null;
    }
  }

  async sendMarkdownC2C(openid: string, markdown: string, templateId?: number, params?: any[], msgId?: string): Promise<any> {
    try {
      const body: any = { msg_type: MSG_TYPE.MARKDOWN, markdown: { content: markdown } };
      if (templateId) body.markdown.custom_template_id = templateId;
      if (params) body.markdown.params = params;
      if (msgId) { body.msg_id = msgId; body.msg_seq = nextMsgSeq(); }
      const result = await this.apiCall('POST', `/v2/users/${openid}/messages`, JSON.stringify(body));
      logger.info(`Markdown C2C OK`);
      this.recordBotSend(openid, '私聊Markdown', markdown, true);
      return result;
    } catch (err: any) {
      logger.error(`Send markdown c2c failed: ${err.message}`);
      this.recordBotSend(openid, '私聊Markdown', markdown, false, String(err.message || ''));
      return null;
    }
  }

  async sendMarkdownGroup(groupOpenid: string, markdown: string, templateId?: number, params?: any[], msgId?: string): Promise<any> {
    // 兼容：部分插件把 msgId（字符串）直接传在第 3 位，自动纠正为 msgId 参数
    if (typeof templateId === 'string' && msgId === undefined) {
      msgId = templateId;
      templateId = undefined;
    }
    logger.info(`SENDING MARKDOWN GROUP: group=${groupOpenid}`);
    try {
      const body: any = { msg_type: MSG_TYPE.MARKDOWN, markdown: { content: markdown } };
      if (templateId) body.markdown.custom_template_id = templateId;
      if (params) body.markdown.params = params;
      if (msgId) { body.msg_id = msgId; body.msg_seq = nextMsgSeq(); }
      const result = await this.apiCall('POST', `/v2/groups/${groupOpenid}/messages`, JSON.stringify(body));
      logger.info(`Markdown GROUP OK`);
      this.recordBotSend(groupOpenid, '群Markdown', markdown, true);
      noteSelfSend(`group:${this.getBotId()}:${groupOpenid}`, markdown);
      return result;
    } catch (err: any) {
      logger.error(`Send markdown group failed: ${err.message}`);
      this.recordBotSend(groupOpenid, '群Markdown', markdown, false, String(err.message || ''));
      return null;
    }
  }

  // 上传媒体文件到群富媒体（URL 上传）：file_type 1=图片 2=视频 3=语音 4=文件
  async uploadGroupMediaUrl(groupOpenid: string, mediaUrl: string, fileType: number, filename = 'media.bin'): Promise<{ url?: string; raw_url?: string; file_info?: string } | null> {
    try {
      let token = await this.ensureToken();
      const FormDataCtor = (globalThis as any).FormData;
      const doUpload = async (tok: string) => {
        const form = new FormDataCtor();
        form.append('file_type', String(fileType));
        form.append('srv_send_msg', 'false');
        form.append('url', mediaUrl);
        form.append('file_name', filename);
        const f = (globalThis as any).fetch;
        return await f(`https://${QQ_API_BASE}/v2/groups/${groupOpenid}/files`, {
          method: 'POST',
          headers: { 'Authorization': `QQBot ${tok}` },
          body: form,
        });
      };
      let res = await doUpload(token);
      if (res && res.status === 401) {
        logger.warn('Upload group media: AccessToken invalid, refreshing and retrying');
        this.accessToken = null;
        this.tokenExpiresAt = 0;
        token = await this.ensureToken();
        res = await doUpload(token);
      }
      if (!res || !res.ok) { logger.error(`Upload group media failed: ${res && res.status}`); return null; }
      const data = await res.json();
      logger.info(`Upload group media OK type=${fileType} url=${(data.url || data.raw_url || '').substring(0, 80)} file_info=${(data.file_info || '').substring(0, 40)}`);
      try { addSystemLog('info', 'bot', `富媒体上传成功（群 ${groupOpenid}）`, `type=${fileType} file_info=${data.file_info || ''}`, '', groupOpenid); } catch {}
      return data;
    } catch (err: any) {
      logger.error(`Upload group media error: ${err.message}`);
      return null;
    }
  }

  // 上传图片到群富媒体，返回 QQ 校验过的 url / file_info（供 markdown 图片使用）
  async uploadGroupImage(groupOpenid: string, imageUrl: string): Promise<{ url?: string; raw_url?: string; file_info?: string } | null> {
    return this.uploadGroupMediaUrl(groupOpenid, imageUrl, 1, 'avatar.jpg');
  }

  // 上传语音到群富媒体（URL 上传，file_type=3，支持 mp3/wav/ogg/silk）
  async uploadGroupVoice(groupOpenid: string, audioUrl: string, filename = 'voice.mp3'): Promise<{ url?: string; raw_url?: string; file_info?: string } | null> {
    return this.uploadGroupMediaUrl(groupOpenid, audioUrl, 3, filename);
  }

  // 发送 markdown，把 __AVATAR__ 占位替换为可显示的头像图片 URL
  async sendGroupMarkdownWithImage(groupOpenid: string, markdown: string, imageUrl: string, msgId?: string): Promise<any> {
    let imageSent = false;
    if (imageUrl) {
      // 头像以富媒体图片消息（msg_type=7 + media.file_info）单独发送，QQ 平台不支持 markdown 图片语法
      const up = await this.uploadGroupImage(groupOpenid, imageUrl);
      if (up && up.file_info) {
        const r = await this.sendGroupImageMessage(groupOpenid, up.file_info, msgId);
        imageSent = !!r;
      }
    }
    let finalMd = markdown;
    if (imageSent) {
      finalMd = markdown.replace(/!\[头像\]\(__AVATAR__\)\n?/g, '');
    } else {
      finalMd = markdown.replace(/!\[头像\]\(__AVATAR__\)/g, imageUrl ? '头像：图片发送失败' : '头像：未绑定QQ无法获取');
    }
    return this.sendMarkdownGroup(groupOpenid, finalMd, undefined, undefined, msgId);
  }

  // 发送富媒体图片消息（msg_type=7）：图片需先上传获取 file_info，再由消息接口携带 media.file_info 发送
  async sendGroupImageMessage(groupOpenid: string, fileInfo: string, msgId?: string): Promise<any> {
    try {
      const body: any = { msg_type: MSG_TYPE.RICH_MEDIA, media: { file_info: fileInfo } };
      if (msgId) { body.msg_id = msgId; body.msg_seq = nextMsgSeq(); }
      const result = await this.apiCall('POST', `/v2/groups/${groupOpenid}/messages`, JSON.stringify(body));
      logger.info(`Group image message OK`);
      this.recordBotSend(groupOpenid, '群图片', fileInfo.substring(0, 20), true);
      return result;
    } catch (err: any) {
      logger.error(`Send group image message failed: ${err.message}`);
      this.recordBotSend(groupOpenid, '群图片', fileInfo.substring(0, 20), false, String(err.message || ''));
      return null;
    }
  }

  // 分片上传本地媒体：upload_prepare → PUT 分片到预签名地址 → upload_part_finish → /files 合并获取 file_info
  async uploadGroupBuffer(groupOpenid: string, buffer: Buffer, filename: string, fileType: number): Promise<{ file_info?: string } | null> {
    try {
      const token = await this.ensureToken();
      const crypto = await import('crypto');
      const md5 = crypto.createHash('md5').update(buffer).digest('hex');
      const sha1 = crypto.createHash('sha1').update(buffer).digest('hex');
      const prepBody = JSON.stringify({ file_type: fileType, file_name: filename, file_size: String(buffer.length), md5, sha1 });
      const prep = await this.apiCall('POST', `/v2/groups/${groupOpenid}/upload_prepare`, prepBody);
      const uploadId = prep.upload_id;
      const parts: any[] = prep.parts || [];
      if (!uploadId || !parts.length) { logger.error(`upload_prepare invalid: ${JSON.stringify(prep).substring(0, 200)}`); return null; }
      for (const part of parts) {
        const blockSize = Number(part.block_size);
        // part.index 从 1 开始
        const start = (part.index - 1) * blockSize;
        const chunk = buffer.subarray(start, start + blockSize);
        const putOk = await this.putToPresigned(part.presigned_url, chunk);
        if (!putOk) { logger.error(`chunk PUT failed for part ${part.index}`); return null; }
        const chunkMd5 = crypto.createHash('md5').update(chunk).digest('hex');
        await this.apiCall('POST', `/v2/groups/${groupOpenid}/upload_part_finish`,
          JSON.stringify({ upload_id: uploadId, part_index: part.index, block_size: String(chunk.length), md5: chunkMd5 }));
      }
      const fin = await this.apiCall('POST', `/v2/groups/${groupOpenid}/files`, JSON.stringify({ upload_id: uploadId, file_type: fileType }));
      if (!fin.file_info) { logger.error(`files merge no file_info: ${JSON.stringify(fin).substring(0, 200)}`); return null; }
      logger.info(`Group buffer upload OK type=${fileType} file_info=${String(fin.file_info).substring(0, 40)}`);
      return { file_info: fin.file_info };
    } catch (err: any) {
      logger.error(`Upload group buffer failed: ${err.message}`);
      return null;
    }
  }

  // 分片上传本地图片
  async uploadGroupImageBuffer(groupOpenid: string, buffer: Buffer, filename = 'card.png'): Promise<{ file_info?: string } | null> {
    return this.uploadGroupBuffer(groupOpenid, buffer, filename, 1);
  }

  // 分片上传本地语音（file_type=3，mp3/wav/ogg/silk）
  async uploadGroupVoiceBuffer(groupOpenid: string, buffer: Buffer, filename = 'voice.mp3'): Promise<{ file_info?: string } | null> {
    return this.uploadGroupBuffer(groupOpenid, buffer, filename, 3);
  }

  // 文本转语音（微软 Edge TTS，免费无 key）：返回 mp3 Buffer，失败返回 null
  async textToSpeech(text: string, voice = 'zh-CN-XiaoxiaoNeural'): Promise<Buffer | null> {
    const safe = String(text || '').trim().substring(0, 300);
    if (!safe) return null;
    try {
      const mod: any = await import('msedge-tts');
      const tts = new mod.MsEdgeTTS();
      await tts.setMetadata(voice, mod.OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      const { audioStream } = await tts.toStream(safe);
      const chunks: Buffer[] = [];
      audioStream.on('data', (d: any) => { if (d && d.length) chunks.push(Buffer.from(d)); });
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 15000);
        audioStream.on('close', () => { clearTimeout(timer); resolve(); });
        audioStream.on('error', () => { clearTimeout(timer); resolve(); });
      });
      if (!chunks.length) { logger.warn('TTS produced empty audio'); return null; }
      const buf = Buffer.concat(chunks);
      if (buf.length < 100) { logger.warn(`TTS audio too small: ${buf.length}`); return null; }
      return buf;
    } catch (err: any) {
      logger.error(`TTS failed: ${err.message}`);
      return null;
    }
  }

  // 发送富媒体语音消息（msg_type=7）：语音需先上传获取 file_info
  async sendGroupVoiceMessage(groupOpenid: string, fileInfo: string, msgId?: string): Promise<any> {
    try {
      const body: any = { msg_type: MSG_TYPE.RICH_MEDIA, media: { file_info: fileInfo } };
      if (msgId) { body.msg_id = msgId; body.msg_seq = nextMsgSeq(); }
      const result = await this.apiCall('POST', `/v2/groups/${groupOpenid}/messages`, JSON.stringify(body));
      logger.info(`Group voice message OK`);
      this.recordBotSend(groupOpenid, '群语音', fileInfo.substring(0, 20), true);
      return result;
    } catch (err: any) {
      logger.error(`Send group voice message failed: ${err.message}`);
      this.recordBotSend(groupOpenid, '群语音', fileInfo.substring(0, 20), false, String(err.message || ''));
      return null;
    }
  }

  // PUT 分片到预签名地址：使用独立连接（agent:false）+ 显式 Content-Length，避免连接复用导致 body 丢失
  private async putToPresigned(url: string, data: Buffer): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const u = new URL(url);
      const req = https.request({
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: 'PUT',
        headers: { 'Content-Length': data.length },
        agent: false,
      }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode === 200));
      });
      req.setTimeout(20000, () => { req.destroy(); resolve(false); });
      req.on('error', () => resolve(false));
      req.write(data);
      req.end();
    });
  }

  // 获取指定群的基础信息：群名、群成员数等
  async getGroupInfo(groupOpenid: string): Promise<any> {
    try {
      const result = await this.apiCall('GET', `/v2/groups/${groupOpenid}/info`);
      logger.info(`Group info OK: ${JSON.stringify(result).substring(0, 200)}`);
      return result;
    } catch (err: any) {
      logger.error(`Get group info failed: ${err.message}`);
      return null;
    }
  }

  // 获取机器人在指定群的状态：机器人角色、接收消息设置等
  async getGroupBotState(groupOpenid: string): Promise<any> {
    try {
      const result = await this.apiCall('GET', `/v2/groups/${groupOpenid}/bot_state`);
      logger.info(`Group bot_state OK: ${JSON.stringify(result).substring(0, 200)}`);
      return result;
    } catch (err: any) {
      logger.error(`Get group bot_state failed: ${err.message}`);
      return null;
    }
  }

  // 发送「个人信息」合成卡片：渲染头像+信息为 PNG，分片上传后以富媒体图片消息发送
  async sendGroupInfoCard(groupOpenid: string, card: InfoCardData, msgId?: string): Promise<boolean> {
    try {
      const buf = await renderInfoCard(card);
      const up = await this.uploadGroupImageBuffer(groupOpenid, buf, 'info_card.png');
      if (!up || !up.file_info) { logger.error('Info card upload failed'); this.recordBotSend(groupOpenid, '个人信息卡片', `昵称:${card.nickname} 群:${card.groupName}`, false, '图片上传失败'); return false; }
      const r = await this.sendGroupImageMessage(groupOpenid, up.file_info, msgId);
      const ok = !!r;
      this.recordBotSend(groupOpenid, '个人信息卡片', `昵称:${card.nickname} 群:${card.groupName}`, ok);
      return ok;
    } catch (err: any) {
      logger.error(`Send info card failed: ${err.message}`);
      this.recordBotSend(groupOpenid, '个人信息卡片', `昵称:${card.nickname} 群:${card.groupName}`, false, String(err.message || ''));
      return false;
    }
  }

  // 发送「群信息」活跃统计看板：聚合本地数据 → 渲染 PNG → 分片上传 → 富媒体图片消息发送
  async sendGroupDashboard(groupOpenid: string, msgId?: string): Promise<boolean> {
    try {
      const stats = collectGroupStats(groupOpenid);
      const buf = await renderGroupDashboard(stats);
      const up = await this.uploadGroupImageBuffer(groupOpenid, buf, 'group_dashboard.png');
      if (!up || !up.file_info) { logger.error('Group dashboard upload failed'); this.recordBotSend(groupOpenid, '群信息看板', `群:${stats.groupName}`, false, '图片上传失败'); return false; }
      const r = await this.sendGroupImageMessage(groupOpenid, up.file_info, msgId);
      const ok = !!r;
      this.recordBotSend(groupOpenid, '群信息看板', `群:${stats.groupName}`, ok);
      return ok;
    } catch (err: any) {
      logger.error(`Send group dashboard failed: ${err.message}`);
      this.recordBotSend(groupOpenid, '群信息看板', groupOpenid, false, String(err.message || ''));
      return false;
    }
  }

  // 发送「图片菜单」卡片：渲染发送者头像昵称+菜单项 PNG → 分片上传 → 富媒体图片消息发送
  async sendMenuCard(groupOpenid: string, menu: MenuCardData, msgId?: string): Promise<boolean> {
    try {
      const buf = await renderMenuCard(menu);
      const up = await this.uploadGroupImageBuffer(groupOpenid, buf, 'menu_card.png');
      if (!up || !up.file_info) { logger.error('Menu card upload failed'); this.recordBotSend(groupOpenid, '图片菜单', menu.title || '', false, '图片上传失败'); return false; }
      const r = await this.sendGroupImageMessage(groupOpenid, up.file_info, msgId);
      const ok = !!r;
      this.recordBotSend(groupOpenid, '图片菜单', menu.title || '', ok);
      return ok;
    } catch (err: any) {
      logger.error(`Send menu card failed: ${err.message}`);
      this.recordBotSend(groupOpenid, '图片菜单', menu.title || '', false, String(err.message || ''));
      return false;
    }
  }

  async muteMember(groupOpenid: string, memberOpenid: string, durationSecs: number): Promise<any> {
    const groupId = groupOpenidToGroupNumber(groupOpenid);
    const qq = memberOpenidToQQ(groupOpenid, memberOpenid);
    if (groupId && qq) {
      const r = await this.napcatHttp('set_group_ban', { group_id: groupId, user_id: qq, duration: Math.max(1, Math.floor(durationSecs)) });
      if (r) {
        logger.info(`[NapCat] MUTED ${qq} in ${groupId} for ${durationSecs}s`);
        return r.data ?? r;
      }
    } else {
      logger.warn(`[NapCat] 禁言映射缺失 group=${groupOpenid} member=${memberOpenid}（缺群号或QQ号），走开放平台`);
    }
    logger.info(`MUTING member=${memberOpenid} group=${groupOpenid} for ${durationSecs}s`);
    try {
      const expire = formatRfc3339(Date.now() + durationSecs * 1000);
      const body = JSON.stringify({ members: [{ op: 'add', member_openid: memberOpenid, mute_expire_at: expire }] });
      const result = await this.apiCall('POST', `/v2/groups/${groupOpenid}/restrict_chat_setting`, body);
      logger.info(`Mute response: ${JSON.stringify(result)}`);
      if (result && result.code !== undefined && result.code !== 0) {
        logger.error(`Mute API error: code=${result.code} message=${result.message}`);
        return null;
      }
      return result;
    } catch (err: any) {
      logger.error(`Mute member failed: ${err.message}`);
      return null;
    }
  }

  async unmuteMember(groupOpenid: string, memberOpenid: string): Promise<any> {
    const groupId = groupOpenidToGroupNumber(groupOpenid);
    const qq = memberOpenidToQQ(groupOpenid, memberOpenid);
    if (groupId && qq) {
      const r = await this.napcatHttp('set_group_ban', { group_id: groupId, user_id: qq, duration: 0 });
      if (r) {
        logger.info(`[NapCat] UNMUTED ${qq} in ${groupId}`);
        return r.data ?? r;
      }
    }
    logger.info(`UNMUTING member=${memberOpenid} group=${groupOpenid}`);
    try {
      const body = JSON.stringify({ members: [{ op: 'del', member_openid: memberOpenid, mute_expire_at: '' }] });
      const result = await this.apiCall('POST', `/v2/groups/${groupOpenid}/restrict_chat_setting`, body);
      logger.info(`Unmute response: ${JSON.stringify(result)}`);
      return result;
    } catch (err: any) {
      logger.error(`Unmute member failed: ${err.message}`);
      return null;
    }
  }

  // 更新已禁言成员的到期时间
  async updateMuteMember(groupOpenid: string, memberOpenid: string, durationSecs: number): Promise<any> {
    try {
      const expire = formatRfc3339(Date.now() + durationSecs * 1000);
      const body = JSON.stringify({ members: [{ op: 'update', member_openid: memberOpenid, mute_expire_at: expire }] });
      const result = await this.apiCall('POST', `/v2/groups/${groupOpenid}/restrict_chat_setting`, body);
      logger.info(`Update mute OK: ${JSON.stringify(result)}`);
      return result;
    } catch (err: any) {
      logger.error(`Update mute member failed: ${err.message}`);
      return null;
    }
  }

  // 查询群内禁言状态（群级规则 + 当前禁言中的成员）
  async getRestrictChatSetting(groupOpenid: string): Promise<any | null> {
    try {
      const result = await this.apiCall('GET', `/v2/groups/${groupOpenid}/restrict_chat_setting`);
      return result;
    } catch (err: any) {
      logger.error(`Get restrict chat setting failed: ${err.message}`);
      return null;
    }
  }

  // 获取入群申请列表
  async getJoinRequests(groupOpenid: string): Promise<any[]> {
    try {
      const result = await this.apiCall('GET', `/v2/groups/${groupOpenid}/join_request_list`);
      return result.list || [];
    } catch (err: any) {
      logger.error(`Get join requests failed: ${err.message}`);
      return [];
    }
  }

  async kickMember(groupOpenid: string, memberOpenid: string, addBlacklist?: boolean, deleteMsgDays?: number): Promise<any> {
    const groupId = groupOpenidToGroupNumber(groupOpenid);
    const qq = memberOpenidToQQ(groupOpenid, memberOpenid);
    if (groupId && qq) {
      const r = await this.napcatHttp('set_group_kick', {
        group_id: groupId, user_id: qq, reject_add_request: !!addBlacklist, delete_msg_days: deleteMsgDays || 0,
      });
      if (r) {
        logger.info(`[NapCat] KICKED ${qq} from ${groupId}`);
        return r.data ?? r;
      }
    }
    logger.info(`KICKING member=${memberOpenid} from group=${groupOpenid}`);
    try {
      const body: any = {};
      if (addBlacklist) body.add_blacklist = true;
      if (deleteMsgDays) body.delete_history_msg_days = deleteMsgDays;
      const result = await this.apiCall('DELETE', `/v2/groups/${groupOpenid}/members/${memberOpenid}`, JSON.stringify(body));
      logger.info(`Kick response: ${JSON.stringify(result)}`);
      return result;
    } catch (err: any) {
      logger.error(`Kick member failed: ${err.message}`);
      return null;
    }
  }

  async setAnnouncement(groupOpenid: string, content: string): Promise<any> {
    const groupId = groupOpenidToGroupNumber(groupOpenid);
    if (groupId) {
      const r = await this.napcatHttp('_send_group_notice', { group_id: groupId, content });
      if (r) {
        logger.info(`[NapCat] ANNOUNCEMENT set in ${groupId}`);
        return r.data ?? r;
      }
    }
    logger.info(`SETTING ANNOUNCEMENT group=${groupOpenid}`);
    try {
      const body = JSON.stringify({ content });
      const result = await this.apiCall('PUT', `/v2/groups/${groupOpenid}/announcement`, body);
      logger.info(`Announcement set OK`);
      return result;
    } catch (err: any) {
      logger.error(`Set announcement failed: ${err.message}`);
      return null;
    }
  }

  async deleteMessage(groupOpenid: string, messageId: string, hideTip?: boolean): Promise<any> {
    try {
      const result = await this.apiCall('DELETE', `/v2/groups/${groupOpenid}/messages/${messageId}?hidetip=${hideTip ? 'true' : 'false'}`);
      logger.info(`Message deleted: ${messageId}`);
      return result;
    } catch (err: any) {
      logger.error(`Delete message failed: ${err.message}`);
      throw err;
    }
  }

  async muteAll(groupOpenid: string, enable: boolean, durationSecs?: number): Promise<any> {
    const groupId = groupOpenidToGroupNumber(groupOpenid);
    if (groupId) {
      const r = await this.napcatHttp('set_group_whole_ban', { group_id: groupId, enable });
      if (r) {
        logger.info(`[NapCat] MUTE ALL ${enable ? 'ON' : 'OFF'} in ${groupId}`);
        return r.data ?? r;
      }
    }
    try {
      // 官方接口：mute_seconds=0 表示解除全员禁言；开启时需给时长（上限 30 天）
      const seconds = enable ? (durationSecs || 2592000) : 0;
      const body = JSON.stringify({ mute_seconds: seconds });
      const result = await this.apiCall('POST', `/v2/groups/${groupOpenid}/mute_all_members`, body);
      logger.info(`Group mute all: ${enable ? 'ON' : 'OFF'}`);
      return result;
    } catch (err: any) {
      logger.error(`Mute all failed: ${err.message}`);
      throw err;
    }
  }

  async deleteAnnouncement(groupOpenid: string, announcementId: string): Promise<any> {
    try {
      const body = JSON.stringify({ announcement_id: announcementId });
      const result = await this.apiCall('DELETE', `/v2/groups/${groupOpenid}/announcement`, body);
      logger.info(`Announcement deleted: ${announcementId}`);
      return result;
    } catch (err: any) {
      logger.error(`Delete announcement failed: ${err.message}`);
      throw err;
    }
  }

  async getAnnouncements(groupOpenid: string): Promise<any[]> {
    try {
      const result = await this.apiCall('GET', `/v2/groups/${groupOpenid}/announcement`);
      return result.announcements || [];
    } catch (err: any) {
      logger.error(`Get announcements failed: ${err.message}`);
      return [];
    }
  }

  async getGroupMembers(groupOpenid: string): Promise<any[]> {
    try {
      const result = await this.apiCall('GET', `/v2/groups/${groupOpenid}/members`);
      return result.members || [];
    } catch (err: any) {
      logger.error(`Get group members failed: ${err.message}`);
      return [];
    }
  }

  // 群成员分页（官方支持 limit + after 游标），返回 { members, next_index }
  async getGroupMembersPage(groupOpenid: string, limit = 50, after = ''): Promise<{ members: any[]; next_index: string }> {
    try {
      const query = `limit=${limit}` + (after ? `&after=${encodeURIComponent(after)}` : '');
      const result = await this.apiCall('GET', `/v2/groups/${groupOpenid}/members?${query}`);
      return { members: result.members || [], next_index: String(result.next_index || '') };
    } catch (err: any) {
      logger.error(`Get group members page failed: ${err.message}`);
      return { members: [], next_index: '' };
    }
  }

  // ===== 频道管理（频道 v1 API，全部走官方开放平台，不使用 NapCat 读取） =====

  // 获取机器人加入的频道列表
  async getGuilds(): Promise<any[]> {
    try {
      const result = await this.apiCall('GET', '/users/@me/guilds');
      const guilds = Array.isArray(result) ? result : (result?.guilds || []);
      logger.info(`Guilds fetched: ${guilds.length}`);
      return guilds.map((g: any) => ({ id: g.id, name: g.name ?? '', icon: g.icon ?? '' }));
    } catch (err: any) {
      logger.error(`Get guilds failed: ${err.message}`);
      return [];
    }
  }

  async getGuildDetail(guildId: string): Promise<any | null> {
    try {
      return await this.apiCall('GET', `/guilds/${guildId}`);
    } catch (err: any) {
      logger.error(`Get guild detail failed: ${err.message}`);
      return null;
    }
  }

  // 频道成员列表（官方：GET /guilds/{guild_id}/members）
  async getGuildMembers(guildId: string, limit = 100, after = ''): Promise<any[]> {
    try {
      const query = `limit=${limit}` + (after ? `&after=${after}` : '');
      const result = await this.apiCall('GET', `/guilds/${guildId}/members?${query}`);
      const members = Array.isArray(result) ? result : (result?.members || []);
      logger.info(`Guild members fetched: ${members.length}`);
      return members;
    } catch (err: any) {
      logger.error(`Get guild members failed: ${err.message}`);
      return [];
    }
  }

  // 移除频道成员（官方：DELETE /guilds/{guild_id}/members/{user_id}）
  async removeGuildMember(guildId: string, userId: string): Promise<any> {
    try {
      const result = await this.apiCall('DELETE', `/guilds/${guildId}/members/${userId}`);
      logger.info(`Guild member removed: ${userId}`);
      return result;
    } catch (err: any) {
      logger.error(`Remove guild member failed: ${err.message}`);
      throw err;
    }
  }

  // 频道成员禁言（官方：PUT /guilds/{guild_id}/members/{user_id}/mute，seconds=0 表示解除）
  async muteGuildMember(guildId: string, userId: string, seconds: number): Promise<any> {
    try {
      const sec = Math.floor(seconds);
      const body = JSON.stringify({ mute_seconds: sec <= 0 ? '0' : String(sec) });
      const result = await this.apiCall('PUT', `/guilds/${guildId}/members/${userId}/mute`, body);
      logger.info(`Guild member muted: ${userId} ${seconds}s`);
      return result;
    } catch (err: any) {
      logger.error(`Mute guild member failed: ${err.message}`);
      throw err;
    }
  }

  // 子频道列表（官方：GET /guilds/{guild_id}/channels）
  async getChannels(guildId: string): Promise<any[]> {
    try {
      const result = await this.apiCall('GET', `/guilds/${guildId}/channels`);
      const channels = Array.isArray(result) ? result : (result?.channels || []);
      logger.info(`Channels fetched: ${channels.length}`);
      return channels.map((c: any) => ({ id: c.id, guild_id: c.guild_id, name: c.name ?? '', type: c.type, position: c.position, parent_id: c.parent_id, owner_id: c.owner_id }));
    } catch (err: any) {
      logger.error(`Get channels failed: ${err.message}`);
      return [];
    }
  }

  async getChannelDetail(channelId: string): Promise<any | null> {
    try {
      return await this.apiCall('GET', `/channels/${channelId}`);
    } catch (err: any) {
      logger.error(`Get channel detail failed: ${err.message}`);
      return null;
    }
  }

  // 频道成员列表（兼容旧方法名，语义为读取 guild 成员）
  async getChannelMembers(channelId: string): Promise<any[]> {
    return this.getGuildMembers(channelId);
  }

  // 删除子频道消息/帖子（官方：DELETE /channels/{channel_id}/messages/{message_id}）
  async deleteChannelMessage(channelId: string, messageId: string): Promise<any> {
    try {
      const result = await this.apiCall('DELETE', `/channels/${channelId}/messages/${messageId}`);
      logger.info(`Channel message deleted: ${messageId}`);
      return result;
    } catch (err: any) {
      logger.error(`Delete channel message failed: ${err.message}`);
      throw err;
    }
  }

  // 修改子频道用户权限（官方：PUT /channels/{channel_id}/members/{user_id}/permissions，add/remove 传权限位）
  async setChannelUserPermission(channelId: string, userId: string, permissionBit: number, add: boolean): Promise<any> {
    try {
      const body = JSON.stringify({ add: add ? String(permissionBit) : '0', remove: add ? '0' : String(permissionBit) });
      const result = await this.apiCall('PUT', `/channels/${channelId}/members/${userId}/permissions`, body);
      logger.info(`Channel user permission set: ${add ? 'ADD' : 'REMOVE'} bit=${permissionBit}`);
      return result;
    } catch (err: any) {
      logger.error(`Set channel user permission failed: ${err.message}`);
      throw err;
    }
  }

  // 读取子频道消息/帖子（官方：GET /channels/{channel_id}/messages）
  async getChannelMessages(channelId: string, pageSize = 20): Promise<any[]> {
    try {
      const result = await this.apiCall('GET', `/channels/${channelId}/messages?page_size=${pageSize}`);
      const msgs = Array.isArray(result) ? result : (result?.messages || result?.data || []);
      logger.info(`Channel messages fetched: ${msgs.length}`);
      return msgs;
    } catch (err: any) {
      logger.error(`Get channel messages failed: ${err.message}`);
      return [];
    }
  }

  // 创建子频道（官方：POST /guilds/{guild_id}/channels）
  async createChannel(guildId: string, payload: any): Promise<any> {
    try {
      const result = await this.apiCall('POST', `/guilds/${guildId}/channels`, JSON.stringify(payload || {}));
      logger.info(`Channel created: ${JSON.stringify(result)}`);
      return result;
    } catch (err: any) {
      logger.error(`Create channel failed: ${err.message}`);
      throw err;
    }
  }

  // 修改频道资料（官方：PATCH /guilds/{guild_id}）
  // 注意：QQ 官方开放平台未开放「修改频道资料」接口，该端点会返回 HTTP 405 请求方法非法。
  // 修改频道名称请改用 modifyChannel（修改子频道）。此方法仅抛明确错误，避免调用方看到晦涩的 405。
  async modifyGuild(guildId: string, payload: any): Promise<any> {
    const err = new Error(`官方 API 不支持「修改频道资料」（PATCH /guilds/${guildId} 未开放，请求方法非法 HTTP 405）。如需改名请使用修改子频道 modifyChannel。`);
    logger.error(err.message);
    throw err;
  }

  // 修改子频道（官方：PATCH /channels/{channel_id}）
  async modifyChannel(channelId: string, payload: any): Promise<any> {
    try {
      const result = await this.apiCall('PATCH', `/channels/${channelId}`, JSON.stringify(payload || {}));
      logger.info(`Channel modified: ${channelId}`);
      return result;
    } catch (err: any) {
      logger.error(`Modify channel failed: ${err.message}`);
      throw err;
    }
  }

  // 删除子频道（官方：DELETE /channels/{channel_id}）
  async deleteChannel(channelId: string): Promise<any> {
    try {
      const result = await this.apiCall('DELETE', `/channels/${channelId}`);
      logger.info(`Channel deleted: ${channelId}`);
      return result;
    } catch (err: any) {
      logger.error(`Delete channel failed: ${err.message}`);
      throw err;
    }
  }

  // 发布子频道公告（官方：POST /channels/{channel_id}/announces，基于已发消息创建）
  async createChannelAnnounce(channelId: string, messageId: string): Promise<any> {
    try {
      const body = JSON.stringify({ message_id: messageId });
      const result = await this.apiCall('POST', `/channels/${channelId}/announces`, body);
      logger.info(`Channel announce created: ${JSON.stringify(result)}`);
      return result;
    } catch (err: any) {
      logger.error(`Create channel announce failed: ${err.message}`);
      throw err;
    }
  }

  // 删除子频道公告（官方：DELETE /channels/{channel_id}/announces/{message_id}）
  async deleteChannelAnnounce(channelId: string, messageId: string): Promise<any> {
    try {
      const result = await this.apiCall('DELETE', `/channels/${channelId}/announces/${messageId}`);
      logger.info(`Channel announce deleted: ${messageId}`);
      return result;
    } catch (err: any) {
      logger.error(`Delete channel announce failed: ${err.message}`);
      throw err;
    }
  }

  // 频道全局公告列表（官方：GET /guilds/{guild_id}/announces）
  async getGuildAnnounces(guildId: string): Promise<any[]> {
    try {
      const result = await this.apiCall('GET', `/guilds/${guildId}/announces`);
      const list = Array.isArray(result) ? result : (result?.announces || []);
      logger.info(`Guild announces fetched: ${list.length}`);
      return list;
    } catch (err: any) {
      logger.error(`Get guild announces failed: ${err.message}`);
      return [];
    }
  }

  // 发布频道全局公告（官方：POST /guilds/{guild_id}/announces，基于已发消息创建）
  async createGuildAnnounce(guildId: string, channelId: string, messageId: string, announceType = 0): Promise<any> {
    try {
      const body = JSON.stringify({ channel_id: channelId, message_id: messageId, announces_type: announceType });
      const result = await this.apiCall('POST', `/guilds/${guildId}/announces`, body);
      logger.info(`Guild announce created: ${JSON.stringify(result)}`);
      return result;
    } catch (err: any) {
      logger.error(`Create guild announce failed: ${err.message}`);
      throw err;
    }
  }

  // 删除频道全局公告（官方：DELETE /guilds/{guild_id}/announces/{message_id}）
  async deleteGuildAnnounce(guildId: string, messageId: string): Promise<any> {
    try {
      const result = await this.apiCall('DELETE', `/guilds/${guildId}/announces/${messageId}`);
      logger.info(`Guild announce deleted: ${messageId}`);
      return result;
    } catch (err: any) {
      logger.error(`Delete guild announce failed: ${err.message}`);
      throw err;
    }
  }

  // 频道成员信息（官方：GET /guilds/{guild_id}/members/{user_id}）
  async getGuildMember(guildId: string, userId: string): Promise<any | null> {
    try {
      return await this.apiCall('GET', `/guilds/${guildId}/members/${userId}`);
    } catch (err: any) {
      logger.error(`Get guild member failed: ${err.message}`);
      return null;
    }
  }

  // 频道身份组列表（官方：GET /guilds/{guild_id}/roles）
  async getGuildRoles(guildId: string): Promise<any[]> {
    try {
      const result = await this.apiCall('GET', `/guilds/${guildId}/roles`);
      const roles = Array.isArray(result) ? result : (result?.roles || []);
      logger.info(`Guild roles fetched: ${roles.length}`);
      return roles;
    } catch (err: any) {
      logger.error(`Get guild roles failed: ${err.message}`);
      return [];
    }
  }

  // 创建频道身份组（官方：POST /guilds/{guild_id}/roles）
  async createGuildRole(guildId: string, name: string): Promise<any> {
    try {
      const body = JSON.stringify({ name });
      const result = await this.apiCall('POST', `/guilds/${guildId}/roles`, body);
      logger.info(`Guild role created: ${JSON.stringify(result)}`);
      return result;
    } catch (err: any) {
      logger.error(`Create guild role failed: ${err.message}`);
      throw err;
    }
  }

  // 修改频道身份组（官方：PATCH /guilds/{guild_id}/roles/{role_id}）
  async updateGuildRole(guildId: string, roleId: string, name: string): Promise<any> {
    try {
      const body = JSON.stringify({ name });
      const result = await this.apiCall('PATCH', `/guilds/${guildId}/roles/${roleId}`, body);
      logger.info(`Guild role updated: ${roleId}`);
      return result;
    } catch (err: any) {
      logger.error(`Update guild role failed: ${err.message}`);
      throw err;
    }
  }

  // 删除频道身份组（官方：DELETE /guilds/{guild_id}/roles/{role_id}）
  async deleteGuildRole(guildId: string, roleId: string): Promise<any> {
    try {
      const result = await this.apiCall('DELETE', `/guilds/${guildId}/roles/${roleId}`);
      logger.info(`Guild role deleted: ${roleId}`);
      return result;
    } catch (err: any) {
      logger.error(`Delete guild role failed: ${err.message}`);
      throw err;
    }
  }

  // 身份组添加成员（官方：PUT /guilds/{guild_id}/members/{user_id}/roles/{role_id}）
  async createGuildRoleMember(guildId: string, roleId: string, userId: string): Promise<any> {
    try {
      const result = await this.apiCall('PUT', `/guilds/${guildId}/members/${userId}/roles/${roleId}`);
      logger.info(`Guild role member added: ${userId} -> ${roleId}`);
      return result;
    } catch (err: any) {
      logger.error(`Add guild role member failed: ${err.message}`);
      throw err;
    }
  }

  // 身份组移除成员（官方：DELETE /guilds/{guild_id}/members/{user_id}/roles/{role_id}）
  async deleteGuildRoleMember(guildId: string, roleId: string, userId: string): Promise<any> {
    try {
      const result = await this.apiCall('DELETE', `/guilds/${guildId}/members/${userId}/roles/${roleId}`);
      logger.info(`Guild role member removed: ${userId} -> ${roleId}`);
      return result;
    } catch (err: any) {
      logger.error(`Remove guild role member failed: ${err.message}`);
      throw err;
    }
  }

  // 板块帖子列表（官方：GET /channels/{channel_id}/threads）
  async getThreads(channelId: string, pageSize = 10): Promise<any[]> {
    try {
      const result = await this.apiCall('GET', `/channels/${channelId}/threads?page_size=${pageSize}`);
      const threads = Array.isArray(result) ? result : (result?.threads || []);
      logger.info(`Channel threads fetched: ${threads.length}`);
      return threads;
    } catch (err: any) {
      logger.error(`Get channel threads failed: ${err.message}`);
      return [];
    }
  }

  // 帖子详情（官方：GET /channels/{channel_id}/threads/{thread_id}）
  async getThreadDetail(channelId: string, threadId: string): Promise<any | null> {
    try {
      return await this.apiCall('GET', `/channels/${channelId}/threads/${threadId}`);
    } catch (err: any) {
      logger.error(`Get thread detail failed: ${err.message}`);
      return null;
    }
  }

  // 发帖（官方：POST /channels/{channel_id}/threads，format=1 文本帖）
  async postThread(channelId: string, title: string, content: string, format = 1): Promise<any> {
    try {
      const body = JSON.stringify({ title, content, format });
      const result = await this.apiCall('POST', `/channels/${channelId}/threads`, body);
      logger.info(`Thread posted: ${JSON.stringify(result)}`);
      return result;
    } catch (err: any) {
      logger.error(`Post thread failed: ${err.message}`);
      throw err;
    }
  }

  // 删帖（官方：DELETE /channels/{channel_id}/threads/{thread_id}）
  async deleteThread(channelId: string, threadId: string): Promise<any> {
    try {
      const result = await this.apiCall('DELETE', `/channels/${channelId}/threads/${threadId}`);
      logger.info(`Thread deleted: ${threadId}`);
      return result;
    } catch (err: any) {
      logger.error(`Delete thread failed: ${err.message}`);
      throw err;
    }
  }

  // ---- 自定义菜单与指令面板（服务端 API v2/menu、v2/panels） ----

  async getGlobalMenu(): Promise<any> {
    try {
      const result = await this.apiCall('GET', '/v2/menu');
      logger.info(`Global menu fetched`);
      return result;
    } catch (err: any) {
      logger.error(`Get global menu failed: ${err.message}`);
      return null;
    }
  }

  async setGlobalMenu(payload: any): Promise<any> {
    try {
      const result = await this.apiCall('PUT', '/v2/menu', JSON.stringify(payload));
      logger.info(`Global menu updated`);
      return result;
    } catch (err: any) {
      logger.error(`Set global menu failed: ${err.message}`);
      throw err;
    }
  }

  async getPanels(): Promise<any> {
    try {
      const result = await this.apiCall('GET', '/v2/panels');
      logger.info(`Panels fetched`);
      return result;
    } catch (err: any) {
      logger.error(`Get panels failed: ${err.message}`);
      return null;
    }
  }

  async createPanel(payload: any): Promise<any> {
    try {
      const result = await this.apiCall('POST', '/v2/panels', JSON.stringify(payload));
      logger.info(`Panel created`);
      return result;
    } catch (err: any) {
      logger.error(`Create panel failed: ${err.message}`);
      throw err;
    }
  }

  async getPanelDetail(panelId: string): Promise<any> {
    try {
      const result = await this.apiCall('GET', `/v2/panels/${panelId}`);
      return result;
    } catch (err: any) {
      logger.error(`Get panel detail failed: ${err.message}`);
      return null;
    }
  }

  async updatePanel(panelId: string, payload: any): Promise<any> {
    try {
      const result = await this.apiCall('PUT', `/v2/panels/${panelId}`, JSON.stringify(payload));
      return result;
    } catch (err: any) {
      logger.error(`Update panel failed: ${err.message}`);
      throw err;
    }
  }

  async deletePanel(panelId: string): Promise<any> {
    try {
      const result = await this.apiCall('DELETE', `/v2/panels/${panelId}`);
      return result;
    } catch (err: any) {
      logger.error(`Delete panel failed: ${err.message}`);
      throw err;
    }
  }

  async updatePanelTarget(panelId: string, payload: any): Promise<any> {
    try {
      const result = await this.apiCall('PUT', `/v2/panels/${panelId}/target`, JSON.stringify(payload));
      return result;
    } catch (err: any) {
      logger.error(`Update panel target failed: ${err.message}`);
      throw err;
    }
  }
}

let botInstance: BotCore | null = null;
const botInstances = new Map<string, BotCore>();

// 多机器人上下文：Webhook 分发事件时标记当前事件的机器人 AppID，
// 插件回复时据此路由到对应 BotCore 实例发送（默认回退 config bot.app_id）
const botContextStorage = new AsyncLocalStorage<string>();

export function runWithBotContext(appId: string, fn: () => Promise<void>): Promise<void> {
  return botContextStorage.run(appId, fn);
}

export function currentBotId(): string {
  return botContextStorage.getStore() || getConfig('bot.app_id') || '';
}

// 当前是否有 Webhook 消息链路上下文（true=消息事件回复，false=定时任务等无上下文场景）
export function alsBotId(): string | undefined {
  return botContextStorage.getStore();
}

export function getBot(appId?: string): BotCore {
  const id = appId || currentBotId() || '';
  const inst = id ? botInstances.get(id) : undefined;
  if (inst) return inst;
  if (!botInstance) throw new Error('BotCore not initialized');
  return botInstance;
}

export function getBotInstance(appId: string): BotCore | undefined {
  return botInstances.get(appId) || undefined;
}

export function registerBot(eventBus: EventBus, appId: string, appSecret?: string): BotCore {
  const existing = botInstances.get(appId);
  if (existing) return existing;
  const core = new BotCore(eventBus, { appId, appSecret });
  botInstances.set(appId, core);
  return core;
}

export function createBot(eventBus: EventBus): BotCore {
  botInstance = new BotCore(eventBus);
  return botInstance;
}
