import { Router, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { AdminAuth } from '../auth';
import { requireSuperMaster } from '../middleware';
import { getDb } from '../../db/index';
import { getPluginEngine } from '../../api/index';

const MARKET_DIR = path.resolve('plugins', '词库');
const PLUGIN_DIR = path.resolve('plugins');
const PLUGIN_EXTS = ['.js', '.mjs', '.py'];

export function getMarketSetting(key: string, def: number): number {
  const db = getDb();
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get('market.' + key) as any;
  const n = Number(row?.value);
  return Number.isFinite(n) ? n : def;
}

export function setMarketSetting(key: string, value: number) {
  getDb().prepare(
    'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run('market.' + key, String(value));
}

function getSponsorText(): string {
  const db = getDb();
  const row = db.prepare("SELECT value FROM config WHERE key = 'market.sponsor'").get() as any;
  return row?.value || '或者赞助一下柒 5米 100金币\nQQ：511742399';
}

function countEntries(content: string): number {
  const lines = String(content || '').split(/\r?\n/);
  let n = 0;
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) continue;
    if (/^(\/\/|#)/.test(t)) continue;
    if (/^规则\s+/.test(t)) { n++; continue; }
    // dict 格式：非注释非空且含 | 视为词条
    if (t.indexOf('|') !== -1 && !/^(词库|版本|主人QQ)\b/.test(t)) n++;
  }
  return n;
}

// 词库安装文件名白名单：仅 词库/ 目录下单层 .txt
function safeFileName(name: string): string {
  const base = path.basename(String(name || '').trim());
  if (!base || !/\.txt$/i.test(base) || /[\/\\\x00-\x1f]/.test(base)) return '';
  return base;
}

// 插件文件名白名单：plugins/ 目录下单层 .js/.mjs/.py
function safePluginFileName(name: string): string {
  const base = path.basename(String(name || '').trim());
  const ext = path.extname(base).toLowerCase();
  if (!base || !PLUGIN_EXTS.includes(ext) || /[\/\\\x00-\x1f]/.test(base)) return '';
  return base;
}

// 按类型解析安装文件名
function safeItemFileName(type: string, name: string): string {
  return type === 'plugin' ? safePluginFileName(name) : safeFileName(name);
}

// 安装落盘并重载加载方插件/插件引擎（与 词库管理/插件管理 保存行为一致）
function installItemFile(type: string, fileName: string, content: string): void {
  const base = safeItemFileName(type, fileName);
  if (!base) throw new Error(type === 'plugin' ? '非法的插件文件名（仅 .js/.mjs/.py）' : '非法的词库文件名');
  const dir = type === 'plugin' ? PLUGIN_DIR : MARKET_DIR;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, base), content, 'utf-8');
}

// 尝试热重载（失败不影响安装结果：服务重启后由引擎扫描加载）
function tryReload(type: string, fileName: string): string {
  try {
    const base = path.basename(fileName).replace(/\.(txt|cid|js|mjs|py)$/i, '');
    const inst = getPluginEngine();
    if (!inst) return 'skipped';
    const target = type === 'plugin' ? 'file-' + base : (base === 'dict' ? 'file-词典回复' : 'file-' + base);
    inst.reload(target).catch(() => {});
    return 'reloading(' + target + ')';
  } catch (e: any) {
    return 'warn:' + String(e.message || e);
  }
}

export function createMarketRoutes(auth: AdminAuth): Router {
  const router = Router();

  // 我的金币 / 签到状态 / 市场设置展示
  router.get('/me', (req: Request, res: Response) => {
    const me = req.adminUser!;
    const u = auth.getUser(me.username);
    const db = getDb();
    // 签到按北京时间自然日计算（UTC+8），避免北京时间 0-8 点间 UTC 日期滞后导致无法签到
    const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    const s = db.prepare('SELECT last_date, total FROM market_signins WHERE username = ?').get(me.username) as any;
    res.json({
      coins: typeof u?.coins === 'number' ? u.coins : 0,
      signedToday: s?.last_date === today,
      signinCoins: getMarketSetting('signin_coins', 5),
      taxRate: getMarketSetting('tax_rate', 10),
      sponsor: getSponsorText(),
    });
  });

  // 每日签到领金币
  router.post('/signin', (req: Request, res: Response) => {
    const me = req.adminUser!;
    const db = getDb();
    // 与 /me 一致：按北京时间自然日判定签到
    const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    const s = db.prepare('SELECT last_date, total FROM market_signins WHERE username = ?').get(me.username) as any;
    if (s?.last_date === today) { res.status(400).json({ error: '今日已签到，明天再来吧' }); return; }
    const coins = Math.max(1, Math.trunc(getMarketSetting('signin_coins', 5)));
    const balance = auth.adjustCoins(me.username, coins, '词库市场每日签到', 'system');
    if (s) {
      db.prepare('UPDATE market_signins SET last_date = ?, total = total + 1 WHERE username = ?').run(today, me.username);
    } else {
      db.prepare('INSERT INTO market_signins (username, last_date, total) VALUES (?, ?, 1)').run(me.username, today);
    }
    res.json({ ok: true, coins, balance });
  });

  // 词库列表（仅已上架/系统内置，按访问权限过滤）
  router.get('/items', (req: Request, res: Response) => {
    const me = req.adminUser!;
    const search = String(req.query.search || '').trim();
    const page = Math.max(1, Math.trunc(Number(req.query.page) || 1));
    const pageSize = Math.max(1, Math.min(50, Math.trunc(Number(req.query.pageSize) || 12)));
    const db = getDb();
    const installedSet = new Set(
      (db.prepare('SELECT item_id FROM market_installs WHERE username = ?').all(me.username) as any[]).map((r) => r.item_id)
    );
    const mineSet = new Set(
      (db.prepare('SELECT id FROM market_items WHERE owner = ?').all(me.username) as any[]).map((r) => r.id)
    );
    let rows = db.prepare("SELECT * FROM market_items WHERE status IN ('approved','pending') ORDER BY is_builtin DESC, updated_at DESC").all() as any[];
    // 访问权限过滤：all=全部；其余为角色白名单。
    // 24h 免审核测试期：pending 且 owner=本人且发布未满 24h → 仅发布者可见（trial 标记）
    const TRIAL_MS = 24 * 3600 * 1000;
    rows = rows.filter((r) => {
      if (r.status === 'approved' || r.is_builtin) return true;
      if (r.status === 'pending' && r.owner === me.username && (Date.now() - Number(r.created_at || 0)) < TRIAL_MS) return true;
      return false;
    });
    rows = rows.filter((r) => {
      const ar = String(r.allowed_roles || 'all').trim();
      return ar === 'all' || ar.split(',').map((x: string) => x.trim()).includes(me.role);
    });
    if (search) {
      const kw = search.toLowerCase();
      rows = rows.filter((r) =>
        String(r.name || '').toLowerCase().includes(kw) ||
        String(r.description || '').toLowerCase().includes(kw) ||
        String(r.author || '').toLowerCase().includes(kw) ||
        String(r.category || '').toLowerCase().includes(kw)
      );
    }
    const total = rows.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const p = Math.min(page, pages);
    const items = rows.slice((p - 1) * pageSize, p * pageSize).map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type === 'plugin' ? 'plugin' : 'dict',
      version: r.version,
      description: r.description,
      category: r.category,
      author: r.author,
      price: r.price,
      entryCount: r.entry_count,
      downloads: r.downloads,
      installed: installedSet.has(r.id),
      isBuiltin: !!r.is_builtin,
      mine: mineSet.has(r.id),
      trial: r.status === 'pending' && r.owner === me.username,
    }));
    res.json({ items, total, page: p, pages });
  });

  // 安装词库（免费直接装；付费扣金币并按税率给作者分成）
  router.post('/install/:id', (req: Request, res: Response) => {
    const me = req.adminUser!;
    const db = getDb();
    const item = db.prepare('SELECT * FROM market_items WHERE id = ?').get(String(req.params.id)) as any;
    if (!item) { res.status(404).json({ error: '词库不存在' }); return; }
    // 24h 免审核测试期：发布者本人在发布后 24h 内可安装自己的 pending 作品（免费）
    const TRIAL_MS = 24 * 3600 * 1000;
    const isTrial = item.status === 'pending' && item.owner === me.username && (Date.now() - Number(item.created_at || 0)) < TRIAL_MS;
    const visible = item.status === 'approved' || item.is_builtin || isTrial;
    if (!visible) { res.status(403).json({ error: '该词库未上架' }); return; }
    const ar = String(item.allowed_roles || 'all').trim();
    if (ar !== 'all' && !ar.split(',').map((x: string) => x.trim()).includes(me.role)) {
      res.status(403).json({ error: '无权安装该词库' }); return;
    }
    const already = db.prepare('SELECT id FROM market_installs WHERE item_id = ? AND username = ?').get(item.id, me.username);
    if (already) { res.json({ ok: true, installed: true, fileName: item.file_name }); return; }

    const price = isTrial ? 0 : (Math.max(0, Math.trunc(item.price) || 0));
    if (price > 0) {
      const u = auth.getUser(me.username);
      const coins = typeof u?.coins === 'number' ? u.coins : 0;
      if (coins < price) { res.status(400).json({ error: `金币不足（需 ${price}，当前 ${coins}），可签到或赞助获取` }); return; }
      // 买家扣款
      const buyerBalance = auth.adjustCoins(me.username, -price, `购买词库「${item.name}」`, 'market');
      if (buyerBalance === null) { res.status(500).json({ error: '扣款失败' }); return; }
      // 作者分成（扣平台税率），作者不存在或为购买者本人时跳过
      const tax = Math.min(90, Math.max(0, Math.trunc(getMarketSetting('tax_rate', 10))));
      const authorIncome = Math.floor(price * (100 - tax) / 100);
      if (authorIncome > 0 && item.owner && item.owner !== me.username && auth.getUser(item.owner)) {
        auth.adjustCoins(item.owner, authorIncome, `词库「${item.name}」售出（税率${tax}%）`, 'market');
      }
    }

    try {
      const type = item.type === 'plugin' ? 'plugin' : 'dict';
      const fileName = safeItemFileName(type, item.file_name) || (item.name + (type === 'plugin' ? '.js' : '.txt'));
      installItemFile(type, fileName, String(item.content || ''));
      // 落盘文件名回填，保证与已安装用户一致
      if (safeItemFileName(type, item.file_name) !== fileName) {
        db.prepare('UPDATE market_items SET file_name = ? WHERE id = ?').run(fileName, item.id);
      }
      const reload = tryReload(type, fileName);
    } catch (e: any) {
      res.status(500).json({ error: '写入文件失败：' + String(e.message || e) }); return;
    }
    db.prepare('INSERT OR IGNORE INTO market_installs (item_id, username) VALUES (?, ?)').run(item.id, me.username);
    db.prepare('UPDATE market_items SET downloads = downloads + 1 WHERE id = ?').run(item.id);
    const type = item.type === 'plugin' ? 'plugin' : 'dict';
    res.json({ ok: true, installed: true, fileName: item.file_name, type });
  });

  // 分享词库/插件到市场（待审核）
  router.post('/publish', (req: Request, res: Response) => {
    const me = req.adminUser!;
    const body = req.body || {};
    const name = String(body.name || '').trim();
    const content = String(body.content || '');
    const type = body.type === 'plugin' ? 'plugin' : 'dict';
    if (!name) { res.status(400).json({ error: '请填写名称' }); return; }
    if (!content.trim()) { res.status(400).json({ error: type === 'plugin' ? '插件代码不能为空' : '词库内容不能为空' }); return; }
    if (type === 'plugin' && !safePluginFileName(name + '.js') && !safePluginFileName(String(body.file_name || ''))) {
      res.status(400).json({ error: '插件文件名需以 .js / .mjs / .py 结尾' }); return;
    }
    const db = getDb();
    const id = 'mk_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const fileName = type === 'plugin'
      ? (safePluginFileName(String(body.file_name || '')) || (name + '.js'))
      : (safeFileName(String(body.file_name || '')) || (name + '.txt'));
    db.prepare(
      `INSERT INTO market_items (id, name, type, version, description, category, author, price, entry_count, content, status, is_builtin, allowed_roles, owner, file_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, 'all', ?, ?)`
    ).run(
      id, name, type,
      String(body.version || '1.0.0').trim() || '1.0.0',
      String(body.description || '').slice(0, 500),
      String(body.category || '通用').trim() || '通用',
      me.username,
      Math.max(0, Math.trunc(Number(body.price) || 0)),
      type === 'plugin' ? 0 : countEntries(content),
      content.slice(0, 2000000),
      me.username,
      fileName
    );
    res.json({ ok: true, id, entryCount: type === 'plugin' ? 0 : countEntries(content) });
  });

  // 我发布的词库
  router.get('/mine', (req: Request, res: Response) => {
    const me = req.adminUser!;
    const db = getDb();
    const rows = db.prepare('SELECT id, name, type, version, description, category, price, entry_count, downloads, status, is_builtin, allowed_roles, file_name, content, owner, created_at FROM market_items WHERE owner = ? ORDER BY created_at DESC').all(me.username) as any[];
    res.json({ items: rows });
  });

  // 下架自己的词库
  router.delete('/mine/:id', (req: Request, res: Response) => {
    const me = req.adminUser!;
    const db = getDb();
    const item = db.prepare('SELECT * FROM market_items WHERE id = ?').get(String(req.params.id)) as any;
    if (!item || item.owner !== me.username) { res.status(404).json({ error: '词库不存在' }); return; }
    db.prepare('DELETE FROM market_items WHERE id = ?').run(item.id);
    res.json({ ok: true });
  });

  // 作者编辑自己的发布（名称/版本/价格/分类/简介/内容；is_builtin 与审核状态仅超主可改）
  router.put('/mine/:id', (req: Request, res: Response) => {
    const me = req.adminUser!;
    const db = getDb();
    const item = db.prepare('SELECT * FROM market_items WHERE id = ?').get(String(req.params.id)) as any;
    if (!item || item.owner !== me.username) { res.status(404).json({ error: '词库不存在' }); return; }
    const body = req.body || {};
    const type = item.type === 'plugin' ? 'plugin' : 'dict';
    const name = String(body.name ?? item.name).trim();
    if (!name) { res.status(400).json({ error: '名称不能为空' }); return; }
    const price = Math.max(0, Math.trunc(Number(body.price ?? item.price) || 0));
    const version = String(body.version ?? (item.version || '1.0.0')).slice(0, 40);
    const description = String(body.description ?? (item.description || '')).slice(0, 500);
    const category = String(body.category ?? (item.category || '通用')).slice(0, 40);
    let content = String(body.content ?? item.content ?? '');
    if (!content.trim()) { res.status(400).json({ error: '内容不能为空' }); return; }
    if (type === 'plugin' && !safePluginFileName(String(item.file_name || name + '.js'))) { res.status(400).json({ error: '文件名非法' }); return; }
    let fileName = item.file_name;
    if (body.file_name) {
      const nf = type === 'plugin' ? safePluginFileName(String(body.file_name)) : safeFileName(String(body.file_name));
      if (nf) fileName = nf;
    }
    db.prepare('UPDATE market_items SET name=?, price=?, version=?, description=?, category=?, content=?, file_name=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(name, price, version, description, category, content, fileName || null, item.id);
    res.json({ ok: true });
  });

  // ===== 超级主人管理 =====
  router.get('/admin/items', requireSuperMaster, (req: Request, res: Response) => {
    const status = String(req.query.status || '').trim();
    const search = String(req.query.search || '').trim();
    const db = getDb();
    let rows = db.prepare('SELECT * FROM market_items ORDER BY is_builtin DESC, updated_at DESC').all() as any[];
    if (status) rows = rows.filter((r) => r.status === status);
    if (search) {
      const kw = search.toLowerCase();
      rows = rows.filter((r) => String(r.name || '').toLowerCase().includes(kw) || String(r.owner || '').toLowerCase().includes(kw));
    }
    res.json({ items: rows });
  });

  // 从本地导入（词库：plugins/词库/*.txt；插件：plugins/*.js|mjs|py）为系统内置条目（超主直接审核上架，可定价）
  router.post('/admin/import', requireSuperMaster, (req: Request, res: Response) => {
    const body = req.body || {};
    const type = body.type === 'plugin' ? 'plugin' : 'dict';
    const file = safeItemFileName(type, body.file);
    if (!file) { res.status(400).json({ error: type === 'plugin' ? '非法插件文件名' : '非法词库文件名' }); return; }
    const full = path.join(type === 'plugin' ? PLUGIN_DIR : MARKET_DIR, file);
    if (!fs.existsSync(full)) {
      res.status(404).json({ error: '文件不存在（plugins' + (type === 'plugin' ? '/' : '/词库/') + file + '）' }); return;
    }
    // 上架定价：0=免费，最高 9999 金币
    let price = Math.trunc(Number(body.price) || 0);
    if (!Number.isFinite(price) || price < 0) price = 0;
    if (price > 9999) price = 9999;
    const content = fs.readFileSync(full, 'utf-8');
    const db = getDb();
    const id = 'mk_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    db.prepare(
      `INSERT INTO market_items (id, name, type, version, description, category, author, price, entry_count, content, status, is_builtin, allowed_roles, owner, file_name)
       VALUES (?, ?, ?, '1.0.0', ?, '通用', ?, ?, ?, ?, 'approved', 1, 'all', ?, ?)`
    ).run(
      id,
      String(body.name || file.replace(/\.(txt|js|mjs|py)$/i, '')).trim(),
      type,
      String(body.description || '').slice(0, 500),
      req.adminUser!.username,
      price,
      type === 'plugin' ? 0 : countEntries(content),
      content,
      req.adminUser!.username,
      file
    );
    res.json({ ok: true, id, price });
  });

  // 市场条目源码预览（把上架内容的完整代码展示出来；approved/内置所有人可看，pending 仅本人与超主）
  router.get('/items/:id/source', (req: Request, res: Response) => {
    const me = req.adminUser!;
    const db = getDb();
    const item = db.prepare('SELECT * FROM market_items WHERE id = ?').get(String(req.params.id)) as any;
    if (!item) { res.status(404).json({ error: '条目不存在' }); return; }
    const isSuper = me.role === 'super_master';
    const visible = item.status === 'approved' || item.is_builtin || item.owner === me.username || isSuper;
    if (!visible) { res.status(403).json({ error: '该条目尚未上架，暂不可查看源码' }); return; }
    const content = String(item.content || '');
    res.json({
      id: item.id,
      name: item.name,
      type: item.type === 'plugin' ? 'plugin' : 'dict',
      author: item.author || '',
      price: item.price || 0,
      fileName: item.file_name || '',
      lineCount: content ? content.split('\n').length : 0,
      content,
    });
  });

  // 本地文件清单（供导入：词库 + 插件）
  router.get('/admin/local-files', requireSuperMaster, (_req: Request, res: Response) => {
    try {
      const files = fs.existsSync(MARKET_DIR)
        ? fs.readdirSync(MARKET_DIR).filter((n) => /\.txt$/i.test(n)).sort((a, b) => a.localeCompare(b, 'zh-CN'))
        : [];
      const plugins = fs.existsSync(PLUGIN_DIR)
        ? fs.readdirSync(PLUGIN_DIR).filter((n) => PLUGIN_EXTS.includes(path.extname(n).toLowerCase()) && fs.statSync(path.join(PLUGIN_DIR, n)).isFile())
            .sort((a, b) => a.localeCompare(b, 'zh-CN'))
        : [];
      res.json({ files, plugins });
    } catch (e: any) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  router.post('/admin/review', requireSuperMaster, (req: Request, res: Response) => {
    const body = req.body || {};
    const id = String(body.id || '');
    const action = String(body.action || '');
    if (!['approve', 'reject'].includes(action)) { res.status(400).json({ error: 'action 须为 approve/reject' }); return; }
    const db = getDb();
    const r = db.prepare('UPDATE market_items SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(action === 'approve' ? 'approved' : 'rejected', id);
    if (!r.changes) { res.status(404).json({ error: '词库不存在' }); return; }
    res.json({ ok: true });
  });

  router.put('/admin/items/:id', requireSuperMaster, (req: Request, res: Response) => {
    const id = String(req.params.id);
    const db = getDb();
    const item = db.prepare('SELECT * FROM market_items WHERE id = ?').get(id) as any;
    if (!item) { res.status(404).json({ error: '词库不存在' }); return; }
    const body = req.body || {};
    const content = typeof body.content === 'string' && body.content.trim() ? body.content : String(item.content || '');
    const type = (body.type === 'plugin' || body.type === 'dict') ? body.type : (item.type === 'plugin' ? 'plugin' : 'dict');
    db.prepare(
      `UPDATE market_items SET name = ?, type = ?, version = ?, description = ?, category = ?, author = ?, price = ?,
       entry_count = ?, content = ?, is_builtin = ?, allowed_roles = ?, status = ?, file_name = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(
      String(body.name ?? item.name).trim() || item.name,
      type,
      String(body.version ?? item.version).trim() || item.version,
      String(body.description ?? item.description).slice(0, 500),
      String(body.category ?? item.category).trim() || item.category,
      String(body.author ?? item.author).trim(),
      Math.max(0, Math.trunc(Number(body.price ?? item.price) || 0)),
      type === 'plugin' ? 0 : countEntries(content),
      content.slice(0, 2000000),
      body.is_builtin !== undefined ? (body.is_builtin ? 1 : 0) : item.is_builtin,
      String(body.allowed_roles ?? item.allowed_roles ?? 'all').trim() || 'all',
      ['pending', 'approved', 'rejected'].includes(body.status) ? body.status : item.status,
      safeItemFileName(type, body.file_name) || item.file_name,
      id
    );
    res.json({ ok: true });
  });

  router.delete('/admin/items/:id', requireSuperMaster, (req: Request, res: Response) => {
    const db = getDb();
    const r = db.prepare('DELETE FROM market_items WHERE id = ?').run(String(req.params.id));
    if (!r.changes) { res.status(404).json({ error: '词库不存在' }); return; }
    res.json({ ok: true });
  });

  router.get('/admin/settings', requireSuperMaster, (_req: Request, res: Response) => {
    res.json({
      taxRate: getMarketSetting('tax_rate', 10),
      signinCoins: getMarketSetting('signin_coins', 5),
      sponsor: getSponsorText(),
    });
  });

  router.put('/admin/settings', requireSuperMaster, (req: Request, res: Response) => {
    const body = req.body || {};
    if (body.taxRate !== undefined) setMarketSetting('tax_rate', Math.min(90, Math.max(0, Math.trunc(Number(body.taxRate) || 0))));
    if (body.signinCoins !== undefined) setMarketSetting('signin_coins', Math.min(1000, Math.max(1, Math.trunc(Number(body.signinCoins) || 5))));
    if (body.sponsor !== undefined) {
      getDb().prepare(
        'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ).run('market.sponsor', String(body.sponsor).slice(0, 300));
    }
    res.json({ ok: true });
  });

  return router;
}
