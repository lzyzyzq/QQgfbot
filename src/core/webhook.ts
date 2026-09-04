// Webhook 接收模块
// 接收 QQ Bot 消息回调 → 验证签名 → 解析事件 → 分发到 EventBus
// 同时追踪群成员加入/退出，记录到本地 group_members 表
import { EventBus } from './event-bus';
import { createLogger } from '../utils/logger';
import { getConfig, getDb, setUserMapping, addSystemLog } from '../db/index';
import { recordGroupActivity } from '../api/groups';
import { isSelfEcho } from './self-echo';
import { reviveGroupUnreachable } from './group-reach';
import nacl from 'tweetnacl';

const logger = createLogger('webhook');

// 消息去重：多个机器人在同一群时，每条群消息会被各机器人各自 webhook 收到，
// 若都触发插件回复会造成重复发送。按消息 ID（无 ID 时退回 群+作者+内容）在窗口期内只分发一次。
const MSG_DEDUP_TTL = 6000;
const recentMessages = new Map<string, number>();

function isDuplicateMessage(key: string): boolean {
  const now = Date.now();
  if (recentMessages.has(key)) {
    const seenAt = recentMessages.get(key)!;
    if (now - seenAt < MSG_DEDUP_TTL) return true;
  }
  if (recentMessages.size > 300) {
    for (const [k, t] of recentMessages) {
      if (now - t > MSG_DEDUP_TTL * 4) recentMessages.delete(k);
    }
  }
  recentMessages.set(key, now);
  return false;
}

function ensureGroupMembersTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS group_members (
      group_id TEXT NOT NULL,
      member_openid TEXT NOT NULL,
      qq_id TEXT DEFAULT '',
      nickname TEXT DEFAULT '',
      role TEXT DEFAULT '',
      bot_id TEXT DEFAULT '',
      first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (group_id, member_openid)
    );
  `);
}

function isRealQq(s: unknown): boolean {
  return /^\d{5,12}$/.test(String(s ?? '').trim());
}

function recordMember(groupId: string, memberOpenid: string, qqId?: string, nickname?: string, botId?: string) {
  try {
    ensureGroupMembersTable();
    getDb().prepare(`
      INSERT INTO group_members (group_id, member_openid, qq_id, nickname, bot_id, last_seen)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(group_id, member_openid) DO UPDATE SET
        qq_id = CASE WHEN excluded.qq_id != '' THEN excluded.qq_id ELSE qq_id END,
        nickname = CASE WHEN excluded.nickname != '' THEN excluded.nickname ELSE nickname END,
        bot_id = CASE WHEN excluded.bot_id != '' THEN excluded.bot_id ELSE bot_id END,
        last_seen = CURRENT_TIMESTAMP
    `).run(groupId, memberOpenid, qqId || '', nickname || '', botId || '');
  } catch {}
}

function removeMember(groupId: string, memberOpenid: string) {
  try {
    ensureGroupMembersTable();
    getDb().prepare('DELETE FROM group_members WHERE group_id = ? AND member_openid = ?').run(groupId, memberOpenid);
  } catch {}
}

export class WebhookManager {
  private eventBus: EventBus;
  private publicKey: Uint8Array;
  private privateKey: Uint8Array;
  private botId: string;
  readonly secret: string;

  constructor(eventBus: EventBus, appId?: string, appSecret?: string) {
    this.eventBus = eventBus;
    this.botId = appId || getConfig('bot.app_id') || '';

    const secret = appSecret || getConfig('bot.app_secret');
    if (!secret) throw new Error('BotSecret not configured');
    this.secret = secret;

    const keys = WebhookManager.deriveKeys(secret);
    this.publicKey = keys.publicKey;
    this.privateKey = keys.privateKey;

    logger.info(`WebhookManager initialized for bot ${this.botId || '(default)'}`);
  }

  getBotId(): string {
    return this.botId;
  }

  static deriveKeys(botSecret: string): { publicKey: Uint8Array; privateKey: Uint8Array } {
    let seed = botSecret;
    while (seed.length < 32) {
      seed = seed.repeat(2);
    }
    seed = seed.substring(0, 32);
    const seedBytes = Buffer.from(seed, 'utf8');
    const keyPair = nacl.sign.keyPair.fromSeed(seedBytes);
    return { publicKey: keyPair.publicKey, privateKey: keyPair.secretKey };
  }

  handleValidation(payload: any): { plain_token: string; signature: string } {
    const { plain_token, event_ts } = payload.d;
    const msg = Buffer.from(`${event_ts}${plain_token}`, 'utf8');
    const signature = nacl.sign.detached(msg, this.privateKey);
    const sigHex = Buffer.from(signature).toString('hex');
    logger.debug(`URL validation: token=${plain_token}`);
    return { plain_token, signature: sigHex };
  }

  verifySignature(timestamp: string, body: string, signatureHex: string): boolean {
    const signature = Buffer.from(signatureHex, 'hex');
    const msg = Buffer.from(`${timestamp}${body}`, 'utf8');
    return nacl.sign.detached.verify(msg, signature, this.publicKey);
  }

  handleEvent(payload: any): any {
    const { op } = payload;

    if (op === 13) {
      return this.handleValidation(payload);
    }

    if (op === 0) {
      return { op: 12 };
    }

    return {};
  }

  async dispatchEvent(payload: any): Promise<void> {
    const { d, t } = payload;
    const eventType = t || 'UNKNOWN';
    logger.info(`Webhook dispatch: type=${eventType} content="${(d.content || '').substring(0, 80)}" group_openid=${d.group_openid || 'N/A'} authorId=${d.author?.user_openid || d.author?.member_openid || d.author?.id || 'N/A'}`);

    const authorId = d.author?.user_openid || d.author?.member_openid || d.author?.id;
    const rawQqId = d.author?.id || '';
    // 开放平台下 author.id 是 OpenID（含字母），仅当其为真实纯数字 QQ 时才作为 QQ 写入，避免污染 user_mappings/group_members
    const qqId = isRealQq(rawQqId) ? rawQqId : '';
    const authorData = {
      id: authorId,
      openid: d.author?.user_openid || d.author?.member_openid || authorId,
      qqId: qqId,
      member_openid: d.author?.member_openid || '',
      username: d.author?.username || '',
    };

    switch (eventType) {
      case 'C2C_MESSAGE_CREATE':
        // 过滤机器人自己发送消息的回显（QQ 平台会把机器人主动发的私聊消息也推回）
        if (isSelfEcho(`c2c:${this.botId}:${authorId}`, d.content)) {
          logger.info(`C2C self-echo ignored: content="${(d.content || '').substring(0, 40)}"`);
          break;
        }
        // 记录私聊用户映射（带触发机器人 bot_id），供定时任务按归属机器人发私聊
        try { setUserMapping(authorId, '', d.author?.username || '', this.botId); } catch (e) {}
        addSystemLog('info', 'message', '收到私聊消息', (d.content || '').substring(0, 100), authorId, '', this.botId);
        if (isDuplicateMessage(`c:${d.id || ''}|${authorId}|${d.content}`)) {
          logger.info(`C2C event deduplicated: content="${(d.content || '').substring(0, 40)}"`);
          break;
        }
        await this.eventBus.emit('message.c2c', {
          id: d.id,
          content: d.content,
          author: authorData,
          timestamp: d.timestamp,
          botId: this.botId,
        });
        logger.info(`C2C event dispatched: content="${(d.content || '').substring(0, 40)}"`);
        break;
      case 'GROUP_AT_MESSAGE_CREATE':
      case 'GROUP_MESSAGE_CREATE': {
        const gid = d.group_openid || d.group_id;
        // 过滤机器人自己发送消息的回显（定时播报、插件回复等），防止"发送→回推→再回复"无限循环刷屏
        if (isSelfEcho(`group:${this.botId}:${gid}`, d.content)) {
          logger.info(`Group self-echo ignored: content="${(d.content || '').substring(0, 40)}" group=${gid}`);
          break;
        }
        logger.info(`Group event: groupId=${gid} authorId=${authorId} content="${(d.content || '').substring(0, 40)}"`);
        recordGroupActivity(gid);
        // 群OpenID 与真实群号绑定：d.group_id 为纯数字时记录群号，自动生成群头像，并补群名
        if (d.group_openid && d.group_id && /^\d{6,15}$/.test(String(d.group_id))) {
          try {
            const db = getDb();
            db.prepare(`UPDATE groups SET group_number = ?,
              avatar = CASE WHEN avatar IS NULL OR avatar = '' THEN ? ELSE avatar END,
              name = CASE WHEN name IS NULL OR name = '' THEN ? ELSE name END
              WHERE id = ?`)
              .run(String(d.group_id), `https://p.qlogo.cn/gh/${d.group_id}/${d.group_id}/0`, d.group_name || '', gid);
          } catch (e: any) { logger.warn(`bind group_number failed: ${e.message}`); }
        }
        recordMember(gid, authorId, qqId, d.author?.username || '', this.botId);
        // 能收到该群消息说明群可达：若此前因主动消息 11255/群已注销被登记停发，这里自动恢复
        reviveGroupUnreachable(gid);
        // 收录消息中被 @ 的用户（<@!openid> / <@openid>），使其 OpenID 可被查询/对账
        try {
          const atRe = /<@!?([A-Za-z0-9_\-]+)>/g;
          let am: RegExpExecArray | null;
          while ((am = atRe.exec(d.content || '')) !== null) {
            const atOpenid = am[1];
            if (atOpenid && atOpenid !== authorId) {
              recordMember(gid, atOpenid, '', '', this.botId);
              try { setUserMapping(atOpenid, '', '', this.botId); } catch (e) {}
            }
          }
        } catch (e) {}
        // 异步获取并缓存真实群名（groups 表 name 为空时），供个人信息卡片/面板群管理展示
        this.refreshGroupName(gid).catch((e: any) => logger.warn(`refreshGroupName failed: ${e.message}`));

        // 记录用户映射（仅真实 QQ 号，避免 OpenID 误写入）
        if (isRealQq(qqId)) {
          try { setUserMapping(authorId, qqId, d.author?.username || '', this.botId); } catch (e) {}
        }

        addSystemLog('info', 'message', '收到群消息', (d.content || '').substring(0, 150), authorId, gid, this.botId);
        logger.info(`Webhook dispatch: type=${eventType} content="${(d.content||'').substring(0,40)}" group_openid=${gid} authorId=${authorId}`);
        if (isDuplicateMessage(`g:${gid}|${d.id || ''}|${authorId}|${d.content}`)) {
          logger.info(`Group event deduplicated: content="${(d.content || '').substring(0, 40)}" group=${gid} bot=${this.botId}`);
          break;
        }
        await this.eventBus.emit('message.group', {
          id: d.id,
          content: d.content,
          author: authorData,
          groupId: gid,
          channelId: gid,
          timestamp: d.timestamp,
          member_openid: d.author?.member_openid || '',
          botId: this.botId,
        });
        break;
      }
      case 'AT_MESSAGE_CREATE':
      case 'MESSAGE_CREATE':
        addSystemLog('info', 'message', '收到频道消息', (d.content || '').substring(0, 150), authorId, d.channel_id || '', this.botId);
        if (isDuplicateMessage(`gu:${d.channel_id || ''}|${d.id || ''}|${authorId}|${d.content}`)) break;
        await this.eventBus.emit('message.guild', {
          id: d.id,
          content: d.content,
          author: authorData,
          channelId: d.channel_id,
          guildId: d.guild_id,
          timestamp: d.timestamp,
          botId: this.botId,
        });
        break;
      case 'DIRECT_MESSAGE_CREATE':
        if (isDuplicateMessage(`d:${d.id || ''}|${authorId}|${d.content}`)) break;
        await this.eventBus.emit('message.c2c', {
          id: d.id,
          content: d.content,
          author: authorData,
          guildId: d.guild_id,
          timestamp: d.timestamp,
          botId: this.botId,
        });
        break;
      case 'FRIEND_ADD': {
        const fid = d.author?.user_openid || d.openid || '';
        addSystemLog('info', 'system', '机器人被添加为好友', '', fid || '', '', this.botId);
        if (fid) {
          // 收录好友 openid，便于后续身份识别与绑定（已有 QQ 时不覆盖）
          try { setUserMapping(fid, '', '', this.botId); } catch {}
          await this.eventBus.emit('friend.add', { ...d, openid: fid, botId: this.botId });
        }
        break;
      }
      case 'GROUP_ADD_ROBOT':
        addSystemLog('info', 'system', '机器人加入新群', d.group_openid || '', '', '', this.botId);
        await this.eventBus.emit('group.add', { ...d, botId: this.botId });
        break;
      case 'GROUP_MEMBER_ADD': {
        const gid = d.group_openid;
        const mid = d.member_openid || d.op_member_openid;
        if (gid && mid) {
          recordMember(gid, mid, '', '', this.botId);
          recordGroupActivity(gid);
          addSystemLog('info', 'member', '群成员加入', '', mid, gid, this.botId);
          logger.info('Group member added: group=' + gid + ' member=' + mid);
          this.eventBus.emit('group.member.add', {
            groupId: gid,
            member: { id: mid, nickname: d.author?.username || '' },
            timestamp: d.timestamp,
            botId: this.botId
          });
        }
        break;
      }
      case 'GROUP_MEMBER_REMOVE': {
        const gid = d.group_openid;
        const mid = d.member_openid || d.op_member_openid;
        if (gid && mid) {
          removeMember(gid, mid);
          recordGroupActivity(gid);
          addSystemLog('info', 'member', '群成员退出', '', mid, gid, this.botId);
          logger.info('Group member removed: group=' + gid + ' member=' + mid);
          this.eventBus.emit('group.member.remove', {
            groupId: gid,
            member: { id: mid, nickname: d.author?.username || '' },
            timestamp: d.timestamp,
            botId: this.botId
          });
        }
        break;
      }
      case 'INTERACTION_CREATE': {
        const interactionId = d.id;
        const resolved = d.data?.resolved;
        const buttonData = resolved?.button_data || resolved?.button_id || '';
        const buttonId = resolved?.button_id || '';
        const userId = resolved?.user_id || d.author?.user_openid || '';
        const gid = d.group_openid || d.channel_id || '';
        logger.info(`Interaction: id=${interactionId} buttonData="${buttonData}" userId=${userId} group=${gid} fullResolved=${JSON.stringify(resolved)}`);
        // 官方文档要求：收到 INTERACTION_CREATE（type=11 消息按钮 / type=12 快捷菜单）后必须调用
        // PUT /interactions/{interaction_id} 回应，否则客户端一直 loading 直到超时。同一 id 只能回应一次。
        if (interactionId) {
          const code = buttonData ? 0 : 4;
          const { getBot } = await import('./bot');
          try {
            const bot = getBot(this.botId);
            await bot.respondInteraction(interactionId, code);
          } catch (e: any) {
            logger.warn(`Interaction confirm failed: ${e?.message || e}`);
          }
        }
        if (buttonData && gid) {
          recordGroupActivity(gid);
          addSystemLog('info', 'interaction', `按钮点击: ${buttonData}`, buttonId, userId, gid, this.botId);
          await this.eventBus.emit('message.group', {
            id: interactionId,
            content: buttonData,
            author: {
              id: userId,
              openid: userId,
              qqId: '',
              member_openid: userId,
              username: '',
            },
            groupId: gid,
            channelId: gid,
            timestamp: d.timestamp || String(Date.now()),
            botId: this.botId,
          });
        }
        break;
      }
      default:
        logger.info(`Unhandled event: ${eventType} raw=${JSON.stringify(payload).substring(0, 500)}`);
    }
  }

  // 群名缓存：groups 表 name 为空时，调用群信息接口获取真实群名并入库
  private async refreshGroupName(groupOpenid: string): Promise<void> {
    if (!groupOpenid) return;
    try {
      const row = getDb().prepare('SELECT name FROM groups WHERE id = ?').get(groupOpenid) as any;
      // 已存在且不含乱码替换符（UTF-8 解码失败的 \uFFFD）时跳过，否则重新拉取真实群名
      if (row && row.name && !String(row.name).includes('\uFFFD')) return;
      const { getBot } = await import('./bot');
      const info = await getBot(this.botId).getGroupInfo(groupOpenid);
      const name = (info && info.group_name) || '';
      if (!name) return;
      getDb().prepare(`
        INSERT INTO groups (id, name, last_active)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name
      `).run(groupOpenid, name);
      logger.info(`Group name cached: ${groupOpenid} = ${name}`);
      try { addSystemLog('info', 'group', `群名已更新：${name}`, groupOpenid, '', groupOpenid, this.botId); } catch {}
    } catch (e: any) {
      logger.warn(`refreshGroupName error: ${e.message}`);
    }
  }
}
