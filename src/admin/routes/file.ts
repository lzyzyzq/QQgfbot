import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import AdmZip from 'adm-zip';
import fs from 'fs';
import path from 'path';

export function createFileRoutes(dataDir: string): Router {
  const router = Router();

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const upload = multer({
    dest: path.join(dataDir, '.tmp'),
    limits: { fileSize: 100 * 1024 * 1024 },
  });

  const tmpDir = path.join(dataDir, '.tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  function safePath(target: string): string {
    const base = path.resolve(dataDir);
    const rel = target.replace(/^\/+/, '');
    const joined = path.resolve(base, rel);
    if (!joined.startsWith(base)) {
      return base;
    }
    return joined;
  }

  // 目录大小递归统计：限制文件数/深度，超大目录返回 -1，避免同步递归阻塞事件循环导致列表加载超时
  const SIZE_MAX_FILES = 8000;
  function dirSize(p: string, depth = 0, count = { n: 0 }): number {
    let total = 0;
    try {
      for (const e of fs.readdirSync(p, { withFileTypes: true })) {
        if (count.n > SIZE_MAX_FILES || depth > 6) return -1;
        if (e.name === '.tmp') continue;
        const fp = path.join(p, e.name);
        if (e.isDirectory()) {
          const sub = dirSize(fp, depth + 1, count);
          if (sub < 0) return -1;
          total += sub;
        } else if (e.isFile()) {
          count.n++;
          try { total += fs.statSync(fp).size; } catch {}
        }
      }
    } catch {}
    return total;
  }

  // ZIP 条目名乱码修复：Windows 压缩包常为 GBK 文件名，AdmZip 按 UTF-8 解码会出现 � 替换符
  function decodeEntryName(name: string, raw: Buffer | null): string {
    if (!name.includes('\uFFFD')) return name;
    try {
      const dec = new TextDecoder('gbk').decode(raw || Buffer.from(name, 'latin1'));
      if (dec && !dec.includes('\uFFFD')) return dec;
    } catch {}
    return name;
  }

  // 手动解压 zip，兼容 GBK/UTF-8 文件名，并防路径穿越
  function extractZip(zipPath: string, targetDir: string): void {
    const zip = new AdmZip(zipPath);
    const base = path.resolve(targetDir);
    for (const entry of zip.getEntries()) {
      const clean = decodeEntryName(entry.entryName, (entry as any).rawEntryName || null);
      const full = path.resolve(base, clean);
      if (!full.startsWith(base)) continue;
      if (entry.isDirectory) { fs.mkdirSync(full, { recursive: true }); continue; }
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, entry.getData());
    }
  }

  // 读取文本时自动识别编码：UTF-8 无效序列视为 GBK，修复上传的乱码群信息文件
  function decodeText(buf: Buffer): { text: string; encoding: string } {
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), encoding: 'utf-8' };
    } catch {}
    try {
      return { text: new TextDecoder('gbk').decode(buf), encoding: 'gbk' };
    } catch {
      return { text: buf.toString('utf-8'), encoding: 'utf-8' };
    }
  }

  function walkFiles(p: string): string[] {
    const out: string[] = [];
    try {
      for (const e of fs.readdirSync(p, { withFileTypes: true })) {
        if (e.name === '.tmp') continue;
        const fp = path.join(p, e.name);
        if (e.isDirectory()) out.push(...walkFiles(fp));
        else if (e.isFile()) out.push(fp);
      }
    } catch {}
    return out;
  }

  router.get('/list', (req: Request, res: Response) => {
    try {
      const dir = req.query.dir ? safePath(String(req.query.dir)) : dataDir;
      if (!fs.existsSync(dir)) {
        res.json([]);
        return;
      }
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files = entries
        .filter((e) => e.name !== '.tmp')
        .map((e) => {
          const fp = path.join(dir, e.name);
          const st = fs.statSync(fp);
          return {
            name: e.name,
            type: e.isDirectory() ? 'dir' : 'file',
            size: e.isDirectory() ? dirSize(fp) : st.size,
            mtime: st.mtime.toISOString(),
          };
        })
        // 目录在前、名称排序，保证文件夹显示齐全且顺序稳定
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
          return a.name.localeCompare(b.name, 'zh-CN');
        });
      res.json({ files, currentDir: path.relative(dataDir, dir) || '/' });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/upload', upload.array('files', 50), (req: Request, res: Response) => {
    try {
      const files = (req.files as Express.Multer.File[] | undefined) || [];
      if (!files.length) {
        res.status(400).json({ error: 'No file' });
        return;
      }
      const targetDir = req.body.dir ? safePath(String(req.body.dir)) : dataDir;
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
      const autoExtract = req.body.extract === '1' || req.body.extract === 'true';
      const results: { name: string; extracted: boolean }[] = [];
      for (const file of files) {
        const name = Buffer.from(file.originalname, 'latin1').toString('utf8');
        const dest = path.join(targetDir, name);
        fs.copyFileSync(file.path, dest);
        fs.unlinkSync(file.path);
        let extracted = false;
        if (autoExtract && name.toLowerCase().endsWith('.zip') && fs.existsSync(dest)) {
          extractZip(dest, targetDir);
          extracted = true;
        }
        results.push({ name, extracted });
      }
      res.json({ ok: true, files: results });
    } catch (err) {
      const files = (req.files as Express.Multer.File[] | undefined) || [];
      for (const f of files) { if (f.path && fs.existsSync(f.path)) { try { fs.unlinkSync(f.path); } catch {} } }
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/mkdir', (req: Request, res: Response) => {
    try {
      const dir = safePath(req.body.path || req.body.name);
      fs.mkdirSync(dir, { recursive: true });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/rename', (req: Request, res: Response) => {
    try {
      const oldPath = safePath(req.body.oldPath);
      const newPath = safePath(req.body.newPath);
      fs.renameSync(oldPath, newPath);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/move', (req: Request, res: Response) => {
    try {
      const source = safePath(req.body.source || req.body.path);
      const destDir = safePath(req.body.destDir || req.body.dest || '');
      if (!fs.existsSync(source)) {
        res.status(404).json({ error: 'Source not found' });
        return;
      }
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      if (destDir === path.dirname(source)) {
        res.json({ ok: true, target: path.relative(dataDir, source) });
        return;
      }
      const target = path.join(destDir, path.basename(source));
      if (fs.existsSync(target)) {
        res.status(409).json({ error: '目标目录已存在同名文件' });
        return;
      }
      fs.renameSync(source, target);
      res.json({ ok: true, target: path.relative(dataDir, target) });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/read', (req: Request, res: Response) => {
    try {
      const filePath = safePath(String(req.query.path));
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        res.status(400).json({ error: 'Cannot read directory' });
        return;
      }
      const buf = fs.readFileSync(filePath);
      const { text, encoding } = decodeText(buf);
      res.json({ content: text, encoding, path: String(req.query.path), size: stat.size });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/write', (req: Request, res: Response) => {
    try {
      const filePath = safePath(req.body.path);
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, req.body.content || '');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // 单文件下载：GET（浏览器原生下载，带 cookie 认证，不走 fetch，大文件不被代理中断）
  router.get('/download', (req: Request, res: Response) => {
    try {
      const filePath = safePath(String(req.query.path || ''));
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      const st = fs.statSync(filePath);
      if (st.isDirectory()) {
        res.status(400).json({ error: 'Cannot download directory' });
        return;
      }
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', String(st.size));
      const name = path.basename(filePath);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}"`);
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/download', (req: Request, res: Response) => {
    try {
      const filePath = safePath(req.body.path);
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      res.download(filePath);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // 多文件打包下载（POST/GET 通用）：浏览器原生下载，不走 fetch blob，大目录不因代理中断
  async function buildZipAndSend(res: Response, paths: string[]): Promise<void> {
    // 上限保护：超大目录同步打包会长时间占用事件循环/内存，导致连接被中断（前端报 Failed to fetch）
    const MAX_FILES = 20000;
    const MAX_BYTES = 1024 * 1024 * 1024;
    const zip = new AdmZip();
    const seen = new Set<string>();
    let fileCount = 0;
    let totalBytes = 0;
    for (const p of paths) {
      const fp = safePath(p);
      if (!fs.existsSync(fp)) continue;
      const st = fs.statSync(fp);
      const targets = st.isDirectory() ? walkFiles(fp) : [fp];
      for (const t of targets) {
        const rel = path.relative(dataDir, t).split(path.sep).join('/');
        if (seen.has(rel)) continue;
        seen.add(rel);
        fileCount++;
        const sz = fs.statSync(t).size;
        totalBytes += sz;
        if (fileCount > MAX_FILES) {
          res.status(400).json({ error: `文件数超过上限（${MAX_FILES} 个）。可进入具体文件夹后勾选需要的文件再打包，或单独下载单个文件` });
          return;
        }
        if (totalBytes > MAX_BYTES) {
          res.status(400).json({ error: '总大小超过上限（1GB），请缩小选择范围' });
          return;
        }
        zip.addFile(rel, fs.readFileSync(t));
        // 每打包 2000 个文件让出事件循环，防止大目录下载时连接超时被中断
        if (fileCount % 2000 === 0) {
          await new Promise((resolve) => setImmediate(resolve));
        }
      }
    }
    const buf = zip.toBuffer();
    // 压缩包文件名带时间戳，避免每次固定 files.zip 造成同名缓存/无法区分版本
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const zipName = `files-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
    res.send(buf);
  }

  router.get('/download-zip', async (req: Request, res: Response) => {
    try {
      const q = req.query.path;
      const paths = Array.isArray(q) ? q.map((x) => String(x)) : q ? [String(q)] : [];
      if (!paths.length) {
        res.status(400).json({ error: 'No paths' });
        return;
      }
      await buildZipAndSend(res, paths);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/download-zip', async (req: Request, res: Response) => {
    try {
      const paths: string[] = req.body.paths || [];
      if (!paths.length) {
        res.status(400).json({ error: 'No paths' });
        return;
      }
      await buildZipAndSend(res, paths);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/extract', (req: Request, res: Response) => {
    try {
      const filePath = safePath(req.body.path);
      const destDir = req.body.dest ? safePath(req.body.dest) : path.dirname(filePath);

      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: 'Not found' });
        return;
      }

      if (filePath.endsWith('.zip')) {
        extractZip(filePath, destDir);
      } else {
        res.status(400).json({ error: 'Only .zip files can be extracted' });
        return;
      }

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/delete', (req: Request, res: Response) => {
    try {
      const filePath = safePath(req.body.path);
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        fs.rmSync(filePath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(filePath);
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // multer/上传错误统一返回 JSON（默认会返回 HTML，导致前端报 Failed to fetch / 解析失败）
  router.use((err: any, _req: Request, res: Response, _next: Function) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: '上传文件过大（单文件最大 100MB）' });
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
