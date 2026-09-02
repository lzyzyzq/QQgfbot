import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import type { PluginManifest } from '../config';
import { ROLE_PERMISSIONS } from '../config';
import { requireSuperMaster, getUserPermissions } from '../middleware';
import { getPluginEngine } from '../../api/index';
import { getDb } from '../../db/index';
import { v4 as uuidv4 } from 'uuid';

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
    const row = getDb().prepare('SELECT source_path, type FROM plugins WHERE name = ?').get(name) as any;
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
      // ZIP 目录插件：定位入口文件（index.js/index.mjs/index.ts/src/index.ts，兼容单层顶层子目录如 MKbot/xxx）
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
    const rowForTarget = getDb().prepare('SELECT source_path, type FROM plugins WHERE name = ?').get(name) as any;
    let target: string | null = null;
    if (rowForTarget?.source_path) {
      try {
        if (fs.existsSync(rowForTarget.source_path) && fs.statSync(rowForTarget.source_path).isFile()) {
          target = rowForTarget.source_path;
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
      // ZIP 目录插件：定位入口文件（index.js/index.mjs/index.ts/src/index.ts，兼容单层顶层子目录如 MKbot/xxx）
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