import { Router, Request, Response } from 'express';
import { getPluginEngine } from './index';
import * as fs from 'fs';
import * as path from 'path';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';

const upload = multer({ dest: '/tmp/qqbot-uploads/', limits: { fileSize: 100 * 1024 * 1024 } });

/**
 * 将插件代码写入 plugins/ 目录（仅用于 .js 插件）
 */
function exportPluginToFile(pluginId: string, name: string, code: string) {
  try {
    const pluginsDir = path.resolve(process.cwd(), 'plugins');
    if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir, { recursive: true });
    const safeName = name.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '_');
    const fileName = safeName + '.js';
    const filePath = path.join(pluginsDir, fileName);
    fs.writeFileSync(filePath, code, 'utf-8');
    console.log(`Plugin exported to ${filePath}`);
    return filePath;
  } catch (e: any) {
    console.error('Plugin export failed:', e.message);
    return null;
  }
}

const router = Router();

// -------------------- 原有路由（保持不变） --------------------
router.get('/plugins', (req: Request, res: Response) => {
  try {
    const engine = getPluginEngine();
    const plugins = engine.list();
    res.json(plugins);
  } catch (err: any) {
    // 永不 500：列表失败降级为空数组，前端正常显示（引擎 list 内部已有目录扫描兜底）
    res.status(200).json([]);
  }
});

router.post('/plugins', async (req: Request, res: Response) => {
  const { name, code, description } = req.body;
  if (!name || !code) {
    res.status(400).json({ error: 'name and code are required' });
    return;
  }
  try {
    const engine = getPluginEngine();
    const id = uuidv4();
    const plugin = await engine.loadFromCode(id, name, code, description || '');
    res.status(201).json(plugin);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/plugins/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, code, description } = req.body;
  if (!code) {
    res.status(400).json({ error: 'code is required' });
    return;
  }
  try {
    const engine = getPluginEngine();
    const plugin = await engine.loadFromCode(id, name || id, code, description || '');
    exportPluginToFile(id, name || id, code);
    res.json(plugin);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/plugins/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const engine = getPluginEngine();
    await engine.deletePlugin(id);
    res.json({ message: 'Plugin deleted' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/plugins/:id/toggle', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const engine = getPluginEngine();
    const enabled = await engine.toggleEnabled(id);
    res.json({ id, enabled, message: enabled ? 'Plugin enabled' : 'Plugin disabled' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/plugins/:id/reload', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const engine = getPluginEngine();
    const plugin = await engine.reload(id);
    res.json(plugin);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/plugins/:id/code', (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const engine = getPluginEngine();
    const code = engine.getPluginCode(id);
    if (code === null) {
      res.status(404).json({ error: 'Plugin not found' });
      return;
    }
    res.json({ id, code });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/plugins/lookup/:name', (req: Request, res: Response) => {
  const { name } = req.params;
  try {
    const engine = getPluginEngine();
    const id = engine.findPluginByName(name);
    if (!id) {
      res.status(404).json({ error: 'Plugin not found' });
      return;
    }
    const config = engine.getPluginConfig(id);
    res.json({ id, name, config });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------- 改造后的上传路由（同时支持 .js 和 .zip） --------------------
router.post('/plugins/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const ext = path.extname(file.originalname).toLowerCase();
    const basename = path.basename(file.originalname, ext);
    const pluginName = (req.body.name as string) || basename; // 允许请求体指定名称，否则用文件名

    const engine = getPluginEngine();

    // 处理 .js 文件：直接读取内容并调用 loadFromCode
    if (ext === '.js') {
      const code = fs.readFileSync(file.path, 'utf-8');
      const id = uuidv4();
      const description = req.body.description || '';
      // 检查是否已存在同名插件（可选覆盖逻辑）
      const existingId = engine.findPluginByName(pluginName);
      if (existingId && req.body.overwrite !== 'true') {
        fs.unlinkSync(file.path);
        res.status(409).json({ error: `Plugin "${pluginName}" already exists` });
        return;
      }
      // 如果覆盖，先删除旧插件
      if (existingId && req.body.overwrite === 'true') {
        await engine.deletePlugin(existingId);
      }
      const plugin = await engine.loadFromCode(id, pluginName, code, description);
      // 确保写入 plugins/ 目录（loadFromCode 内部已写，但为了保险再次确认）
      exportPluginToFile(id, pluginName, code);
      fs.unlinkSync(file.path);
      res.status(201).json(plugin);
      return;
    }

    // 处理 .mjs 单文件插件（ES Module，支持 export default + 同名子目录 webui 设置界面）
    if (ext === '.mjs') {
      const description = req.body.description || '';
      const existingId = engine.findPluginByName(pluginName);
      if (existingId && req.body.overwrite !== 'true') {
        fs.unlinkSync(file.path);
        res.status(409).json({ error: `Plugin "${pluginName}" already exists` });
        return;
      }
      if (existingId && req.body.overwrite === 'true') {
        await engine.deletePlugin(existingId);
      }
      const mjsPath = path.resolve(process.cwd(), 'plugins', pluginName + '.mjs');
      if (!fs.existsSync(path.dirname(mjsPath))) fs.mkdirSync(path.dirname(mjsPath), { recursive: true });
      fs.writeFileSync(mjsPath, fs.readFileSync(file.path, 'utf-8'), 'utf-8');
      const id = await engine.registerMjsFile(pluginName, description);
      const plugin = await engine.reload(id);
      fs.unlinkSync(file.path);
      res.status(201).json(plugin);
      return;
    }

    // 处理 .zip 文件
    if (ext === '.zip') {
      const id = uuidv4();
      const plugin = await engine.createFromZip(id, file.path);
      // 可选的名称覆盖：如果请求体指定了 name，但 createFromZip 从 package.json 读取，可忽略
      fs.unlinkSync(file.path);
      res.status(201).json(plugin);
      return;
    }

    // 其他扩展名不处理
    fs.unlinkSync(file.path);
    res.status(400).json({ error: 'Only .js or .zip files are supported' });
  } catch (err: any) {
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(400).json({ error: err.message });
  }
});

// -------------------- WebUI 静态文件服务（支持 package.json 的 webui 字段与 webui/ 目录） --------------------
/** 解析插件 WebUI 入口相对路径：优先 package.json 的 webui 字段，否则 webui/index.html */
function resolveWebuiEntry(sourcePath: string): string | null {
  if (fs.existsSync(path.join(sourcePath, 'webui', 'index.html'))) return 'webui/index.html';
  try {
    const pkgPath = path.join(sourcePath, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (typeof pkg.webui === 'string' && fs.existsSync(path.join(sourcePath, pkg.webui))) {
        return pkg.webui;
      }
    }
  } catch {}
  return null;
}

// 插件 WebUI 配置读写（供插件设置界面使用，存储于 config 表 plugin.{id}.{key}）
router.get('/plugins/:id/config', (req: Request, res: Response) => {
  try {
    const engine = getPluginEngine();
    res.json(engine.getPluginConfig(req.params.id));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/plugins/:id/config', (req: Request, res: Response) => {
  try {
    const engine = getPluginEngine();
    const body = req.body || {};
    for (const [k, v] of Object.entries(body)) {
      if (v === null || v === undefined) continue;
      engine.setPluginConfig(req.params.id, k, String(v));
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/plugins/:id/webui', (req: Request, res: Response) => {
  const engine = getPluginEngine();
  const sourcePath = engine.getPluginSourcePath(req.params.id);
  if (!sourcePath) {
    res.status(404).json({ error: 'Plugin webui not found' });
    return;
  }
  const rel = resolveWebuiEntry(sourcePath);
  if (!rel) {
    res.status(404).json({ error: 'WebUI index not found' });
    return;
  }
  res.sendFile(path.join(sourcePath, rel));
});

// ---- NapCat 兼容插件：配置表单描述 + config.json 读写 ----
router.get('/plugins/:id/napcat-schema', (req: Request, res: Response) => {
  try {
    const engine = getPluginEngine();
    res.json({ schema: engine.getNapcatSchema(req.params.id) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/plugins/:id/napcat-config', (req: Request, res: Response) => {
  try {
    const engine = getPluginEngine();
    res.json(engine.getNapcatConfig(req.params.id));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/plugins/:id/napcat-config', (req: Request, res: Response) => {
  try {
    const engine = getPluginEngine();
    const existing = engine.getNapcatConfig(req.params.id);
    const merged = { ...existing, ...(req.body || {}) };
    engine.setNapcatConfig(req.params.id, merged);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
router.get('/plugins/:id/webui/*', (req: Request, res: Response) => {
  const engine = getPluginEngine();
  const sourcePath = engine.getPluginSourcePath(req.params.id);
  if (!sourcePath) {
    res.status(404).json({ error: 'Plugin webui not found' });
    return;
  }
  const subPath = req.params[0] || '';
  const filePath = path.join(sourcePath, 'webui', subPath);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(sourcePath, 'webui'))) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }
  if (!fs.existsSync(resolved)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }
  res.sendFile(resolved);
});

export default router;