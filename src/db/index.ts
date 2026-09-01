import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { createLogger } from '../utils/logger';

const logger = createLogger('db');

const dataDir = path.resolve(process.cwd(), 'data');
const dbPath = path.join(dataDir, 'bot.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

export function initDb(): Database.Database {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  createTables();
  logger.info(`Database initialized at ${dbPath}`);

  return db;
}

function createTables() {
  const database = db!;

  database.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS plugins (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      code TEXT NOT NULL,
      enabled INTEGER DEFAULT 0,
      config TEXT DEFAULT '{}',
      version INTEGER DEFAULT 1,
      type TEXT DEFAULT 'code',
      source_path TEXT DEFAULT '',
      has_webui INTEGER DEFAULT 0,
      owner TEXT DEFAULT '',
      approved INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS auth_codes (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      created_by TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      expires_at DATETIME,
      is_permanent INTEGER DEFAULT 0,
      used_by TEXT,
      used_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS group_members (
      group_id TEXT NOT NULL,
      member_openid TEXT NOT NULL,
      qq_id TEXT DEFAULT '',
      nickname TEXT DEFAULT '',
      role TEXT DEFAULT '',
      first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (group_id, member_openid)
    );

    CREATE TABLE IF NOT EXISTS user_mappings (
      openid TEXT PRIMARY KEY,
      qq_number TEXT NOT NULL,
      nickname TEXT DEFAULT '',
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS system_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL DEFAULT 'info',
      category TEXT NOT NULL DEFAULT 'system',
      message TEXT NOT NULL,
      detail TEXT DEFAULT '',
      user_id TEXT DEFAULT '',
      group_id TEXT DEFAULT '',
      bot_id TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS napcat_members (
      group_openid TEXT DEFAULT '',
      group_id TEXT NOT NULL,
      group_name TEXT DEFAULT '',
      user_id TEXT NOT NULL,
      nickname TEXT DEFAULT '',
      card TEXT DEFAULT '',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (group_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS bot_plugins (
      bot_id TEXT NOT NULL,
      plugin_id TEXT NOT NULL,
      assigned INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (bot_id, plugin_id)
    );

    CREATE TABLE IF NOT EXISTS plugin_group_config (
      plugin_id TEXT NOT NULL,
      group_id TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'deny',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (plugin_id, group_id)
    );

    CREATE TABLE IF NOT EXISTS feedbacks (
      id TEXT PRIMARY KEY,
      bot_id TEXT DEFAULT '',
      user_openid TEXT DEFAULT '',
      qq_number TEXT DEFAULT '',
      nickname TEXT DEFAULT '',
      content TEXT DEFAULT '',
      contact TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_user_mappings_qq ON user_mappings(qq_number);
    CREATE INDEX IF NOT EXISTS idx_system_logs_category ON system_logs(category);
    CREATE INDEX IF NOT EXISTS idx_system_logs_created ON system_logs(created_at);
  `);

  migrateSchema();

  logger.info('Database tables created/verified');
}

function migrateSchema() {
  const database = db!;
  const cols = database.prepare("PRAGMA table_info('plugins')").all() as any[];
  const names = new Set(cols.map((c: any) => c.name));
  if (!names.has('type')) database.exec("ALTER TABLE plugins ADD COLUMN type TEXT DEFAULT 'code'");
  if (!names.has('source_path')) database.exec("ALTER TABLE plugins ADD COLUMN source_path TEXT DEFAULT ''");
  if (!names.has('has_webui')) database.exec("ALTER TABLE plugins ADD COLUMN has_webui INTEGER DEFAULT 0");
  if (!names.has('owner')) database.exec("ALTER TABLE plugins ADD COLUMN owner TEXT DEFAULT ''");
  if (!names.has('approved')) database.exec("ALTER TABLE plugins ADD COLUMN approved INTEGER DEFAULT 0");

  // 多机器人支持：记录 OpenID 来自哪个机器人（bot_id），并支持同一 QQ 绑定多个 OpenID
  const umCols = database.prepare("PRAGMA table_info('user_mappings')").all() as any[];
  const umNames = new Set(umCols.map((c: any) => c.name));
  if (!umNames.has('bot_id')) database.exec("ALTER TABLE user_mappings ADD COLUMN bot_id TEXT DEFAULT ''");

  // 反馈回复支持：reply 回复内容、replied_at 回复时间
  const fbCols = database.prepare("PRAGMA table_info('feedbacks')").all() as any[];
  const fbNames = new Set(fbCols.map((c: any) => c.name));
  if (!fbNames.has('reply')) database.exec("ALTER TABLE feedbacks ADD COLUMN reply TEXT DEFAULT ''");
  if (!fbNames.has('replied_at')) database.exec("ALTER TABLE feedbacks ADD COLUMN replied_at DATETIME DEFAULT NULL");

  // 群信息扩展：group_number 真实群号、avatar 群头像、bot_id 归属机器人
  const gCols = database.prepare("PRAGMA table_info('groups')").all() as any[];
  const gNames = new Set(gCols.map((c: any) => c.name));
  if (!gNames.has('group_number')) database.exec("ALTER TABLE groups ADD COLUMN group_number TEXT DEFAULT ''");
  if (!gNames.has('avatar')) database.exec("ALTER TABLE groups ADD COLUMN avatar TEXT DEFAULT ''");
  if (!gNames.has('bot_id')) database.exec("ALTER TABLE groups ADD COLUMN bot_id TEXT DEFAULT ''");

  const gmCols = database.prepare("PRAGMA table_info('group_members')").all() as any[];
  const gmNames = new Set(gmCols.map((c: any) => c.name));
  if (!gmNames.has('bot_id')) database.exec("ALTER TABLE group_members ADD COLUMN bot_id TEXT DEFAULT ''");
  // 后台可编辑的群内角色：owner 群主 / admin 群管理 / member 普通成员 / 空=未设置（回退实时查询）
  if (!gmNames.has('role')) database.exec("ALTER TABLE group_members ADD COLUMN role TEXT DEFAULT ''");

  // 系统日志关联机器人（多租户运行记录按 owner 隔离）
  const slCols = database.prepare("PRAGMA table_info('system_logs')").all() as any[];
  const slNames = new Set(slCols.map((c: any) => c.name));
  if (!slNames.has('bot_id')) database.exec("ALTER TABLE system_logs ADD COLUMN bot_id TEXT DEFAULT ''");

  // 已有插件默认设为已审批
  if (!names.has('approved')) {
    database.exec("UPDATE plugins SET approved = 1, owner = 'system' WHERE owner IS NULL OR owner = ''");
  }

  // auth_codes 表迁移：补充 role 列
  const authCols = database.prepare("PRAGMA table_info('auth_codes')").all() as any[];
  const authNames = new Set(authCols.map((c: any) => c.name));
  if (!authNames.has('role')) {
    database.exec("ALTER TABLE auth_codes ADD COLUMN role TEXT DEFAULT 'member'");
  }
  // 授权码最近修改时间（激活码用户修改授权码后 10 天内不重复提醒）
  if (!authNames.has('password_changed_at')) {
    database.exec("ALTER TABLE auth_codes ADD COLUMN password_changed_at TEXT DEFAULT ''");
  }
  // 授权码绑定机器人（小主人/会员生成的激活码仅限其归属机器人激活，空=全局/超主）
  if (!authNames.has('bot_id')) {
    database.exec("ALTER TABLE auth_codes ADD COLUMN bot_id TEXT DEFAULT ''");
  }
}

export function getConfig(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM config WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setConfig(key: string, value: string) {
  getDb().prepare(
    'INSERT INTO config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP'
  ).run(key, value);
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
    logger.info('Database connection closed');
  }
}

// ====== 用户映射 (openid <-> QQ号) ======

export function setUserMapping(openid: string, qqNumber: string, nickname?: string, botId?: string) {
  getDb().prepare(
    `INSERT INTO user_mappings (openid, qq_number, nickname, bot_id, last_updated) VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(openid) DO UPDATE SET
       qq_number = CASE WHEN excluded.qq_number != '' THEN excluded.qq_number ELSE qq_number END,
       nickname = CASE WHEN excluded.nickname != '' THEN excluded.nickname ELSE nickname END,
       bot_id = CASE WHEN excluded.bot_id != '' THEN excluded.bot_id ELSE bot_id END,
       last_updated = datetime('now')`
  ).run(openid, qqNumber, nickname || '', botId || '');
}

export function getQQByOpenid(openid: string): string | null {
  const row = getDb().prepare('SELECT qq_number FROM user_mappings WHERE openid = ?').get(openid) as any;
  return row ? row.qq_number : null;
}

export function getOpenidByQQ(qqNumber: string): string | null {
  const row = getDb().prepare('SELECT openid FROM user_mappings WHERE qq_number = ?').get(qqNumber) as any;
  return row ? row.openid : null;
}

// 该 QQ 绑定的所有 OpenID（多机器人场景：每个机器人分配的 OpenID 不同）
export function getOpenidsByQQ(qqNumber: string): Array<{ openid: string; bot_id: string; nickname: string }> {
  return getDb().prepare(
    'SELECT openid, bot_id, nickname FROM user_mappings WHERE qq_number = ? ORDER BY last_updated ASC'
  ).all(qqNumber) as any[];
}

// 某 QQ 号在所有机器人（OpenID）上的绑定统一更新为新 QQ 号（用于管理员改 QQ，跨机器人同步身份）
export function updateQqNumber(oldQq: string, newQq: string): number {
  if (!oldQq || !newQq || oldQq === newQq) return 0;
  const info = getDb().prepare(
    "UPDATE user_mappings SET qq_number = ?, last_updated = datetime('now') WHERE qq_number = ?"
  ).run(newQq, oldQq);
  return info.changes;
}

// 该 OpenID 对应的映射信息
export function getMappingByOpenid(openid: string): { openid: string; qq_number: string; nickname: string; bot_id: string } | null {
  const row = getDb().prepare('SELECT * FROM user_mappings WHERE openid = ?').get(openid) as any;
  return row || null;
}

// 绑定 OpenID 到指定 QQ（同 openid 覆盖，不覆盖已有 QQ 时保留）
export function bindOpenidToQQ(openid: string, qqNumber: string, nickname?: string, botId?: string): void {
  setUserMapping(openid, qqNumber, nickname, botId);
}

// 解绑指定 OpenID
export function unbindOpenid(openid: string): boolean {
  return getDb().prepare('DELETE FROM user_mappings WHERE openid = ?').run(openid).changes > 0;
}

// 按 QQ 号聚合查询：返回每个 QQ 绑定的所有 OpenID 与机器人来源
export function listMappingsByQQ(): Array<{ qq_number: string; nickname: string; openids: Array<{ openid: string; bot_id: string }> }> {
  const rows = getDb().prepare(
    'SELECT qq_number, nickname, openid, bot_id FROM user_mappings ORDER BY qq_number, last_updated ASC'
  ).all() as any[];
  const map = new Map<string, { qq_number: string; nickname: string; openids: Array<{ openid: string; bot_id: string }> }>();
  for (const r of rows) {
    const k = r.qq_number;
    if (!k) continue;
    if (!map.has(k)) map.set(k, { qq_number: k, nickname: r.nickname || '', openids: [] });
    map.get(k)!.openids.push({ openid: r.openid, bot_id: r.bot_id || '' });
  }
  return Array.from(map.values());
}

// ====== 系统日志 ======

export function addSystemLog(level: string, category: string, message: string, detail?: string, userId?: string, groupId?: string, botId?: string) {
  try {
    getDb().prepare(
      'INSERT INTO system_logs (level, category, message, detail, user_id, group_id, bot_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(level, category, message, detail || '', userId || '', groupId || '', botId || '');
  } catch (e) { /* 写入失败不阻塞主流程 */ }
}

export function querySystemLogs(limit: number = 50, category?: string, level?: string, botIds?: string[]): any[] {
  let sql = 'SELECT * FROM system_logs WHERE 1=1';
  const params: any[] = [];
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (level) { sql += ' AND level = ?'; params.push(level); }
  if (botIds && botIds.length) {
    sql += ` AND bot_id IN (${botIds.map(() => '?').join(',')})`;
    params.push(...botIds);
  }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  return getDb().prepare(sql).all(...params);
}

export function querySystemLogsCount(category?: string, level?: string, botIds?: string[]): number {
  let sql = 'SELECT COUNT(*) AS c FROM system_logs WHERE 1=1';
  const params: any[] = [];
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (level) { sql += ' AND level = ?'; params.push(level); }
  if (botIds && botIds.length) {
    sql += ` AND bot_id IN (${botIds.map(() => '?').join(',')})`;
    params.push(...botIds);
  }
  const row = getDb().prepare(sql).get(...params) as { c: number };
  return row ? row.c : 0;
}

export function deleteSystemLogs(ids: number[]): number {
  const valid = ids.filter(Number.isInteger);
  if (!valid.length) return 0;
  const placeholders = valid.map(() => '?').join(',');
  return getDb().prepare(`DELETE FROM system_logs WHERE id IN (${placeholders})`).run(...valid).changes;
}

export function clearSystemLogs(): number {
  return getDb().prepare('DELETE FROM system_logs').run().changes;
}
