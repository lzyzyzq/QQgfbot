import { Router } from 'express';
import { getDb } from '../db/index';
import { getBot } from '../core/bot';

const router = Router();

function ensureGroupsTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT,
      member_count INTEGER DEFAULT 0,
      first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_active DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function ensureGroupMembersTable() {
  getDb().exec(`
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
  `);
}

// Record a group when a message arrives
export function recordGroupActivity(groupId: string, memberCount?: number) {
  try {
    ensureGroupsTable();
    getDb().prepare(`
      INSERT INTO groups (id, member_count, last_active) VALUES (?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET last_active = datetime('now')
    `).run(groupId, memberCount || 0);
  } catch {}
}

router.get('/groups', (_req, res) => {
  try {
    ensureGroupsTable();
    ensureGroupMembersTable();
    const db = getDb();
    const groups = db.prepare('SELECT * FROM groups ORDER BY last_active DESC').all() as any[];
    for (const g of groups) {
      const row = db.prepare('SELECT COUNT(*) as cnt FROM group_members WHERE group_id = ?').get(g.id) as any;
      g.member_count = row?.cnt || 0;
    }
    res.json({ groups });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/groups/:id/name', (req, res) => {
  try {
    const { name } = req.body;
    if (!name) { res.status(400).json({ error: 'name required' }); return; }
    getDb().prepare('UPDATE groups SET name = ? WHERE id = ?').run(name, req.params.id);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/groups/:id/members', async (req, res) => {
  try {
    ensureGroupMembersTable();
    const db = getDb();
    const botId = (req.query.bot_id as string) || '';
    let sql = 'SELECT member_openid, qq_id, nickname, bot_id, first_seen, last_seen FROM group_members WHERE group_id = ?';
    const params: any[] = [req.params.id];
    if (botId) {
      sql += ' AND bot_id = ?';
      params.push(botId);
    }
    sql += ' ORDER BY last_seen DESC';
    const members = db.prepare(sql).all(...params);
    res.json({ members, source: 'local', bot_id: botId || null });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/groups/:id/mute', async (req, res) => {
  try {
    const { memberId, duration } = req.body;
    if (!memberId) { res.status(400).json({ error: 'memberId required' }); return; }
    const bot = getBot();
    await bot.muteMember(req.params.id, memberId, duration || 600);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/groups/:id/unmute', async (req, res) => {
  try {
    const { memberId } = req.body;
    if (!memberId) { res.status(400).json({ error: 'memberId required' }); return; }
    const bot = getBot();
    await bot.unmuteMember(req.params.id, memberId);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/groups/:id/kick', async (req, res) => {
  try {
    const { memberId } = req.body;
    if (!memberId) { res.status(400).json({ error: 'memberId required' }); return; }
    const bot = getBot();
    await bot.kickMember(req.params.id, memberId);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
