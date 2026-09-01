import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { getDb } from '../db/index';
import { getPluginEngine } from './index';
import { createLogger } from '../utils/logger';

const logger = createLogger('plugin-approval');

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

  constructor(pluginsDir: string) {
    this.filePath = path.join(pluginsDir, '.approvals.json');
  }

  private _load(): PluginApproval[] {
    try {
      if (fs.existsSync(this.filePath)) {
        return JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      }
    } catch { /* ignore */ }
    return [];
  }

  private _save(data: PluginApproval[]): void {
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }

  get(name: string): PluginApproval | undefined {
    return this._load().find((a) => a.name === name);
  }

  add(name: string, uploadedBy: string): PluginApproval {
    const data = this._load();
    const existing = data.find(a => a.name === name);
    if (existing) {
      existing.uploadedBy = uploadedBy;
      existing.uploadedAt = Date.now();
      existing.status = uploadedBy === '__super__' ? 'approved' : 'pending';
      existing.reviewedBy = undefined;
      existing.reviewedAt = undefined;
      existing.reason = undefined;
      this._save(data);
      return existing;
    }
    const entry: PluginApproval = {
      name,
      status: uploadedBy === '__super__' ? 'approved' : 'pending',
      uploadedBy,
      uploadedAt: Date.now(),
    };
    data.push(entry);
    this._save(data);
    return entry;
  }

  approve(name: string, reviewer: string): PluginApproval | null {
    const data = this._load();
    const entry = data.find(a => a.name === name);
    if (!entry) return null;
    entry.status = 'approved';
    entry.reviewedBy = reviewer;
    entry.reviewedAt = Date.now();
    entry.reason = undefined;
    this._save(data);
    return entry;
  }

  reject(name: string, reviewer: string, reason?: string): PluginApproval | null {
    const data = this._load();
    const entry = data.find(a => a.name === name);
    if (!entry) return null;
    entry.status = 'rejected';
    entry.reviewedBy = reviewer;
    entry.reviewedAt = Date.now();
    entry.reason = reason;
    this._save(data);
    return entry;
  }

  all(): PluginApproval[] { return this._load(); }
}

export function createPluginApprovalRoutes(pluginsDir: string): Router {
  const router = Router();
  const approvalStore = new PluginApprovalStore(pluginsDir);

  if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir, { recursive: true });

  const upload = multer({
    dest: path.join(pluginsDir, '.tmp'),
    limits: { fileSize: 50 * 1024 * 1024 },
  });

  // 审批列表
  router.get('/approvals', (_req: Request, res: Response) => {
    try {
      const all = approvalStore.all();
      const pending = all.filter(a => a.status === 'pending');
      res.json({ total: all.length, pending: pending.length, items: all });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // 审批通过
  router.post('/approvals/:name/approve', (req: Request, res: Response) => {
    const reviewer = (req as any).adminUser?.username || 'admin';
    const result = approvalStore.approve(req.params.name, reviewer);
    if (!result) { res.status(404).json({ error: 'Approval not found' }); return; }
    try {
      const db = getDb();
      db.prepare('UPDATE plugins SET approved = 1, enabled = 1 WHERE name = ?').run(req.params.name);
    } catch(e) {}
    // 重新加载插件
    try {
      const engine = getPluginEngine();
      if (engine) engine.loadAllFromDb();
    } catch(e) {}
    res.json({ ok: true, approval: result });
  });

  // 审批拒绝
  router.post('/approvals/:name/reject', (req: Request, res: Response) => {
    const result = approvalStore.reject(
      req.params.name,
      (req as any).adminUser?.username || 'admin',
      req.body.reason,
    );
    if (!result) { res.status(404).json({ error: 'Approval not found' }); return; }
    try {
      const db = getDb();
      db.prepare('UPDATE plugins SET approved = 0, enabled = 0 WHERE name = ?').run(req.params.name);
    } catch(e) {}
    res.json({ ok: true, approval: result });
  });

  // 上传插件 ZIP
  router.post('/upload', upload.single('plugin'), (req: Request, res: Response) => {
    try {
      const file = req.file;
      if (!file) { res.status(400).json({ error: 'No file uploaded' }); return; }
      if (!file.originalname.endsWith('.js') && !file.originalname.endsWith('.zip')) {
        fs.unlinkSync(file.path);
        res.status(400).json({ error: 'Only .js or .zip files are accepted' });
        return;
      }

      const pluginName = req.body.name || path.basename(file.originalname, path.extname(file.originalname));
      const destPath = path.join(pluginsDir, pluginName + '.js');

      if (file.originalname.endsWith('.zip')) {
        // ZIP 解压处理
        try {
          const AdmZip = require('adm-zip');
          const zip = new AdmZip(file.path);
          const entries = zip.getEntries();
          for (const entry of entries) {
            const entryName = entry.entryName.replace(/^[^/]+\//, '');
            if (entry.isDirectory || !entryName || !entryName.endsWith('.js')) continue;
            const targetPath = path.join(pluginsDir, path.basename(entryName).replace(/\.js$/, '') + '.js');
            fs.writeFileSync(targetPath, entry.getData());
          }
          fs.unlinkSync(file.path);
        } catch (e) {
          fs.unlinkSync(file.path);
          res.status(500).json({ error: 'ZIP extraction failed: ' + (e as Error).message });
          return;
        }
      } else {
        // 单文件 .js
        const content = fs.readFileSync(file.path, 'utf-8');
        fs.writeFileSync(destPath, content);
        fs.unlinkSync(file.path);
      }

      // 记录审批
      const isSuper = (req as any).adminUser?.role === 'super_master';
      const uploadedBy = isSuper ? '__super__' : ((req as any).adminUser?.username || 'unknown');
      const approval = approvalStore.add(pluginName, uploadedBy);

      // 写入 DB 记录 owner 和审批状态
      try {
        const db = getDb();
        const code = fs.readFileSync(destPath, 'utf-8');
        const id = 'file-' + pluginName;
        const existing = db.prepare('SELECT id FROM plugins WHERE name = ?').get(pluginName);
        if (existing) {
          db.prepare(
            'UPDATE plugins SET code = ?, approved = ?, owner = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?'
          ).run(code, isSuper ? 1 : 0, uploadedBy, isSuper ? 1 : 0, pluginName);
        } else {
          db.prepare(
            'INSERT INTO plugins (id, name, code, enabled, version, type, approved, owner) VALUES (?, ?, ?, ?, 1, ?, ?, ?)'
          ).run(id, pluginName, code, isSuper ? 1 : 0, 'code', isSuper ? 1 : 0, uploadedBy);
        }
      } catch (e) {
        logger.error(`DB insert for ${pluginName} failed: ${(e as Error).message}`);
      }

      // 如果超级主人上传，自动审批并加载
      if (isSuper) {
        try {
          const engine = getPluginEngine();
          if (engine) engine.loadAllFromDb();
          logger.info(`Plugin "${pluginName}" auto-loaded by super master`);
        } catch (e) {
          logger.error(`Auto-load plugin failed: ${(e as Error).message}`);
        }
      }

      res.json({ ok: true, name: pluginName, approval });
    } catch (err) {
      if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(500).json({ error: String(err) });
    }
  });

  // 删除已审批插件
  router.delete('/approvals/:name', (req: Request, res: Response) => {
    const name = req.params.name;
    const pluginPath = path.join(pluginsDir, name + '.js');
    if (fs.existsSync(pluginPath)) {
      fs.unlinkSync(pluginPath);
      logger.info(`Plugin file deleted: ${name}.js`);
    }
    res.json({ ok: true });
  });

  return router;
}
