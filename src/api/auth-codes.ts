import { Router, Request, Response } from 'express';
import { getDb, setUserMapping, addSystemLog, getQQByOpenid, getOpenidsByQQ, getMappingByOpenid, unbindOpenid, listMappingsByQQ, getConfig } from '../db/index';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// 角色规范化：支持 超级主人/小主人/会员 三种（中英文）
function normalizeRole(role?: string | null): 'super_master' | 'master' | 'member' {
  const r = String(role || '').trim().toLowerCase();
  if (r === 'super_master' || r === 'super' || r === '超级主人' || r === '超主' || r === '超主人') return 'super_master';
  if (r === 'master' || r === '主人' || r === '小主人') return 'master';
  return 'member';
}

const ROLE_LABELS: Record<string, string> = { super_master: '超级主人', master: '小主人', member: '会员' };

// 生成授权码（支持绑定QQ号）
router.post('/auth-codes', (req: Request, res: Response) => {
  const { expires_in_minutes, qq_number, role } = req.body;
  const db = getDb();

  const id = uuidv4();
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();

  let expiresAt: string | null = null;
  let isPermanent = 1;

  if (expires_in_minutes && expires_in_minutes > 0) {
    isPermanent = 0;
    const d = new Date();
    d.setMinutes(d.getMinutes() + expires_in_minutes);
    expiresAt = d.toISOString();
  }

  const targetRole = normalizeRole(role);
  const createdBy = req.adminUser?.username || 'admin';
  // 越权防护：非超主不允许生成 super_master 角色授权码（只有超主授权码可登录面板）
  if (targetRole === 'super_master' && req.adminUser?.role !== 'super_master') {
    res.status(403).json({ ok: false, error: '无权限生成超级主人授权码' });
    return;
  }
  db.prepare(
    'INSERT INTO auth_codes (id, code, created_by, role, expires_at, is_permanent, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime(\'now\'))'
  ).run(id, code, createdBy, targetRole, expiresAt, isPermanent);

  addSystemLog('info', 'auth', `授权码已创建: ${code}`, JSON.stringify({ createdBy, qq_number, role: targetRole }), createdBy);

  res.json({
    id,
    code,
    role: targetRole,
    role_label: ROLE_LABELS[targetRole],
    expires_at: expiresAt,
    is_permanent: !!isPermanent,
    expires_label: isPermanent ? '永久有效' : (expires_in_minutes + ' 分钟'),
  });
});

// 别名路由：POST /api/auth/code（单数）等价于 /auth-codes 生成授权码，
// 供机器人插件 / 外部调用方统一使用（授权码数据仍存 data/bot.db 的 auth_codes 表）
router.post('/auth/code', (req: Request, res: Response) => {
  if (!req.adminUser) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const { expires_in_minutes, qq_number, role } = req.body || {};
  const db = getDb();

  const id = uuidv4();
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();

  let expiresAt: string | null = null;
  let isPermanent = 1;

  if (expires_in_minutes && expires_in_minutes > 0) {
    isPermanent = 0;
    const d = new Date();
    d.setMinutes(d.getMinutes() + expires_in_minutes);
    expiresAt = d.toISOString();
  }

  const targetRole = normalizeRole(role);
  const createdBy = req.adminUser?.username || 'admin';
  // 越权防护：非超主不允许生成 super_master 角色授权码（只有超主授权码可登录面板）
  if (targetRole === 'super_master' && req.adminUser?.role !== 'super_master') {
    res.status(403).json({ ok: false, error: '无权限生成超级主人授权码' });
    return;
  }
  db.prepare(
    'INSERT INTO auth_codes (id, code, created_by, role, expires_at, is_permanent, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime(\'now\'))'
  ).run(id, code, createdBy, targetRole, expiresAt, isPermanent);

  addSystemLog('info', 'auth', `授权码已创建: ${code}`, JSON.stringify({ createdBy, qq_number, role: targetRole }), createdBy);

  res.json({
    id,
    code,
    role: targetRole,
    role_label: ROLE_LABELS[targetRole],
    expires_at: expiresAt,
    is_permanent: !!isPermanent,
    expires_label: isPermanent ? '永久有效' : (expires_in_minutes + ' 分钟'),
  });
});

// 获取可用激活码列表（公开，供机器人插件「获取激活码」拉取）：仅返回未使用、未过期的 code，不泄露创建者等敏感信息
router.get('/auth/code', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(
      "SELECT code, expires_at, is_permanent, used_by FROM auth_codes ORDER BY created_at DESC"
    ).all() as any[];
    const now = new Date();
    const codes: string[] = [];
    for (const r of rows) {
      if (r.used_by) continue;
      if (!r.is_permanent && r.expires_at && new Date(r.expires_at) < now) continue;
      codes.push(String(r.code));
    }
    res.json({ ok: true, codes, code: codes, list: codes, count: codes.length });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 验证并激活授权码（公开，供机器人插件「激活 <码>」调用）：合法则标记 used_by=openid 并返回角色
router.post('/auth/code/verify', (req: Request, res: Response) => {
  const { code, openid } = req.body || {};
  if (!code) {
    res.json({ valid: false, error: '缺少激活码' });
    return;
  }

  const db = getDb();
  const row = db.prepare(
    'SELECT id, code, role, expires_at, is_permanent, used_by, bot_id FROM auth_codes WHERE code = ?'
  ).get(String(code).toUpperCase()) as any;

  if (!row) {
    addSystemLog('warn', 'auth', '公开接口无效激活码尝试', String(code), openid);
    res.json({ valid: false, error: '激活码无效' });
    return;
  }

  if (!row.is_permanent && row.expires_at && new Date(row.expires_at) < new Date()) {
    addSystemLog('warn', 'auth', '公开接口过期激活码尝试', String(code), openid);
    res.json({ valid: false, error: '激活码已过期' });
    return;
  }

  if (row.used_by) {
    res.json({ valid: false, error: '激活码已被使用' });
    return;
  }

  const usedBy = openid || 'unknown';
  db.prepare("UPDATE auth_codes SET used_by = ?, used_at = datetime('now') WHERE id = ?").run(usedBy, row.id);
  if (openid && !db.prepare('SELECT 1 FROM user_mappings WHERE openid = ?').get(openid)) setUserMapping(openid, '');
  addSystemLog('info', 'auth', `公开接口激活码已使用: ${row.code}`, `使用者: ${usedBy} 角色: ${row.role || 'member'}`, usedBy);

  res.json({ valid: true, code: row.code, role: row.role || 'member' });
});

// 修改授权码信息（角色 / 有效期，0=永久）；仅超主或创建者本人可修改
router.put('/auth-codes/:id', (req: Request, res: Response) => {
  const { role, expires_in_minutes } = req.body || {};
  const db = getDb();
  const row = db.prepare('SELECT id, code, created_by FROM auth_codes WHERE id = ?').get(req.params.id) as any;
  if (!row) { res.status(404).json({ ok: false, error: '授权码不存在' }); return; }
  const isOwner = row.created_by === req.adminUser?.username;
  if (req.adminUser?.role !== 'super_master' && !isOwner) {
    res.status(403).json({ ok: false, error: '无权限修改他人授权码' });
    return;
  }
  if (role !== undefined && role !== null && String(role).trim() !== '') {
    const nr = normalizeRole(role);
    if (nr === 'super_master' && req.adminUser?.role !== 'super_master') {
      res.status(403).json({ ok: false, error: '无权限生成超级主人授权码' });
      return;
    }
    db.prepare('UPDATE auth_codes SET role = ? WHERE id = ?').run(nr, row.id);
  }
  if (expires_in_minutes !== undefined && expires_in_minutes !== null && expires_in_minutes !== '') {
    const m = parseInt(String(expires_in_minutes), 10);
    if (isNaN(m)) { res.status(400).json({ ok: false, error: '有效期必须是数字（0=永久）' }); return; }
    if (m > 0) {
      const d = new Date();
      d.setMinutes(d.getMinutes() + m);
      db.prepare('UPDATE auth_codes SET expires_at = ?, is_permanent = 0 WHERE id = ?').run(d.toISOString(), row.id);
    } else {
      db.prepare('UPDATE auth_codes SET expires_at = NULL, is_permanent = 1 WHERE id = ?').run(row.id);
    }
  }

  addSystemLog('info', 'auth', `授权码信息已修改: ${row.code}`, `role=${role || '-'} expires_in_minutes=${expires_in_minutes}`, req.adminUser?.username);
  res.json({ ok: true });
});

// 列出授权码：超主可见全部（可传 bot_id 过滤），其他用户只能看到自己创建的
router.get('/auth-codes', (_req: Request, res: Response) => {
  const db = getDb();
  const user = _req.adminUser as { username?: string; role?: string } | undefined;
  const botId = (_req.query.bot_id as string) || '';
  let rows: any[];
  if (user && user.role !== 'super_master') {
    rows = db.prepare(
      'SELECT id, code, role, created_by, expires_at, is_permanent, used_by, used_at, bot_id, created_at FROM auth_codes WHERE created_by = ? ORDER BY created_at DESC'
    ).all(user.username);
  } else if (botId) {
    rows = db.prepare(
      'SELECT id, code, role, created_by, expires_at, is_permanent, used_by, used_at, bot_id, created_at FROM auth_codes WHERE bot_id = ? ORDER BY created_at DESC'
    ).all(botId);
  } else {
    rows = db.prepare(
      'SELECT id, code, role, created_by, expires_at, is_permanent, used_by, used_at, bot_id, created_at FROM auth_codes ORDER BY created_at DESC'
    ).all();
  }
  const masterId = String(getConfig('bot.app_id') || '').trim();
  res.json({ codes: rows.map((c: any) => ({ ...c, bot_label: c.bot_id ? (c.bot_id === masterId ? '超主机器人' : '机器人:' + c.bot_id) : '全局' })) });
});

// 删除授权码；仅超主或创建者本人可删除
router.delete('/auth-codes/:id', (req: Request, res: Response) => {
  const db = getDb();
  const code = db.prepare('SELECT code, created_by FROM auth_codes WHERE id = ?').get(req.params.id) as any;
  if (code) {
    const isOwner = code.created_by === req.adminUser?.username;
    if (req.adminUser?.role !== 'super_master' && !isOwner) {
      res.status(403).json({ ok: false, error: '无权限删除他人授权码' });
      return;
    }
  }
  db.prepare('DELETE FROM auth_codes WHERE id = ?').run(req.params.id);
  if (code) {
    addSystemLog('warn', 'auth', `授权码已删除: ${code.code}`, undefined, req.adminUser?.username);
  }
  res.json({ ok: true });
});

// 验证授权码（供机器人端和管理面板通用）
router.post('/auth-codes/verify', (req: Request, res: Response) => {
  const { code, openid } = req.body;
  const db = getDb();

  if (!code) {
    res.status(400).json({ valid: false, error: '缺少授权码' });
    return;
  }

  const row = db.prepare(
    'SELECT id, code, role, expires_at, is_permanent, used_by, used_at FROM auth_codes WHERE code = ?'
  ).get(code) as any;

  if (!row) {
    addSystemLog('warn', 'auth', '无效授权码尝试', code);
    res.json({ valid: false, error: '授权码无效' });
    return;
  }

  // 检查是否过期
  if (!row.is_permanent && row.expires_at) {
    if (new Date(row.expires_at) < new Date()) {
      addSystemLog('warn', 'auth', '过期授权码尝试', code);
      res.json({ valid: false, error: '授权码已过期' });
      return;
    }
  }

  // 记录使用
  if (!row.used_by) {
    const usedBy = openid || 'api';
    db.prepare('UPDATE auth_codes SET used_by = ?, used_at = datetime(\'now\') WHERE id = ?').run(usedBy, row.id);
    addSystemLog('info', 'auth', `授权码已使用: ${code}`, `使用者: ${usedBy}`, usedBy);
  }

  // 如果提供了 openid，建立映射（仅首次，不覆盖已绑定的 QQ 号）
  if (openid) {
    const db = getDb();
    if (!db.prepare('SELECT 1 FROM user_mappings WHERE openid = ?').get(openid)) {
      setUserMapping(openid, '');
    }
  }

  res.json({ valid: true, code: row.code, role: row.role || 'member' });
});

// 绑定QQ号到授权码（机器人端使用）
router.post('/auth-codes/bind-qq', (req: Request, res: Response) => {
  const { code, qq_number, openid } = req.body;

  if (!code || !qq_number) {
    res.status(400).json({ error: '缺少授权码或QQ号' });
    return;
  }

  const db = getDb();
  const row = db.prepare('SELECT id, code FROM auth_codes WHERE code = ?').get(code) as any;

  if (!row) {
    res.json({ success: false, error: '授权码无效' });
    return;
  }

  if (openid) {
    setUserMapping(openid, qq_number, '');
  }

  addSystemLog('info', 'auth', `QQ号 ${qq_number} 已绑定授权码 ${code}`, `openid: ${openid || '无'}`);

  res.json({ success: true, message: 'QQ号已绑定' });
});

// 通过 openid 查询 QQ 号
router.get('/auth-codes/qq-by-openid', (req: Request, res: Response) => {
  const openid = req.query.openid as string;
  if (!openid) { res.status(400).json({ error: '缺少 openid' }); return; }

  const db = getDb();
  const row = db.prepare('SELECT qq_number, nickname FROM user_mappings WHERE openid = ?').get(openid) as any;
  res.json(row ? { qq_number: row.qq_number, nickname: row.nickname } : { qq_number: null });
});

// 通过 QQ 号 查询 openid
router.get('/auth-codes/openid-by-qq', (req: Request, res: Response) => {
  const qq = req.query.qq as string;
  if (!qq) { res.status(400).json({ error: '缺少 qq 参数' }); return; }

  const db = getDb();
  const row = db.prepare('SELECT openid, nickname FROM user_mappings WHERE qq_number = ?').get(qq) as any;
  res.json(row ? { openid: row.openid, nickname: row.nickname } : { openid: null });
});

// ====== 多机器人 OpenID 绑定（一个 QQ 可绑定多个机器人的 OpenID） ======

// 按 QQ 查询绑定的所有 OpenID（含来源机器人）
router.get('/auth-codes/openids-by-qq', (req: Request, res: Response) => {
  const qq = String(req.query.qq || '').trim();
  if (!qq) { res.status(400).json({ error: '缺少 qq 参数' }); return; }
  res.json({ qq, openids: getOpenidsByQQ(qq) });
});

// 全部映射（按 QQ 聚合），供用户管理页展示
router.get('/auth-codes/mappings', (_req: Request, res: Response) => {
  res.json({ mappings: listMappingsByQQ() });
});

// 绑定 OpenID 到 QQ
router.post('/auth-codes/bind-openid', (req: Request, res: Response) => {
  const { openid, qq_number, nickname, bot_id } = req.body || {};
  const openidV = String(openid || '').trim();
  const qqV = String(qq_number || '').trim();
  if (!openidV || !qqV) { res.status(400).json({ ok: false, error: '缺少 openid 或 qq_number' }); return; }
  setUserMapping(openidV, qqV, String(nickname || '').trim(), String(bot_id || '').trim());
  addSystemLog('info', 'auth', `OpenID 绑定: ${openidV.slice(0, 8)}... → QQ ${qqV}`, `bot_id=${bot_id || ''}`, req.adminUser?.username);
  res.json({ ok: true, openid: openidV, qq_number: qqV });
});

// 解绑 OpenID
router.post('/auth-codes/unbind-openid', (req: Request, res: Response) => {
  const openid = String((req.body || {}).openid || '').trim();
  if (!openid) { res.status(400).json({ ok: false, error: '缺少 openid' }); return; }
  const removed = unbindOpenid(openid);
  if (removed) addSystemLog('info', 'auth', `OpenID 解绑: ${openid.slice(0, 8)}...`, undefined, req.adminUser?.username);
  res.json({ ok: true, removed });
});

// 私聊登录信息：根据 OpenID 解析 QQ，返回该用户可用的登录授权码与面板登录链接（供机器人回复）
router.get('/auth-codes/login-info', (req: Request, res: Response) => {
  const openid = String(req.query.openid || '').trim();
  if (!openid) { res.status(400).json({ error: '缺少 openid' }); return; }

  const qq = getQQByOpenid(openid) || '';
  const db = getDb();
  const codes = qq
    ? db.prepare(
        "SELECT code, role, created_by, expires_at, is_permanent, used_at FROM auth_codes WHERE used_by = ? OR used_by = ? ORDER BY created_at DESC"
      ).all(openid, qq)
    : db.prepare("SELECT code, role, created_by, expires_at, is_permanent, used_at FROM auth_codes WHERE used_by = ? ORDER BY created_at DESC").all(openid);

  const valid = (codes as any[]).filter((c: any) => c.is_permanent || (c.expires_at && new Date(c.expires_at) > new Date()));
  res.json({
    openid,
    qq_number: qq,
    nickname: getMappingByOpenid(openid)?.nickname || '',
    codes: valid.map((c: any) => ({
      code: c.code, role: c.role, role_label: c.role === 'super_master' ? '超级主人' : c.role === 'master' ? '小主人' : '会员',
      is_permanent: !!c.is_permanent,
      expires_label: c.is_permanent ? '永久有效' : (c.expires_at ? new Date(c.expires_at).toLocaleString() : ''),
    })),
  });
});

export default router;
