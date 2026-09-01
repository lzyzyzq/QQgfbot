import { Router, type Request, type Response } from 'express';
import type { BotManager } from '../manager';
import { requireSuperMaster } from '../middleware';
import { getBot, getBotInstance } from '../../core/bot';
import { WebhookManager } from '../../core/webhook';
import { getDb, setConfig, getConfig } from '../../db/index';
import { resetAssignmentCache, markBotHasAssignment, resetGroupPolicyCache } from '../../core/event-bus';
import nacl from 'tweetnacl';
import fs from 'fs';
import path from 'path';

export function createBotRoutes(botManager: BotManager): Router {
  const router = Router();

  // 群列表：按机器人过滤（group_members.bot_id 反查），无本地记录时兜底返回全部群
  router.get('/:id/groups', (req: Request, res: Response) => {
    const bot = botManager.getBot(req.params.id as string);
    if (!bot) { res.status(404).json({ error: 'Bot not found' }); return; }
    if (!_checkAccess(req, bot)) { res.status(403).json({ error: 'Access denied' }); return; }
    try {
      const db = getDb();
      db.exec(`CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, name TEXT, member_count INTEGER DEFAULT 0, last_active DATETIME DEFAULT CURRENT_TIMESTAMP)`);
      const grpIds = (db.prepare('SELECT DISTINCT group_id FROM group_members WHERE bot_id = ?').all(bot.appId) as any[])
        .map((r: any) => r.group_id).filter(Boolean);
      let groups: any[] = [];
      if (grpIds.length) {
        const ph = grpIds.map(() => '?').join(',');
        groups = db.prepare(`SELECT * FROM groups WHERE id IN (${ph}) ORDER BY last_active DESC`).all(...grpIds) as any[];
        const known = new Set(groups.map((g: any) => g.id));
        for (const gid of grpIds) if (!known.has(gid)) groups.push({ id: gid, name: '', member_count: 0 });
      } else {
        groups = db.prepare('SELECT * FROM groups ORDER BY last_active DESC').all() as any[];
      }
      res.json({ groups });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  router.put('/:id/groups/:groupId/name', (req: Request, res: Response) => {
    try {
      const { name } = req.body;
      if (!name) { res.status(400).json({ error: 'name required' }); return; }
      const db = getDb();
      db.exec(`CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, name TEXT, member_count INTEGER DEFAULT 0, last_active DATETIME DEFAULT CURRENT_TIMESTAMP)`);
      db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(String(name).trim(), req.params.groupId);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // 群详情（含运行日志/活跃度/公告）：群OpenID → 群号/群名/头像/公告/人数/日志/活跃度
  router.get('/:id/groups/:groupId/detail', (req: Request, res: Response) => {
    try {
      const db = getDb();
      db.exec(`CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, name TEXT, member_count INTEGER DEFAULT 0, last_active DATETIME DEFAULT CURRENT_TIMESTAMP)`);
      const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.groupId) as any;
      const logs = db.prepare(
        'SELECT level, category, message, user_id, created_at FROM system_logs WHERE group_id = ? ORDER BY created_at DESC LIMIT 30'
      ).all(req.params.groupId) as any[];
      const members = db.prepare('SELECT COUNT(*) AS c FROM group_members WHERE group_id = ?').get(req.params.groupId) as any;
      res.json({
        group: {
          id: g?.id || req.params.groupId,
          group_number: g?.group_number || '',
          name: g?.name || '',
          avatar: g?.avatar || '',
          member_count: g?.member_count || 0,
          active_members: members?.c || 0,
          first_seen: g?.first_seen || '',
          last_active: g?.last_active || '',
          bot_id: g?.bot_id || '',
        },
        logs,
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // 修改群信息（群名/群号/头像）
  router.put('/:id/groups/:groupId', (req: Request, res: Response) => {
    try {
      const { name, group_number, avatar } = req.body || {};
      const db = getDb();
      db.exec(`CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, name TEXT, member_count INTEGER DEFAULT 0, last_active DATETIME DEFAULT CURRENT_TIMESTAMP)`);
      const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.groupId) as any;
      const next = { name: g?.name || '', group_number: g?.group_number || '', avatar: g?.avatar || '' };
      if (name !== undefined) next.name = String(name).trim();
      if (group_number !== undefined) {
        next.group_number = String(group_number).trim();
        if (/^\d{6,15}$/.test(next.group_number)) next.avatar = `https://p.qlogo.cn/gh/${next.group_number}/${next.group_number}/0`;
      }
      if (avatar !== undefined && avatar !== '') next.avatar = String(avatar).trim();
      db.prepare('UPDATE groups SET name = ?, group_number = ?, avatar = ? WHERE id = ?').run(next.name, next.group_number, next.avatar, req.params.groupId);
      res.json({ ok: true, group: { ...next, id: req.params.groupId } });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // 删除群（连带删除群成员记录）
  router.delete('/:id/groups/:groupId', (req: Request, res: Response) => {
    try {
      const db = getDb();
      db.prepare('DELETE FROM groups WHERE id = ?').run(req.params.groupId);
      db.prepare('DELETE FROM group_members WHERE group_id = ?').run(req.params.groupId);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // 发布群公告（开放平台 PUT /v2/groups/{openid}/announcement）
  router.post('/:id/groups/:groupId/announce', async (req: Request, res: Response) => {
    try {
      const bot = botManager.getBot(req.params.id as string);
      if (!bot) { res.status(404).json({ ok: false, error: 'Bot not found' }); return; }
      const { content } = req.body || {};
      if (!content || !String(content).trim()) { res.status(400).json({ ok: false, error: 'content required' }); return; }
      const botApi = getBotInstance(bot.appId) || getBot();
      const result = await botApi.setAnnouncement(req.params.groupId, String(content).trim());
      res.json({ ok: true, result });
    } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // 群成员列表：对应机器人在线成员 + 本地记录（该机器人发过消息的 OpenID），完整展示 member_openid
  router.get('/:id/groups/:groupId/members', async (req: Request, res: Response) => {
    const bot = botManager.getBot(req.params.id as string);
    if (!bot) { res.status(404).json({ error: 'Bot not found' }); return; }
    if (!_checkAccess(req, bot)) { res.status(403).json({ error: 'Access denied' }); return; }
    try {
      const db = getDb();
      db.exec(`CREATE TABLE IF NOT EXISTS user_mappings (openid TEXT PRIMARY KEY, qq_number TEXT NOT NULL, nickname TEXT DEFAULT '', last_updated DATETIME DEFAULT CURRENT_TIMESTAMP)`);
      db.exec(`CREATE TABLE IF NOT EXISTS group_members (
        group_id TEXT NOT NULL, member_openid TEXT NOT NULL, qq_id TEXT DEFAULT '', nickname TEXT DEFAULT '', role TEXT DEFAULT '',
        first_seen DATETIME DEFAULT CURRENT_TIMESTAMP, last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (group_id, member_openid)
      )`);
      // 本地记录：该机器人在这群里发过消息 / 加入过的成员 OpenID
      const localRows = db.prepare(
        "SELECT member_openid, qq_id, nickname FROM group_members WHERE group_id = ? AND (bot_id = ? OR bot_id = '') ORDER BY last_seen DESC"
      ).all(req.params.groupId, bot.appId) as any[];
      const localMap = new Map<string, any>(localRows.map((r: any) => [r.member_openid, r]));

      // QQ 在线成员（用该机器人自己的 BotCore，避免错误路由到主机器人）
      let remote: any[] = [];
      try {
        const core = getBotInstance(bot.appId) || getBot();
        remote = await core.getGroupMembers(req.params.groupId);
      } catch (e: any) { /* 接口失败则只用本地记录 */ }

      const seen = new Set<string>();
      const merged: any[] = [];
      for (const m of remote || []) {
        const openid = m.member_openid || m.user?.member_openid || m.openid || m.user_openid || '';
        if (!openid) continue;
        seen.add(openid);
        const l = localMap.get(openid);
        const um = l ? null : db.prepare('SELECT qq_number, nickname FROM user_mappings WHERE openid = ?').get(openid) as any;
        merged.push({
          ...m,
          member_openid: openid,
          qq_id: (l && l.qq_id) || um?.qq_number || '',
          nickname: m.nickname || (l && l.nickname) || um?.nickname || m.member_name || '',
        });
      }
      // 补充本地有记录但 QQ 在线接口未返回的成员（离线/接口限制）
      for (const l of localRows) {
        if (seen.has(l.member_openid)) continue;
        seen.add(l.member_openid);
        merged.push({ member_openid: l.member_openid, qq_id: l.qq_id || '', nickname: l.nickname || '', local: true });
      }
      res.json({ members: merged, localCount: localRows.length, remoteCount: (remote || []).length });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // 手动映射：设置群成员的 QQ 号（openid ↔ QQ号），写入 user_mappings 并同步 group_members.qq_id
  // 绑定策略：QQ 号一旦绑定（纯数字 5-12 位）不可修改，只能绑定一次
  router.put('/:id/groups/:groupId/members/:memberOpenid/qq', (req: Request, res: Response) => {
    try {
      const { qq_id, nickname } = req.body;
      const memberOpenid = req.params.memberOpenid;
      if (!qq_id) { res.status(400).json({ error: 'qq_id required' }); return; }
      const qq = String(qq_id).trim();
      const isRealQq = /^\d{5,12}$/.test(qq);
      const db = getDb();
      db.exec(`CREATE TABLE IF NOT EXISTS user_mappings (openid TEXT PRIMARY KEY, qq_number TEXT NOT NULL, nickname TEXT DEFAULT '', last_updated DATETIME DEFAULT CURRENT_TIMESTAMP)`);
      db.exec(`CREATE TABLE IF NOT EXISTS group_members (
        group_id TEXT NOT NULL, member_openid TEXT NOT NULL, qq_id TEXT DEFAULT '', nickname TEXT DEFAULT '',
        first_seen DATETIME DEFAULT CURRENT_TIMESTAMP, last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (group_id, member_openid)
      )`);
      const existing = db.prepare('SELECT qq_number FROM user_mappings WHERE openid = ?').get(memberOpenid) as any;
      if (isRealQq && existing && /^\d{5,12}$/.test(existing.qq_number || '')) {
        res.status(409).json({ ok: false, error: '该用户已绑定 QQ 号 ' + existing.qq_number + '，绑定后不可修改' });
        return;
      }
      db.prepare(`INSERT INTO user_mappings (openid, qq_number, nickname, last_updated)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(openid) DO UPDATE SET qq_number=CASE WHEN excluded.qq_number<>'' THEN excluded.qq_number ELSE qq_number END, nickname=CASE WHEN excluded.nickname<>'' THEN excluded.nickname ELSE nickname END, last_updated=CURRENT_TIMESTAMP`)
        .run(memberOpenid, qq, nickname || '');
      db.prepare(`INSERT INTO group_members (group_id, member_openid, qq_id, nickname, last_seen)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(group_id, member_openid) DO UPDATE SET qq_id=CASE WHEN excluded.qq_id<>'' THEN excluded.qq_id ELSE qq_id END, last_seen=CURRENT_TIMESTAMP`)
        .run(req.params.groupId, memberOpenid, qq, nickname || '');
      res.json({ ok: true, openid: memberOpenid, qq_id: qq, bound: isRealQq && !existing });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  router.get('/', (req: Request, res: Response) => {
    const isSuper = req.adminUser?.role === 'super_master';
    const owner = isSuper ? undefined : req.adminUser?.username;
    res.json(botManager.listBots(owner));
  });

  router.get('/:id', (req: Request, res: Response) => {
    const bot = botManager.getBot(req.params.id as string);
    if (!bot) { res.status(404).json({ error: 'Bot not found' }); return; }
    if (!_checkAccess(req, bot)) { res.status(403).json({ error: 'Access denied' }); return; }
    res.json({ ...bot, clientSecret: _secretFor(req, bot) });
  });

  // 机器人详情聚合页：AppID/Secret(脱敏)/回调链接/插件/归属者/群/用户
  router.get('/:id/detail', (req: Request, res: Response) => {
    try {
      const bot = botManager.getBot(req.params.id as string);
      if (!bot) { res.status(404).json({ error: 'Bot not found' }); return; }
      if (!_checkAccess(req, bot)) { res.status(403).json({ error: 'Access denied' }); return; }
      const db = getDb();
      const plugins = db.prepare('SELECT id, name, version, enabled, type, owner, approved FROM plugins ORDER BY created_at DESC').all();

      let groups: any[] = [];
      try {
        const grpIds = (db.prepare('SELECT DISTINCT group_id FROM group_members WHERE bot_id = ?').all(bot.appId) as any[])
          .map((r: any) => r.group_id).filter(Boolean);
        if (grpIds.length) {
          const ph = grpIds.map(() => '?').join(',');
          groups = db.prepare(`SELECT * FROM groups WHERE id IN (${ph}) ORDER BY last_active DESC`).all(...grpIds) as any[];
          const known = new Set(groups.map((g: any) => g.id));
          for (const gid of grpIds) if (!known.has(gid)) groups.push({ id: gid, name: '', member_count: 0 });
        } else {
          groups = db.prepare('SELECT * FROM groups ORDER BY last_active DESC LIMIT 200').all() as any[];
        }
      } catch {
        try { groups = db.prepare('SELECT * FROM groups ORDER BY last_active DESC LIMIT 200').all() as any[]; } catch { groups = []; }
      }

      let users: any[] = [];
      try {
        users = db.prepare("SELECT openid, qq_number, nickname, last_updated, bot_id FROM user_mappings WHERE bot_id = ? OR bot_id = '' ORDER BY last_updated DESC LIMIT 500").all(bot.appId) as any[];
      } catch { users = []; }

      let ownerInfo: any = null;
      try {
        const admins = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'admin.json'), 'utf-8'));
        ownerInfo = admins.find((a: any) => a.username === bot.owner) || null;
        if (ownerInfo) {
          const { password, ...pub } = ownerInfo;
          ownerInfo = pub;
        }
      } catch { ownerInfo = null; }

      let proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
      const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
      // 面板经平台反向代理访问均为 https 入口；代理未标明协议时，公网域名一律按 https（本地 localhost/内网直连保持 http）
      const hostnameOnly = String(host).split(':')[0];
      const isPublicHost = !/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|(10|192\.168|172\.(1[6-9]|2\d|3[01]))\.)/.test(hostnameOnly);
      if (proto === 'http' && isPublicHost) proto = 'https';
      // 回调链接按 AppID 独立生成：每个机器人配置各自独立的消息 URL /qq/:appId/webhook，
      // 服务端按路径 AppID 路由到对应机器人验签，避免多机器人共用统一链接互相干扰
      const webhookUrl = `${proto}://${host}/qq/${bot.appId}/webhook`;

      res.json({
        bot: { ...bot, clientSecret: _secretFor(req, bot) },
        webhookUrl,
        plugins,
        groups,
        users,
        ownerInfo,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 一键自测：模拟 QQ 开放平台对统一回调地址发起 op=13 URL 校验（带 X-Bot-Appid 头），
  // 走完整 webhook 路由，验证服务端用该机器人自身 AppSecret 派生密钥返回的签名与独立计算一致
  router.post('/:id/webhook-test', (req: Request, res: Response) => {
    try {
      const bot = botManager.getBot(req.params.id as string);
      if (!bot) { res.status(404).json({ error: 'Bot not found' }); return; }
      if (!_checkAccess(req, bot)) { res.status(403).json({ error: 'Access denied' }); return; }

      const plainToken = 'selftest_' + Date.now();
      const eventTs = String(Math.floor(Date.now() / 1000));
      const body = JSON.stringify({ d: { plain_token: plainToken, event_ts: eventTs }, op: 13 });

      let port = 3000;
      try { const c = parseInt(String(getConfig('server.port') || ''), 10); if (c > 0 && c <= 65535) port = c; } catch {}
      if (process.env.PORT) { const p = parseInt(process.env.PORT, 10); if (p > 0 && p <= 65535) port = p; }

      let proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
      const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
      const hostnameOnly = String(host).split(':')[0];
      const isPublicHost = !/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|(10|192\.168|172\.(1[6-9]|2\d|3[01]))\.)/.test(hostnameOnly);
      if (proto === 'http' && isPublicHost) proto = 'https';
      const webhookUrl = `${proto}://${host}/qq/${bot.appId}/webhook`;

      const http = require('http');
      const inner = http.request({
        hostname: '127.0.0.1', port,
        path: `/qq/${bot.appId}/webhook`, method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'QQBot-Callback',
          'X-Bot-Appid': String(bot.appId),
        },
      }, (resp: any) => {
        let data = '';
        resp.on('data', (c: Buffer) => (data += c));
        resp.on('end', () => {
          let parsed: any = {};
          try { parsed = JSON.parse(data); } catch {}
          let signatureMatch = false;
          if (resp.statusCode === 200 && parsed.signature && parsed.plain_token === plainToken) {
            const keys = WebhookManager.deriveKeys(String(bot.clientSecret || ''));
            const expectSig = Buffer.from(nacl.sign.detached(Buffer.from(`${eventTs}${plainToken}`, 'utf8'), keys.privateKey)).toString('hex');
            signatureMatch = parsed.signature === expectSig;
          }
          res.json({
            ok: resp.statusCode === 200 && signatureMatch,
            httpStatus: resp.statusCode,
            response: parsed,
            signatureMatch,
            appId: bot.appId,
            webhookUrl,
          });
        });
      });
      inner.on('error', (e: any) => {
        res.status(500).json({ ok: false, error: `无法访问本机 webhook: ${e.message}`, webhookUrl });
      });
      inner.end(body);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // 机器人插件分配：列出该机器人可见的全部插件及分配状态。
  // 权限：超主可见全部插件；归属者仅可见自己拥有的插件或已审核通过(approved=1)的插件。
  router.get('/:id/plugins', (req: Request, res: Response) => {
    try {
      const bot = botManager.getBot(req.params.id as string);
      if (!bot) { res.status(404).json({ error: 'Bot not found' }); return; }
      if (!_checkAccess(req, bot)) { res.status(403).json({ error: 'Access denied' }); return; }
      const db = getDb();
      const isSuper = req.adminUser?.role === 'super_master';
      const username = req.adminUser?.username || '';
      let rows: any[];
      if (isSuper) {
        rows = db.prepare('SELECT id, name, version, type, owner, approved, enabled FROM plugins ORDER BY created_at DESC').all() as any[];
      } else {
        rows = db.prepare('SELECT id, name, version, type, owner, approved, enabled FROM plugins WHERE owner = ? OR approved = 1 ORDER BY created_at DESC').all(username) as any[];
      }
      const assignedRows = db.prepare('SELECT plugin_id, assigned FROM bot_plugins WHERE bot_id = ?').all(bot.appId) as any[];
      const assignedMap = new Map<string, number>();
      for (const r of assignedRows) assignedMap.set(r.plugin_id, r.assigned);
      res.json({
        globalMode: assignedRows.length === 0,
        plugins: rows.map((r: any) => ({
          id: r.id, name: r.name, version: r.version, type: r.type,
          owner: r.owner, approved: r.approved === 1, enabled: r.enabled === 1,
          assigned: assignedMap.has(r.id) ? assignedMap.get(r.id) === 1 : undefined,
        })),
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // 设置某插件在该机器人的分配状态（assigned=true 分配，false 停用）
  router.post('/:id/plugins/toggle', (req: Request, res: Response) => {
    try {
      const bot = botManager.getBot(req.params.id as string);
      if (!bot) { res.status(404).json({ error: 'Bot not found' }); return; }
      if (!_checkAccess(req, bot)) { res.status(403).json({ error: 'Access denied' }); return; }
      const { plugin_id, assigned } = req.body || {};
      if (!plugin_id) { res.status(400).json({ error: 'plugin_id required' }); return; }
      const db = getDb();
      const plugin = db.prepare('SELECT id, owner, approved FROM plugins WHERE id = ?').get(String(plugin_id)) as any;
      if (!plugin) { res.status(404).json({ error: 'Plugin not found' }); return; }
      const isSuper = req.adminUser?.role === 'super_master';
      if (!isSuper && plugin.owner !== req.adminUser?.username && plugin.approved !== 1) {
        res.status(403).json({ ok: false, error: '无权分配该插件（仅可分配自己上传的或已审核通过的插件）' });
        return;
      }
      db.prepare(`INSERT INTO bot_plugins (bot_id, plugin_id, assigned, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(bot_id, plugin_id) DO UPDATE SET assigned = excluded.assigned, updated_at = CURRENT_TIMESTAMP`)
        .run(bot.appId, String(plugin_id), assigned ? 1 : 0);
      markBotHasAssignment(bot.appId);
      resetAssignmentCache(bot.appId, String(plugin_id));
      res.json({ ok: true, assigned: !!assigned, appId: bot.appId });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // 清空该机器人全部分配记录，回到全局模式（所有启用的插件都会响应）
  router.post('/:id/plugins/reset', (req: Request, res: Response) => {
    try {
      const bot = botManager.getBot(req.params.id as string);
      if (!bot) { res.status(404).json({ error: 'Bot not found' }); return; }
      if (!_checkAccess(req, bot)) { res.status(403).json({ error: 'Access denied' }); return; }
      const db = getDb();
      db.prepare('DELETE FROM bot_plugins WHERE bot_id = ?').run(bot.appId);
      resetAssignmentCache(bot.appId);
      res.json({ ok: true, appId: bot.appId, globalMode: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // 插件按群开关：列出该机器人已知群 + 指定插件在各群的门控模式
  // mode: 'allow'（仅此群启用）/ 'deny'（此群禁用）/ null（未配置，跟随全局）
  router.get('/:id/plugins/:pluginId/groups', (req: Request, res: Response) => {
    try {
      const bot = botManager.getBot(req.params.id as string);
      if (!bot) { res.status(404).json({ error: 'Bot not found' }); return; }
      if (!_checkAccess(req, bot)) { res.status(403).json({ error: 'Access denied' }); return; }
      const db = getDb();
      const pluginId = String(req.params.pluginId);
      const plugin = db.prepare('SELECT id, name FROM plugins WHERE id = ?').get(pluginId) as any;
      if (!plugin) { res.status(404).json({ error: 'Plugin not found' }); return; }
      db.exec(`CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, name TEXT, group_number TEXT DEFAULT '', member_count INTEGER DEFAULT 0, last_active DATETIME DEFAULT CURRENT_TIMESTAMP)`);
      const grpIds = (db.prepare('SELECT DISTINCT group_id FROM group_members WHERE bot_id = ?').all(bot.appId) as any[])
        .map((r: any) => r.group_id).filter(Boolean);
      let groups: any[] = [];
      if (grpIds.length) {
        const ph = grpIds.map(() => '?').join(',');
        groups = db.prepare(`SELECT * FROM groups WHERE id IN (${ph}) ORDER BY last_active DESC`).all(...grpIds) as any[];
        const known = new Set(groups.map((g: any) => g.id));
        for (const gid of grpIds) if (!known.has(gid)) groups.push({ id: gid, name: '', member_count: 0 });
      } else {
        groups = db.prepare('SELECT * FROM groups ORDER BY last_active DESC').all() as any[];
      }
      const cfgRows = db.prepare('SELECT group_id, mode FROM plugin_group_config WHERE plugin_id = ?').all(pluginId) as any[];
      const cfgMap = new Map<string, string>();
      for (const r of cfgRows) cfgMap.set(r.group_id, String(r.mode));
      const hasAllow = Array.from(cfgMap.values()).includes('allow');
      res.json({
        plugin: { id: plugin.id, name: plugin.name },
        whitelistMode: hasAllow,
        groups: groups.map((g: any) => ({
          id: g.id, name: g.name || '', group_number: g.group_number || '', member_count: g.member_count || 0,
          mode: cfgMap.has(g.id) ? cfgMap.get(g.id) : null,
        })),
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // 设置插件在指定群的门控模式（mode='allow'|'deny'，传 null 清除该群配置）
  router.post('/:id/plugins/:pluginId/groups', (req: Request, res: Response) => {
    try {
      const bot = botManager.getBot(req.params.id as string);
      if (!bot) { res.status(404).json({ error: 'Bot not found' }); return; }
      if (!_checkAccess(req, bot)) { res.status(403).json({ error: 'Access denied' }); return; }
      const { group_id, mode } = req.body || {};
      if (!group_id) { res.status(400).json({ error: 'group_id required' }); return; }
      const db = getDb();
      const pluginId = String(req.params.pluginId);
      const plugin = db.prepare('SELECT id, owner, approved FROM plugins WHERE id = ?').get(pluginId) as any;
      if (!plugin) { res.status(404).json({ error: 'Plugin not found' }); return; }
      const isSuper = req.adminUser?.role === 'super_master';
      if (!isSuper && plugin.owner !== req.adminUser?.username && plugin.approved !== 1) {
        res.status(403).json({ ok: false, error: '无权配置该插件（仅可配置自己上传的或已审核通过的插件）' });
        return;
      }
      const gid = String(group_id);
      const m = mode === 'allow' ? 'allow' : mode === 'deny' ? 'deny' : null;
      if (m) {
        db.prepare(`INSERT INTO plugin_group_config (plugin_id, group_id, mode, updated_at)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(plugin_id, group_id) DO UPDATE SET mode = excluded.mode, updated_at = CURRENT_TIMESTAMP`)
          .run(pluginId, gid, m);
      } else {
        db.prepare('DELETE FROM plugin_group_config WHERE plugin_id = ? AND group_id = ?').run(pluginId, gid);
      }
      resetGroupPolicyCache(pluginId);
      res.json({ ok: true, plugin_id: pluginId, group_id: gid, mode: m });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  router.post('/', (req: Request, res: Response) => {
    const { name, appId, clientSecret, intents, sandbox } = req.body;
    if (!name || !appId || !clientSecret) {
      res.status(400).json({ error: 'Missing required fields: name, appId, clientSecret' });
      return;
    }

    const bot = botManager.addBot({
      name,
      appId,
      clientSecret,
      intents: intents || 0,
      sandbox: sandbox || false,
      owner: req.adminUser!.username,
    });

    // 同步到 config 表：仅当 config 尚无主机器人时，才把第一个机器人设为默认（config bot.app_id 仅作无 app_id 回调的兜底）
    try {
      if (!getConfig('bot.app_id')) {
        setConfig('bot.app_id', appId);
        setConfig('bot.app_secret', clientSecret);
        setConfig('bot.name', name);
      }
    } catch (e: any) { console.error('[bot] sync config failed:', e.message); }

    res.json({ ...bot, clientSecret: _secretFor(req, bot) });
  });

  router.put('/:id', (req: Request, res: Response) => {
    const bot = botManager.getBot(req.params.id as string);
    if (!bot) { res.status(404).json({ error: 'Bot not found' }); return; }
    if (!_checkAccess(req, bot)) { res.status(403).json({ error: 'Access denied' }); return; }

    const data = req.body;
    if (data.clientSecret === '******') delete data.clientSecret;

    const updated = botManager.updateBot(req.params.id as string, data);

    // 同步到 config 表：仅当编辑的是主机器人（config bot.app_id）时更新 config，
    // 多机器人场景下其他机器人验签密钥存于 registry，不覆盖主配置
    try {
      if (String(getConfig('bot.app_id') || '') === bot.appId) {
        if (data.appId) setConfig('bot.app_id', String(data.appId));
        if (data.clientSecret) {
          setConfig('bot.app_secret', String(data.clientSecret));
          try { getBot().updateSecret(String(data.clientSecret)); } catch (e: any) {}
        }
        if (data.name) setConfig('bot.name', String(data.name));
      }
    } catch (e: any) { console.error('[bot] sync config failed:', e.message); }

    res.json({ ...updated, clientSecret: _secretFor(req, updated as any) });
  });

  router.delete('/:id', (req: Request, res: Response) => {
    const bot = botManager.getBot(req.params.id as string);
    if (!bot) { res.status(404).json({ error: 'Bot not found' }); return; }
    if (!_checkAccess(req, bot)) { res.status(403).json({ error: 'Access denied' }); return; }

    botManager.removeBot(req.params.id as string);
    res.json({ ok: true });
  });

  // 转移机器人归属：仅超级主人可用。目标用户必须存在于 admin.json
  router.put('/:id/owner', requireSuperMaster, (req: Request, res: Response) => {
    const bot = botManager.getBot(req.params.id as string);
    if (!bot) { res.status(404).json({ error: 'Bot not found' }); return; }
    const targetOwner = String(req.body?.owner || '').trim();
    if (!targetOwner) { res.status(400).json({ error: 'owner required' }); return; }
    try {
      const admins = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'admin.json'), 'utf-8')) as any[];
      if (!admins.some((a: any) => a.username === targetOwner)) {
        res.status(400).json({ error: '目标用户不存在：' + targetOwner });
        return;
      }
    } catch (e: any) { res.status(500).json({ error: '读取用户列表失败: ' + e.message }); return; }
    const updated = botManager.updateBot(req.params.id as string, { owner: targetOwner });
    try { getDb().prepare('UPDATE plugins SET owner = ? WHERE owner = ?').run(targetOwner, bot.owner); } catch {}
    res.json({ ok: true, bot: { ...updated, clientSecret: '******' } });
  });

  router.post('/:id/start', async (req: Request, res: Response) => {
    const bot = botManager.getBot(req.params.id as string);
    if (!bot) { res.status(404).json({ error: 'Bot not found' }); return; }
    if (!_checkAccess(req, bot)) { res.status(403).json({ error: 'Access denied' }); return; }

    try {
      await botManager.startBot(req.params.id as string);
      res.json({ ok: true, status: 'running' });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/:id/stop', (req: Request, res: Response) => {
    const bot = botManager.getBot(req.params.id as string);
    if (!bot) { res.status(404).json({ error: 'Bot not found' }); return; }
    if (!_checkAccess(req, bot)) { res.status(403).json({ error: 'Access denied' }); return; }

    botManager.stopBot(req.params.id as string);
    res.json({ ok: true, status: 'stopped' });
  });

  router.post('/:id/restart', async (req: Request, res: Response) => {
    const bot = botManager.getBot(req.params.id as string);
    if (!bot) { res.status(404).json({ error: 'Bot not found' }); return; }
    if (!_checkAccess(req, bot)) { res.status(403).json({ error: 'Access denied' }); return; }

    try {
      await botManager.restartBot(req.params.id as string);
      res.json({ ok: true, status: 'running' });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/:id/invite-url', (req: Request, res: Response) => {
    const bot = botManager.getBot(req.params.id as string);
    if (!bot) { res.status(404).json({ error: 'Bot not found' }); return; }
    if (!_checkAccess(req, bot)) { res.status(403).json({ error: 'Access denied' }); return; }
    const url = 'https://qun.qq.com/qunpro/robot/qunshare?robot_appid=' + bot.appId;
    const qrcodeUrl = 'https://q.qq.com/bot/qrcode/' + bot.appId;
    res.json({ inviteUrl: url, qrcodeUrl, appId: bot.appId, name: bot.name });
  });

  router.post('/:id/groups/mute', (req: Request, res: Response) => {
    try {
      const bot = botManager.getBot(req.params.id as string);
      if (!bot) { res.status(404).json({ error: 'Bot not found' }); return; }
      if (!_checkAccess(req, bot)) { res.status(403).json({ error: 'Access denied' }); return; }
      const { groupOpenid, memberOpenid, duration } = req.body;
      if (!groupOpenid || !memberOpenid) {
        res.status(400).json({ error: 'groupOpenid and memberOpenid are required' }); return;
      }
      const botCore = getBotInstance(bot.appId) || getBot();
      botCore.muteMember(groupOpenid, memberOpenid, duration || 600).then(() => {
        res.json({ ok: true, message: '成员已禁言 ' + (duration || 600) + ' 秒' });
      }).catch((e: any) => res.status(500).json({ error: e.message }));
    } catch (e: any) { res.status(503).json({ error: 'Bot 未初始化: ' + e.message }); }
  });

  router.post('/:id/groups/unmute', (req: Request, res: Response) => {
    try {
      const bot = botManager.getBot(req.params.id as string);
      if (!bot) { res.status(404).json({ error: 'Bot not found' }); return; }
      if (!_checkAccess(req, bot)) { res.status(403).json({ error: 'Access denied' }); return; }
      const { groupOpenid, memberOpenid } = req.body;
      if (!groupOpenid || !memberOpenid) {
        res.status(400).json({ error: 'groupOpenid and memberOpenid are required' }); return;
      }
      const botCore = getBotInstance(bot.appId) || getBot();
      botCore.unmuteMember(groupOpenid, memberOpenid).then(() => {
        res.json({ ok: true, message: '成员已解除禁言' });
      }).catch((e: any) => res.status(500).json({ error: e.message }));
    } catch (e: any) { res.status(503).json({ error: 'Bot 未初始化: ' + e.message }); }
  });

  router.post('/:id/groups/kick', (req: Request, res: Response) => {
    try {
      const bot = botManager.getBot(req.params.id as string);
      if (!bot) { res.status(404).json({ error: 'Bot not found' }); return; }
      if (!_checkAccess(req, bot)) { res.status(403).json({ error: 'Access denied' }); return; }
      const { groupOpenid, memberOpenid } = req.body;
      if (!groupOpenid || !memberOpenid) {
        res.status(400).json({ error: 'groupOpenid and memberOpenid are required' }); return;
      }
      const botCore = getBotInstance(bot.appId) || getBot();
      botCore.kickMember(groupOpenid, memberOpenid).then(() => {
        res.json({ ok: true, message: '成员已被踢出' });
      }).catch((e: any) => res.status(500).json({ error: e.message }));
    } catch (e: any) { res.status(503).json({ error: 'Bot 未初始化: ' + e.message }); }
  });

  router.post('/:id/groups/announce', (req: Request, res: Response) => {
    try {
      const bot = botManager.getBot(req.params.id as string);
      if (!bot) { res.status(404).json({ error: 'Bot not found' }); return; }
      if (!_checkAccess(req, bot)) { res.status(403).json({ error: 'Access denied' }); return; }
      const { groupOpenid, content } = req.body;
      if (!groupOpenid || !content) {
        res.status(400).json({ error: 'groupOpenid and content are required' }); return;
      }
      const botCore = getBotInstance(bot.appId) || getBot();
      botCore.setAnnouncement(groupOpenid, content).then(() => {
        res.json({ ok: true, message: '群公告已发布' });
      }).catch((e: any) => res.status(500).json({ error: e.message }));
    } catch (e: any) { res.status(503).json({ error: 'Bot 未初始化: ' + e.message }); }
  });

  return router;
}

function _checkAccess(req: Request, bot: { owner: string }): boolean {
  if (req.adminUser?.role === 'super_master') return true;
  return req.adminUser?.username === bot.owner;
}

function _secretFor(req: Request, bot: { clientSecret: string; secretVisible?: boolean }): string {
  if (req.adminUser?.role === 'super_master') return bot.clientSecret;
  if (bot.secretVisible === false) return '******';
  return bot.clientSecret;
}
