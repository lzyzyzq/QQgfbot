import { getConfig, setConfig, getDb, addSystemLog, getQQByOpenid, getMappingByOpenid, setUserMapping, updateQqNumber } from '../db/index';
import { createLogger } from '../utils/logger';
import fs from 'fs';
import path from 'path';

const logger = createLogger('napcat');

export interface NapcatConfig {
  httpUrl: string;
  token: string;
  enabled: boolean;
}

export function getNapcatConfig(): NapcatConfig {
  return {
    httpUrl: getConfig('napcat.http_url') || '',
    token: getConfig('napcat.http_token') || '',
    enabled: (getConfig('napcat.enabled') || '0') === '1',
  };
}

export function setNapcatConfig(cfg: { httpUrl?: string; token?: string; enabled?: boolean }) {
  if (cfg.httpUrl !== undefined) setConfig('napcat.http_url', cfg.httpUrl.trim());
  if (cfg.token !== undefined) setConfig('napcat.http_token', cfg.token.trim());
  if (cfg.enabled !== undefined) setConfig('napcat.enabled', cfg.enabled ? '1' : '0');
}

export function getNapcatLastSync(): any {
  const raw = getConfig('napcat.last_sync');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function isNapcatEnabled(): boolean {
  return getNapcatConfig().enabled && !!getNapcatConfig().httpUrl;
}

/** 原始 OneBot 响应（含 status/retcode/data/wording），供兼容层与 HTTP 优先逻辑使用 */
async function callRaw(action: string, params: Record<string, any> = {}, timeoutMs = 20000): Promise<any> {
  const cfg = getNapcatConfig();
  if (!cfg.enabled) throw new Error('NapCat 同步开关未开启：请在「成员同步」页开启后再操作');
  if (!cfg.httpUrl) throw new Error('NapCat HTTP 地址未配置，请先在面板填写');
  const url = cfg.httpUrl.replace(/\/+$/, '') + '/' + action;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.token) headers['Authorization'] = 'Bearer ' + cfg.token;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ params }),
        signal: controller.signal,
      });
    } catch (fetchErr: any) {
      const reason = fetchErr?.name === 'AbortError' ? '请求超时' : (fetchErr?.cause?.code || fetchErr?.message || '连接失败');
      throw new Error(`无法连接到 NapCat（${reason}）。请确认：地址是机器人服务器可访问的真实 OneBot HTTP 地址（如在手机 Termux 运行，需使用手机局域网 IP 或内网穿透公网地址，不能填 127.0.0.1），且 NapCat 已启动`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const data: any = await res.json();
    if (data.status === 'failed' || (data.retcode !== undefined && data.retcode !== 0)) {
      throw new Error(`OneBot 错误(retcode=${data.retcode}): ${data.wording || data.message || '未知错误'}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/** 通用 OneBot 动作调用（兼容层 actions.call HTTP 优先路径），返回完整响应 */
export async function callNapcatAction(action: string, params: Record<string, any> = {}, timeoutMs = 20000): Promise<any> {
  return callRaw(action, params, timeoutMs);
}

async function call(action: string, params: Record<string, any> = {}, timeoutMs = 20000): Promise<any> {
  const data = await callRaw(action, params, timeoutMs);
  return data.data;
}

export async function testNapcatConnection(): Promise<any> {
  const data = await call('get_login_info');
  return { self_id: String(data.user_id ?? ''), nickname: data.nickname || '' };
}

export async function getNapcatGroupList(): Promise<any[]> {
  const data = await call('get_group_list');
  return Array.isArray(data) ? data : [];
}

export async function getNapcatGroupMembers(groupId: string | number): Promise<any[]> {
  const gid = Number(groupId);
  const data = await call('get_group_member_list', { group_id: gid, no_cache: false }, 60000);
  return Array.isArray(data) ? data : [];
}

// 开放平台群 ID（group_openid）→ 真实群号（NapCat 用）。依赖 NapCat 同步写入 groups.group_number
export function groupOpenidToGroupNumber(groupOpenid: string): string | null {
  try {
    const row = getDb().prepare('SELECT group_number FROM groups WHERE id = ?').get(groupOpenid || '') as any;
    return row && row.group_number ? String(row.group_number) : null;
  } catch { return null; }
}

// 开放平台成员（member_openid）→ 真实 QQ 号（NapCat 用）。
// 优先取该群内 group_members.qq_id（NapCat 同步/手动绑定回填），其次 user_mappings 权威绑定。
export function memberOpenidToQQ(groupOpenid: string, memberOpenid: string): string | null {
  const valid = (v: any) => (v && /^\d{5,12}$/.test(String(v)) ? String(v) : null);
  try {
    const row = getDb().prepare('SELECT qq_id FROM group_members WHERE group_id = ? AND member_openid = ?').get(groupOpenid || '', memberOpenid) as any;
    const qq = valid(row?.qq_id);
    if (qq) return qq;
  } catch {}
  try {
    const row = getDb().prepare('SELECT qq_number FROM user_mappings WHERE openid = ?').get(memberOpenid) as any;
    const qq = valid(row?.qq_number);
    if (qq) return qq;
  } catch {}
  return null;
}

// 开放平台用户（openid，无群上下文）→ 真实 QQ 号
export function openidToQQ(openid: string): string | null {
  const valid = (v: any) => (v && /^\d{5,12}$/.test(String(v)) ? String(v) : null);
  try {
    const row = getDb().prepare('SELECT qq_number FROM user_mappings WHERE openid = ?').get(openid) as any;
    const qq = valid(row?.qq_number);
    if (qq) return qq;
  } catch {}
  try {
    const row = getDb().prepare('SELECT qq_id FROM group_members WHERE member_openid = ? AND qq_id IS NOT NULL AND qq_id != "" ORDER BY updated_at DESC LIMIT 1').get(openid) as any;
    const qq = valid(row?.qq_id);
    if (qq) return qq;
  } catch {}
  return null;
}

function ensureNapcatTable() {
  getDb().exec(`CREATE TABLE IF NOT EXISTS napcat_members (
    group_openid TEXT DEFAULT '', group_id TEXT NOT NULL, group_name TEXT DEFAULT '',
    user_id TEXT NOT NULL, nickname TEXT DEFAULT '', card TEXT DEFAULT '',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (group_id, user_id)
  )`);
}

// 读取 data/admin.json，建立 qq/openid -> 角色 映射（用于成员权限列 / userinfo 权限判断）
export function loadAdminRoleByQQ(): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const file = path.resolve(process.cwd(), 'data', 'admin.json');
    if (fs.existsSync(file)) {
      const admins = JSON.parse(fs.readFileSync(file, 'utf-8')) as any[];
      for (const a of admins) {
        if (!a || typeof a !== 'object') continue;
        const role = a.role || 'member';
        if (a.qq) map.set(String(a.qq), role);
        if (a.openid) map.set(String(a.openid), role);
      }
    }
  } catch { /* 读取失败忽略 */ }
  return map;
}

export interface SyncResult {
  matchedGroups: number;
  totalMembers: number;
  skippedGroups: string[];
  detail: Array<{ group_id: string; group_openid: string; group_name: string; members: number }>;
}

// 同步 NapCat 群成员真实 QQ 号到本地 napcat_members 表，并按昵称回填 group_members.qq_id
export async function syncNapcatMembers(): Promise<SyncResult> {
  const cfg = getNapcatConfig();
  if (!cfg.enabled) throw new Error('NapCat 同步开关未开启：请在「成员同步」页开启后再操作');
  if (!cfg.httpUrl) throw new Error('NapCat HTTP 地址未配置，请先在面板填写');
  const db = getDb();
  ensureNapcatTable();
  db.exec(`CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, name TEXT, member_count INTEGER DEFAULT 0, last_active DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  const localGroups = db.prepare('SELECT id, name FROM groups').all() as any[];
  const ncGroups = await getNapcatGroupList();
  const result: SyncResult = { matchedGroups: 0, totalMembers: 0, skippedGroups: [], detail: [] };
  const insert = db.prepare(`INSERT INTO napcat_members (group_openid, group_id, group_name, user_id, nickname, card, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(group_id, user_id) DO UPDATE SET group_openid=excluded.group_openid, group_name=excluded.group_name, nickname=excluded.nickname, card=excluded.card, updated_at=CURRENT_TIMESTAMP`);
  const runGroup = db.transaction((openid: string, gid: string, gname: string, list: any[]) => {
    for (const m of list) {
      const userId = String(m.user_id ?? '');
      if (!userId) continue;
      insert.run(openid, gid, gname, userId, String(m.nickname || ''), String(m.card || ''));
    }
  });

  for (const g of ncGroups) {
    const gid = String(g.group_id);
    const gname = String(g.group_name || '');
    let openid = '';
    const exact = localGroups.find((l: any) => l.name === gname);
    if (exact) openid = exact.id;
    if (!openid) {
      const empty = localGroups.find((l: any) => !l.name && !l.id.startsWith('__'));
      if (empty) openid = empty.id;
    }
    if (openid) {
      // 群OpenID 与真实群号绑定：记录群号 + 自动生成群头像
      const avatar = `https://p.qlogo.cn/gh/${gid}/${gid}/0`;
      try {
        db.prepare(`UPDATE groups SET group_number = ?, avatar = ?, name = CASE WHEN name IS NULL OR name = '' THEN ? ELSE name END WHERE id = ?`)
          .run(gid, avatar, gname, openid);
      } catch (e: any) { logger.warn(`save group_number for ${openid} failed: ${e.message}`); }
    }
    try {
      const members = await getNapcatGroupMembers(gid);
      runGroup(openid, gid, gname, members);
      result.matchedGroups++;
      result.totalMembers += members.length;
      result.detail.push({ group_id: gid, group_openid: openid, group_name: gname, members: members.length });
      if (!openid) result.skippedGroups.push(`${gname}(${gid})`);
    } catch (e: any) {
      addSystemLog('error', 'napcat', `同步群 ${gname}(${gid}) 失败`, e.message);
      logger.error(`sync group ${gname}(${gid}) failed: ${e.message}`);
    }
  }
  backfillGroupMembers();
  setConfig('napcat.last_sync', JSON.stringify({
    time: new Date().toISOString(),
    matchedGroups: result.matchedGroups,
    totalMembers: result.totalMembers,
    skippedGroups: result.skippedGroups,
    detail: result.detail,
  }));
  addSystemLog('info', 'napcat', `群成员同步完成：${result.matchedGroups} 个群 / ${result.totalMembers} 个成员`,
    JSON.stringify({ detail: result.detail, skipped: result.skippedGroups }));
  return result;
}

// 概览：本地群 + NapCat 群匹配情况（供面板"成员同步"页展示）
export interface Overview {
  localGroups: any[];
  napcatGroups: any[];
  lastSync: any;
  enabled: boolean;
}

export async function getNapcatOverview(): Promise<Overview> {
  const db = getDb();
  ensureNapcatTable();
  db.exec(`CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, name TEXT, member_count INTEGER DEFAULT 0, last_active DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  // 本地群按物理群合并：同一群号多个群OpenID（多机器人各分配一个）聚合为一行，聚合 group_openids 标注来源机器人
  const rawGroups = db.prepare('SELECT id, name, group_number, member_count, last_active, bot_id FROM groups ORDER BY last_active DESC').all() as any[];
  const gAgg = new Map<string, any>();
  for (const g of rawGroups) {
    const key = String(g.group_number || '') || String(g.id || '');
    if (!gAgg.has(key)) {
      gAgg.set(key, {
        id: g.id,
        name: g.name || '',
        group_number: g.group_number || '',
        group_openids: g.id ? [{ group_openid: g.id, group_bot_id: g.bot_id || '' }] : [],
        member_count: g.member_count || 0,
        last_active: g.last_active,
      });
      continue;
    }
    const cur = gAgg.get(key);
    if (g.id && !cur.group_openids.some((x: any) => x.group_openid === g.id)) {
      cur.group_openids.push({ group_openid: g.id, group_bot_id: g.bot_id || '' });
    }
    if (!cur.name && g.name) cur.name = g.name;
    cur.member_count += g.member_count || 0;
  }
  const localGroups = [...gAgg.values()].map((g: any) => {
    const ids = g.group_openids.map((x: any) => x.group_openid);
    const ph = ids.map(() => '?').join(',');
    const cnt = ph ? db.prepare(`SELECT COUNT(*) AS c FROM napcat_members WHERE group_openid IN (${ph})`).get(...ids) as any : null;
    return { ...g, synced: cnt?.c || 0 };
  });
  let napcatGroups: any[] = [];
  const enabled = isNapcatEnabled();
  if (enabled) {
    try {
      napcatGroups = await getNapcatGroupList();
      napcatGroups = napcatGroups.map((g: any) => {
        const name = String(g.group_name || '');
        const match = localGroups.find((l: any) => l.name === name);
        return {
          group_id: String(g.group_id),
          group_name: name,
          member_count: g.member_count || 0,
          matched_openid: match ? match.id : '',
        };
      });
    } catch (e: any) {
      addSystemLog('error', 'napcat', '概览拉取 NapCat 群列表失败', e.message);
    }
  }
  return { localGroups, napcatGroups, lastSync: getNapcatLastSync(), enabled };
}

// 回填：group_members 中 qq_id 为空、同群 napcat_members 昵称/card 匹配 → 填真实 QQ 号（不覆盖手动映射）
function backfillGroupMembers() {
  const db = getDb();
  const rows = db.prepare(`SELECT group_id, member_openid, nickname FROM group_members WHERE qq_id IS NULL OR qq_id = ''`).all() as any[];
  let filled = 0;
  for (const row of rows) {
    if (!row.nickname) continue;
    const nc = db.prepare(`SELECT user_id FROM napcat_members WHERE group_openid = ? AND (nickname = ? OR card = ?) ORDER BY updated_at DESC LIMIT 1`)
      .get(row.group_id, row.nickname, row.nickname) as any;
    if (nc) {
      db.prepare(`UPDATE group_members SET qq_id = ? WHERE group_id = ? AND member_openid = ?`)
        .run(nc.user_id, row.group_id, row.member_openid);
      filled++;
    }
  }
  if (filled > 0) {
    addSystemLog('info', 'napcat', `按昵称回填 ${filled} 条群成员 QQ 号`, '');
  }
}

// 统一视图：开放平台收录成员 + NapCat 真实同步成员（并集），每个成员带 QQ 号与来源
export function getAllGroupMembers(keyword = '', groupOpenid = '', botId = '', groupNumber = ''): any[] {
  const db = getDb();
  ensureNapcatTable();
  db.exec(`CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, name TEXT, member_count INTEGER DEFAULT 0, last_active DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  const kw = keyword ? `%${keyword}%` : '%';
  const rows: any[] = [];
  const seenOpenid = new Set<string>();
  const seenQQ = new Set<string>();

  // 预加载收集信息：管理员(admin.json qq->role)、映射(openid->qq)、授权码(openid->code+role)
  const adminRoleByQQ = loadAdminRoleByQQ();
  const qqByOpenid = new Map<string, string>();
  for (const um of db.prepare('SELECT openid, qq_number FROM user_mappings').all() as any[]) {
    if (um.openid && um.qq_number) qqByOpenid.set(um.openid, String(um.qq_number));
  }
  const authByOpenid = new Map<string, any>();
  for (const ac of db.prepare("SELECT code, role, used_by FROM auth_codes WHERE used_by IS NOT NULL AND used_by != ''").all() as any[]) {
    authByOpenid.set(ac.used_by, { code: ac.code, role: ac.role || 'member' });
  }
  const toQQ = (v: string) => (v && /^\d{5,12}$/.test(v)) ? v : '';
  const collect = (openid: string, qqId: string): { qq: string; avatar: string; auth: any; permission: string } => {
    const qq = toQQ(qqId) || toQQ(qqByOpenid.get(openid) || '');
    const avatar = qq ? `https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=640` : '';
    const auth = (openid && authByOpenid.get(openid)) || (qq && authByOpenid.get(qq)) || null;
    const permission = (qq && adminRoleByQQ.get(qq)) || (openid && adminRoleByQQ.get(openid)) || '';
    return { qq, avatar, auth, permission };
  };

  // 1) 开放平台收录成员（group_members），左连群名
  const gmSql = `
    SELECT gm.group_id, gm.member_openid, gm.nickname, gm.qq_id, gm.role, gm.bot_id, g.name AS group_name, g.group_number, g.avatar AS group_avatar
    FROM group_members gm LEFT JOIN groups g ON g.id = gm.group_id
    WHERE (gm.nickname LIKE ? OR gm.qq_id LIKE ? OR gm.member_openid LIKE ?)${botId ? ' AND gm.bot_id = ?' : ''}
  `;
  const gmParams: any[] = [kw, kw, kw];
  if (botId) gmParams.push(botId);
  const gmRows = db.prepare(gmSql).all(...gmParams) as any[];
  for (const r of gmRows) {
    if (groupOpenid && r.group_id !== groupOpenid) continue;
    if (groupNumber && String(r.group_number || '') !== groupNumber) continue;
    let qqId = r.qq_id || '';
    let source = 'none';
    if (qqId && /^\d{5,12}$/.test(qqId)) { source = 'mapped'; }
    else { qqId = ''; } // qq_id 列可能被历史数据误写为 OpenID，仅保留真实 QQ 号
    if ((!qqId || source === 'none') && r.nickname) {
      const nc = db.prepare(`SELECT user_id FROM napcat_members WHERE group_openid = ? AND (nickname = ? OR card = ?) ORDER BY updated_at DESC LIMIT 1`)
        .get(r.group_id, r.nickname, r.nickname) as any;
      if (nc) { qqId = nc.user_id; source = 'napcat'; }
    }
    seenOpenid.add(r.group_id + '|' + r.member_openid);
    if (qqId && /^\d{5,12}$/.test(qqId)) seenQQ.add(r.group_id + '|' + qqId);
    const info = collect(r.member_openid || '', qqId);
    rows.push({
      group_id: r.group_id,
      member_openid: r.member_openid,
      nickname: r.nickname || '',
      qq_id: info.qq,
      role: r.role || '',
      source: info.qq ? (source === 'napcat' ? 'napcat' : 'mapped') : 'none',
      group_name: r.group_name || '',
      group_number: r.group_number || '',
      group_avatar: r.group_avatar || '',
      bot_id: r.bot_id || '',
      avatar: info.avatar,
      auth_code: info.auth ? info.auth.code : '',
      auth_role: info.auth ? info.auth.role : '',
      permission: info.permission,
    });
  }

  // 2) NapCat 同步但本地未收录/未回填的成员（避免与上面重复）
  let sql = 'SELECT nap.group_openid, nap.group_id, nap.group_name, nap.user_id, nap.nickname FROM napcat_members nap WHERE 1=1';
  const params: any[] = [];
  if (groupOpenid) { sql += ' AND nap.group_openid = ?'; params.push(groupOpenid); }
  if (groupNumber) { sql += ' AND nap.group_openid IN (SELECT id FROM groups WHERE group_number = ?)'; params.push(groupNumber); }
  if (botId) { sql += ' AND nap.group_openid IN (SELECT id FROM groups WHERE bot_id = ?)'; params.push(botId); }
  if (kw) { sql += ' AND (nap.user_id LIKE ? OR nap.nickname LIKE ?)'; params.push(kw, kw); }
  const ncRows = db.prepare(sql + ' ORDER BY updated_at DESC').all(...params) as any[];
  for (const r of ncRows) {
    const keyOpenid = r.group_openid + '|openid:' + r.user_id;
    if (seenOpenid.has(keyOpenid)) continue;
    if (r.group_openid && seenQQ.has(r.group_openid + '|' + r.user_id)) continue;
    if (r.group_openid && db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND qq_id = ?').get(r.group_openid, r.user_id)) continue;
    const info = collect(r.group_openid || '', r.user_id);
    let gNum = '';
    let gAv = '';
    try {
      const g = db.prepare('SELECT group_number, avatar FROM groups WHERE id = ?').get(r.group_openid || '') as any;
      if (g) { gNum = g.group_number || ''; gAv = g.avatar || ''; }
    } catch {}
    rows.push({
      group_id: r.group_openid,
      member_openid: '',
      nickname: r.nickname || '',
      qq_id: toQQ(r.user_id),
      source: 'napcat',
      group_name: r.group_name || '',
      group_number: gNum || '',
      group_avatar: gAv || '',
      avatar: info.avatar,
      auth_code: info.auth ? info.auth.code : '',
      auth_role: info.auth ? info.auth.role : '',
      permission: info.permission,
    });
  }

  // 3) 聚合：同一物理群（按群号，无群号则按群OpenID）合并群行；群内同一成员（按QQ，无QQ则按OpenID）合并成员行。
  //    解决同一物理群被多个机器人各分配群OpenID/成员OpenID导致的重复展示，聚合时保留各来源机器人标注。
  const groupKey = (r: any) => String(r.group_number || '') || String(r.group_id || '');
  const memberKey = (r: any) => String(r.qq_id || '') || String(r.member_openid || '');
  const agg = new Map<string, any>();
  for (const r of rows) {
    const gk = groupKey(r);
    const mk = memberKey(r);
    const key = gk + '|' + mk;
    if (!agg.has(key)) {
      agg.set(key, {
        ...r,
        group_openids: r.group_id ? [{ group_openid: r.group_id, group_bot_id: r.bot_id || '' }] : [],
        member_openids: r.member_openid ? [{ openid: r.member_openid, bot_id: r.bot_id || '', role: r.role || '', group_openid: r.group_id || '' }] : [],
      });
      continue;
    }
    const cur = agg.get(key);
    // 聚合群OpenID（保留第一个的群名/群号/群头像）
    if (r.group_id && !cur.group_openids.some((x: any) => x.group_openid === r.group_id)) {
      cur.group_openids.push({ group_openid: r.group_id, group_bot_id: r.bot_id || '' });
    }
    // 聚合成员OpenID（带后台可编辑的群角色 role）
    if (r.member_openid && !cur.member_openids.some((x: any) => x.openid === r.member_openid)) {
      cur.member_openids.push({ openid: r.member_openid, bot_id: r.bot_id || '', role: r.role || '', group_openid: r.group_id || '' });
    } else if (r.member_openid) {
      const ex = cur.member_openids.find((x: any) => x.openid === r.member_openid);
      if (ex && !ex.role && r.role) ex.role = r.role;
      if (ex && !ex.group_openid && r.group_id) ex.group_openid = r.group_id;
    }
    // 昵称/头像优先取非空
    if (!cur.nickname && r.nickname) cur.nickname = r.nickname;
    if (!cur.avatar && r.avatar) cur.avatar = r.avatar;
    if (!cur.group_name && r.group_name) cur.group_name = r.group_name;
    if (!cur.group_avatar && r.group_avatar) cur.group_avatar = r.group_avatar;
    // source 优先级：mapped > napcat > none
    const srcRank: any = { none: 0, napcat: 1, mapped: 2 };
    if (srcRank[r.source] > (srcRank[cur.source] || 0)) cur.source = r.source;
    if (!cur.permission && r.permission) cur.permission = r.permission;
  }
  return [...agg.values()];
}

// 超管编辑成员 QQ：写入 user_mappings（权威绑定）并回填 group_members.qq_id，
// 同时同步 admin.json 中该 openid 的 qq/avatar/nickname，保证面板权限与个人信息一致。
// 改 QQ 时同步旧 QQ 在所有机器人（OpenID）上的绑定，保证多机器人身份识别随账号切换生效。
export function updateMemberBinding(openid: string, qq: string, botId?: string): void {
  const db = getDb();
  try {
    const oldQq = getQQByOpenid(openid);
    if (oldQq && oldQq !== qq) updateQqNumber(oldQq, qq);
  } catch {}
  const gRow = db.prepare("SELECT bot_id FROM group_members WHERE member_openid = ? AND bot_id != '' LIMIT 1").get(openid) as any;
  const bid = (botId || (gRow && gRow.bot_id) || getMappingByOpenid(openid)?.bot_id || '').trim();
  setUserMapping(openid, qq, '', bid);
  db.prepare('UPDATE group_members SET qq_id = ? WHERE member_openid = ?').run(qq, openid);
  try {
    const file = path.resolve(process.cwd(), 'data', 'admin.json');
    if (fs.existsSync(file)) {
      const admins = JSON.parse(fs.readFileSync(file, 'utf-8')) as any[];
      let changed = false;
      for (const a of admins) {
        if (a && a.openid === openid && a.qq !== qq) {
          a.qq = qq;
          a.avatar = `https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=640`;
          changed = true;
        }
      }
      if (changed) fs.writeFileSync(file, JSON.stringify(admins, null, 2));
    }
  } catch {}
}

// 超管删除成员：解绑 user_mappings、删除 group_members 记录；admin.json 中若存在该 openid
// 则仅清空 qq/avatar（保留账号与角色，面板权限仍按 openid 生效）。
// 传入 groupId 时仅删除指定群的 group_members 记录（不动 user_mappings / admin.json），用于修复挂错群。
export function removeMemberBinding(openid: string, groupId?: string): void {
  const db = getDb();
  if (groupId) {
    db.prepare('DELETE FROM group_members WHERE member_openid = ? AND group_id = ?').run(openid, groupId);
    return;
  }
  db.prepare('DELETE FROM user_mappings WHERE openid = ?').run(openid);
  db.prepare('DELETE FROM group_members WHERE member_openid = ?').run(openid);
  try {
    const file = path.resolve(process.cwd(), 'data', 'admin.json');
    if (fs.existsSync(file)) {
      const admins = JSON.parse(fs.readFileSync(file, 'utf-8')) as any[];
      let changed = false;
      for (const a of admins) {
        if (a && a.openid === openid && (a.qq || a.avatar)) {
          delete a.qq;
          delete a.avatar;
          changed = true;
        }
      }
      if (changed) fs.writeFileSync(file, JSON.stringify(admins, null, 2));
    }
  } catch {}
}

// 新增成员（手动插入 OpenID）：写入 group_members（若有归属群），可选现绑定 QQ（user_mappings + admin.json 头像昵称）。
// 后期绑定 = 只记 OpenID 不绑 QQ；头像/昵称在绑定 QQ 后自动生成。openid 可关联多个群。
export interface AddMemberInput {
  openid: string;
  groupOpenid?: string;
  qq?: string;
  nickname?: string;
  botId?: string;
}
export function addNapcatMember(input: AddMemberInput): { groupInserted: boolean; qqBound: boolean } {
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, name TEXT, member_count INTEGER DEFAULT 0, last_active DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  let groupInserted = false;
  if (input.groupOpenid) {
    const gid = String(input.groupOpenid);
    if (!db.prepare('SELECT 1 FROM groups WHERE id = ?').get(gid)) {
      db.prepare('INSERT INTO groups (id, name, member_count, last_active) VALUES (?, ?, 0, CURRENT_TIMESTAMP)')
        .run(gid, gid);
    }
    const bid = (input.botId || '').trim();
    db.prepare(`INSERT INTO group_members (group_id, member_openid, qq_id, nickname, bot_id, first_seen, last_seen)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(group_id, member_openid) DO UPDATE SET qq_id = CASE WHEN excluded.qq_id != '' THEN excluded.qq_id ELSE qq_id END,
        nickname = CASE WHEN excluded.nickname != '' THEN excluded.nickname ELSE nickname END,
        bot_id = CASE WHEN excluded.bot_id != '' THEN excluded.bot_id ELSE bot_id END, last_seen = CURRENT_TIMESTAMP`)
      .run(gid, input.openid, input.qq || '', input.nickname || '', bid);
    groupInserted = true;
  }
  let qqBound = false;
  const qq = input.qq || '';
  if (/^\d{5,12}$/.test(qq)) {
    const bid = (input.botId || '').trim();
    setUserMapping(input.openid, qq, input.nickname || '', bid);
    if (!input.groupOpenid) {
      const bid = (input.botId || '').trim();
      db.prepare(`INSERT INTO group_members (group_id, member_openid, qq_id, nickname, bot_id, first_seen, last_seen)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(group_id, member_openid) DO UPDATE SET qq_id = excluded.qq_id, nickname = excluded.nickname, bot_id = excluded.bot_id, last_seen = CURRENT_TIMESTAMP`)
        .run('', input.openid, qq, input.nickname || '', bid);
    }
    try {
      const file = path.resolve(process.cwd(), 'data', 'admin.json');
      if (fs.existsSync(file)) {
        const admins = JSON.parse(fs.readFileSync(file, 'utf-8')) as any[];
        let changed = false;
        for (const a of admins) {
          if (a && a.openid === input.openid) {
            if (a.qq !== qq) { a.qq = qq; changed = true; }
            if (!a.avatar) { a.avatar = `https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=640`; changed = true; }
            if (input.nickname && a.nickname !== input.nickname) { a.nickname = input.nickname; changed = true; }
          }
        }
        if (changed) fs.writeFileSync(file, JSON.stringify(admins, null, 2));
      }
    } catch {}
    qqBound = true;
  }
  return { groupInserted, qqBound };
}

// 编辑成员：更新昵称 / 来源机器人 / 绑定 QQ（现绑定）。openid 不变，保留各群归属。
export function updateNapcatMember(openid: string, patch: { qq?: string; nickname?: string; botId?: string }): void {
  const db = getDb();
  const sets: string[] = [];
  const params: any[] = [];
  if (patch.nickname !== undefined) {
    sets.push('nickname = ?'); params.push(patch.nickname);
    db.prepare("UPDATE user_mappings SET nickname = CASE WHEN ? != '' THEN ? ELSE nickname END, last_updated = datetime('now') WHERE openid = ?")
      .run(patch.nickname, patch.nickname, openid);
  }
  if (patch.qq !== undefined && /^\d{5,12}$/.test(patch.qq)) {
    sets.push('qq_id = ?'); params.push(patch.qq);
    const bid = (patch.botId || '').trim();
    setUserMapping(openid, patch.qq, patch.nickname || '', bid);
    try {
      const file = path.resolve(process.cwd(), 'data', 'admin.json');
      if (fs.existsSync(file)) {
        const admins = JSON.parse(fs.readFileSync(file, 'utf-8')) as any[];
        let changed = false;
        for (const a of admins) {
          if (a && a.openid === openid && a.qq !== patch.qq) {
            a.qq = patch.qq;
            a.avatar = `https://q1.qlogo.cn/g?b=qq&nk=${patch.qq}&s=640`;
            if (patch.nickname) a.nickname = patch.nickname;
            changed = true;
          }
        }
        if (changed) fs.writeFileSync(file, JSON.stringify(admins, null, 2));
      }
    } catch {}
  }
  // 来源机器人：独立更新 group_members.bot_id 与 user_mappings.bot_id（不强制要求带 QQ）
  if (patch.botId !== undefined) {
    sets.push('bot_id = ?'); params.push((patch.botId || '').trim());
    db.prepare("UPDATE user_mappings SET bot_id = CASE WHEN ? != '' THEN ? ELSE bot_id END, last_updated = datetime('now') WHERE openid = ?")
      .run(patch.botId || '', patch.botId || '', openid);
  }
  if (sets.length) {
    db.prepare(`UPDATE group_members SET ${sets.join(', ')}, last_seen = CURRENT_TIMESTAMP WHERE member_openid = ?`).run(...params, openid);
  }
}

// 修正成员所在群：把 openid 的群归属修正为目标群（默认从其他群移除，用于修复"挂错群/来源机器人写反"）。
// 目标群 upsert 该成员（保留 qq/nickname，bot_id 用指定值或目标群原归属机器人兜底），并同步 user_mappings.bot_id。
export function moveNapcatMember(
  openid: string,
  targetGroupId: string,
  opts?: { removeOthers?: boolean; botId?: string }
): { moved: boolean; removed: number } {
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, name TEXT, member_count INTEGER DEFAULT 0, last_active DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  const gid = String(targetGroupId || '').trim();
  if (!openid || !gid) return { moved: false, removed: 0 };
  if (!db.prepare('SELECT 1 FROM groups WHERE id = ?').get(gid)) {
    db.prepare('INSERT INTO groups (id, name, member_count, last_active) VALUES (?, ?, 0, CURRENT_TIMESTAMP)').run(gid, gid);
  }
  const existing = db.prepare('SELECT group_id, qq_id, nickname, bot_id FROM group_members WHERE member_openid = ?').all(openid) as any[];
  const hasTarget = existing.some((r: any) => r.group_id === gid);
  const seed = existing[0] || {};
  const bid = String((opts?.botId || '').trim() || seed.bot_id || '');
  db.prepare(`INSERT INTO group_members (group_id, member_openid, qq_id, nickname, bot_id, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(group_id, member_openid) DO UPDATE SET
      qq_id = CASE WHEN excluded.qq_id != '' THEN excluded.qq_id ELSE qq_id END,
      nickname = CASE WHEN excluded.nickname != '' THEN excluded.nickname ELSE nickname END,
      bot_id = CASE WHEN excluded.bot_id != '' THEN excluded.bot_id ELSE bot_id END,
      last_seen = CURRENT_TIMESTAMP`)
    .run(gid, openid, seed.qq_id || '', seed.nickname || '', bid);
  let removed = 0;
  if (opts?.removeOthers !== false) {
    removed = db.prepare('DELETE FROM group_members WHERE member_openid = ? AND group_id != ?').run(openid, gid).changes;
  }
  if (bid) {
    db.prepare("UPDATE user_mappings SET bot_id = CASE WHEN ? != '' THEN ? ELSE bot_id END, last_updated = datetime('now') WHERE openid = ?")
      .run(bid, bid, openid);
  }
  return { moved: !hasTarget || removed > 0, removed };
}

// 修正 OpenID 值：把旧 openid 全库替换为新 openid（group_members / user_mappings / auth_codes.used_by / admin.json.openid），
// 用于纠正"成员 openid 写错/张冠李戴"。目标 openid 已存在时合并删除冲突记录。
export function renameNapcatMember(oldOpenid: string, newOpenid: string): { renamed: number } {
  const db = getDb();
  const oldO = String(oldOpenid || '').trim();
  const newO = String(newOpenid || '').trim();
  if (!oldO || !newO || oldO === newO) return { renamed: 0 };
  // group_members：若目标 openid 在相同群已有记录则先删除冲突行，再整体改名（PRIMARY KEY (group_id, member_openid)）
  db.prepare('DELETE FROM group_members WHERE member_openid = ? AND group_id IN (SELECT group_id FROM group_members WHERE member_openid = ?)')
    .run(oldO, newO);
  const res = db.prepare('UPDATE group_members SET member_openid = ?, last_seen = CURRENT_TIMESTAMP WHERE member_openid = ?').run(newO, oldO);
  // user_mappings：目标 openid 已存在时删旧映射（避免主键冲突），否则改名
  if (db.prepare('SELECT 1 FROM user_mappings WHERE openid = ?').get(newO)) {
    db.prepare('DELETE FROM user_mappings WHERE openid = ?').run(oldO);
  } else {
    db.prepare("UPDATE user_mappings SET openid = ?, last_updated = datetime('now') WHERE openid = ?").run(newO, oldO);
  }
  // auth_codes.used_by：授权码归属同步换绑
  try { db.prepare('UPDATE auth_codes SET used_by = ? WHERE used_by = ?').run(newO, oldO); } catch {}
  // admin.json：openid 同步替换
  try {
    const file = path.resolve(process.cwd(), 'data', 'admin.json');
    if (fs.existsSync(file)) {
      const admins = JSON.parse(fs.readFileSync(file, 'utf-8')) as any[];
      let changed = false;
      for (const a of admins) {
        if (a && a.openid === oldO) { a.openid = newO; changed = true; }
      }
      if (changed) fs.writeFileSync(file, JSON.stringify(admins, null, 2));
    }
  } catch {}
  return { renamed: res.changes };
}

// 「从用户管理」一键收录+补全：把群成员(group_members)中已绑定真实 QQ 号的 OpenID
// 补入 user_mappings（OpenID 列表数据源），并用群成员最新昵称/QQ 号/来源机器人补全已有记录。
// 仅收录有 QQ 号的成员（OpenID 列表定位为「QQ 号名下」），未绑定 QQ 的群成员跳过。
export function syncOpenidsFromMembers(): { added: number; updated: number; skipped: number } {
  const db = getDb();
  const rows = db.prepare(
    'SELECT member_openid, qq_id, nickname, bot_id FROM group_members WHERE member_openid != \'\' ORDER BY last_seen DESC, rowid DESC'
  ).all() as any[];
  // 按 member_openid 聚合：保留最新一条昵称，QQ/机器人取任意非空
  const best = new Map<string, { openid: string; qq: string; nickname: string; botId: string }>();
  for (const r of rows) {
    const oid = String(r.member_openid || '');
    if (!oid) continue;
    const cur = best.get(oid);
    if (!cur) {
      best.set(oid, { openid: oid, qq: String(r.qq_id || ''), nickname: String(r.nickname || ''), botId: String(r.bot_id || '') });
    } else {
      if (!cur.qq && r.qq_id) cur.qq = String(r.qq_id);
      if (!cur.nickname && r.nickname) cur.nickname = String(r.nickname);
      if (!cur.botId && r.bot_id) cur.botId = String(r.bot_id);
    }
  }
  let added = 0, updated = 0, skipped = 0;
  for (const b of best.values()) {
    // QQ 号：群成员 qq_id 优先，否则沿用 user_mappings 已有绑定
    let qq = b.qq;
    if (!qq) {
      const m = getMappingByOpenid(b.openid);
      if (m && m.qq_number) qq = m.qq_number;
    }
    if (!qq || !/^\d{5,12}$/.test(qq)) { skipped++; continue; }
    const existing = getMappingByOpenid(b.openid);
    if (existing) {
      const nick = b.nickname || existing.nickname;
      const bot = b.botId || existing.bot_id;
      const changed = (b.nickname && b.nickname !== existing.nickname) || (qq !== existing.qq_number) || (b.botId && b.botId !== existing.bot_id);
      if (changed) {
        setUserMapping(b.openid, qq, nick, bot);
        updated++;
      }
    } else {
      setUserMapping(b.openid, qq, b.nickname || '', b.botId || '');
      added++;
    }
  }
  return { added, updated, skipped };
}

// 用群成员最新昵称刷新 user_mappings.nickname（群成员改名后 OpenID 列表同步更新）。
// openids 为空数组时全量同步；返回更新的条数。
export function syncOpenidNicknames(openids: string[] = []): number {
  const db = getDb();
  const targets = openids && openids.length
    ? openids.filter(Boolean)
    : (db.prepare('SELECT openid FROM user_mappings').all() as any[]).map((r) => String(r.openid || ''));
  if (!targets.length) return 0;
  let updated = 0;
  const upd = db.prepare("UPDATE user_mappings SET nickname = ?, last_updated = datetime('now') WHERE openid = ? AND (nickname IS NULL OR nickname != ?)");
  for (const oid of targets) {
    const latest = db.prepare(
      "SELECT nickname FROM group_members WHERE member_openid = ? AND nickname != '' ORDER BY last_seen DESC, rowid DESC LIMIT 1"
    ).get(oid) as any;
    if (latest && latest.nickname) {
      const r = upd.run(latest.nickname, oid, latest.nickname);
      if (r.changes > 0) updated++;
    }
  }
  return updated;
}
