import { Router, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { addSystemLog } from '../../db/index';

// 代码编辑器：在线编辑插件代码与文本文件，仅允许在受控目录内操作
const router = Router();

// 允许编辑的文本类型（含 ZIP 插件常见数据文件 .dm/.txt/.json 等）
const ALLOWED_EXTS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.php', '.md', '.json', '.txt', '.dm',
  '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf',
  '.csv', '.html', '.css', '.xml', '.sql', '.sh', '.py', '.rb', '.go', '.env', '.log',
]);

interface EditorRoot {
  key: string;
  dir: string;
  label: string;
}

// 动态构建编辑根目录：
//  - plugins/（JS 代码插件 .js 文件）
//  - plugins/ 下每个 ZIP 插件子目录（含 plugin.json/package.json）
//  - scripts、docs
function buildRoots(): EditorRoot[] {
  const cwd = process.cwd();
  const roots: EditorRoot[] = [];
  const pluginsDir = path.resolve(cwd, 'plugins');

  if (fs.existsSync(pluginsDir)) {
    roots.push({ key: 'plugins', dir: pluginsDir, label: 'plugins（JS 插件）' });
    const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      if (e.name === '.tmp' || e.name === 'node_modules' || e.name === 'dist') continue;
      const sub = path.join(pluginsDir, e.name);
      if (fs.existsSync(path.join(sub, 'plugin.json')) || fs.existsSync(path.join(sub, 'package.json'))) {
        roots.push({ key: 'zip-' + e.name, dir: sub, label: 'ZIP插件 ' + e.name });
      }
    }
  }
  for (const sub of ['scripts', 'docs']) {
    const d = path.resolve(cwd, sub);
    if (fs.existsSync(d)) roots.push({ key: sub, dir: d, label: sub + (sub === 'scripts' ? '（脚本）' : '（文档）') });
  }
  return roots;
}

function isAllowedPath(full: string): boolean {
  const resolved = path.resolve(full);
  return buildRoots().some((r) => resolved === r.dir || resolved.startsWith(r.dir + path.sep));
}

// 列出代码插件根时跳过 ZIP 插件子目录（它们有独立根），避免重复
function isZipPluginDir(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'plugin.json')) || fs.existsSync(path.join(dir, 'package.json'));
}

function listFilesRecursive(dir: string, base: string, skipZipSubdir: boolean, out: string[]): void {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.tmp') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (skipZipSubdir && isZipPluginDir(full)) continue;
      listFilesRecursive(full, base, skipZipSubdir, out);
    } else if (ALLOWED_EXTS.has(path.extname(e.name).toLowerCase())) {
      out.push(path.relative(base, full).split(path.sep).join('/'));
    }
  }
}

// 列出可编辑文件
router.get('/files', (_req: Request, res: Response) => {
  try {
    const roots = buildRoots();
    const result = roots.map((r) => {
      const files: string[] = [];
      listFilesRecursive(r.dir, r.dir, r.key === 'plugins', files);
      files.sort((a, b) => a.localeCompare(b));
      return { root: r.key, label: r.label, files };
    });
    res.json({ roots: result });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 读取文件内容
router.get('/file', (req: Request, res: Response) => {
  try {
    const rel = (req.query.path as string) || '';
    const key = (req.query.root as string) || '';
    const root = buildRoots().find((r) => r.key === key);
    if (!root) { res.status(400).json({ error: '未知目录' }); return; }
    const full = path.resolve(root.dir, rel);
    if (!isAllowedPath(full) || !ALLOWED_EXTS.has(path.extname(full).toLowerCase())) {
      res.status(403).json({ error: '文件类型不允许' }); return;
    }
    if (!fs.existsSync(full)) { res.status(404).json({ error: '文件不存在' }); return; }
    const content = fs.readFileSync(full, 'utf-8');
    res.json({ path: rel, root: key, content, ext: path.extname(full).toLowerCase() });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 保存文件（编辑/新建共用）
router.put('/file', (req: Request, res: Response) => {
  try {
    const { root: key, path: rel, content } = req.body || {};
    const root = buildRoots().find((r) => r.key === key);
    if (!root) { res.status(400).json({ error: '未知目录' }); return; }
    if (!rel || typeof content !== 'string') { res.status(400).json({ error: '缺少 path 或 content' }); return; }
    const full = path.resolve(root.dir, rel);
    if (!isAllowedPath(full)) { res.status(403).json({ error: '路径不允许' }); return; }
    const ext = path.extname(full).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) { res.status(403).json({ error: '不支持的文件类型' }); return; }
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
    addSystemLog('info', 'editor', `保存文件: ${key}/${rel}`, undefined, req.adminUser?.username);
    res.json({ ok: true, path: rel, root: key, ext });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
