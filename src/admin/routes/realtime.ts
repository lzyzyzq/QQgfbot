import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import type { BotManager } from '../manager';
import { getDb } from '../../db/index';
import { getBotInstance } from '../../core/bot';

// 实时同步消息（消息工作台）：会话列表 / 历史消息 / SSE 实时流 / 发送消息。
// 数据来源为 system_logs（category=message 入站、send 出站），发送走后端 BotCore，
// 因此入站与出站会天然经过同一条日志链路，SSE 只需增量读表即可。
export function createRealtimeRoutes(botManager: BotManager): Router {
  const router = Router();

  const isSuper = (req: Request) => req.adminUser?.role === 'super_master';

  // 解析并鉴权目标机器人（botId 支持机器人 id 或 appId）
  function resolveBot(req: Request): { bot: any; appId: string } | null {
    const id = String(req.query.botId || (req.body && req.body.botId) || '');
    if (!id) return null;
    const bot = botManager.getBot(id) || botManager.listBots().find((b) => String(b.appId) === id);
    if (!bot) return null;
    if (!(isSuper(req) || req.adminUser?.username === bot.owner)) return null;
    return { bot, appId: String(bot.appId) };
  }

  // 正文提取：优先 detail；缺失时从 message 去掉通用前缀，仍为空则保留原 message
  function deriveContent(message: any, detail: any): string {
    let content = String(detail == null ? '' : detail).trim();
    if (content) return content;
    const raw = String(message == null ? '' : message);
    const stripped = raw
      .replace(/^收到(群|私聊|频道)消息[:：]?/, '')
      .replace(/^机器人回复\[[^\]]*\]\s*(发送成功|发送失败)?/, '')
      .trim();
    return stripped || raw.trim();
  }

  // 群头像：仅当绑定了真实群号时可用
  function groupAvatar(groupNumber: any): string {
    const n = String(groupNumber || '');
    return /^\d{6,15}$/.test(n) ? `https://p.qlogo.cn/gh/${n}/${n}/0` : '';
  }

  // 用户头像/昵称：优先 user_mappings（全局 openid↔QQ），其次 group_members（手动映射写入的 qq_id/nickname）
  // 头像优先级：已绑定 QQ → qlogo；未绑定 → QQ 官方 qqapp(appId+openid) 真实头像；都没有则返回空（前端用首字占位）
  const userCache = new Map<string, { avatar: string; name: string; qq: string; ts: number }>();
  function userInfo(openid: string, appId = ''): { avatar: string; name: string; qq: string } {
    const key = String(openid || '');
    if (!key) return { avatar: '', name: '', qq: '' };
    const ck = String(appId || '') + ':' + key;
    const hit = userCache.get(ck);
    if (hit && Date.now() - hit.ts < 60000) return hit;
    let qq = '';
    let name = '';
    try {
      const db = getDb();
      const um = db.prepare('SELECT qq_number, nickname FROM user_mappings WHERE openid=?').get(key) as any;
      if (um) {
        qq = String(um.qq_number || '').trim();
        name = String(um.nickname || '').trim();
      }
      const gm = db.prepare(
        "SELECT qq_id, nickname FROM group_members WHERE member_openid=? ORDER BY CASE WHEN qq_id<>'' THEN 0 ELSE 1 END, last_seen DESC LIMIT 1"
      ).get(key) as any;
      if (gm) {
        if (!/^\d{5,12}$/.test(qq) && gm.qq_id) qq = String(gm.qq_id).trim();
        if (!name && gm.nickname) name = String(gm.nickname).trim();
      }
    } catch { /* ignore */ }
    let avatar = '';
    if (/^\d{5,12}$/.test(qq)) {
      avatar = `https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=100`;
    } else if (appId && /^[0-9A-Za-z_-]{16,64}$/.test(key)) {
      avatar = `https://q.qlogo.cn/qqapp/${appId}/${key}/100`;
    }
    const info = { avatar, name, qq, ts: Date.now() };
    if (userCache.size > 800) userCache.clear();
    userCache.set(ck, info);
    return info;
  }

  // 日志行归一化：区分入站/出站
  function normRow(r: any, appId = '') {
    const cat = String(r.category || '');
    const dir = cat === 'send' ? 'out' : 'in';
    const u = dir === 'in' ? userInfo(String(r.user_id || ''), appId) : { avatar: '', name: '', qq: '' };
    return {
      id: Number(r.id) || 0,
      dir,
      category: cat,
      level: r.level || 'info',
      message: r.message || '',
      content: deriveContent(r.message, r.detail),
      user_id: r.user_id || '',
      group_id: r.group_id || '',
      created_at: r.created_at || '',
      sender_name: u.name,
      sender_qq: u.qq,
      sender_avatar: u.avatar,
    };
  }

  // 该机器人的全部群 OpenID（用于区分离群与私聊目标）
  function groupIdSet(appId: string): Set<string> {
    const set = new Set<string>();
    try {
      const db = getDb();
      for (const r of db.prepare('SELECT DISTINCT group_id FROM group_members WHERE bot_id = ?').all(appId) as any[]) {
        if (r.group_id) set.add(String(r.group_id));
      }
      for (const r of db.prepare('SELECT id FROM groups WHERE bot_id = ?').all(appId) as any[]) {
        if (r.id) set.add(String(r.id));
      }
      for (const r of db.prepare("SELECT DISTINCT group_id FROM system_logs WHERE bot_id = ? AND group_id != ''").all(appId) as any[]) {
        if (r.group_id) set.add(String(r.group_id));
      }
    } catch { /* ignore */ }
    return set;
  }

  // 会话列表：群聊 + 私聊，带最后一条消息与消息数
  router.get('/conversations', (req: Request, res: Response) => {
    const rb = resolveBot(req);
    if (!rb) { res.status(403).json({ error: '无权访问或机器人不存在' }); return; }
    const scope = String(req.query.scope || 'all');
    const appId = rb.appId;
    const db = getDb();
    const out: any[] = [];
    const knownGroups = groupIdSet(appId);

    if (scope !== 'c2c') {
      const groups: any[] = [];
      const seen = new Set<string>();
      try {
        const ids = [...knownGroups];
        if (ids.length) {
          const ph = ids.map(() => '?').join(',');
          for (const g of db.prepare(`SELECT id, name, group_number, avatar, member_count, last_active FROM groups WHERE id IN (${ph})`).all(...ids) as any[]) {
            if (seen.has(String(g.id))) continue;
            seen.add(String(g.id));
            groups.push(g);
          }
        }
      } catch { /* ignore */ }
      for (const gid of knownGroups) {
        if (seen.has(gid)) continue;
        seen.add(gid);
        groups.push({ id: gid, name: '', group_number: '', member_count: 0, last_active: '' });
      }
      for (const g of groups) {
        let cnt = 0; let last: any = null;
        try {
          cnt = Number((db.prepare("SELECT COUNT(*) c FROM system_logs WHERE bot_id=? AND group_id=? AND category IN ('message','send')").get(appId, g.id) as any)?.c || 0);
          last = db.prepare("SELECT message, detail, created_at FROM system_logs WHERE bot_id=? AND group_id=? AND category IN ('message','send') ORDER BY id DESC LIMIT 1").get(appId, g.id);
        } catch { /* ignore */ }
        out.push({
          type: 'group',
          id: String(g.id),
          name: g.name || '',
          openid: String(g.id),
          group_number: g.group_number || '',
          avatar: g.avatar || groupAvatar(g.group_number),
          member_count: g.member_count || 0,
          last_active: g.last_active || '',
          msg_count: cnt,
          last_text: last ? deriveContent(last.message, last.detail) : '',
          last_time: last ? last.created_at : '',
        });
      }
    }

    if (scope !== 'group') {
      const map = new Map<string, { count: number }>();
      try {
        const priv = db.prepare("SELECT user_id, COUNT(*) c FROM system_logs WHERE bot_id=? AND category='message' AND (group_id='' OR group_id IS NULL) AND user_id!='' GROUP BY user_id").all(appId) as any[];
        for (const p of priv) map.set(String(p.user_id), { count: Number(p.c) || 0 });
        const sends = db.prepare("SELECT group_id target, COUNT(*) c FROM system_logs WHERE bot_id=? AND category='send' AND group_id!='' GROUP BY group_id").all(appId) as any[];
        for (const s of sends) {
          const t = String(s.target);
          if (knownGroups.has(t)) continue;
          const cur = map.get(t) || { count: 0 };
          cur.count += Number(s.c) || 0;
          map.set(t, cur);
        }
      } catch { /* ignore */ }
      for (const [uid, info] of map) {
        let um: any = null; let last: any = null;
        try {
          um = db.prepare('SELECT qq_number, nickname FROM user_mappings WHERE openid=?').get(uid);
          last = db.prepare("SELECT message, detail, created_at FROM system_logs WHERE bot_id=? AND ((category='message' AND user_id=? AND (group_id='' OR group_id IS NULL)) OR (category='send' AND group_id=?)) ORDER BY id DESC LIMIT 1").get(appId, uid, uid);
        } catch { /* ignore */ }
        const u = userInfo(uid, appId);
        out.push({
          type: 'c2c',
          id: uid,
          name: (um && um.nickname) || u.name || '',
          openid: uid,
          group_number: '',
          qq: (um && um.qq_number) || u.qq || '',
          avatar: u.avatar,
          last_active: '',
          msg_count: info.count,
          last_text: last ? deriveContent(last.message, last.detail) : '',
          last_time: last ? last.created_at : '',
        });
      }
    }

    out.sort((a, b) => String(b.last_time || '').localeCompare(String(a.last_time || '')));
    res.json({
      conversations: out,
      bot: { id: rb.bot.id, name: rb.bot.name, appId: rb.bot.appId, status: rb.bot.status },
    });
  });

  // 历史消息（默认倒序取最近 N 条后正序返回）
  router.get('/messages', (req: Request, res: Response) => {
    const rb = resolveBot(req);
    if (!rb) { res.status(403).json({ error: '无权访问或机器人不存在' }); return; }
    const type = String(req.query.type || 'group');
    const target = String(req.query.target || '');
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const beforeId = Number(req.query.beforeId) || 0;
    if (!target) { res.json({ messages: [] }); return; }
    const db = getDb();
    let sql = '';
    let params: any[] = [];
    if (type === 'group') {
      sql = "SELECT * FROM system_logs WHERE bot_id=? AND group_id=? AND category IN ('message','send')";
      params = [rb.appId, target];
    } else {
      sql = "SELECT * FROM system_logs WHERE bot_id=? AND ((category='message' AND user_id=? AND (group_id='' OR group_id IS NULL)) OR (category='send' AND group_id=?))";
      params = [rb.appId, target, target];
    }
    if (beforeId > 0) { sql += ' AND id < ?'; params.push(beforeId); }
    sql += ' ORDER BY id DESC LIMIT ?';
    params.push(limit);
    let rows: any[] = [];
    try { rows = db.prepare(sql).all(...params) as any[]; } catch { /* ignore */ }
    rows.reverse();
    res.json({ messages: rows.map((r) => normRow(r, rb.appId)) });
  });

  // SSE 实时流：入站/出站日志增量推送
  router.get('/stream', (req: Request, res: Response) => {
    const rb = resolveBot(req);
    if (!rb) { res.status(403).json({ error: '无权访问或机器人不存在' }); return; }
    const type = String(req.query.type || 'group');
    const target = String(req.query.target || '');
    const appId = rb.appId;
    const db = getDb();

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof (res as any).flushHeaders === 'function') (res as any).flushHeaders();
    res.write(': connected\n\n');

    const query = (sinceId: number): any[] => {
      let sql = '';
      let params: any[] = [];
      if (type === 'group') {
        sql = "SELECT * FROM system_logs WHERE bot_id=? AND group_id=? AND category IN ('message','send') AND id>?";
        params = [appId, target, sinceId];
      } else {
        sql = "SELECT * FROM system_logs WHERE bot_id=? AND ((category='message' AND user_id=? AND (group_id='' OR group_id IS NULL)) OR (category='send' AND group_id=?)) AND id>?";
        params = [appId, target, target, sinceId];
      }
      sql += ' ORDER BY id ASC LIMIT 50';
      return db.prepare(sql).all(...params) as any[];
    };

    let lastId = Number(req.query.sinceId) || 0;
    if (!lastId) {
      try { lastId = Number((db.prepare('SELECT MAX(id) m FROM system_logs').get() as any)?.m || 0); } catch { lastId = 0; }
    }

    const timer = setInterval(() => {
      try {
        for (const r of query(lastId)) {
          lastId = Math.max(lastId, Number(r.id) || 0);
          res.write('event: message\ndata: ' + JSON.stringify(normRow(r, appId)) + '\n\n');
        }
        res.write(': ping\n\n');
      } catch { /* ignore */ }
    }, 1500);

    req.on('close', () => { clearInterval(timer); try { res.end(); } catch { /* ignore */ } });
  });

  // 发送消息（以机器人身份发到群 / 私聊）
  router.post('/send', async (req: Request, res: Response) => {
    const rb = resolveBot(req);
    if (!rb) { res.status(403).json({ error: '无权访问或机器人不存在' }); return; }
    const type = String(req.body?.type || 'group');
    const target = String(req.body?.target || '').trim();
    const content = String(req.body?.content ?? '');
    if (!target || !content) { res.status(400).json({ error: 'target / content 不能为空' }); return; }
    const inst = getBotInstance(rb.appId);
    if (!inst) { res.status(409).json({ error: '该机器人当前未运行，无法发送消息' }); return; }
    try {
      const result = type === 'c2c'
        ? await inst.sendPrivateMessage(target, content)
        : await inst.sendGroupMessage(target, content);
      res.json({ ok: true, result: result || null });
    } catch (e: any) {
      res.status(500).json({ error: e.message || '发送失败' });
    }
  });

  // SSE 全机器人实时流：不绑定具体会话，页面加载即可连上，用于状态灯与列表/会话增量
  router.get('/live', (req: Request, res: Response) => {
    const rb = resolveBot(req);
    if (!rb) { res.status(403).json({ error: '无权访问或机器人不存在' }); return; }
    const appId = rb.appId;
    const db = getDb();

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof (res as any).flushHeaders === 'function') (res as any).flushHeaders();
    res.write(': connected\n\n');

    const query = (sinceId: number): any[] =>
      db.prepare("SELECT * FROM system_logs WHERE bot_id=? AND category IN ('message','send') AND id>? ORDER BY id ASC LIMIT 100").all(appId, sinceId) as any[];

    let lastId = Number(req.query.sinceId) || 0;
    if (!lastId) {
      try { lastId = Number((db.prepare('SELECT MAX(id) m FROM system_logs').get() as any)?.m || 0); } catch { lastId = 0; }
    }

    const timer = setInterval(() => {
      try {
        for (const r of query(lastId)) {
          lastId = Math.max(lastId, Number(r.id) || 0);
          res.write('event: message\ndata: ' + JSON.stringify(normRow(r, appId)) + '\n\n');
        }
        res.write(': ping\n\n');
      } catch { /* ignore */ }
    }, 1200);

    req.on('close', () => { clearInterval(timer); try { res.end(); } catch { /* ignore */ } });
  });

  // 发送媒体（图片/视频/语音/文件，含表情包 GIF）：multipart 上传 → 转 QQ 富媒体 → msg_type=7
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });
  router.post('/send-media', (req: Request, res: Response, next: any) => {
    upload.single('file')(req as any, res as any, (err: any) => {
      if (err) { res.status(400).json({ error: '文件上传失败：' + (err.message || '') }); return; }
      next();
    });
  }, async (req: Request, res: Response) => {
    const rb = resolveBot(req);
    if (!rb) { res.status(403).json({ error: '无权访问或机器人不存在' }); return; }
    const type = String(req.body?.type || 'group');
    const target = String(req.body?.target || '').trim();
    const mediaType = String(req.body?.mediaType || 'image');
    const file = (req as any).file as { buffer: Buffer; originalname?: string; mimetype?: string } | undefined;
    if (!target || !file) { res.status(400).json({ error: 'target / file 不能为空' }); return; }
    const inst = getBotInstance(rb.appId);
    if (!inst) { res.status(409).json({ error: '该机器人当前未运行，无法发送消息' }); return; }
    const fileType = mediaType === 'video' ? 2 : mediaType === 'voice' ? 3 : mediaType === 'file' ? 4 : 1;
    const label = mediaType === 'video' ? '视频' : mediaType === 'voice' ? '语音' : mediaType === 'file' ? '文件' : '图片';
    const filename = file.originalname || 'media.bin';
    try {
      const up = type === 'c2c'
        ? await inst.uploadUserBuffer(target, file.buffer, filename, fileType)
        : await inst.uploadGroupBuffer(target, file.buffer, filename, fileType);
      if (!up || !up.file_info) { res.status(502).json({ error: '上传媒体到 QQ 失败' }); return; }
      const result = type === 'c2c'
        ? await inst.sendUserMediaMessage(target, up.file_info)
        : await inst.sendGroupMediaMessage(target, up.file_info, undefined, '群' + label);
      res.json({ ok: true, result: result || null });
    } catch (e: any) {
      res.status(500).json({ error: e.message || '发送媒体失败' });
    }
  });

  return router;
}
