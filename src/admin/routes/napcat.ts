import { Router, type Request, type Response } from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import {
  getNapcatConfig,
  setNapcatConfig,
  testNapcatConnection,
  syncNapcatMembers,
  getNapcatGroupList,
  getNapcatOverview,
  getAllGroupMembers,
  updateMemberBinding,
  removeMemberBinding,
  addNapcatMember,
  updateNapcatMember,
  moveNapcatMember,
  renameNapcatMember,
  syncOpenidsFromMembers,
  syncOpenidNicknames,
} from '../../core/napcat';
import { getDb, updateQqNumber, setUserMapping } from '../../db/index';
import { collectGroupStats } from '../../core/group-stats';
import { getUserPermissions } from '../middleware';
import type { AdminAuth } from '../auth';
import { getBot, getBotInstance } from '../../core/bot';
import type { EventBus } from '../../core/event-bus';

export function createNapcatRoutes(auth?: AdminAuth, eventBus?: EventBus): Router {
  const router = Router();

  // ===== NapCat WebUI 代理：面板内一键登录小号 QQ（自动注入最新 token，无需手动输密钥） =====
  const NAPCAT_WEBUI_PORT = 6099;
  function napcatWebuiToken(): string {
    try {
      const file = process.env.NAPCAT_WEBUI_CONFIG || '/var/www/NapCat/config/webui.json';
      if (!fs.existsSync(file)) return '';
      const d = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const find = (o: any): string => {
        if (!o || typeof o !== 'object') return '';
        for (const k of Object.keys(o)) {
          if (/token|auth|secret|key/i.test(k) && typeof o[k] === 'string' && o[k].length >= 6) return o[k];
          if (typeof o[k] === 'object') { const v = find(o[k]); if (v) return v; }
        }
        return '';
      };
      return find(d);
    } catch { return ''; }
  }
  router.all('/webui-proxy*', (req: Request, res: Response) => {
    try {
      const targetPath = req.originalUrl.replace(/^\/api\/napcat\/webui-proxy/, '') || '/';
      const options = {
        host: '127.0.0.1',
        port: NAPCAT_WEBUI_PORT,
        path: targetPath,
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${NAPCAT_WEBUI_PORT}` } as any,
      };
      const token = napcatWebuiToken();
      if (token) options.headers.authorization = 'Bearer ' + token;
      options.headers['accept-encoding'] = 'identity';
      const preq = http.request(options, (pres: any) => {
        res.status(pres.statusCode || 200);
        const hop = new Set(['content-encoding', 'transfer-encoding', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailers', 'upgrade']);
        for (const [k, v] of Object.entries(pres.headers)) {
          if (!hop.has(k.toLowerCase())) { try { res.setHeader(k, v as any); } catch {} }
        }
        pres.pipe(res);
      });
      preq.on('error', (e: any) => { res.status(502).json({ ok: false, error: `NapCat WebUI 不可达(${e.message})` }); });
      req.pipe(preq);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  function canManageMembers(req: Request): boolean {
    if (req.adminUser?.role === 'super_master') return true;
    if (auth) {
      const perms = getUserPermissions(auth, req.adminUser?.username || '');
      if (perms && perms.canManageGroups) return true;
    }
    return false;
  }

  // 读取配置（token 掩码显示）
  router.get('/config', (_req: Request, res: Response) => {
    const cfg = getNapcatConfig();
    res.json({ ...cfg, token: cfg.token ? '********' : '', hasToken: !!cfg.token });
  });

  // 保存配置（token 传 '********' 表示不修改）
  router.put('/config', (req: Request, res: Response) => {
    try {
      const { httpUrl, token, enabled } = req.body;
      const patch: { httpUrl?: string; token?: string; enabled?: boolean } = {};
      if (typeof httpUrl === 'string') patch.httpUrl = httpUrl;
      if (typeof token === 'string' && token !== '********') patch.token = token;
      if (typeof enabled === 'boolean') patch.enabled = enabled;
      setNapcatConfig(patch);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 测试连接（get_login_info）
  router.post('/test', async (_req: Request, res: Response) => {
    try {
      const info = await testNapcatConnection();
      res.json({ ok: true, ...info, httpUrl: getNapcatConfig().httpUrl });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 拉取 NapCat 群列表（仅返回，不落库）
  router.get('/groups', async (_req: Request, res: Response) => {
    try {
      const groups = await getNapcatGroupList();
      res.json({ ok: true, groups });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 执行同步：遍历群拉成员，写入 napcat_members + 回填 group_members.qq_id
  router.post('/sync', async (_req: Request, res: Response) => {
    try {
      const result = await syncNapcatMembers();
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 概览：本地群 + NapCat 群匹配情况 + 最近同步
  router.get('/overview', async (_req: Request, res: Response) => {
    try {
      const overview = await getNapcatOverview();
      res.json({ ok: true, ...overview });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 群 OpenID 信息列表：以「有成员记录的群」为群集合（group_members 开放平台收录 + napcat_members NapCat 同步），
  // 左连 groups 表补全群名/群号/头像，每群聚合统计（人数/今日活跃/今日消息/机器人回复/本周消息），可按机器人筛选
  router.get('/group-openid-list', (req: Request, res: Response) => {
    try {
      const botId = (req.query.bot_id as string) || '';
      const db = getDb();
      const groupRows = db.prepare(`
        SELECT gm.group_id AS gid FROM group_members gm WHERE gm.group_id != '' AND gm.group_id IS NOT NULL
        UNION
        SELECT nap.group_openid AS gid FROM napcat_members nap WHERE nap.group_openid != '' AND nap.group_openid IS NOT NULL
      `).all() as any[];
      const seen = new Set<string>();
      const groups: any[] = [];
      for (const r of groupRows) {
        const gid = String(r.gid || '');
        if (!gid || seen.has(gid)) continue;
        seen.add(gid);
        let g: any = null;
        try { g = db.prepare('SELECT id, name, group_number, avatar, member_count, last_active, bot_id FROM groups WHERE id = ?').get(gid) as any; } catch {}
        const gBotId = g?.bot_id || '';
        if (botId) {
          const has = gBotId === botId
            || !!db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND bot_id = ? LIMIT 1').get(gid, botId);
          if (!has) {
            try {
              const n = db.prepare('SELECT 1 FROM napcat_members WHERE group_openid = ? AND bot_id = ? LIMIT 1').get(gid, botId);
              if (!n) continue;
            } catch { continue; }
          }
        }
        const st = collectGroupStats(gid);
        const pick = (label: string): string => {
          const m = st.metrics.find((x: any) => x.label === label);
          return m ? m.value : '0';
        };
        // 群人数 = 开放平台收录成员（发过言）+ NapCat 同步成员（含未发言）去重
        let memberCount = '0';
        try {
          const mc = db.prepare(`
            SELECT COUNT(*) c FROM (
              SELECT gm.member_openid AS x FROM group_members gm WHERE gm.group_id = ?
              UNION
              SELECT nap.user_id AS x FROM napcat_members nap WHERE nap.group_openid = ?
            )
          `).get(gid, gid) as any;
          memberCount = String(mc?.c || 0);
        } catch { memberCount = pick('群成员数') || '0'; }
        groups.push({
          group_openid: gid,
          name: (g && g.name) || '',
          group_number: (g && g.group_number) || '',
          avatar: (g && g.avatar) || '',
          bot_id: gBotId,
          member_count: memberCount,
          today_active: pick('今日活跃成员'),
          today_msgs: pick('今日消息数'),
          robot_replies: pick('机器人回复'),
          week_msgs: pick('本周消息数'),
          last_active: (g && g.last_active) || '',
        });
      }
      res.json({ ok: true, groups, total: groups.length });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 绑定群 OpenID → QQ 群号：写入群号并自动补全群头像（p.qlogo）与群名，返回更新后群信息；
  // 群记录不存在时自动收录（INSERT），绑定后该群所有成员行的「群信息」列自动带出群号（聚合查询 groups.group_number）
  router.post('/group-openid-bind', (req: Request, res: Response) => {
    try {
      if (!canManageMembers(req)) { res.status(403).json({ error: '无权限管理成员（需超管授权 canManageGroups）' }); return; }
      const groupOpenid = String((req.body || {}).group_openid || '').trim();
      const groupNumber = String((req.body || {}).group_number || '').trim();
      const name = String((req.body || {}).name || '').trim();
      if (!groupOpenid) { res.status(400).json({ error: 'group_openid required' }); return; }
      if (!/^\d{6,15}$/.test(groupNumber)) { res.status(400).json({ error: 'QQ 群号应为 6-15 位数字' }); return; }
      const db = getDb();
      const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupOpenid) as any;
      const nextName = name || (g && g.name) || '';
      const nextAvatar = `https://p.qlogo.cn/gh/${groupNumber}/${groupNumber}/0`;
      if (!g) {
        db.prepare('INSERT INTO groups (id, name, group_number, avatar, last_active) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)')
          .run(groupOpenid, nextName, groupNumber, nextAvatar);
      } else {
        db.prepare('UPDATE groups SET group_number = ?, name = ?, avatar = ?, last_active = CURRENT_TIMESTAMP WHERE id = ?')
          .run(groupNumber, nextName, nextAvatar, groupOpenid);
      }
      res.json({ ok: true, group: { group_openid: groupOpenid, name: nextName, group_number: groupNumber, avatar: nextAvatar } });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 统一视图：所有群成员（开放平台 + NapCat 同步），每个成员带 QQ 号与来源；按物理群/QQ 聚合展示
  router.get('/all-members', (req: Request, res: Response) => {    try {
      const keyword = (req.query.keyword as string) || '';
      const groupOpenid = (req.query.groupOpenid as string) || '';
      const botId = (req.query.bot_id as string) || '';
      const groupNumber = (req.query.groupNumber as string) || '';
      const members = getAllGroupMembers(keyword, groupOpenid, botId, groupNumber);
      res.json({ ok: true, members, total: members.length });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 查询 napcat_members 表
  router.get('/members', (req: Request, res: Response) => {
    try {
      ensureTable();
      const groupOpenid = (req.query.groupOpenid as string) || '';
      const keyword = (req.query.keyword as string) || '';
      let sql = 'SELECT * FROM napcat_members WHERE 1=1';
      const params: any[] = [];
      if (groupOpenid) { sql += ' AND group_openid = ?'; params.push(groupOpenid); }
      if (keyword) { sql += ' AND (user_id LIKE ? OR nickname LIKE ? OR card LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }
      sql += ' ORDER BY updated_at DESC LIMIT 2000';
      const rows = getDb().prepare(sql).all(...params);
      res.json({ ok: true, members: rows, total: rows.length });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 编辑成员 QQ（需 canManageGroups 权限）：写入 user_mappings + group_members + admin.json（跨页面串联同步）
  router.put('/members/:openid/qq', (req: Request, res: Response) => {
    try {
      if (!canManageMembers(req)) { res.status(403).json({ error: '无权限管理成员（需超管授权 canManageGroups）' }); return; }
      const openid = req.params.openid;
      const qq = String((req.body || {}).qq_id || '').trim();
      if (!openid) { res.status(400).json({ error: 'openid required' }); return; }
      if (!/^\d{5,12}$/.test(qq)) { res.status(400).json({ error: 'QQ 号应为 5-12 位数字' }); return; }
      updateMemberBinding(openid, qq);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 设置群成员角色（需 canManageGroups 权限）：按 group_id + member_openid 写入/更新 group_members.role，
  // 供插件「群内权限判定」优先使用（真实群角色查询失败时兜底，且后台明确标注的 member 可覆盖自动角色）。
  // role 取值：owner 群主 / admin 群管理 / member 普通成员 / user 普通用户 / 空=清除（恢复自动判定）
  router.put('/members/role', (req: Request, res: Response) => {
    try {
      if (!canManageMembers(req)) { res.status(403).json({ error: '无权限管理成员（需超管授权 canManageGroups）' }); return; }
      const groupId = String((req.body || {}).group_id || '').trim();
      const memberOpenid = String((req.body || {}).member_openid || '').trim();
      const role = String((req.body || {}).role || '').trim();
      if (!groupId) { res.status(400).json({ error: 'group_id required' }); return; }
      if (!memberOpenid) { res.status(400).json({ error: 'member_openid required' }); return; }
      if (!['owner', 'admin', 'member', 'user', ''].includes(role)) {
        res.status(400).json({ error: 'role 应为 owner / admin / member / user / 空' }); return;
      }
      const db = getDb();
      db.exec(`CREATE TABLE IF NOT EXISTS group_members (
        group_id TEXT NOT NULL, member_openid TEXT NOT NULL, qq_id TEXT DEFAULT '', nickname TEXT DEFAULT '', role TEXT DEFAULT '',
        first_seen DATETIME DEFAULT CURRENT_TIMESTAMP, last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (group_id, member_openid)
      )`);
      db.prepare(`INSERT INTO group_members (group_id, member_openid, role, first_seen, last_seen)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(group_id, member_openid) DO UPDATE SET role=excluded.role, last_seen=CURRENT_TIMESTAMP`)
        .run(groupId, memberOpenid, role);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 删除成员（需 canManageGroups 权限）：解绑 user_mappings + 删除 group_members 记录；
  // 传 group_id（body 或 query）时仅删除该群下的记录（保留其他群与 QQ 绑定），用于修复挂错群。
  router.delete('/members/:openid', (req: Request, res: Response) => {
    try {
      if (!canManageMembers(req)) { res.status(403).json({ error: '无权限管理成员（需超管授权 canManageGroups）' }); return; }
      const openid = req.params.openid;
      if (!openid) { res.status(400).json({ error: 'openid required' }); return; }
      const groupId = String((req.body || {}).group_id || (req.query.group_id as string) || '').trim();
      removeMemberBinding(openid, groupId || undefined);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 新增成员（需 canManageGroups 权限）：手动插入 OpenID，可选归属群/现绑定 QQ/后期绑定/来源机器人
  router.post('/members', (req: Request, res: Response) => {
    try {
      if (!canManageMembers(req)) { res.status(403).json({ error: '无权限管理成员（需超管授权 canManageGroups）' }); return; }
      const { openid, groupOpenid, qq_id, nickname, bot_id } = req.body || {};
      const oid = String(openid || '').trim();
      if (!oid) { res.status(400).json({ error: 'OpenID 必填' }); return; }
      if (!/^[A-Za-z0-9_-]{6,64}$/.test(oid)) { res.status(400).json({ error: 'OpenID 格式不正确（应为字母/数字/_-，6-64 位）' }); return; }
      if (qq_id && !/^\d{5,12}$/.test(String(qq_id).trim())) { res.status(400).json({ error: 'QQ 号应为 5-12 位数字' }); return; }
      const result = addNapcatMember({
        openid: oid,
        groupOpenid: groupOpenid ? String(groupOpenid).trim() : '',
        qq: qq_id ? String(qq_id).trim() : '',
        nickname: nickname ? String(nickname).trim() : '',
        botId: bot_id ? String(bot_id).trim() : '',
      });
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 编辑成员（需 canManageGroups 权限）：更新昵称 / 绑定 QQ / 来源机器人；
  // 新增 OpenID 后端修复能力：new_openid=纠正 OpenID 值（全库替换）、group_id=修正所在群（默认从其他群移除）、remove_others=是否保留其他群记录
  router.put('/members/:openid', (req: Request, res: Response) => {
    try {
      if (!canManageMembers(req)) { res.status(403).json({ error: '无权限管理成员（需超管授权 canManageGroups）' }); return; }
      const openid = req.params.openid;
      if (!openid) { res.status(400).json({ error: 'openid required' }); return; }
      const { qq_id, nickname, bot_id, group_id, new_openid, remove_others } = req.body || {};
      if (qq_id && !/^\d{5,12}$/.test(String(qq_id).trim())) { res.status(400).json({ error: 'QQ 号应为 5-12 位数字' }); return; }
      let targetOid = openid;
      if (new_openid) {
        const v = String(new_openid).trim();
        if (!/^[A-Za-z0-9_-]{6,64}$/.test(v)) { res.status(400).json({ error: 'OpenID 格式不正确（应为字母/数字/_-，6-64 位）' }); return; }
        renameNapcatMember(openid, v);
        targetOid = v;
      }
      updateNapcatMember(targetOid, {
        qq: qq_id !== undefined ? String(qq_id).trim() : undefined,
        nickname: nickname !== undefined ? String(nickname).trim() : undefined,
        botId: bot_id !== undefined ? String(bot_id).trim() : undefined,
      });
      if (group_id) {
        moveNapcatMember(targetOid, String(group_id).trim(), {
          removeOthers: remove_others !== false,
          botId: bot_id !== undefined ? String(bot_id).trim() : undefined,
        });
      }
      res.json({ ok: true, openid: targetOid });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ===== 频道管理（网页端：频道 / 子频道 / 发帖 / 读取） =====
  // 频道列表（可传 bot_id 指定机器人，默认主机器人）
  router.get('/channels', async (_req: Request, res: Response) => {
    try {
      const botId = (_req.query.bot_id as string) || '';
      const bot = botId ? (getBotInstance(botId) || getBot()) : getBot();
      const guilds = await bot.getGuilds();
      res.json({ ok: true, guilds });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 子频道列表（可传 bot_id）
  router.get('/channels/:guildId', async (req: Request, res: Response) => {
    try {
      const botId = (req.query.bot_id as string) || '';
      const bot = botId ? (getBotInstance(botId) || getBot()) : getBot();
      const channels = await bot.getChannels(req.params.guildId);
      res.json({ ok: true, channels });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 读取子频道消息/帖子（可传 bot_id）
  router.get('/channels/:guildId/messages', async (req: Request, res: Response) => {
    try {
      const channelId = (req.query.channel_id as string) || req.params.guildId;
      const pageSize = parseInt(String(req.query.page_size || '20'), 10) || 20;
      const botId = (req.query.bot_id as string) || '';
      const bot = botId ? (getBotInstance(botId) || getBot()) : getBot();
      const messages = await bot.getChannelMessages(channelId, pageSize);
      res.json({ ok: true, messages });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 发送帖子/消息到子频道（可传 bot_id）
  router.post('/channels/:channelId/send', async (req: Request, res: Response) => {
    try {
      const { content } = req.body || {};
      if (!content || !String(content).trim()) { res.status(400).json({ ok: false, error: 'content required' }); return; }
      const botId = String((req.body || {}).bot_id || '');
      const bot = botId ? (getBotInstance(botId) || getBot()) : getBot();
      const result = await bot.sendMessage(req.params.channelId, String(content).trim());
      const messageId = result?.id || result?.message_id || '';
      res.json({ ok: true, result, messageId, channelId: req.params.channelId, content: String(content).trim() });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 删除帖子/撤回消息（可传 bot_id）
  router.post('/channels/:channelId/delete-message', async (req: Request, res: Response) => {
    try {
      const { message_id } = req.body || {};
      if (!message_id) { res.status(400).json({ ok: false, error: 'message_id required' }); return; }
      const botId = String((req.body || {}).bot_id || '');
      const bot = botId ? (getBotInstance(botId) || getBot()) : getBot();
      const result = await bot.deleteChannelMessage(req.params.channelId, String(message_id));
      res.json({ ok: true, result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 发布子频道公告（基于已发消息创建；可传 bot_id）
  router.post('/channels/:channelId/announce', async (req: Request, res: Response) => {
    try {
      const { message_id } = req.body || {};
      if (!message_id) { res.status(400).json({ ok: false, error: 'message_id required' }); return; }
      const botId = String((req.body || {}).bot_id || '');
      const bot = botId ? (getBotInstance(botId) || getBot()) : getBot();
      const result = await bot.createChannelAnnounce(req.params.channelId, String(message_id));
      res.json({ ok: true, result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 发布频道全局公告（基于已发消息创建，announces_type 0=成员公告 1=欢迎公告）
  router.post('/guilds/:guildId/announce', async (req: Request, res: Response) => {
    try {
      const { channel_id, message_id, announces_type } = req.body || {};
      if (!channel_id || !message_id) { res.status(400).json({ ok: false, error: 'channel_id and message_id required' }); return; }
      const botId = String((req.body || {}).bot_id || '');
      const bot = botId ? (getBotInstance(botId) || getBot()) : getBot();
      const result = await bot.createGuildAnnounce(req.params.guildId, String(channel_id), String(message_id), parseInt(String(announces_type), 10) || 0);
      res.json({ ok: true, result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 删除频道公告（message_id 传 'all' 清空全部）
  router.delete('/guilds/:guildId/announce', async (req: Request, res: Response) => {
    try {
      const { message_id } = req.body || {};
      if (!message_id) { res.status(400).json({ ok: false, error: 'message_id required' }); return; }
      const botId = String((req.body || {}).bot_id || '');
      const bot = botId ? (getBotInstance(botId) || getBot()) : getBot();
      const result = await bot.deleteGuildAnnounce(req.params.guildId, String(message_id));
      res.json({ ok: true, result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 频道成员列表
  router.get('/guilds/:guildId/members', async (req: Request, res: Response) => {
    try {
      const botId = String((req.query.bot_id as string) || '');
      const bot = botId ? (getBotInstance(botId) || getBot()) : getBot();
      const members = await bot.getGuildMembers(req.params.guildId);
      res.json({ ok: true, members });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 移除频道成员
  router.delete('/guilds/:guildId/members/:userId', async (req: Request, res: Response) => {
    try {
      const botId = String((req.body || {}).bot_id || '');
      const bot = botId ? (getBotInstance(botId) || getBot()) : getBot();
      const result = await bot.removeGuildMember(req.params.guildId, req.params.userId);
      res.json({ ok: true, result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 频道成员禁言（seconds=0 解除）
  router.post('/guilds/:guildId/members/:userId/mute', async (req: Request, res: Response) => {
    try {
      const seconds = parseInt(String(req.body?.seconds || '600'), 10) || 600;
      const botId = String((req.body || {}).bot_id || '');
      const bot = botId ? (getBotInstance(botId) || getBot()) : getBot();
      const result = await bot.muteGuildMember(req.params.guildId, req.params.userId, seconds);
      res.json({ ok: true, result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 修改频道资料（改名/头像）
  router.post('/guilds/:guildId/modify', async (req: Request, res: Response) => {
    try {
      const { name, icon } = req.body || {};
      if (!name && icon === undefined) { res.status(400).json({ ok: false, error: 'name or icon required' }); return; }
      const botId = String((req.body || {}).bot_id || '');
      const bot = botId ? (getBotInstance(botId) || getBot()) : getBot();
      const payload: any = {};
      if (name) payload.name = String(name).trim();
      if (icon) payload.icon = String(icon);
      const result = await bot.modifyGuild(req.params.guildId, payload);
      res.json({ ok: true, result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 修改子频道
  router.post('/channel/:channelId/modify', async (req: Request, res: Response) => {
    try {
      const { name } = req.body || {};
      if (!name) { res.status(400).json({ ok: false, error: 'name required' }); return; }
      const botId = String((req.body || {}).bot_id || '');
      const bot = botId ? (getBotInstance(botId) || getBot()) : getBot();
      const result = await bot.modifyChannel(req.params.channelId, { name: String(name).trim() });
      res.json({ ok: true, result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 删除子频道
  router.post('/channel/:channelId/delete', async (req: Request, res: Response) => {
    try {
      const botId = String((req.body || {}).bot_id || '');
      const bot = botId ? (getBotInstance(botId) || getBot()) : getBot();
      const result = await bot.deleteChannel(req.params.channelId);
      res.json({ ok: true, result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 创建子频道
  router.post('/channels/:guildId/create', async (req: Request, res: Response) => {
    try {
      const { name, type, parent_id } = req.body || {};
      if (!name) { res.status(400).json({ ok: false, error: 'name required' }); return; }
      const payload: any = { name: String(name).trim() };
      if (type !== undefined) payload.type = parseInt(String(type), 10) || 0;
      if (parent_id) payload.parent_id = String(parent_id);
      const botId = String((req.body || {}).bot_id || '');
      const bot = botId ? (getBotInstance(botId) || getBot()) : getBot();
      const result = await bot.createChannel(req.params.guildId, payload);
      res.json({ ok: true, result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ===== 新增机器人：测试是否有回复 =====
  // 向目标群/频道发测试消息，并监听 8 秒内是否收到目标来源的新消息
  router.post('/test-reply', async (req: Request, res: Response) => {
    try {
      const { target, targetType, message } = req.body || {};
      const bot = getBot();
      const probe = String(message || '').trim() || '[测试] 机器人在线测试，收到请回复任意内容';
      let sentTo = '';
      if (targetType === 'channel') {
        if (!target) { res.status(400).json({ ok: false, error: 'channel target required' }); return; }
        sentTo = String(target);
        await bot.sendMessage(sentTo, probe);
      } else {
        let gid = String(target || '');
        if (!gid) {
          const groups = await getNapcatGroupList();
          if (groups && groups.length) gid = String(groups[0].group_id || '');
        }
        if (!gid) { res.status(400).json({ ok: false, error: '未找到可测试的群，请先配置 NapCat 并同步群列表' }); return; }
        sentTo = gid;
        await bot.sendGroupMessage(sentTo, probe);
      }

      const replies: any[] = [];
      const match = (data: any) => {
        const src = String(data?.groupId || data?.channelId || data?.guildId || '');
        return src === sentTo || (data?.channelId && data.channelId === sentTo);
      };
      const onGroup = (data: any) => { if (match(data)) replies.push({ content: data?.content, channelId: data?.channelId, groupId: data?.groupId, authorId: data?.author?.id || '' }); };
      const onGuild = (data: any) => { if (match(data)) replies.push({ content: data?.content, channelId: data?.channelId, guildId: data?.guildId, authorId: data?.author?.id || '' }); };
      let id1: string | undefined;
      let id2: string | undefined;
      if (eventBus) {
        id1 = eventBus.on('message.group', onGroup as any);
        id2 = eventBus.on('message.guild', onGuild as any);
      }
      await new Promise((r) => setTimeout(r, 8000));
      if (eventBus && id1) eventBus.off(id1);
      if (eventBus && id2) eventBus.off(id2);

      res.json({ ok: true, sent: true, sentTo, targetType: targetType || 'group', probe, hasReply: replies.length > 0, replies: replies.slice(0, 5) });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ===== OpenID 列表（user_mappings 全量：QQ 号名下所有 OpenID + 来源机器人 + 所在群） =====
  router.get('/openids', (req: Request, res: Response) => {
    try {
      const keyword = String((req.query.keyword as string) || '').trim();
      const botId = String((req.query.bot_id as string) || '').trim();
      const qq = String((req.query.qq as string) || '').trim();
      const out = queryOpenidList(keyword, botId, qq);
      // 加载列表时自动用群成员最新昵称刷新 user_mappings（群成员改名后无需手动更新），再返回最新昵称
      try { syncOpenidNicknames(out.map((o: any) => o.openid)); } catch {}
      res.json({ ok: true, openids: queryOpenidList(keyword, botId, qq), total: out.length });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 「从用户管理」一键收录+补全：把群成员中已绑定 QQ 的 OpenID 补入本列表，并同步最新昵称/QQ 号/来源机器人
  router.post('/openids/sync', (req: Request, res: Response) => {
    try {
      const r = syncOpenidsFromMembers();
      res.json({
        ok: true,
        added: r.added,
        updated: r.updated,
        skipped: r.skipped,
        message: `已收录 ${r.added} 条、补全 ${r.updated} 条${r.skipped ? `，跳过未绑定 QQ 的 ${r.skipped} 条` : ''}`,
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 「更新到相应昵称」全量刷新：用群成员最新昵称覆盖 user_mappings 中的旧昵称
  router.post('/openids/sync-nicknames', (req: Request, res: Response) => {
    try {
      const n = syncOpenidNicknames();
      res.json({ ok: true, updated: n, message: n ? `已更新 ${n} 条昵称` : '昵称已是最新' });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 编辑 OpenID 绑定：改 QQ 号/昵称/来源机器人/所在群/纠正 OpenID 值，实时写后端并同步旧 QQ 全部 OpenID 与群成员记录。
  // openid 可只存在于 group_members（未进 user_mappings），也能直接编辑修复。
  router.put('/openids/:openid', (req: Request, res: Response) => {
    try {
      const openid = String(req.params.openid || '').trim();
      if (!openid) { res.status(400).json({ ok: false, error: 'openid required' }); return; }
      const db = getDb();
      const cur = db.prepare('SELECT openid, qq_number, nickname, bot_id FROM user_mappings WHERE openid = ?').get(openid) as any;
      const gmCur = cur ? null : db.prepare('SELECT qq_id, nickname, bot_id FROM group_members WHERE member_openid = ? ORDER BY last_seen DESC LIMIT 1').get(openid) as any;
      if (!cur && !gmCur) { res.status(404).json({ ok: false, error: '该 OpenID 不存在，无法编辑' }); return; }
      const curQq = cur ? cur.qq_number : (gmCur.qq_id || '');
      const qq = String((req.body || {}).qq_number ?? curQq).trim();
      if (qq && !/^\d{5,12}$/.test(qq)) { res.status(400).json({ ok: false, error: 'QQ 号应为 5-12 位数字' }); return; }
      const oldQq = String(curQq || '').trim();
      if (qq && qq !== oldQq && cur) updateQqNumber(oldQq, qq);
      const nickname = String((req.body || {}).nickname ?? (cur ? cur.nickname : (gmCur.nickname || ''))).trim();
      const botId = String((req.body || {}).bot_id ?? (cur ? cur.bot_id : (gmCur.bot_id || ''))).trim();
      const newOpenid = String((req.body || {}).new_openid || '').trim();
      if (newOpenid && !/^[A-Za-z0-9_-]{6,64}$/.test(newOpenid)) { res.status(400).json({ ok: false, error: 'OpenID 格式不正确（应为字母/数字/_-，6-64 位）' }); return; }
      const groupId = String((req.body || {}).group_id || '').trim();
      let targetOid = openid;
      if (newOpenid) { renameNapcatMember(openid, newOpenid); targetOid = newOpenid; }
      if (cur) {
        db.prepare("UPDATE user_mappings SET qq_number = ?, nickname = ?, bot_id = ?, last_updated = datetime('now') WHERE openid = ?")
          .run(qq || oldQq, nickname, botId, targetOid);
      } else {
        if (qq) { try { setUserMapping(targetOid, qq, nickname, botId); } catch {} }
      }
      db.prepare(`UPDATE group_members SET qq_id = CASE WHEN ? <> '' THEN ? ELSE qq_id END, nickname = CASE WHEN ? <> '' THEN ? ELSE nickname END, bot_id = CASE WHEN ? <> '' THEN ? ELSE bot_id END, last_seen = CURRENT_TIMESTAMP WHERE member_openid = ?`)
        .run(qq, qq, nickname, nickname, botId, botId, targetOid);
      if (groupId) {
        moveNapcatMember(targetOid, groupId, { removeOthers: (req.body || {}).remove_others !== false, botId });
      }
      res.json({ ok: true, openid: targetOid, qq_number: qq || oldQq, nickname, bot_id: botId });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 删除 OpenID 绑定：删除 user_mappings，并清空群成员记录中的 qq_id（不删成员记录）；
  // 传 group_id 时仅删除该群下的成员记录；openid 未在 user_mappings（仅 group_members）时也能删除。
  router.delete('/openids/:openid', (req: Request, res: Response) => {
    try {
      const openid = String(req.params.openid || '').trim();
      if (!openid) { res.status(400).json({ ok: false, error: 'openid required' }); return; }
      const db = getDb();
      const groupId = String((req.body || {}).group_id || (req.query.group_id as string) || '').trim();
      if (groupId) {
        db.prepare('DELETE FROM group_members WHERE member_openid = ? AND group_id = ?').run(openid, groupId);
      } else {
        db.prepare('DELETE FROM user_mappings WHERE openid = ?').run(openid);
        db.prepare("UPDATE group_members SET qq_id = '' WHERE member_openid = ?").run(openid);
      }
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}

function ensureTable() {
  getDb().exec(`CREATE TABLE IF NOT EXISTS napcat_members (
    group_openid TEXT DEFAULT '', group_id TEXT NOT NULL, group_name TEXT DEFAULT '',
    user_id TEXT NOT NULL, nickname TEXT DEFAULT '', card TEXT DEFAULT '',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (group_id, user_id)
  )`);
}

// 查询 OpenID 列表数据（user_mappings 全量 + 所在群 JOIN），供 GET /openids 与自动同步复用
function queryOpenidList(keyword: string, botId: string, qq: string): any[] {
  const db = getDb();
  let sql = 'SELECT um.openid, um.qq_number, um.nickname, um.bot_id, um.last_updated FROM user_mappings um WHERE 1=1';
  const params: any[] = [];
  if (qq) { sql += ' AND um.qq_number = ?'; params.push(qq); }
  if (keyword) {
    sql += ' AND (um.openid LIKE ? OR um.qq_number LIKE ? OR um.nickname LIKE ?)';
    const k = `%${keyword}%`;
    params.push(k, k, k);
  }
  sql += ' ORDER BY um.last_updated DESC LIMIT 500';
  const rows = db.prepare(sql).all(...params) as any[];
  const out = rows.map((r) => {
    let groups: any[] = [];
    try {
      groups = db.prepare(
        `SELECT g.id AS group_id, g.name AS group_name, g.group_number, g.bot_id AS group_bot_id, gm.bot_id AS member_bot_id
         FROM group_members gm JOIN groups g ON g.id = gm.group_id
         WHERE gm.member_openid = ?`
      ).all(r.openid) as any[];
    } catch {}
    // 来源机器人：user_mappings.bot_id 优先，否则取收录该成员的机器人（group_members.bot_id）或其所在群归属机器人兜底
    const groupBots = [...new Set((groups.map((g: any) => g.member_bot_id || g.group_bot_id) || []).filter(Boolean))];
    const sourceBot = String(r.bot_id || '') || groupBots[0] || '';
    const qqNum = String(r.qq_number || '');
    return {
      openid: r.openid,
      qq_number: qqNum,
      nickname: r.nickname || '',
      bot_id: sourceBot,
      last_updated: r.last_updated || '',
      avatar: qqNum ? `https://q1.qlogo.cn/g?b=qq&nk=${qqNum}&s=640` : '',
      groups,
    };
  });
  // 按机器人筛选：仅返回来源机器人归属为该机器人的 OpenID（不再把未标注行混入）
  return botId ? out.filter((o: any) => o.bot_id === botId) : out;
}
