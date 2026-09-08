import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import type { PluginManifest } from '../config';
import { ROLE_PERMISSIONS } from '../config';
import { requireSuperMaster, getUserPermissions } from '../middleware';
import { getPluginEngine } from '../../api/index';
import { getDb, getConfig, setConfig } from '../../db/index';
import { v4 as uuidv4 } from 'uuid';
import { generatePluginBlockCode, injectCodeSegment, hasUCardSegment, assertInjectableSourceFile } from '../plugin-codegen';
import { findPluginIdFor as findMenuConfigPluginId, readAll as readMenuConfigAll, mergeConfig as mergeMenuConfig } from '../../api/menu-config';
import { builtinReplySpec, cfgKeyFor, makePreviewData, renderBranch, type ReplySpec } from '../reply-editor';

// ===================== 插件审批存储 =====================
interface PluginApproval {
  name: string;
  status: 'pending' | 'approved' | 'rejected';
  uploadedBy: string;
  uploadedAt: number;
  reviewedBy?: string;
  reviewedAt?: number;
  reason?: string;
}

class PluginApprovalStore {
  private filePath: string;
  private data: PluginApproval[] = [];

  constructor(pluginsDir: string) {
    this.filePath = path.join(pluginsDir, '.approvals.json');
    this._load();
  }

  private _load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      }
    } catch { this.data = []; }
  }

  private _save(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }

  get(name: string): PluginApproval | undefined {
    return this.data.find((a) => a.name === name);
  }

  add(name: string, uploadedBy: string): PluginApproval {
    const existing = this.get(name);
    if (existing) {
      existing.uploadedBy = uploadedBy;
      existing.uploadedAt = Date.now();
      existing.status = uploadedBy === '__super__' ? 'approved' : 'pending';
      existing.reviewedBy = undefined;
      existing.reviewedAt = undefined;
      existing.reason = undefined;
      this._save();
      return existing;
    }
    const entry: PluginApproval = {
      name,
      status: uploadedBy === '__super__' ? 'approved' : 'pending',
      uploadedBy,
      uploadedAt: Date.now(),
    };
    this.data.push(entry);
    this._save();
    return entry;
  }

  approve(name: string, reviewer: string): PluginApproval | null {
    const entry = this.get(name);
    if (!entry) return null;
    entry.status = 'approved';
    entry.reviewedBy = reviewer;
    entry.reviewedAt = Date.now();
    entry.reason = undefined;
    this._save();
    return entry;
  }

  reject(name: string, reviewer: string, reason?: string): PluginApproval | null {
    const entry = this.get(name);
    if (!entry) return null;
    entry.status = 'rejected';
    entry.reviewedBy = reviewer;
    entry.reviewedAt = Date.now();
    entry.reason = reason;
    this._save();
    return entry;
  }

  remove(name: string): void {
    this.data = this.data.filter((a) => a.name !== name);
    this._save();
  }

  all(): PluginApproval[] {
    return [...this.data];
  }
}

// ===================== 辅助函数 =====================
function listFiles(dir: string, base: string = ''): Array<{ name: string; path: string; type: string; size: number }> {
  const results: Array<{ name: string; path: string; type: string; size: number }> = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push({ name: entry.name, path: relPath, type: 'dir', size: 0 });
      results.push(...listFiles(fullPath, relPath));
    } else {
      results.push({ name: entry.name, path: relPath, type: 'file', size: fs.statSync(fullPath).size });
    }
  }
  return results;
}

function isPathSafe(base: string, target: string): boolean {
  const resolved = path.resolve(target);
  const resolvedBase = path.resolve(base);
  return resolved.startsWith(resolvedBase);
}

function getPluginOwner(name: string): string {
  try {
    const row = getDb().prepare('SELECT owner FROM plugins WHERE name = ?').get(name) as any;
    return (row && row.owner) || '';
  } catch {
    return '';
  }
}

// 编辑插件代码权限：超级主人 或 拥有 canEditPluginCode 权限 或 该插件归属本人
function canEditPlugin(req: Request, name: string, auth?: AdminAuth): boolean {
  if (req.adminUser?.role === 'super_master') return true;
  const username = req.adminUser?.username || '';
  if (auth) {
    const perms = getUserPermissions(auth, username);
    if (perms && perms.canEditPluginCode) return true;
  }
  const owner = getPluginOwner(name);
  return !!owner && owner === username;
}

import type { AdminAuth } from '../auth';

// 定位插件入口文件（供代码读写 GET/PUT /:name/code 与 gen-card 注入共用）：
// 1) plugins.source_path（存在且为文件） 2) {name}.js/.mjs/.py/.php 直接文件
// 3) {name} 本身为文件 4) ZIP 目录插件入口（index.js/index.mjs/index.ts/src/index.ts，兼容单层顶层子目录如 MKbot/xxx）
function locatePluginEntryFile(name: string, pluginsDir: string): string | null {
  const row = getDb().prepare('SELECT source_path FROM plugins WHERE name = ?').get(name) as any;
  let target: string | null = null;
  if (row?.source_path) {
    try {
      if (fs.existsSync(row.source_path) && fs.statSync(row.source_path).isFile()) {
        target = row.source_path;
      }
    } catch {}
  }
  if (!target) {
    const jsPath = path.join(pluginsDir, name + '.js');
    const mjsPath = path.join(pluginsDir, name + '.mjs');
    const pyPath = path.join(pluginsDir, name + '.py');
    const phpPath = path.join(pluginsDir, name + '.php');
    const directPath = path.join(pluginsDir, name);
    target = fs.existsSync(jsPath) ? jsPath
      : (fs.existsSync(mjsPath) ? mjsPath
      : (fs.existsSync(pyPath) ? pyPath
      : (fs.existsSync(phpPath) ? phpPath
      : (fs.existsSync(directPath) && fs.statSync(directPath).isFile() ? directPath : null))));
  }
  if (!target) {
    const dirPath = path.join(pluginsDir, name);
    try {
      if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
        const scanDirs: string[] = [dirPath];
        try {
          const subs = fs.readdirSync(dirPath).filter((n: string) => {
            try { return fs.statSync(path.join(dirPath, n)).isDirectory(); } catch { return false; }
          });
          if (subs.length === 1 &&
              !fs.existsSync(path.join(dirPath, 'index.js')) &&
              !fs.existsSync(path.join(dirPath, 'index.mjs'))) {
            scanDirs.push(path.join(dirPath, subs[0]));
          }
        } catch {}
        const entryCandidates = ['index.js', 'index.mjs', 'index.ts', path.join('src', 'index.ts')];
        for (const d of scanDirs) {
          for (const e of entryCandidates) {
            const ep = path.join(d, e);
            try {
              if (fs.existsSync(ep) && fs.statSync(ep).isFile()) { target = ep; break; }
            } catch {}
          }
          if (target) break;
        }
      }
    } catch {}
  }
  return target;
}

// ===================== 路由工厂 =====================
export function createPluginRoutes(pluginsDir: string, auth?: AdminAuth): Router {
  const router = Router();

  if (!fs.existsSync(pluginsDir)) {
    fs.mkdirSync(pluginsDir, { recursive: true });
  }

  const approvalStore = new PluginApprovalStore(pluginsDir);

  // multer 配置
  const upload = multer({
    dest: path.join(pluginsDir, '.tmp'),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  });

  const tmpDir = path.join(pluginsDir, '.tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  // 按插件文件后缀推断类型（.js → js，.php → php），目录插件按目录内主文件后缀
  function detectPluginType(dir: string): string {
    try {
      const files = fs.readdirSync(dir);
      if (files.includes('index.js')) return 'js';
      if (files.includes('index.mjs')) return 'mjs';
      if (files.includes('index.ts') || fs.existsSync(path.join(dir, 'src', 'index.ts'))) return 'ts';
      if (files.includes('index.php')) return 'php';
      for (const f of files) {
        if (f.endsWith('.js')) return 'js';
        if (f.endsWith('.ts')) return 'ts';
        if (f.endsWith('.php')) return 'php';
      }
    } catch {}
    return 'js';
  }

  // ------------------------------------------------------------
  // 1. 获取插件列表
  // ------------------------------------------------------------
  router.get('/', (req: Request, res: Response) => {
    const results: any[] = [];
    try {
      const isSuper = req.adminUser?.role === 'super_master';
      const username = req.adminUser?.username || '';
      const perms = auth ? getUserPermissions(auth, username) : null;
      const canEditCodePerm = !!perms?.canEditPluginCode;

      if (fs.existsSync(pluginsDir)) {
        const entries = fs.readdirSync(pluginsDir);
        for (const name of entries) {
          const fullPath = path.join(pluginsDir, name);
          if (name === '.tmp') continue;

          let stat: fs.Stats | null = null;
          try { stat = fs.statSync(fullPath); } catch { continue; }

          if (stat.isDirectory()) {
            // ZIP 插件（目录）：无入口文件且无 plugin.json 的目录仅用于托管 webui 资源，不作为插件展示
            const hasEntry = fs.existsSync(path.join(fullPath, 'index.js')) ||
              fs.existsSync(path.join(fullPath, 'index.mjs')) ||
              fs.existsSync(path.join(fullPath, 'index.ts')) ||
              fs.existsSync(path.join(fullPath, 'src', 'index.ts'));
            const hasManifest = fs.existsSync(path.join(fullPath, 'plugin.json'));
            if (!hasEntry && !hasManifest) continue;
            const manifestPath = path.join(fullPath, 'plugin.json');
            let manifest: any = null;
            if (fs.existsSync(manifestPath)) {
              try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')); } catch {}
            }
            // plugin.json 缺失时回退到 package.json（版本/作者/描述）
            let zipVersion = '1.0.0';
            let zipAuthor = '';
            let zipDescription = '';
            if (manifest) {
              zipVersion = manifest.version || zipVersion;
              zipAuthor = manifest.author || zipAuthor;
              zipDescription = manifest.description || zipDescription;
            } else {
              const pkgPath = path.join(fullPath, 'package.json');
              if (fs.existsSync(pkgPath)) {
                try {
                  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
                  zipVersion = pkg.version || zipVersion;
                  zipAuthor = (typeof pkg.author === 'string' ? pkg.author : pkg.author?.name) || zipAuthor;
                  zipDescription = pkg.description || zipDescription;
                } catch {}
              }
            }
            const approval = approvalStore.get(name);
            let zipId = '';
            let zipName = name;
            let zipEnabled = false;
            try {
              // zip 插件目录名通常为 DB id（uuid），先按 id 匹配，再按 name 匹配
              let row = getDb().prepare('SELECT id, name, enabled FROM plugins WHERE id = ?').get(name) as any;
              if (!row) row = getDb().prepare('SELECT id, name, enabled FROM plugins WHERE name = ?').get(name) as any;
              if (row) { zipId = row.id; zipName = row.name || name; zipEnabled = row.enabled === 1; }
            } catch {}
            results.push({
              name: zipName, type: 'zip', fileType: detectPluginType(fullPath),
              id: zipId,
              enabled: zipEnabled,
              version: zipVersion,
              author: zipAuthor,
              description: zipDescription,
              has_webui: fs.existsSync(path.join(fullPath, 'webui')),
              status: approval?.status || 'approved',
              uploadedBy: approval?.uploadedBy || '',
              canEdit: isSuper || canEditCodePerm,
            });
          } else if (!name.startsWith('.')) {
            // 单文件插件：.js/.mjs/.php/.py 及任意扩展名文件（file 类型，仅展示/在线编辑）
            const ext = path.extname(name).toLowerCase();
            // 排除无扩展名、.zip、.txt、.md 及模板 zip 等资源，不作为插件展示
            if (!ext || ext === '.zip' || ext === '.txt' || ext === '.md') continue;
            // php_helpers.php 是 PHP 辅助库，不作为插件展示
            if (name === 'php_helpers.php') continue;
            const fileType = ext.slice(1);
            const dbName = name;
            const displayName = ['.js', '.mjs', '.php', '.py'].includes(ext)
              ? name.replace(/\.[^.]+$/, '') : name;
            const approval = approvalStore.get(name);
            try {
              // 优先按 file-{文件名} 文件插件 id（与引擎自动发现/编辑器 findPluginIdFor 一致），
              // 再按完整文件名匹配（.py/.file 记录 name 带扩展名），最后按去扩展名匹配（.js/.mjs 历史记录 name 不带扩展名）
              let row = getDb().prepare(
                'SELECT id, name, version, enabled, owner, approved, has_webui, type, description FROM plugins WHERE id = ?'
              ).get(`file-${displayName}`) as any;
              if (!row) {
                row = getDb().prepare(
                  'SELECT id, name, version, enabled, owner, approved, has_webui, type, description FROM plugins WHERE name = ?'
                ).get(dbName) as any;
              }
              if (!row) {
                row = getDb().prepare(
                  'SELECT id, name, version, enabled, owner, approved, has_webui, type, description FROM plugins WHERE name = ?'
                ).get(name.replace(/\.[^.]+$/, '')) as any;
              }
              if (row) {
                const owner = row.owner || '';
                const approved = row.approved === 1;
                // 权限过滤：超级主人可见全部，普通用户仅可见自己拥有或已审批的
                if (!isSuper && owner !== username && !approved) continue;

                const rowType = row.type || 'code';
                const displayType = rowType === 'file' ? 'file' : (rowType === 'py' ? 'py' : (rowType === 'php' ? 'php' : 'code'));
                results.push({
                  name: displayName, type: displayType, fileType,
                  version: row.version || '1.0.0', id: row.id,
                  author: '', description: row.description || '',
                  enabled: row.enabled === 1,
                  owner: owner, approved: approved,
                  has_webui: row.has_webui === 1,
                  status: approved ? 'approved' : 'pending',
                  canEdit: isSuper || canEditCodePerm || owner === username,
                });
              } else {
                // DB 未登记（如启动后手动放入目录的 js/py 文件）：仍展示该文件，
                // 保证「插件统一放在 plugins 目录」即可被管理面板识别，不因 DB 缺记录而消失
                const fallbackType = (ext === '.js' || ext === '.mjs') ? 'code' : (ext === '.py' ? 'py' : (ext === '.php' ? 'php' : 'file'));
                results.push({
                  name: displayName, type: fallbackType, fileType,
                  version: '', id: 'file-' + displayName,
                  author: '', description: '',
                  enabled: false,
                  owner: 'system', approved: true,
                  has_webui: false,
                  status: 'approved',
                  canEdit: isSuper || canEditCodePerm,
                });
              }
            } catch (e) {
              // 忽略 DB 错误，单文件条目不因 DB 异常而中断
            }
          }
        }
      }

      res.json(results);
    } catch (err) {
      // 永不 500：列表异常时返回已收集的结果 + 错误日志，前端正常显示不弹「获取插件列表失败」
      console.error('[Plugin List Partial Error]', err);
      res.status(200).json(results);
    }
  });

  // ------------------------------------------------------------
  // 2. 获取待审批列表（仅超级主人）
  // ------------------------------------------------------------
  router.get('/dirs', (req: Request, res: Response) => {
    try {
      const dirs: { name: string; hasManifest: boolean; hasMain: boolean }[] = [];
      if (fs.existsSync(pluginsDir)) {
        for (const entry of fs.readdirSync(pluginsDir)) {
          const full = path.join(pluginsDir, entry);
          if (!fs.statSync(full).isDirectory()) continue;
          if (entry.startsWith('.')) continue;
          dirs.push({
            name: entry,
            hasManifest: fs.existsSync(path.join(full, 'plugin.json')),
            hasMain: fs.existsSync(path.join(full, 'index.js')),
          });
        }
      }
      res.json({ dirs });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 新增插件向导：选择插件目录，自动补全 manifest 与入口文件并写入 DB
  router.post('/create', async (req: Request, res: Response) => {
    try {
      // 权限：超级主人 或 canEditPluginCode（新建插件与编辑插件同权限）
      const isSuperCreate = req.adminUser?.role === 'super_master';
      const usernameCreate = req.adminUser?.username || '';
      const permsCreate = auth ? getUserPermissions(auth, usernameCreate) : null;
      if (!isSuperCreate && !(permsCreate && permsCreate.canEditPluginCode)) {
        res.status(403).json({ error: '无权限新建插件（需超级主人授权 canEditPluginCode 权限）' });
        return;
      }
      const { dir } = req.body;
      if (!dir) { res.status(400).json({ error: 'dir is required' }); return; }
      const safeName = String(dir).trim();
      if (!/^[a-zA-Z0-9\u4e00-\u9fa5_-]+$/.test(safeName)) {
        res.status(400).json({ error: '目录名只允许字母、数字、中文、下划线、中划线' });
        return;
      }
      const target = path.join(pluginsDir, safeName);
      if (!target.startsWith(pluginsDir)) { res.status(400).json({ error: '非法路径' }); return; }
      if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
        res.status(400).json({ error: '目录不存在: ' + safeName });
        return;
      }
      const manifestPath = path.join(target, 'plugin.json');
      let manifest: any = {};
      if (fs.existsSync(manifestPath)) {
        try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')); } catch { manifest = {}; }
      }
      const username = req.adminUser?.username || 'admin';
      const id = manifest.id || safeName;
      const name = manifest.name || safeName;
      const version = manifest.version || '1.0.0';
      manifest.id = id;
      manifest.name = name;
      manifest.version = version;
      manifest.main = manifest.main || 'index.js';
      manifest.author = manifest.author || username;
      manifest.engine = manifest.engine || '>=1.0.0';
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      const mainPath = path.join(target, manifest.main);
      if (!fs.existsSync(mainPath)) {
        fs.writeFileSync(mainPath, `module.exports = {\n  name: '${name}',\n  version: '${version}',\n  async onMessage(ctx) {\n    // TODO: implement message handler\n    return 'Hello from ${name}';\n  },\n};\n`);
      }

      const db = getDb();
      db.prepare(`INSERT INTO plugins (id, name, description, code, enabled, config, version, type, source_path, has_webui, owner, approved)
        VALUES (?, ?, ?, ?, 0, '{}', 1, 'zip', ?, 0, ?, 1)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, type='zip', source_path=excluded.source_path, owner=excluded.owner, approved=1, updated_at=CURRENT_TIMESTAMP`)
        .run(id, name, manifest.description || '', '// auto generated\n', target, username);

      res.json({ ok: true, id, name, version, source_path: target });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/pending', requireSuperMaster, (_req: Request, res: Response) => {
    const pending = approvalStore.all().filter((a) => a.status === 'pending');
    res.json(pending);
  });

  // ------------------------------------------------------------
  // 3. 上传插件（支持 .js 和 .zip）
  // ------------------------------------------------------------
  router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
    // 统一错误处理
    const sendError = (status: number, message: string, detail?: any) => {
      console.error(`[Upload Error] ${message}`, detail || '');
      if (req.file?.path && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
      }
      res.status(status).json({ error: message, detail: detail?.toString() || undefined });
    };

    try {
      const file = req.file;
      if (!file) {
        return sendError(400, 'No file uploaded');
      }

      // 获取插件引擎
      let engine;
      try {
        engine = getPluginEngine();
      } catch (e) {
        return sendError(500, 'Plugin engine not initialized', e);
      }

      const ext = path.extname(file.originalname).toLowerCase();
      const basename = path.basename(file.originalname, ext);
      const pluginName = (req.body.name as string) || basename;
      const overwrite = req.body.overwrite === 'true';
      const description = req.body.description || '';

      const isSuper = req.adminUser?.role === 'super_master';
      const uploadedBy = isSuper ? '__super__' : (req.adminUser?.username || 'unknown');

      // ---------- 处理 .js 文件 ----------
      if (ext === '.js') {
        let code: string;
        try {
          code = fs.readFileSync(file.path, 'utf-8');
        } catch (e) {
          return sendError(500, 'Failed to read uploaded file', e);
        }

        // 检查是否已存在
        const existingId = engine.findPluginByName(pluginName);
        if (existingId && !overwrite) {
          return sendError(409, `Plugin "${pluginName}" already exists. Use overwrite=true to replace.`);
        }
        if (existingId && overwrite) {
          try {
            await engine.deletePlugin(existingId);
          } catch (e) {
            return sendError(500, 'Failed to delete old plugin', e);
          }
        }

        const id = uuidv4();
        const approved = isSuper;

        let pluginInfo;
        try {
          pluginInfo = await engine.loadFromCode(
            id,
            pluginName,
            code,
            description,
            'code',
            '',
            false, // has_webui
            req.adminUser?.username || 'system',
            approved
          );
        } catch (e) {
          return sendError(400, 'Failed to load plugin code. Check syntax or manifest.', e);
        }

        // 记录审批
        approvalStore.add(pluginName, uploadedBy);
        if (approved) {
          approvalStore.approve(pluginName, req.adminUser?.username || 'system');
        }

        // 清理临时文件
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);

        return res.status(201).json({
          ok: true,
          name: pluginName,
          plugin: pluginInfo,
          approval: approvalStore.get(pluginName),
          message: 'JS plugin uploaded and loaded successfully'
        });
      }

      // ---------- 处理 .mjs 文件 ----------
      if (ext === '.mjs') {
        let code: string;
        try {
          code = fs.readFileSync(file.path, 'utf-8');
        } catch (e) {
          return sendError(500, 'Failed to read uploaded file', e);
        }

        const existingId = engine.findPluginByName(pluginName);
        if (existingId && !overwrite) {
          return sendError(409, `Plugin "${pluginName}" already exists. Use overwrite=true to replace.`);
        }
        if (existingId && overwrite) {
          try {
            await engine.deletePlugin(existingId);
          } catch (e) {
            return sendError(500, 'Failed to delete old plugin', e);
          }
        }

        try {
          const destPath = path.join(pluginsDir, pluginName + '.mjs');
          fs.writeFileSync(destPath, code, 'utf-8');
          const id = await engine.registerMjsFile(pluginName, description);
          approvalStore.add(pluginName, uploadedBy);
          if (isSuper) {
            approvalStore.approve(pluginName, req.adminUser?.username || 'system');
          }
          if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
          return res.status(201).json({
            ok: true,
            name: pluginName,
            id,
            message: 'MJS plugin uploaded and loaded successfully',
          });
        } catch (e) {
          return sendError(400, 'Failed to load MJS plugin: ' + (e as Error)?.message, e);
        }
      }

      // ---------- 处理 .py 文件 ----------
      if (ext === '.py') {
        let code: string;
        try {
          code = fs.readFileSync(file.path, 'utf-8');
        } catch (e) {
          return sendError(500, 'Failed to read uploaded file', e);
        }
        const existingId = engine.findPluginByName(pluginName);
        if (existingId && !overwrite) {
          return sendError(409, `Plugin "${pluginName}" already exists. Use overwrite=true to replace.`);
        }
        if (existingId && overwrite) {
          try {
            await engine.deletePlugin(existingId);
          } catch (e) {
            return sendError(500, 'Failed to delete old plugin', e);
          }
        }
        try {
          const id = await engine.registerPyFile(pluginName, code, description);
          approvalStore.add(pluginName, uploadedBy);
          if (isSuper) {
            approvalStore.approve(pluginName, req.adminUser?.username || 'system');
          }
          if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
          return res.status(201).json({
            ok: true,
            name: pluginName,
            id,
            message: 'Python plugin uploaded and loaded successfully',
          });
        } catch (e) {
          return sendError(400, 'Failed to load Python plugin: ' + (e as Error)?.message, e);
        }
      }

      // ---------- 处理 .zip 文件 ----------
      if (ext === '.zip') {
        // 同名覆盖语义：已存在同名插件时复用其 id（createFromZip 内部按 id UPDATE），否则新 id
        const existingId = engine.findPluginByName(pluginName);
        if (existingId && !overwrite) {
          return sendError(409, `Plugin "${pluginName}" already exists. Use overwrite=true to replace.`);
        }
        if (existingId && overwrite) {
          try {
            await engine.deletePlugin(existingId);
          } catch (e) {
            return sendError(500, 'Failed to delete old plugin', e);
          }
        }
        const id = existingId || uuidv4();
        const approved = isSuper;

        // 统一走 engine.createFromZip：完整保留 zip 目录结构、写库走 getDb() 单例（与运行引擎同库），
        // 不再手工解压 + 硬编码 bot.db 路径新建连接（旧实现会写错库/破坏多级目录结构）
        let pluginInfo;
        try {
          pluginInfo = await engine.createFromZip(id, file.path, req.adminUser?.username || 'system', approved);
        } catch (e) {
          const errMsg = (e as Error)?.message || String(e);
          return sendError(400, 'Failed to load ZIP plugin: ' + errMsg, e);
        }

        // 清理临时文件
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);

        // 记录审批
        approvalStore.add(pluginInfo.name, uploadedBy);
        if (approved) {
          approvalStore.approve(pluginInfo.name, req.adminUser?.username || 'system');
        }

        // 若已审批，尝试加载（force：覆盖上传后强制卸载旧实例并重新加载新代码）
        if (approved) {
          try {
            await engine.enable(id, true);
          } catch (e) {
            console.error('Auto-load zip plugin failed:', e);
          }
        }

        return res.status(201).json({
          ok: true,
          name: pluginInfo.name,
          plugin: pluginInfo,
          approval: approvalStore.get(pluginInfo.name),
          message: approved ? 'ZIP plugin uploaded and loaded' : 'ZIP plugin uploaded, pending approval'
        });
      }

      // ---------- 处理 .php 文件（与启动扫描一致注册为 php 插件，执行由 php-plugin 桥负责） ----------
      if (ext === '.php') {
        let code: string;
        try {
          code = fs.readFileSync(file.path, 'utf-8');
        } catch (e) {
          return sendError(500, 'Failed to read uploaded file', e);
        }
        const fileName = pluginName.endsWith('.php') ? pluginName : pluginName + '.php';
        const safeBase = path.basename(fileName, '.php');
        if (!safeBase || /[\\/:*?"<>|]/.test(safeBase)) {
          return sendError(400, 'Invalid plugin name');
        }
        const existingId = engine.findPluginByName(safeBase);
        if (existingId && !overwrite) {
          return sendError(409, `Plugin "${pluginName}" already exists. Use overwrite=true to replace.`);
        }
        try {
          if (existingId && overwrite) await engine.deletePlugin(existingId);
          const destPath = path.join(pluginsDir, fileName);
          fs.writeFileSync(destPath, code, 'utf-8');
          const db = getDb();
          const id = 'php-' + safeBase;
          let desc = description || 'PHP 插件';
          const m = code.slice(0, 800).match(/@description\s+(.+)/);
          if (m) desc = m[1].trim();
          db.prepare(
            `INSERT INTO plugins (id, name, description, code, enabled, version, type, source_path, approved, owner)
             VALUES (?, ?, ?, '', 1, '1.0.0', 'php', ?, ?, 'system')
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = COALESCE(excluded.description, description),
               source_path = excluded.source_path, approved = 1`
          ).run(id, fileName, desc, destPath, isSuper ? 1 : 0);
          approvalStore.add(fileName, uploadedBy);
          if (isSuper) approvalStore.approve(fileName, req.adminUser?.username || 'system');
          if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
          return res.status(201).json({
            ok: true,
            name: fileName,
            id,
            message: 'PHP plugin uploaded and registered successfully'
          });
        } catch (e) {
          return sendError(400, 'Failed to register PHP plugin: ' + (e as Error)?.message, e);
        }
      }

      // ---------- 处理 .yaml/.yml 文件（菜单/配置/资源型插件：可查看可编辑，不执行代码） ----------
      if (ext === '.yaml' || ext === '.yml') {
        let code: string;
        try {
          code = fs.readFileSync(file.path, 'utf-8');
        } catch (e) {
          return sendError(500, 'Failed to read uploaded file', e);
        }
        const fileName = pluginName + ext;
        const safeBase = path.basename(fileName, ext);
        if (!safeBase || /[\\/:*?"<>|]/.test(safeBase)) {
          return sendError(400, 'Invalid plugin name');
        }
        const existingId = engine.findPluginByName(fileName);
        if (existingId && !overwrite) {
          return sendError(409, `Plugin "${fileName}" already exists. Use overwrite=true to replace.`);
        }
        try {
          if (existingId && overwrite) await engine.deletePlugin(existingId);
          const destPath = path.join(pluginsDir, fileName);
          fs.writeFileSync(destPath, code, 'utf-8');
          const db = getDb();
          const id = 'file-' + safeBase;
          let desc = description || 'YAML 配置/菜单资源插件';
          const m = code.slice(0, 500).match(/^(?:#\s*)?(?:name|description)\s*:\s*(.+)$/m);
          if (m) desc = m[1].trim().slice(0, 100);
          db.prepare(
            `INSERT INTO plugins (id, name, description, code, enabled, version, type, source_path, has_webui, approved, owner)
             VALUES (?, ?, ?, '', 0, '1.0.0', 'file', ?, 0, ?, 'system')
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = COALESCE(excluded.description, description),
               source_path = excluded.source_path, approved = 1`
          ).run(id, fileName, desc, destPath, isSuper ? 1 : 0);
          approvalStore.add(fileName, uploadedBy);
          if (isSuper) approvalStore.approve(fileName, req.adminUser?.username || 'system');
          if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
          return res.status(201).json({
            ok: true,
            name: fileName,
            id,
            message: 'YAML plugin uploaded and registered successfully (resource/config, not executable)'
          });
        } catch (e) {
          return sendError(400, 'Failed to register YAML plugin: ' + (e as Error)?.message, e);
        }
      }

      // 不支持的类型
      return sendError(400, 'Only .js, .mjs, .py, .php, .yaml, .yml or .zip files are supported');
    } catch (err: any) {
      return sendError(500, 'Internal server error during upload', err);
    }
  });

  // ------------------------------------------------------------
  // 4. 审批通过（超级主人）
  // ------------------------------------------------------------
  router.post('/:name/approve', requireSuperMaster, async (req: Request, res: Response) => {
    const name = req.params.name;
    const result = approvalStore.approve(name, req.adminUser!.username);
    if (!result) {
      res.status(404).json({ error: 'Plugin not found' });
      return;
    }
    try {
      getDb().prepare('UPDATE plugins SET approved = 1 WHERE name = ?').run(name);
      const row = getDb().prepare('SELECT id FROM plugins WHERE name = ?').get(name) as any;
      if (row) {
        const engine = getPluginEngine();
        await engine.enable(row.id, true);
      }
    } catch (e) {
      console.error('[Approve Error]', e);
    }
    res.json({ ok: true, approval: result });
  });

  // ------------------------------------------------------------
  // 5. 审批拒绝（超级主人）
  // ------------------------------------------------------------
  router.post('/:name/reject', requireSuperMaster, (req: Request, res: Response) => {
    const name = req.params.name;
    const { reason } = req.body;
    const result = approvalStore.reject(name, req.adminUser!.username, reason);
    if (!result) {
      res.status(404).json({ error: 'Plugin not found' });
      return;
    }
    try {
      getDb().prepare('UPDATE plugins SET approved = 0 WHERE name = ?').run(name);
    } catch (e) {
      console.error('[Reject Error]', e);
    }
    res.json({ ok: true, approval: result });
  });

  // ------------------------------------------------------------
  // 6. 启用/禁用插件（超级主人）——每个插件独立开关
  // ------------------------------------------------------------
  router.post('/:id/toggle', requireSuperMaster, async (req: Request, res: Response) => {
    const id = req.params.id;
    try {
      const engine = getPluginEngine();
      const nowEnabled = await engine.toggleEnabled(id);
      res.json({ ok: true, enabled: nowEnabled });
    } catch (err: any) {
      res.status(400).json({ error: err.message || '操作失败' });
    }
  });

  // ------------------------------------------------------------
  // 7. 读取 plugin.json
  // ------------------------------------------------------------
  router.get('/:name/manifest', (req: Request, res: Response) => {
    const manifestPath = path.join(pluginsDir, req.params.name, 'plugin.json');
    if (!fs.existsSync(manifestPath)) {
      res.status(404).json({ error: 'plugin.json not found' });
      return;
    }
    res.json(JSON.parse(fs.readFileSync(manifestPath, 'utf-8')));
  });

  // ------------------------------------------------------------
  // 8. 更新 plugin.json
  // ------------------------------------------------------------
  router.put('/:name/manifest', (req: Request, res: Response) => {
    const manifestPath = path.join(pluginsDir, req.params.name, 'plugin.json');
    fs.writeFileSync(manifestPath, JSON.stringify(req.body, null, 2));
    res.json({ ok: true });
  });

  // ------------------------------------------------------------
  // 8. 读取 README.md
  // ------------------------------------------------------------
  router.get('/:name/doc', (req: Request, res: Response) => {
    const docPath = path.join(pluginsDir, req.params.name, 'README.md');
    if (!fs.existsSync(docPath)) {
      res.status(404).json({ error: 'doc not found' });
      return;
    }
    res.json({ content: fs.readFileSync(docPath, 'utf-8'), name: req.params.name });
  });

  // ------------------------------------------------------------
  // 9. 更新 README.md
  // ------------------------------------------------------------
  router.put('/:name/doc', (req: Request, res: Response) => {
    const docPath = path.join(pluginsDir, req.params.name, 'README.md');
    fs.writeFileSync(docPath, req.body.content || '');
    res.json({ ok: true });
  });

  // ------------------------------------------------------------
  // 10. 读取 JS/MJS 插件代码
  // ------------------------------------------------------------
  router.get('/:name/code', (req: Request, res: Response) => {
    const name = req.params.name;
    const target = locatePluginEntryFile(name, pluginsDir);
    if (!target) {
      res.status(404).json({ error: 'Plugin file not found' });
      return;
    }
    const fileName = path.basename(target);
    res.json({
      name,
      fileName,
      fileType: fileName.endsWith('.mjs') ? 'mjs' : fileName.endsWith('.py') ? 'py' : fileName.endsWith('.php') ? 'php' : path.extname(fileName).replace(/^\./, '') || 'js',
      code: fs.readFileSync(target, 'utf-8'),
    });
  });

  // ------------------------------------------------------------
  // 11. 更新 JS/MJS 插件代码（超级主人 / canEditPluginCode / 插件归属本人）
  // ------------------------------------------------------------
  router.put('/:name/code', async (req: Request, res: Response) => {
    const name = req.params.name;
    if (!canEditPlugin(req, name, auth)) {
      res.status(403).json({ error: '无权限编辑该插件代码（需超级主人授权或拥有该插件）' });
      return;
    }
    const target = locatePluginEntryFile(name, pluginsDir);
    if (!target) {
      res.status(404).json({ error: 'Plugin file not found' });
      return;
    }
    const newCode = req.body.code;
    if (!newCode) {
      res.status(400).json({ error: 'code is required' });
      return;
    }

    try {
      // 写入文件
      fs.writeFileSync(target, newCode, 'utf-8');

      // 重新加载插件
      const engine = getPluginEngine();
      const pluginId = engine.findPluginByName(name);
      if (pluginId) {
        const trow = getDb().prepare('SELECT type FROM plugins WHERE id = ?').get(pluginId) as any;
        if (trow?.type === 'file') {
          // 文件资源插件不执行，仅保存
          res.json({ ok: true, message: '文件已更新（文件资源插件不可执行）', fileName: path.basename(target) });
          return;
        }
        if (trow?.type === 'php') {
          // PHP 插件由 php-plugin 桥每次执行时从磁盘读取，无需 reload
          res.json({ ok: true, message: 'PHP 插件代码已更新（下次消息即生效）', fileName: path.basename(target) });
          return;
        }
        await engine.reload(pluginId);
        res.json({ ok: true, message: 'Plugin code updated and reloaded', fileName: path.basename(target) });
      } else {
        // 若数据库无记录，仅文件更新
        res.json({ ok: true, message: 'Plugin code updated (database record missing, will be discovered on restart)', fileName: path.basename(target) });
      }
    } catch (err: any) {
      console.error('[Update Code Error]', err);
      res.status(500).json({ error: `Failed to reload plugin: ${err.message}` });
    }
  });

  // ------------------------------------------------------------
  // 12. 获取 ZIP 插件文件列表
  // ------------------------------------------------------------
  router.get('/:name/files', (req: Request, res: Response) => {
    const pluginDir = path.join(pluginsDir, req.params.name);
    if (!fs.existsSync(pluginDir)) {
      res.status(404).json({ error: 'Plugin not found' });
      return;
    }
    const files = listFiles(pluginDir);
    res.json(files);
  });

  // ------------------------------------------------------------
  // 13. 读取 ZIP 插件子文件
  // ------------------------------------------------------------
  router.get('/:name/files/*', (req: Request, res: Response) => {
    const subPath = (req.params as any)[0] || '';
    const filePath = path.join(pluginsDir, req.params.name, subPath);
    if (!fs.existsSync(filePath) || !isPathSafe(pluginsDir, filePath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    res.json({ content: fs.readFileSync(filePath, 'utf-8'), path: subPath });
  });

  // ------------------------------------------------------------
  // 14. 更新 ZIP 插件子文件
  // ------------------------------------------------------------
  router.put('/:name/files/*', async (req: Request, res: Response) => {
    const subPath = (req.params as any)[0] || '';
    if (!canEditPlugin(req, req.params.name, auth)) {
      res.status(403).json({ error: '无权限编辑该插件（需超级主人授权或拥有该插件）' });
      return;
    }
    const filePath = path.join(pluginsDir, req.params.name, subPath);
    if (!isPathSafe(pluginsDir, filePath)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, req.body.content || '');

    // 保存后自动重新加载该 ZIP 插件，使改动立即生效
    try {
      const engine = getPluginEngine();
      const row = getDb().prepare('SELECT id FROM plugins WHERE name = ?').get(req.params.name) as any;
      if (row?.id) {
        await engine.reload(row.id);
        res.json({ ok: true, reloaded: true });
        return;
      }
    } catch {}
    res.json({ ok: true, reloaded: false });
  });

  // ------------------------------------------------------------
  // 15. 读取插件 CHANGELOG.md
  // ------------------------------------------------------------
  router.get('/:name/changelog', (req: Request, res: Response) => {
    const name = req.params.name;
    const paths = [
      path.join(pluginsDir, name, 'CHANGELOG.md'),
      path.join(pluginsDir, name + '-CHANGELOG.md'),
    ];
    let foundPath: string | null = null;
    for (const p of paths) {
      if (fs.existsSync(p)) { foundPath = p; break; }
    }
    if (!foundPath) {
      res.status(404).json({ error: 'CHANGELOG not found' });
      return;
    }
    res.json({ name, content: fs.readFileSync(foundPath, 'utf-8') });
  });

  // ------------------------------------------------------------
  // 16. 更新插件 CHANGELOG.md
  // ------------------------------------------------------------
  router.put('/:name/changelog', requireSuperMaster, (req: Request, res: Response) => {
    const name = req.params.name;
    const changelogPath = path.join(pluginsDir, name, 'CHANGELOG.md');
    const dir = path.dirname(changelogPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(changelogPath, req.body.content || '');
    res.json({ ok: true });
  });

  // ------------------------------------------------------------
  // 17. 删除插件（目录 + .js + 数据库）
  // ------------------------------------------------------------
  router.delete('/:name', async (req: Request, res: Response) => {
    const name = req.params.name;
    const pluginDir = path.join(pluginsDir, name);
    const jsPath = path.join(pluginsDir, name + '.js');

    // 删除目录
    if (fs.existsSync(pluginDir)) {
      fs.rmSync(pluginDir, { recursive: true, force: true });
    }
    // 删除 JS 文件
    if (fs.existsSync(jsPath)) {
      fs.unlinkSync(jsPath);
    }
    // 移除审批记录
    approvalStore.remove(name);

    // 从数据库删除
    try {
      const engine = getPluginEngine();
      const id = engine.findPluginByName(name);
      if (id) {
        await engine.deletePlugin(id);
      }
    } catch (e) {
      console.error('[Delete Plugin Error]', e);
    }

    res.json({ ok: true });
  });

  // ------------------------------------------------------------
  // 18. 插件实时测试（模拟消息触发插件事件，需 canTestPlugin 权限）
  // ------------------------------------------------------------
  router.post('/test', async (req: Request, res: Response) => {
    try {
      const { plugin_name, user_id, group_id, message, mode, bot_id } = req.body;
      if (!plugin_name || !message) {
        res.status(400).json({ error: 'plugin_name and message are required' });
        return;
      }

      const username = req.adminUser?.username;
      const role = req.adminUser?.role;
      if (!username || !role) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      if (role !== 'super_master' && auth) {
        const user = auth.getUser(username);
        const perms = user?.permissions;
        const defaultPerms = ROLE_PERMISSIONS[role];
        const canTest = perms ? (perms.canTestPlugin !== undefined ? perms.canTestPlugin : defaultPerms?.canTestPlugin) : (defaultPerms?.canTestPlugin ?? false);
        if (!canTest) {
          res.status(403).json({ error: '你没有插件测试权限，请联系超级主人开通' });
          return;
        }
      }

      const engine = getPluginEngine();
      const result = await engine.testMessage(
        plugin_name,
        user_id || 'test_user',
        '测试用户',
        group_id || null,
        group_id ? '测试群聊' : null,
        message,
        mode || undefined,
        String(bot_id || '')
      );
      // 测试消息记录保存到项目目录 test-messages.log
      try {
        const line = {
          time: new Date().toISOString(),
          user: username,
          plugin: plugin_name,
          scene: group_id ? 'group' : 'c2c',
          input: message,
          output: result.replies || [],
          status: result.status,
        };
        fs.appendFileSync(path.join(process.cwd(), 'test-messages.log'), JSON.stringify(line) + '\n');
      } catch { /* ignore log write error */ }
      res.json(result);
    } catch (err: any) {
      res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
    }
  });

  // M3 gen-card 辅助：写回 js/mjs 入口文件后触发与 PUT /:name/code 一致的 reload 语义
  async function reloadAfterEntryCodeWrite(name: string): Promise<{ message: string }> {
    const engine = getPluginEngine();
    const pluginId = engine.findPluginByName(name);
    if (!pluginId) {
      return { message: '数据库无该插件记录，代码已保存（重启后自动发现）' };
    }
    const trow = getDb().prepare('SELECT type FROM plugins WHERE id = ?').get(pluginId) as any;
    if (trow?.type === 'file') return { message: '代码已更新（文件资源插件不可执行，仅保存）' };
    if (trow?.type === 'php') return { message: '代码已更新（PHP 插件每次执行时从磁盘读取，下次消息即生效）' };
    await engine.reload(pluginId);
    return { message: '代码已更新并重新加载插件' };
  }

  // ------------------------------------------------------------
  // M3: 生成并注入「可视化卡片渲染」代码段（gen-card）
  // 读取该插件 menu-config 配置（无则用默认模板）→ 生成含幂等 marker 的 JS 段 →
  // 首次注入前备份原码到 config plugin.{id}.ucard_backup → 注入入口源码 → reload。
  // 仅 js/mjs 入口可注入；py/php/file/zip（ts 入口）返回 400 提示改用配置方式渲染。
  // ------------------------------------------------------------
  router.post('/:name/gen-card', async (req: Request, res: Response) => {
    const name = req.params.name;
    if (!canEditPlugin(req, name, auth)) {
      res.status(403).json({ error: '无权限修改该插件代码（需超级主人授权或拥有该插件）' });
      return;
    }
    const target = locatePluginEntryFile(name, pluginsDir);
    if (!target) {
      res.status(404).json({ error: 'Plugin file not found' });
      return;
    }
    const fileName = path.basename(target);
    try {
      assertInjectableSourceFile(fileName);
    } catch (err: any) {
      res.status((err && err.code === 'ERR_UCARD_UNSUPPORTED') ? 400 : 500)
        .json({ error: String((err && err.message) || err) });
      return;
    }
    try {
      const pluginId = findMenuConfigPluginId(name);
      const all = readMenuConfigAll(name);
      const appids = Object.keys(all || {});
      // 与编辑器 GET 该插件 menu-config 一致：无配置回退默认模板
      let config: any = null;
      if (appids.length) config = mergeMenuConfig(all[appids[0]], name);
      if (!config) config = mergeMenuConfig(null, name);
      const segment = generatePluginBlockCode(name, config);
      const original = fs.readFileSync(target, 'utf-8');
      const backupKey = `plugin.${pluginId}.ucard_backup`;
      if (!hasUCardSegment(original)) {
        // 仅首次注入前备份原码（重复生成只原位更新段，不动备份）
        setConfig(backupKey, JSON.stringify({ fileName, code: original, at: new Date().toISOString() }));
      }
      const next = injectCodeSegment(original, segment);
      fs.writeFileSync(target, next, 'utf-8');
      const reloadResult = await reloadAfterEntryCodeWrite(name);
      res.json({
        ok: true,
        message: reloadResult.message,
        pluginId,
        fileName,
        backupKey,
        inserted: !hasUCardSegment(original),
      });
    } catch (err: any) {
      console.error('[GenCard Error]', err);
      res.status(500).json({ error: `Failed to generate card code: ${err.message}` });
    }
  });

  // ------------------------------------------------------------
  // M3: 撤销上一步 gen-card 注入
  // 读备份 config plugin.{id}.ucard_backup 还原入口源码并 reload，成功后清除备份。
  // ------------------------------------------------------------
  router.post('/:name/gen-card/undo', async (req: Request, res: Response) => {
    const name = req.params.name;
    if (!canEditPlugin(req, name, auth)) {
      res.status(403).json({ error: '无权限修改该插件代码（需超级主人授权或拥有该插件）' });
      return;
    }
    const target = locatePluginEntryFile(name, pluginsDir);
    if (!target) {
      res.status(404).json({ error: 'Plugin file not found' });
      return;
    }
    const fileName = path.basename(target);
    try {
      assertInjectableSourceFile(fileName);
    } catch (err: any) {
      res.status((err && err.code === 'ERR_UCARD_UNSUPPORTED') ? 400 : 500)
        .json({ error: String((err && err.message) || err) });
      return;
    }
    const pluginId = findMenuConfigPluginId(name);
    const backupKey = `plugin.${pluginId}.ucard_backup`;
    const backupRaw = getConfig(backupKey);
    if (!backupRaw) {
      res.status(404).json({ error: '没有可回退的生成备份（可能已回退或从未生成过）' });
      return;
    }
    let backup: any = null;
    try { backup = JSON.parse(backupRaw); } catch {}
    if (!backup || typeof backup.code !== 'string') {
      res.status(500).json({ error: '生成备份已损坏，无法自动回退，请手工恢复' });
      return;
    }
    const current = fs.readFileSync(target, 'utf-8');
    if (!hasUCardSegment(current)) {
      res.status(400).json({ error: '当前源码已不含生成段（可能被手工修改或已回退），为避免覆盖你的改动已中止回退' });
      return;
    }
    try {
      fs.writeFileSync(target, backup.code, 'utf-8');
      getDb().prepare('DELETE FROM config WHERE key = ?').run(backupKey);
      const reloadResult = await reloadAfterEntryCodeWrite(name);
      res.json({ ok: true, message: '已还原生成前的代码。' + reloadResult.message, pluginId, fileName });
    } catch (err: any) {
      console.error('[GenCard Undo Error]', err);
      res.status(500).json({ error: `Failed to undo generated card code: ${err.message}` });
    }
  });

  // ------------------------------------------------------------
  // 19. 一键登记补全：无 DB 记录 / 缺 plugin.json 的插件，沿用插件内代码解析 manifest 串联登记
  // ------------------------------------------------------------
  function parseManifestFromEntry(name: string): any {
    const mfPath = path.join(pluginsDir, name, 'plugin.json');
    if (fs.existsSync(mfPath)) {
      try {
        const p = JSON.parse(fs.readFileSync(mfPath, 'utf-8'));
        if (p && typeof p === 'object') return p;
      } catch {}
    }
    const m: any = { name: String(name).replace(/\.(js|mjs|py|php)$/i, ''), version: '1.0.0' };
    try {
      const target = locatePluginEntryFile(name, pluginsDir);
      if (target) {
        const code = fs.readFileSync(target, 'utf-8').slice(0, 4000);
        const mm = code.match(/manifest\s*:\s*\{([\s\S]{0,1200}?)\}/);
        if (mm) {
          const seg = mm[1];
          const g = (re: RegExp) => { const x = seg.match(re); return x ? x[1] : ''; };
          const nm = g(/name\s*:\s*['"]([^'"]+)['"]/); if (nm) m.name = nm;
          const vv = g(/version\s*:\s*['"]([^'"]+)['"]/); if (vv) m.version = vv;
          const aa = g(/author\s*:\s*['"]([^'"]+)['"]/); if (aa) m.author = aa;
          const dd = g(/description\s*:\s*['"]([^'"]+)['"]/); if (dd) m.description = dd;
        } else {
          const desc = code.match(/@description\s+(.+)/); if (desc) m.description = desc[1].trim();
          const ver = code.match(/@version\s+(.+)/); if (ver) m.version = ver[1].trim();
          const aut = code.match(/@author\s+(.+)/); if (aut) m.author = aut[1].trim();
        }
      }
    } catch {}
    return m;
  }

  router.post('/:name/register', async (req: Request, res: Response) => {
    const name = req.params.name;
    try {
      const db = getDb();
      const dirPath = path.join(pluginsDir, name);
      const dirMode = fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
      const m = parseManifestFromEntry(name);
      const username = (req.adminUser && req.adminUser.username) || 'system';
      const bare = String(m.name || name).replace(/\.(js|mjs|py|php)$/i, '');
      const engine = getPluginEngine();
      let registeredId = '';
      let kind = 'single';
      let note = '已登记到数据库（文件插件）';

      if (dirMode) {
        kind = 'zip';
        const mfPath = path.join(dirPath, 'plugin.json');
        let prev: any = {};
        if (fs.existsSync(mfPath)) { try { prev = JSON.parse(fs.readFileSync(mfPath, 'utf-8')) || {}; } catch {} }
        const merged = Object.assign({}, prev, { name: m.name || name, version: m.version || '1.0.0' }, { author: m.author || prev.author || '', description: m.description || prev.description || '' });
        fs.writeFileSync(mfPath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
        let row: any = null;
        try {
          row = db.prepare('SELECT id FROM plugins WHERE name = ?').get(name)
            || db.prepare('SELECT id FROM plugins WHERE id = ?').get(name);
        } catch {}
        const ver = String(merged.version || '1.0.0');
        if (row && row.id) {
          registeredId = row.id;
          db.prepare('UPDATE plugins SET version = ?, description = COALESCE(?, description), approved = 1, type = ? WHERE id = ?')
            .run(ver, merged.description || null, 'zip', row.id);
        } else {
          registeredId = uuidv4();
          db.prepare(
            'INSERT INTO plugins (id, name, description, code, enabled, version, type, source_path, approved, owner) VALUES (?, ?, ?, \'\', 0, ?, \'zip\', ?, 1, ?)'
          ).run(registeredId, name, merged.description || '', ver, dirPath, username);
        }
        note = '已生成 plugin.json（' + (Object.keys(prev).length ? '补全既有 manifest' : '新建 manifest') + '）并登记数据库，服务重启后完整生效';
      } else {
        const exId = engine.findPluginByName(bare) || engine.findPluginByName(name);
        if (exId) {
          registeredId = exId;
          db.prepare('UPDATE plugins SET version = ?, approved = 1, owner = ? WHERE id = ?')
            .run(String(m.version || '1.0.0'), username, exId);
          note = '插件已由引擎加载，已补全版本/审批/归属登记';
        } else {
          const target = locatePluginEntryFile(name, pluginsDir);
          const ext = target ? path.extname(target).toLowerCase() : '';
          if (ext === '.mjs') {
            registeredId = await engine.registerMjsFile(bare, m.description);
          } else if (ext === '.py') {
            const code = target ? fs.readFileSync(target, 'utf-8') : '';
            registeredId = await engine.registerPyFile(bare, code, m.description);
          } else if (ext === '.php') {
            const pId = 'php-' + bare;
            db.prepare(
              'INSERT INTO plugins (id, name, description, code, enabled, version, type, source_path, approved, owner) VALUES (?, ?, ?, \'\', 0, ?, \'php\', ?, 1, ?) ON CONFLICT(id) DO UPDATE SET version = excluded.version, approved = 1, owner = excluded.owner'
            ).run(pId, bare + '.php', m.description || 'PHP 插件', String(m.version || '1.0.0'), target || '', username);
            registeredId = pId;
          } else {
            registeredId = 'file-' + bare;
            db.prepare(
              'INSERT INTO plugins (id, name, description, code, enabled, version, type, has_webui, approved, owner) VALUES (?, ?, ?, \'\', 0, ?, \'code\', 0, 1, ?) ON CONFLICT(id) DO UPDATE SET version = excluded.version, approved = 1, owner = excluded.owner'
            ).run(registeredId, bare, m.description || '', String(m.version || '1.0.0'), username);
            note = '已登记数据库（js 文件插件，重启服务后由引擎扫描加载生效）';
          }
        }
      }
      try { approvalStore.approve(name, username); } catch {}
      res.json({ ok: true, kind, id: registeredId, name, manifest: m, note });
    } catch (e: any) {
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  });

  // ------------------------------------------------------------
  // 20. 生成开发文档（README.md + CHANGELOG.md，沿用插件内代码解析）——仅目录型插件
  // ------------------------------------------------------------
  router.post('/:name/docs', async (req: Request, res: Response) => {
    const name = req.params.name;
    const dirPath = path.join(pluginsDir, name);
    if (!(fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory())) {
      res.status(400).json({ error: '开发文档仅支持目录（zip）型插件；单文件插件的 README 落在 plugins/{name}/ 目录，请先使用「登记」转换。' });
      return;
    }
    const m = parseManifestFromEntry(name);
    const target = locatePluginEntryFile(name, pluginsDir);
    let deps = '- 无外部依赖';
    const caps: string[] = [];
    if (target) {
      const code = fs.readFileSync(target, 'utf-8');
      const mods: string[] = [];
      const re = /require\s*\(\s*['"]([^'"]+)['"]\s*\)|from\s+['"]([^'"]+)['"]/g;
      let mm: RegExpExecArray | null;
      while ((mm = re.exec(code))) { const d = mm[1] || mm[2]; if (d && mods.indexOf(d) < 0) mods.push(d); }
      if (mods.length) deps = mods.map((d) => '- `' + d + '`').join('\n');
      const capRe = /ctx\.bot\.([A-Za-z_$][\w$]*)/g;
      while ((mm = capRe.exec(code))) { if (caps.indexOf(mm[1]) < 0) caps.push(mm[1]); }
    }
    const date = new Date().toISOString().slice(0, 10);
    const readmePath = path.join(dirPath, 'README.md');
    const clPath = path.join(dirPath, 'CHANGELOG.md');
    const readmeExisted = fs.existsSync(readmePath);
    const clExisted = fs.existsSync(clPath);
    if (!readmeExisted) {
      const readme = [
        '# ' + (m.name || name), '',
        '> ' + (m.description || '（该插件暂无描述，可在 manifest 中补充）'), '',
        '## 基本信息', '',
        '- **版本**：' + (m.version || '1.0.0'),
        '- **作者**：' + (m.author || '未知'),
        '- **类型**：目录（zip）插件',
        '- **入口文件**：' + (target ? path.basename(target) : 'index.js'), '',
        '## 功能说明', '',
        '（请依据插件内 manifest.description 或实际行为在此补充功能说明）', '',
        '## 触发方式', '',
        '- 群聊 / 私聊发送消息触发（具体指令以插件逻辑为准）', '',
        '## 依赖', '', deps, '',
        '## 使用的机器人能力', '',
        (caps.length ? caps.map((c) => '- `ctx.bot.' + c + '`').join('\n') : '- 无'), '',
        '---', '',
        '文档由后台编辑器「生成开发文档」依据插件内代码自动生成（' + date + '），可继续手工维护。', ''
      ].join('\n');
      fs.writeFileSync(readmePath, readme, 'utf-8');
    }
    if (!clExisted) {
      const changelog = [
        '# ' + (m.name || name) + ' 更新日志', '',
        '## ' + date, '',
        '### v' + (m.version || '1.0.0'),
        '- 初始版本（由后台编辑器依据插件内 manifest 自动生成）', ''
      ].join('\n');
      fs.writeFileSync(clPath, changelog, 'utf-8');
    }
    res.json({
      ok: true,
      name,
      readme: readmeExisted ? '已存在，未覆盖' : '已生成',
      changelog: clExisted ? '已存在，未覆盖' : '已生成',
      version: m.version || '1.0.0',
    });
  });

  // ------------------------------------------------------------
  // 21. 回复可视化编辑器（ReplySpec）：读取/保存回复模板 + 一键写回插件源码
  //   A 保存到 config（plugin.file-{name}.reply），插件运行时读它即时渲染生效
  //   B 「写回源码」把默认 ReplySpec 常量固化进插件（仅已内置 REPLY_SPEC 标记的适配插件），可撤销
  // ------------------------------------------------------------

  function readReplyCfg(name: string): any {
    try {
      const row = getDb().prepare('SELECT value FROM config WHERE key = ?').get(cfgKeyFor(name)) as any;
      if (row && row.value) return JSON.parse(String(row.value));
    } catch {}
    return null;
  }

  function writeReplyCfg(name: string, spec: any): void {
    getDb()
      .prepare('INSERT INTO config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP')
      .run(cfgKeyFor(name), JSON.stringify(spec));
  }

  router.get('/:name/reply-spec', (req: Request, res: Response) => {
    const name = req.params.name;
    const stored = readReplyCfg(name);
    const builtin = builtinReplySpec(name);
    const spec: ReplySpec | null = stored || builtin;
    if (!spec) {
      res.status(404).json({ error: '该插件暂无回复模板（ReplySpec）内置定义，且尚未保存过自定义回复' });
      return;
    }
    const botName = String(req.query.botName || '');
    const botId = String(req.query.botId || '');
    const preview = makePreviewData(botName || undefined, botId || undefined);
    res.json({ ok: true, name, spec, edited: !!stored, preview, hasBuiltin: !!builtin });
  });

  router.post('/:name/reply-spec', requireSuperMaster, (req: Request, res: Response) => {
    const name = req.params.name;
    const spec = (req.body && (req.body.spec || req.body)) as any;
    if (!spec || typeof spec !== 'object' || !Array.isArray(spec.branches)) {
      res.status(400).json({ error: '无效的回复模板：需 { name, branches: [...] }' });
      return;
    }
    try {
      writeReplyCfg(String(spec.name || name), spec);
      res.json({ ok: true, key: cfgKeyFor(name), branches: spec.branches.length });
    } catch (e: any) {
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  });

  router.post('/:name/reply-apply', requireSuperMaster, async (req: Request, res: Response) => {
    const name = req.params.name;
    const target = locatePluginEntryFile(name, pluginsDir);
    if (!target || !/\.(js|mjs)$/i.test(target)) {
      res.status(400).json({ error: 'ReplySpec 源码注入仅支持 js/mjs 单文件插件' });
      return;
    }
    const code = fs.readFileSync(target, 'utf-8');
    const begin = '/*__REPLY_SPEC_BEGIN__*/';
    const end = '/*__REPLY_SPEC_END__*/';
    const bIdx = code.indexOf(begin);
    const eIdx = code.indexOf(end);
    if (bIdx < 0 || eIdx < 0 || eIdx <= bIdx) {
      res.status(400).json({ error: '该插件源码中未找到 ReplySpec 适配标记（/*__REPLY_SPEC_BEGIN__*/），暂无法自动注入；需先完成插件适配改造后即可一键写回。' });
      return;
    }
    const spec: ReplySpec | null = (req.body && req.body.spec) || readReplyCfg(name) || builtinReplySpec(name);
    if (!spec) {
      res.status(404).json({ error: '没有可写回的回复模板（内置与 config 均无）' });
      return;
    }
    try {
      const username = req.adminUser?.username || 'system';
      const backupKey = cfgKeyFor(name) + '.codebackup';
      getDb()
        .prepare('INSERT INTO config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP')
        .run(backupKey, JSON.stringify({ fileName: target, code, owner: username, at: new Date().toISOString() }));
      const constDecl = begin + '\nvar REPLY_SPEC = ' + JSON.stringify(spec, null, 1) + ';\n' + end;
      const patched = code.slice(0, bIdx) + constDecl + code.slice(eIdx + end.length);
      fs.writeFileSync(target, patched, 'utf-8');
      res.json({ ok: true, fileName: path.basename(target), branches: spec.branches.length });
    } catch (e: any) {
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  });

  router.post('/:name/reply-apply/undo', requireSuperMaster, async (req: Request, res: Response) => {
    const name = req.params.name;
    try {
      const backupKey = cfgKeyFor(name) + '.codebackup';
      const row = getDb().prepare('SELECT value FROM config WHERE key = ?').get(backupKey) as any;
      if (!row || !row.value) {
        res.status(404).json({ error: '没有可还原的写回备份（尚未执行过「写回源码」）' });
        return;
      }
      const bak = JSON.parse(String(row.value));
      if (!bak || !bak.fileName || !fs.existsSync(path.join(pluginsDir, path.basename(bak.fileName)))) {
        res.status(400).json({ error: '备份记录无效或插件文件已被删除' });
        return;
      }
      fs.writeFileSync(path.join(pluginsDir, path.basename(bak.fileName)), String(bak.code), 'utf-8');
      res.json({ ok: true, fileName: path.basename(bak.fileName) });
    } catch (e: any) {
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  });

  // ------------------------------------------------------------
  // 22. cid 词库管理（词典回复 dict.txt：key|value 行，支持中文）
  //   GET/PUT /api/plugins/_dict/entries：读取/整体保存行集合（词条/注释/空行），保存后自动 reload 词典回复
  // ------------------------------------------------------------

  // 词库文件名白名单：仅允许 plugins 目录内单层 txt/cid 数据文件，杜绝路径穿越
  function dictFilePath(fileName?: string): string {
    const base = path.basename(String(fileName || 'dict.txt').trim() || 'dict.txt');
    const ext = path.extname(base).toLowerCase();
    if (ext !== '.txt' && ext !== '.cid') throw new Error('词库文件仅支持 .txt / .cid');
    const full = path.resolve(pluginsDir, base);
    if (full.indexOf(path.resolve(pluginsDir) + path.sep) !== 0 && full !== path.resolve(pluginsDir)) {
      throw new Error('词库文件必须位于插件目录内');
    }
    return full;
  }

  // 解析词库行：空行/注释(# 开头) 原样保留；词条按首个 | 切分为 key/value
  function parseDictLines(text: string): Array<{ t: 'e' | 'c' | 'b'; key?: string; value?: string; text?: string }> {
    const lines = String(text || '').split(/\r?\n/);
    const out: Array<{ t: 'e' | 'c' | 'b'; key?: string; value?: string; text?: string }> = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) { out.push({ t: 'b' }); continue; }
      if (trimmed.startsWith('#')) { out.push({ t: 'c', text: line }); continue; }
      const sep = line.indexOf('|');
      if (sep < 0) { out.push({ t: 'c', text: line }); continue; }
      out.push({ t: 'e', key: line.slice(0, sep).trim(), value: line.slice(sep + 1).trim() });
    }
    return out;
  }

  // 序列化行集合回词库文本
  function serializeDictLines(lines: Array<{ t: string; key?: string; value?: string; text?: string }>): string {
    const parts: string[] = [];
    for (const it of lines || []) {
      if (it.t === 'e') {
        const key = String(it.key == null ? '' : it.key).trim();
        const value = String(it.value == null ? '' : it.value).trim();
        if (!key) continue; // 无关键词的词条行丢弃，避免生成无效行
        if (key.indexOf('|') >= 0) continue;
        parts.push(key + '|' + value);
      } else if (it.t === 'c') {
        parts.push(String(it.text == null ? '' : it.text));
      } else {
        parts.push('');
      }
    }
    return parts.join('\n');
  }

  // 词库行级校验：给可读的条目数/问题数
  function dictLineStats(lines: Array<{ t: string; key?: string; value?: string; text?: string }>): { entries: number; problems: number } {
    let entries = 0;
    let problems = 0;
    for (const it of lines) {
      if (it.t === 'e') {
        entries++;
        if (!String(it.key || '').trim() || String(it.key || '').indexOf('|') >= 0) problems++;
      }
    }
    return { entries, problems };
  }

  router.get('/_dict/entries', (req: Request, res: Response) => {
    try {
      const file = dictFilePath(String(req.query.file || ''));
      const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
      const lines = parseDictLines(raw);
      const stats = dictLineStats(lines);
      res.json({ ok: true, fileName: path.basename(file), entries: lines, count: stats.entries, problems: stats.problems });
    } catch (e: any) {
      res.status(400).json({ error: String((e && e.message) || e) });
    }
  });

  router.put('/_dict/entries', requireSuperMaster, async (req: Request, res: Response) => {
    try {
      const file = dictFilePath(req.body && req.body.file);
      const lines = Array.isArray(req.body && req.body.entries) ? (req.body.entries as Array<any>) : null;
      if (!lines) {
        res.status(400).json({ error: '缺少 entries 行集合' });
        return;
      }
      const stats = dictLineStats(lines);
      const text = serializeDictLines(lines);
      const dir = path.dirname(file);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, text, 'utf-8');
      // 写盘后 reload 词库加载方插件，让新词库立即生效（找不到/未启用不影响保存结果）
      //   dict.txt → file-词典回复；其它 N.txt → 按文件名命名的加载方插件（如 file-娱乐群管）
      let reload = 'skipped';
      try {
        const engine = getPluginEngine();
        if (engine) {
          const baseName = path.basename(file);
          const loader = baseName === 'dict.txt' ? 'file-词典回复' : 'file-' + baseName.replace(/\.(txt|cid)$/i, '');
          await engine.reload(loader);
          reload = 'reloaded(' + loader + ')';
        }
      } catch (e: any) {
        reload = 'warn:' + String((e && e.message) || e);
      }
      res.json({ ok: true, fileName: path.basename(file), count: stats.entries, problems: stats.problems, reload });
    } catch (e: any) {
      res.status(400).json({ error: String((e && e.message) || e) });
    }
  });

  // multer/上传错误统一返回 JSON（默认返回 HTML，会导致前端报 Failed to fetch / 解析失败）
  router.use((err: any, _req: Request, res: Response, _next: Function) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: '上传文件过大（单文件最大 50MB）' });
      return;
    }
    if (err instanceof multer.MulterError) {
      res.status(400).json({ error: '上传失败: ' + err.message });
      return;
    }
    res.status(500).json({ error: String((err && err.message) || err) });
  });

  return router;
}