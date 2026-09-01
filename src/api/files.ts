import { Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import multer from 'multer';
import AdmZip from 'adm-zip';

import * as os from 'os';

const router = Router();

// ---------- 基础配置 ----------
const WORKSPACE_ROOT = path.resolve(process.cwd()); // 工作区根目录（项目根）
const TMP_DIR = path.join(os.tmpdir(), 'qqbot-uploads'); // 临时上传目录

// ---------- multer 存储配置 ----------
const storage = multer.diskStorage({
  // 目标目录：使用系统临时目录下的 qqbot-uploads
  destination: (_req, _file, cb) => {
    if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
    cb(null, TMP_DIR);
  },
  // 文件名：将 latin1 编码的原始文件名转换为 UTF-8（解决中文乱码）
  filename: (req, file, cb) => {
    const decoded = Buffer.from(file.originalname, 'latin1').toString('utf8');
    cb(null, decoded);
  }
});
// 上传中间件：最大 100MB，支持多文件
const upload = multer({ storage: storage, limits: { fileSize: 100 * 1024 * 1024 } });

/**
 * 安全路径检查：确保访问路径在工作区根目录内
 * @param p 要检查的路径
 * @returns 是否安全（true 表示允许访问）
 */
function isSafe(p: string): boolean {
  const resolved = path.resolve(p);
  return resolved.startsWith(WORKSPACE_ROOT);
}

// ==================== 文件浏览接口 ====================

/**
 * 获取目录内容（列出文件和子目录）
 * GET /api/files?dir=相对路径
 * @query dir 可选，相对于工作区的目录路径，默认为根目录
 * @returns { path: 当前显示目录（相对路径）, items: 文件/目录信息数组 }
 *   - items 包含 name, type (directory/file), path, size（仅文件）
 * @throws 403 若路径不合法；500 若读取失败
 */
router.get('/files', (req, res) => {
  try {
    const dirParam = (req.query.dir as string) || '';
    const target = dirParam
      ? path.join(WORKSPACE_ROOT, dirParam)
      : WORKSPACE_ROOT;
    if (!isSafe(target)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    const entries = fs.readdirSync(target, { withFileTypes: true });
    const items = entries.map((e) => {
      const full = path.join(target, e.name);
      let size: number | undefined;
      if (e.isFile()) {
        try { size = fs.statSync(full).size; } catch {}
      }
      return {
        name: e.name,
        type: e.isDirectory() ? 'directory' : 'file',
        path: path.relative(WORKSPACE_ROOT, full),
        size,
      };
    });
    // 排序：目录在前，文件在后，按名称字母序
    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    const parent = path.relative(WORKSPACE_ROOT, target);
    res.json({ path: parent, items });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 文件读取接口 ====================

/**
 * 读取文件内容（纯文本）
 * GET /api/files/read?file=相对路径
 * @query file 必填，文件相对路径
 * @returns { path, content } 文件内容和路径
 * @throws 400 若缺少 file 参数；404 若文件不存在或为目录；500 若读取失败
 */
router.get('/files/read', (req, res) => {
  try {
    const fileParam = (req.query.file as string) || '';
    if (!fileParam) {
      res.status(400).json({ error: 'file param required' });
      return;
    }
    const target = path.join(WORKSPACE_ROOT, fileParam);
    if (!isSafe(target) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    const content = fs.readFileSync(target, 'utf-8');
    res.json({ path: fileParam, content });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 文件下载接口 ====================

/**
 * 下载单个文件
 * GET /api/files/download?file=相对路径
 * @query file 必填，文件相对路径
 * @returns 文件流（Content-Disposition 为 attachment，支持中文文件名）
 * @throws 404 若文件不存在或为目录；500 若读取失败
 */
router.get('/files/download', (req, res) => {
  try {
    const fileParam = (req.query.file as string) || '';
    if (!fileParam) {
      res.status(400).json({ error: 'file param required' });
      return;
    }
    const target = path.join(WORKSPACE_ROOT, fileParam);
    if (!isSafe(target) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    const name = path.basename(target);
    // 使用 UTF-8 编码的文件名（RFC 5987）
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader('Content-Type', 'application/octet-stream');
    fs.createReadStream(target).pipe(res);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 前端批量/单文件下载使用 POST + JSON body（{path} / {paths}），此处提供兼容路由
router.post('/files/download', (req, res) => {
  try {
    const fileParam = String((req.body as any)?.path || '');
    if (!fileParam) {
      res.status(400).json({ error: 'path required' });
      return;
    }
    const target = path.join(WORKSPACE_ROOT, fileParam);
    if (!isSafe(target) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    const name = path.basename(target);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader('Content-Type', 'application/octet-stream');
    fs.createReadStream(target).pipe(res);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * 批量下载多个文件/文件夹（打包为 ZIP）
 * GET /api/files/download-zip?files=路径1,路径2,...
 * @query files 必填，逗号分隔的相对路径列表
 * @returns ZIP 文件流（filename=files.zip）
 * @throws 400 若未提供文件列表；500 若打包失败
 */
router.get('/files/download-zip', (req, res) => {
  try {
    const filesParam = (req.query.files as string) || '';
    const files = filesParam.split(',').filter(Boolean);
    if (files.length === 0) {
      res.status(400).json({ error: 'files param required' });
      return;
    }
    const zip = new AdmZip();
    for (const f of files) {
      const target = path.join(WORKSPACE_ROOT, f);
      if (!isSafe(target) || !fs.existsSync(target)) continue;
      if (fs.statSync(target).isDirectory()) {
        // 添加整个文件夹（保留子目录结构）
        zip.addLocalFolder(target, path.basename(target));
      } else {
        zip.addLocalFile(target);
      }
    }
    res.setHeader('Content-Disposition', 'attachment; filename=files.zip');
    res.setHeader('Content-Type', 'application/zip');
    res.send(zip.toBuffer());
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 前端批量下载使用 POST + JSON body（{paths:[...]}），此处提供兼容路由
router.post('/files/download-zip', (req, res) => {
  try {
    const files: string[] = Array.isArray((req.body as any)?.paths) ? (req.body as any).paths.map(String) : [];
    if (files.length === 0) {
      res.status(400).json({ error: 'paths required' });
      return;
    }
    const zip = new AdmZip();
    for (const f of files) {
      const target = path.join(WORKSPACE_ROOT, f);
      if (!isSafe(target) || !fs.existsSync(target)) continue;
      if (fs.statSync(target).isDirectory()) {
        zip.addLocalFolder(target, path.basename(target));
      } else {
        zip.addLocalFile(target);
      }
    }
    res.setHeader('Content-Disposition', 'attachment; filename=files.zip');
    res.setHeader('Content-Type', 'application/zip');
    res.send(zip.toBuffer());
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 创建文件/目录接口 ====================

/**
 * 创建新文件或目录
 * POST /api/files
 * @body { dir: 父目录相对路径（可选）, name: 名称, type: 'file' 或 'directory' }
 * @returns { ok: true, path: 新创建项的相对路径 }
 * @throws 400 若名称非法或未提供；403 若路径不安全；409 若已存在；500 若创建失败
 */
router.post('/files', (req, res) => {
  try {
    const { dir, name, type } = req.body;
    // 名称校验：只允许字母、数字、下划线、连字符、点、中文
    if (!name || !/^[a-zA-Z0-9_\-\.\u4e00-\u9fff]+$/.test(name)) {
      res.status(400).json({ error: 'Invalid name' });
      return;
    }
    const targetDir = dir ? path.join(WORKSPACE_ROOT, dir) : WORKSPACE_ROOT;
    if (!isSafe(targetDir)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    const fullPath = path.join(targetDir, name);
    if (fs.existsSync(fullPath)) {
      res.status(409).json({ error: 'Already exists' });
      return;
    }
    if (type === 'directory') {
      fs.mkdirSync(fullPath, { recursive: true });
    } else {
      fs.writeFileSync(fullPath, '', 'utf-8');
    }
    res.json({ ok: true, path: path.relative(WORKSPACE_ROOT, fullPath) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 编辑/重命名接口 ====================

/**
 * 编辑文件内容 或 重命名文件/目录
 * PUT /api/files
 * @body 常规编辑: { file: 相对路径, content: 新内容 }
 * @body 重命名: { file: 旧路径, action: 'rename', newName: 新名称 }
 * @returns { ok: true } 或 { ok: true, newPath: 新路径 }（重命名时）
 * @throws 400 若缺少必要参数；403 若路径不安全；404 若原文件不存在；
 *         409 若新名称已存在；500 若操作失败
 */
router.put('/files', (req, res) => {
  try {
    const { file, content, action } = req.body;

    // ---------- 重命名操作 ----------
    if (action === 'rename') {
      const { newName } = req.body;
      if (!file || !newName) {
        res.status(400).json({ error: 'file and newName required' });
        return;
      }
      const oldPath = path.join(WORKSPACE_ROOT, file);
      if (!isSafe(oldPath) || !fs.existsSync(oldPath)) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      const newPath = path.join(path.dirname(oldPath), newName);
      if (!isSafe(newPath)) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      if (fs.existsSync(newPath)) {
        res.status(409).json({ error: '名称已存在' });
        return;
      }
      fs.renameSync(oldPath, newPath);
      res.json({ ok: true, newPath: path.relative(WORKSPACE_ROOT, newPath) });
      return;
    }

    // ---------- 常规编辑（更新文件内容） ----------
    if (!file) {
      res.status(400).json({ error: 'file param required' });
      return;
    }
    const target = path.join(WORKSPACE_ROOT, file);
    if (!isSafe(target)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(target, content || '', 'utf-8');
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 文件上传接口 ====================

/**
 * 上传文件（支持多个文件，可自动解压 ZIP）
 * POST /api/files/upload
 * @body form-data:
 *   - files: 文件列表（multipart）
 *   - dir: 目标目录（可选，相对路径）
 *   - extract: 是否为1，若是则对 ZIP 文件自动解压
 * @returns { ok: true, message: 描述 }
 * @throws 400 若解压失败或不支持的格式；403 若目标路径不安全；500 若上传失败
 */
router.post('/files/upload', upload.array('files', 20), (req: any, res) => {
  try {
    const files = req.files || [];
    const dir = (req.body.dir as string) || '';
    const extract = req.body.extract === '1';
    const targetDir = dir ? path.join(WORKSPACE_ROOT, dir) : WORKSPACE_ROOT;

    if (!isSafe(targetDir)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    let extracted = 0;
    let uploaded = 0;

    for (const file of files) {
      // 恢复原始文件名（处理中文）
      const originalname = file.filename || Buffer.from(file.originalname, 'latin1').toString('utf8');
      const filePath = file.path || '';
      const fileBuffer = fs.existsSync(filePath) ? fs.readFileSync(filePath) : file.buffer;
      const ext = path.extname(originalname).toLowerCase();

      // 若启用解压且是 ZIP 文件
      if (extract && (ext === '.zip')) {
        try {
          const zip = new AdmZip(fileBuffer);
          const entries = zip.getEntries();
          for (const entry of entries) {
            if (entry.isDirectory) continue;
            // 修正条目名的编码（支持中文）
            const entryName = Buffer.from(entry.entryName, 'binary').toString('utf8');
            const entryPath = path.join(targetDir, entryName);
            const entryDir = path.dirname(entryPath);
            if (!fs.existsSync(entryDir)) fs.mkdirSync(entryDir, { recursive: true });
            fs.writeFileSync(entryPath, entry.getData());
            extracted++;
          }
        } catch (e: any) {
          return res.status(400).json({ error: 'ZIP解压失败: ' + e.message });
        }
      } else if (extract && ext === '.rar') {
        // RAR 暂不支持
        return res.status(400).json({ error: 'RAR格式暂不支持，请使用ZIP格式' });
      } else {
        // 普通文件：移动到目标目录（覆盖同名文件）
        const dest = path.join(targetDir, originalname);
        if (filePath && fs.existsSync(filePath)) {
          fs.renameSync(filePath, dest);
        } else {
          fs.writeFileSync(dest, fileBuffer);
        }
        uploaded++;
      }
    }

    // 清理临时文件
    try {
      for (const file of files) {
        if (file.path && fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      }
    } catch {}

    res.json({
      ok: true,
      message: extract
        ? `解压完成，释放了 ${extracted} 个文件`
        : `上传了 ${uploaded} 个文件`,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 回收站功能 ====================

// 回收站目录（位于工作区根目录下的 .trash）
const TRASH_DIR = path.join(WORKSPACE_ROOT, '.trash');
// 回收站元数据目录（存储删除信息）
const TRASH_META_DIR = path.join(TRASH_DIR, '.meta');

/**
 * 确保回收站目录结构存在
 */
function ensureTrashDir() {
  if (!fs.existsSync(TRASH_DIR)) fs.mkdirSync(TRASH_DIR, { recursive: true });
  if (!fs.existsSync(TRASH_META_DIR)) fs.mkdirSync(TRASH_META_DIR, { recursive: true });
}

/**
 * 获取回收站中某项的元数据文件路径
 */
function trashMetaPath(id: string) {
  return path.join(TRASH_META_DIR, id + '.json');
}

/**
 * 删除文件/目录（移入回收站 或 永久删除）
 * DELETE /api/files?file=相对路径&permanent=0/1
 * @query file 必填，要删除的相对路径
 * @query permanent 可选，1表示永久删除，0或省略表示移入回收站
 * @returns { ok: true, message: 描述 }
 * @throws 400 若缺少 file；404 若不存在；500 若操作失败
 */
router.delete('/files', (req, res) => {
  try {
    const file = (req.query.file as string) || '';
    const permanent = req.query.permanent === '1';
    if (!file) {
      res.status(400).json({ error: 'file required' });
      return;
    }
    const target = path.join(WORKSPACE_ROOT, file);
    if (!isSafe(target) || !fs.existsSync(target)) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const isDir = fs.statSync(target).isDirectory();

    // 永久删除（直接删除）
    if (permanent) {
      if (isDir) fs.rmSync(target, { recursive: true, force: true });
      else fs.unlinkSync(target);
      res.json({ ok: true, message: '已永久删除' });
      return;
    }

    // ---------- 移至回收站 ----------
    ensureTrashDir();
    const id = Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
    const dest = path.join(TRASH_DIR, id);
    const meta = {
      id,
      originalPath: file,
      name: path.basename(target),
      isDir,
      deletedAt: new Date().toISOString(),
    };
    fs.renameSync(target, dest);
    fs.writeFileSync(trashMetaPath(id), JSON.stringify(meta, null, 2), 'utf-8');
    res.json({ ok: true, message: '已移至回收站(保留2天)' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * 获取回收站列表
 * GET /api/trash
 * @returns { items: 元数据数组（按删除时间倒序） }
 * @throws 500 若读取失败
 */
router.get('/trash', (_req, res) => {
  try {
    ensureTrashDir();
    const items: any[] = [];
    const files = fs.readdirSync(TRASH_META_DIR).filter(f => f.endsWith('.json'));
    for (const f of files) {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(TRASH_META_DIR, f), 'utf-8'));
        items.push(meta);
      } catch {}
    }
    items.sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime());
    res.json({ items });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * 恢复回收站中的文件
 * POST /api/trash/restore
 * @body { id: 回收站条目ID }
 * @returns { ok: true, message: '已恢复' }
 * @throws 400 若缺少 id；404 若文件不在回收站；409 若同名文件已存在；500 若操作失败
 */
router.post('/trash/restore', (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      res.status(400).json({ error: 'id required' });
      return;
    }
    const metaRaw = fs.readFileSync(trashMetaPath(id), 'utf-8');
    const meta = JSON.parse(metaRaw);
    const src = path.join(TRASH_DIR, id);
    const dest = path.join(WORKSPACE_ROOT, meta.originalPath);
    if (!fs.existsSync(src)) {
      res.status(404).json({ error: 'File not found in trash' });
      return;
    }
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    if (fs.existsSync(dest)) {
      res.status(409).json({ error: '同名文件已存在' });
      return;
    }
    fs.renameSync(src, dest);
    fs.unlinkSync(trashMetaPath(id));
    res.json({ ok: true, message: '已恢复' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * 清理回收站（永久删除过期文件或指定条目）
 * DELETE /api/trash?id=可选
 * @query id 可选，若指定则删除该条目；若不指定则清空整个回收站（仅删除超过2天的文件）
 * @returns { ok: true, message: '已清理' }
 * @throws 500 若操作失败
 */
router.delete('/trash', (req, res) => {
  try {
    const id = (req.query.id as string) || '';
    ensureTrashDir();

    if (id) {
      // 删除指定条目（永久删除）
      const src = path.join(TRASH_DIR, id);
      if (fs.existsSync(src)) {
        const isDir = fs.statSync(src).isDirectory();
        if (isDir) fs.rmSync(src, { recursive: true, force: true });
        else fs.unlinkSync(src);
      }
      const metaFile = trashMetaPath(id);
      if (fs.existsSync(metaFile)) fs.unlinkSync(metaFile);
    } else {
      // 清空整个回收站，删除所有超过2天的文件
      const now = Date.now();
      const metaFiles = fs.readdirSync(TRASH_META_DIR).filter(f => f.endsWith('.json'));
      for (const f of metaFiles) {
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(TRASH_META_DIR, f), 'utf-8'));
          const age = now - new Date(meta.deletedAt).getTime();
          if (age > 2 * 24 * 3600 * 1000) {
            const src = path.join(TRASH_DIR, meta.id);
            if (fs.existsSync(src)) {
              if (meta.isDir) fs.rmSync(src, { recursive: true, force: true });
              else fs.unlinkSync(src);
            }
            fs.unlinkSync(path.join(TRASH_META_DIR, f));
          }
        } catch {}
      }
    }
    res.json({ ok: true, message: '已清理' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;