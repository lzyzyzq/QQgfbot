import { Router, type Request, type Response } from 'express';
import { getDb, setUserMapping, addSystemLog, getConfig } from '../db/index';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';

// 机器人插件专用授权码接口（仅允许本机调用）
// 机器人群聊/私聊的"生成激活码/激活授权码/授权码列表/删除授权码/修改授权码"
// 通过该接口与网页后端统一使用 auth_codes 表（数据同源）
const router = Router();

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function genCode(len = 8): string {
  let code = '';
  for (let i = 0; i < len; i++) code += CHARS[Math.floor(Math.random() * CHARS.length)];
  return code;
}

// 角色规范化：支持 超级主人/小主人/会员 三种（中英文）
function normalizeRole(role?: string | null): 'super_master' | 'master' | 'member' {
  const r = String(role || '').trim().toLowerCase();
  if (r === 'super_master' || r === 'super' || r === '超级主人' || r === '超主' || r === '超主人') return 'super_master';
  if (r === 'master' || r === '主人' || r === '小主人') return 'master';
  return 'member';
}

const ROLE_LABELS: Record<string, string> = { super_master: '超级主人', master: '小主人', member: '会员' };

function isLocal(req: Request): boolean {
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}

function rejectNonLocal(res: Response) {
  res.status(403).json({ error: 'Forbidden: local only' });
}

function calcExpiry(expiresInMinutes?: number | string): { expiresAt: string | null; isPermanent: number } {
  const m = parseInt(String(expiresInMinutes), 10);
  if (m > 0) {
    const d = new Date();
    d.setMinutes(d.getMinutes() + m);
    return { expiresAt: d.toISOString(), isPermanent: 0 };
  }
  return { expiresAt: null, isPermanent: 1 };
}

// 该 OpenID（或绑定 QQ）是否为面板超级主人：超主生成的激活码全局可用，非超主绑定其机器人
function isSuperByOpenid(openid: string): boolean {
  try {
    const file = path.resolve(process.cwd(), 'data', 'admin.json');
    if (!fs.existsSync(file)) return false;
    const admins = JSON.parse(fs.readFileSync(file, 'utf-8')) as any[];
    if (admins.some((a: any) => a && a.openid === openid && a.role === 'super_master')) return true;
    const um = getDb().prepare('SELECT qq_number FROM user_mappings WHERE openid = ?').get(openid) as any;
    if (um && um.qq_number) {
      return admins.some((a: any) => a && a.qq && String(a.qq) === String(um.qq_number) && a.role === 'super_master');
    }
  } catch {}
  return false;
}

// 面板超主机器人 AppID（config 主机器人），用于激活码列表标注与插件回退展示
function getMasterBotId(): string {
  try { return String(getConfig('bot.app_id') || '').trim(); } catch { return ''; }
}

// 生成激活码（机器人端，超级主人/小主人调用；支持角色与有效期）
// 非超主（小主人/会员）生成的激活码绑定其机器人（bot_id），仅该机器人可激活；超主生成全局可用
router.post('/auth-codes', (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  const { role, expires_in_minutes, created_by, bot_id } = req.body || {};
  const creator = String(created_by || 'bot');
  const creatorIsSuper = isSuperByOpenid(creator);
  let targetRole = normalizeRole(role);
  // 非超主只能生成 会员/小主人 激活码，不能生成 超级主人 激活码
  if (!creatorIsSuper && targetRole === 'super_master') targetRole = 'member';
  const code = genCode(8);
  const { expiresAt, isPermanent } = calcExpiry(expires_in_minutes);
  const bindBotId = creatorIsSuper ? '' : String(bot_id || '').trim();

  const db = getDb();
  const id = uuidv4();
  db.prepare(
    "INSERT INTO auth_codes (id, code, created_by, role, expires_at, is_permanent, bot_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))"
  ).run(id, code, creator, targetRole, expiresAt, isPermanent, bindBotId);

  addSystemLog('info', 'auth', `机器人生成激活码: ${code}`, `角色: ${ROLE_LABELS[targetRole]}${isPermanent ? ' 永久' : ' ' + String(expires_in_minutes) + ' 分钟'}${bindBotId ? ' 绑定机器人:' + bindBotId : ' 全局'}` , creator);
  res.json({ ok: true, id, code, role: targetRole, role_label: ROLE_LABELS[targetRole], is_permanent: !!isPermanent, expires_at: expiresAt, bot_id: bindBotId });
});

// 激活码列表（机器人端，超级主人调用）
router.get('/auth-codes', (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  const masterId = getMasterBotId();
  const rows = getDb().prepare(
    'SELECT id, code, role, created_by, expires_at, is_permanent, used_by, used_at, bot_id, created_at FROM auth_codes ORDER BY created_at DESC'
  ).all() as any[];
  res.json({ codes: rows.map((c: any) => ({ ...c, bot_label: c.bot_id ? (c.bot_id === masterId ? '超主机器人' : '机器人:' + c.bot_id) : '全局' })) });
});

// 修改激活码（机器人端，超级主人调用）：role | expires_in_minutes(0=永久)
router.put('/auth-codes', (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  const { code, role, expires_in_minutes } = req.body || {};
  const codeStr = String(code || '').toUpperCase();
  if (!codeStr) { res.status(400).json({ ok: false, error: '缺少 code 参数' }); return; }

  const db = getDb();
  const row = db.prepare('SELECT id, code FROM auth_codes WHERE code = ?').get(codeStr) as any;
  if (!row) { res.json({ ok: false, error: '授权码不存在' }); return; }

  if (role !== undefined && role !== null && String(role).trim() !== '') {
    const nr = normalizeRole(role);
    db.prepare('UPDATE auth_codes SET role = ? WHERE id = ?').run(nr, row.id);
  }
  if (expires_in_minutes !== undefined) {
    const m = parseInt(String(expires_in_minutes), 10);
    if (m > 0) {
      const d = new Date();
      d.setMinutes(d.getMinutes() + m);
      db.prepare('UPDATE auth_codes SET expires_at = ?, is_permanent = 0 WHERE id = ?').run(d.toISOString(), row.id);
    } else {
      db.prepare('UPDATE auth_codes SET expires_at = NULL, is_permanent = 1 WHERE id = ?').run(row.id);
    }
  }

  addSystemLog('info', 'auth', `机器人端修改激活码: ${codeStr}`, `role=${role || '-'} expires_in_minutes=${expires_in_minutes}`, 'bot');
  res.json({ ok: true });
});

// 删除激活码（机器人端，超级主人调用）
router.delete('/auth-codes', (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  const codeStr = String(req.query.code || '').toUpperCase();
  if (!codeStr) { res.status(400).json({ ok: false, error: '缺少 code 参数' }); return; }

  const db = getDb();
  const row = db.prepare('SELECT id, code FROM auth_codes WHERE code = ?').get(codeStr) as any;
  if (!row) { res.json({ ok: false, error: '授权码不存在' }); return; }

  db.prepare('DELETE FROM auth_codes WHERE id = ?').run(row.id);
  addSystemLog('warn', 'auth', `机器人端删除激活码: ${codeStr}`, undefined, 'bot');
  res.json({ ok: true });
});

// 激活授权码（机器人端，群聊调用）：校验并标记 used_by，返回角色
router.post('/auth-codes/verify', (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  const { code, openid, bot_id } = req.body || {};
  if (!code) {
    res.json({ valid: false, error: '缺少激活码' });
    return;
  }

  const db = getDb();
  const row = db.prepare(
    'SELECT id, code, role, expires_at, is_permanent, used_by, bot_id FROM auth_codes WHERE code = ?'
  ).get(String(code).toUpperCase()) as any;

  if (!row) {
    addSystemLog('warn', 'auth', '机器人端无效激活码尝试', String(code), openid);
    res.json({ valid: false, error: '激活码无效' });
    return;
  }

  if (row.bot_id && String(row.bot_id) !== String(bot_id || '')) {
    res.json({ valid: false, error: '该激活码仅限在指定机器人激活，请到生成它的机器人使用' });
    return;
  }

  if (!row.is_permanent && row.expires_at && new Date(row.expires_at) < new Date()) {
    addSystemLog('warn', 'auth', '机器人端过期激活码尝试', String(code), openid);
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
  addSystemLog('info', 'auth', `机器人端激活码已使用: ${row.code}`, `使用者: ${usedBy} 角色: ${row.role || 'member'}`, usedBy);

  res.json({ valid: true, code: row.code, role: row.role || 'member' });
});

// 兼容旧接口（generate/activate），无调用方时不影响
router.post('/auth-codes/generate', (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  const { role, created_by } = req.body || {};
  const targetRole = normalizeRole(role);
  const code = genCode(8);

  const id = uuidv4();
  const db = getDb();
  db.prepare(
    "INSERT INTO auth_codes (id, code, created_by, role, is_permanent, created_at) VALUES (?, ?, ?, ?, 1, datetime('now'))"
  ).run(id, code, created_by || 'bot', targetRole);

  addSystemLog('info', 'auth', `机器人生成激活码: ${code}`, `角色: ${ROLE_LABELS[targetRole]}`, created_by || 'bot');
  res.json({ id, code, role: targetRole, role_label: ROLE_LABELS[targetRole] });
});

router.post('/auth-codes/activate', (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  const { code, openid, bot_id } = req.body || {};
  if (!code) {
    res.status(400).json({ valid: false, error: '缺少激活码' });
    return;
  }

  const db = getDb();
  const row = db.prepare(
    'SELECT id, code, role, expires_at, is_permanent, used_by, bot_id FROM auth_codes WHERE code = ?'
  ).get(String(code).toUpperCase()) as any;

  if (!row) {
    addSystemLog('warn', 'auth', '机器人端无效激活码尝试', String(code), openid);
    res.json({ valid: false, error: '激活码无效' });
    return;
  }

  if (row.bot_id && String(row.bot_id) !== String(bot_id || '')) {
    res.json({ valid: false, error: '该激活码仅限在指定机器人激活，请到生成它的机器人使用' });
    return;
  }

  if (!row.is_permanent && row.expires_at && new Date(row.expires_at) < new Date()) {
    addSystemLog('warn', 'auth', '机器人端过期激活码尝试', String(code), openid);
    res.json({ valid: false, error: '激活码已过期' });
    return;
  }

  if (row.used_by) {
    res.json({ valid: false, error: '激活码已被使用' });
    return;
  }

  const usedBy = openid || 'unknown';
  db.prepare("UPDATE auth_codes SET used_by = ?, used_at = datetime('now') WHERE id = ?").run(usedBy, row.id);
  addSystemLog('info', 'auth', `机器人端激活码已使用: ${row.code}`, `使用者: ${usedBy} 角色: ${row.role || 'member'}`, usedBy);

  res.json({ valid: true, code: row.code, role: row.role || 'member' });
});

// 私聊登录信息：按 OpenID 解析 QQ，返回该用户已使用的授权码（供机器人私聊回复登录链接）
router.get('/auth-codes/login-info', (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  const openid = String(req.query.openid || '').trim();
  if (!openid) { res.status(400).json({ error: '缺少 openid' }); return; }

  const db = getDb();
  const um = db.prepare('SELECT qq_number, nickname FROM user_mappings WHERE openid = ?').get(openid) as any;
  const qq = um?.qq_number || '';
  const codes = qq
    ? db.prepare("SELECT code, role, expires_at, is_permanent FROM auth_codes WHERE used_by = ? OR used_by = ? ORDER BY created_at DESC").all(openid, qq)
    : db.prepare("SELECT code, role, expires_at, is_permanent FROM auth_codes WHERE used_by = ? ORDER BY created_at DESC").all(openid);

  const valid = (codes as any[]).filter((c: any) => c.is_permanent || (c.expires_at && new Date(c.expires_at) > new Date()));
  res.json({
    openid,
    qq_number: qq,
    nickname: um?.nickname || '',
    codes: valid.map((c: any) => ({
      code: c.code,
      role: c.role,
      role_label: c.role === 'super_master' ? '超级主人' : c.role === 'master' ? '小主人' : '会员',
      is_permanent: !!c.is_permanent,
    })),
  });
});

// 面板信息：返回面板对外地址（供机器人回复登录链接用）
router.get('/panel-info', (req: Request, res: Response) => {
  if (!isLocal(req)) { rejectNonLocal(res); return; }
  const host = getConfig('panel.host') || '';
  const port = process.env.PORT || '3000';
  res.json({ host, port, url: host ? (host.startsWith('http') ? host : 'https://' + host) : '' });
});

export default router;
