import { Router, type Request, type Response } from 'express';
import type { Logger } from '../logger';
import { requireSuperMaster } from '../middleware';
import type { AdminAuth } from '../auth';
import type { BotRegistry } from '../registry';
import { getBot, getBotInstance } from '../../core/bot';
import { querySystemLogs, querySystemLogsCount, deleteSystemLogs, clearSystemLogs, getDb, getConfig, setConfig } from '../../db/index';
import {
  getSwitchStates,
  setSwitchState,
  listScheduleTasks,
  createScheduleTask,
  updateScheduleTask,
  deleteScheduleTask,
  toggleScheduleTask,
} from '../../shared/bot-controls';
import fs from 'fs';
import path from 'path';
import net from 'net';
import { spawn } from 'child_process';
import os from 'os';
import multer from 'multer';

// 部署终端会话当前目录（默认 /var/www/php，面板「部署终端」页面维护，单实例共享）
let terminalCwd = '/var/www/php';

// ================= 服务端更新接收端（AI 发布包一键接收部署，与「更新系统」记录/重启串联） =================
const updateRecDir = (): string => path.resolve(process.cwd(), 'data', 'database', '更新');
// 云端更新配置（update-config.json）候选源：GitHub 主仓 raw 直连 → GitHub 加速镜像 → 8091 备用。
// 后端/面板/群内更新插件统一从这份 json 读「版本/补丁URL/全量URL/镜像/更新内容」。
const DEFAULT_AI_CONFIG_URLS = [
  'https://raw.githubusercontent.com/lzyzyzq/QQgfbot/main/update-config.json',
  'https://raw.gitmirror.com/lzyzyzq/QQgfbot/main/update-config.json',
  'https://8091-6f61dc7363389b7a.monkeycode-ai.online/update-config.json',
];
// 更新配置 JSON 候选地址（去重）：先本机配置 update.config_url（可逗号分隔多个），否则用默认清单
function aiConfigUrls(): string[] {
  const urls: string[] = [];
  const cfg = cfgSafe('update.config_url').split(',').map((s: string) => s.trim()).filter(Boolean);
  for (const u of [...cfg, ...DEFAULT_AI_CONFIG_URLS]) {
    if (u && urls.indexOf(u) < 0) urls.push(u);
  }
  return urls;
}

// getConfig 容错：面板进程已 initDb 正常读取；无 db 上下文（如外部调用接收函数）时返回空，不抛错
export function cfgSafe(key: string): string {
  try { return getConfig(key) || ''; } catch { return ''; }
}

// 解压根目录：优先 config update.receive_root，留空=面板运行目录（服务器部署时通常即 /var/www/php）
const receiverRoot = (): string => path.resolve(cfgSafe('update.receive_root') || process.cwd());

function fmtTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const now = new Date(d.getTime() + (8 * 60 + d.getTimezoneOffset()) * 60000);
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
}

// 追加更新记录 + 更新当前版本（与群内「更新系统」插件/面板「记录本次更新」同一记录文件）
export function appendUpdateRecord(version: string, type: string, content: string, dir?: string): { records: any[]; currentVersion: string } {
  const recDir = dir || updateRecDir();
  if (!fs.existsSync(recDir)) fs.mkdirSync(recDir, { recursive: true });
  const recFile = path.join(recDir, '记录.json');
  const stateFile = path.join(recDir, '状态.json');
  let records: any[] = [];
  if (fs.existsSync(recFile)) {
    const j = JSON.parse(fs.readFileSync(recFile, 'utf-8') || '[]');
    if (Array.isArray(j)) records = j;
  }
  const time = fmtTime(new Date());
  records.push({ type, version, time, content });
  fs.writeFileSync(recFile, JSON.stringify(records, null, 2), 'utf-8');
  fs.writeFileSync(stateFile, JSON.stringify({ version, updatedAt: time }, null, 2), 'utf-8');
  return { records, currentVersion: version };
}

export function runSh(cwd: string, cmd: string, timeoutMs = 30000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    let out = '';
    try {
      const child = spawn('sh', ['-c', cmd], { cwd, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
      const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* noop */ } }, timeoutMs);
      child.stdout!.on('data', (d: Buffer) => {
        out += d.toString();
        if (out.length > 200000) { try { child.kill('SIGKILL'); } catch { /* noop */ } }
      });
      child.stderr!.on('data', (d: Buffer) => { out += d.toString(); });
      child.on('error', (e: Error) => { clearTimeout(timer); resolve({ code: 127, out: out + '\n' + e.message }); });
      child.on('close', (code: number | null) => { clearTimeout(timer); resolve({ code: code ?? -1, out }); });
    } catch (e: any) {
      resolve({ code: 127, out: String((e && e.message) || e) });
    }
  });
}

async function fetchJson(url: string, timeoutMs = 8000): Promise<any> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'qq-bot-update-receiver' } });
    clearTimeout(timer);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function fetchBuffer(url: string, timeoutMs = 180000): Promise<Buffer | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'qq-bot-update-receiver' } });
    if (!r.ok || !r.body) return null;
    const chunks: Buffer[] = [];
    for await (const c of r.body as any) chunks.push(Buffer.from(c));
    if (chunks.length === 0) return null;
    return Buffer.concat(chunks);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 拉取云端更新配置：依次尝试候选 config URL，取第一份可用；解析主源 + mirrors 备用源列表
async function fetchAiConfig(): Promise<any> {
  const urls = aiConfigUrls();
  const errors: string[] = [];
  for (const u of urls) {
    const j = await fetchJson(u);
    if (j && j.ok) {
      const sources: { name: string; patchUrl: string; fullUrl: string }[] = [];
      const push = (name: string, patchUrl: any, fullUrl: any) => {
        const p = String(patchUrl || '').trim();
        const f = String(fullUrl || '').trim();
        if (p || f) sources.push({ name, patchUrl: p, fullUrl: f });
      };
      push('主源（GitHub Release）', j.patchUrl, j.fullUrl);
      const mirrors = Array.isArray(j.mirrors) ? j.mirrors : [];
      for (const m of mirrors) {
        if (m) push(String((m as any).name || '备用源'), (m as any).patchUrl, (m as any).fullUrl);
      }
      if (sources.length === 0) { errors.push(u + '：未找到下载地址'); continue; }
      const prim = sources[0];
      return {
        ok: true,
        sourceUrl: u,
        errors,
        version: String(j.version || ''),
        changeLog: String(j.changeLog || ''),
        patchUrl: prim.patchUrl,
        fullUrl: prim.fullUrl,
        sources,
      };
    }
    errors.push(u + '：不可用');
  }
  return { ok: false, sourceUrl: '', errors };
}

export async function receiveUpdatePackage(opts: {
  zipBuffer?: Buffer;
  zipUrl?: string;
  zipUrls?: string[];  // 多候选下载地址：按序尝试，取第一个可下载的源（GitHub 主源失败自动切加速镜像/备用源）
  zipName?: string;
  changeLog?: string;
  root?: string;      // 解压根目录（默认 update.receive_root 或面板运行目录）
  dataDir?: string;   // 更新记录目录（默认 面板运行目录/data/database/更新），测试可隔离
}): Promise<any> {
  const root = opts.root || receiverRoot();
  const recDir = opts.dataDir || updateRecDir();
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  const zipTmp = path.join(os.tmpdir(), `qqbot-recv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.zip`);
  try {
    // 1. 得到 zip 内容（多候选 URL 下载 或 本地上传）
    let data: Buffer | null = null;
    let usedUrl = '';
    const urls: string[] = opts.zipUrls && opts.zipUrls.length ? opts.zipUrls : (opts.zipUrl ? [opts.zipUrl] : []);
    if (urls.length > 0) {
      for (const u of urls) {
        const b = await fetchBuffer(u);
        if (b) { data = b; usedUrl = u; break; }
      }
      if (!data) return { ok: false, step: '下载', error: `下载失败（已尝试 ${urls.length} 个源：${urls.join(' → ')}，均不可访问或超时）` };
    } else if (opts.zipBuffer && opts.zipBuffer.length > 0) {
      data = opts.zipBuffer;
    } else {
      return { ok: false, step: '参数', error: '缺少 zip 文件或下载地址' };
    }
    // zip 魔数校验
    if (data.length < 4 || data[0] !== 0x50 || data[1] !== 0x4b) {
      return { ok: false, step: '校验', error: '不是有效的 ZIP 文件' };
    }
    fs.writeFileSync(zipTmp, data);
    // 文件名：优先取实际下载 URL 的文件名（源/镜像文件名一致），无则用入参
    let zipName = String(opts.zipName || '');
    if ((!zipName || zipName === 'update.zip') && usedUrl) {
      try { zipName = decodeURIComponent(usedUrl.split('?')[0].split('/').pop() || zipName); } catch { /* noop */ }
    }
    // 2. 版本与类型：从文件名提取（如 qqbot-card-editor-patch-4.2.59.zip）
    const m = zipName.match(/(\d+(?:\.\d+){1,3})/);
    const version = m ? m[1] : (cfgSafe('update.version') || '4.2.59');
    const kind = /full|全量/i.test(zipName) ? '全量包' : '补丁包';
    // 3. 压缩包完整性校验
    const t = await runSh(root, `unzip -t ${JSON.stringify(zipTmp)}`);
    if (t.code !== 0) {
      return { ok: false, step: '校验', error: `压缩包校验失败（服务器未安装 unzip 或文件损坏）：\n${t.out.slice(0, 300)}` };
    }
    // 4. 解压到部署根目录（覆盖式，与群内「更新补丁/更新全量」一致）
    const u = await runSh(root, `unzip -o ${JSON.stringify(zipTmp)}`);
    if (u.code !== 0) {
      return { ok: false, step: '解压', error: `解压失败：\n${u.out.slice(0, 300)}` };
    }
    // 5. 记录版本 + 更新内容（写 记录.json / 状态.json，群内「更新记录」与「检查更新」立即可见）
    const content = (opts.changeLog && opts.changeLog.trim()) || cfgSafe('update.changelog') || '';
    const rec = appendUpdateRecord(version, `服务端接收-${kind}`, content || `接收更新包：${zipName}`, recDir);
    // 6. 重启机器人（pm2 restart qqbot；部署根=面板运行目录）
    const restartCwd = opts.root || process.cwd();
    const rcmd = `cd ${JSON.stringify(restartCwd)} && pm2 restart qqbot`;
    const r = await runSh(restartCwd, rcmd, 15000);
    return {
      ok: true,
      kind,
      version,
      fileName: zipName,
      usedUrl,
      root,
      applied: true,
      records: rec.records,
      currentVersion: rec.currentVersion,
      restart: { ok: r.code === 0, output: r.out.slice(0, 300) },
    };
  } finally {
    try { if (fs.existsSync(zipTmp)) fs.unlinkSync(zipTmp); } catch { /* noop */ }
  }
}

// 检测目标端口是否已被其他进程占用（排除服务自身当前端口）
function portInUse(p: number, currentPort: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (p === currentPort) { resolve(false); return; }
    const srv = net.createServer();
    srv.once('error', () => resolve(true));
    srv.once('listening', () => { srv.close(() => resolve(false)); });
    srv.listen(p, '0.0.0.0');
  });
}

interface BotConfig {
  appId?: string;
  clientSecret?: string;
  sandbox?: boolean;
  intents?: number;
}

interface AdminConfig {
  port: number;
}

export function createSystemRoutes(
  logger: Logger,
  botConfig: BotConfig,
  adminConfig: AdminConfig,
  getUpdateLog: () => string,
  saveUpdateLog?: (content: string) => void,
  restartFn?: () => Promise<any>,
  refreshFn?: () => Promise<void>,
  adminAuth?: AdminAuth,
  botRegistry?: BotRegistry,
): Router {
  const router = Router();

  router.get('/logs', (_req: Request, res: Response) => {
    const lines = Number(_req.query.lines) || 200;
    res.json(logger.readLogs(lines));
  });

  router.get('/logs/download', (_req: Request, res: Response) => {
    res.download(logger.getLogPath());
  });

  // 系统日志数据库查询（运行记录）：非超主只能看到自己名下机器人的记录；超主可传 bot_id 过滤
  router.get('/system-logs', (_req: Request, res: Response) => {
    const limit = Number(_req.query.limit) || 100;
    const category = _req.query.category as string | undefined;
    const level = _req.query.level as string | undefined;
    const botId = (_req.query.bot_id as string) || '';
    const user = (_req as any).adminUser as { username?: string; role?: string } | undefined;
    let botIds: string[] | undefined;
    if (botId) {
      botIds = [botId];
    } else if (user && user.role !== 'super_master' && botRegistry) {
      botIds = botRegistry.list(user.username).map((b: any) => b.id);
    }
    const logs = querySystemLogs(limit, category, level, botIds);
    const total = querySystemLogsCount(category, level, botIds);
    res.json({ logs, total, filtered: !!botIds });
  });

  // 删除运行记录：body {ids:[...]} 批量删除；?all=1 或 body {all:true} 清空全部
  router.delete('/system-logs', requireSuperMaster, (req: Request, res: Response) => {
    try {
      const ids = req.body?.ids;
      if (Array.isArray(ids)) {
        const deleted = deleteSystemLogs(ids.map(Number));
        res.json({ ok: true, deleted });
        return;
      }
      if (req.query.all === '1' || req.body?.all) {
        const deleted = clearSystemLogs();
        res.json({ ok: true, deleted });
        return;
      }
      res.status(400).json({ error: '缺少 ids 或 all 参数' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/updatelog', (_req: Request, res: Response) => {
    res.json({ content: getUpdateLog() });
  });

  router.put('/updatelog', requireSuperMaster, (req: Request, res: Response) => {
    const content = req.body?.content;
    if (typeof content !== 'string') {
      res.status(400).json({ error: '缺少 content 字段' });
      return;
    }
    if (!saveUpdateLog) {
      res.status(500).json({ error: '更新日志保存能力不可用' });
      return;
    }
    try {
      saveUpdateLog(content);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 面板授权码登录开关状态（免鉴权，供登录页显示/隐藏授权码登录入口）
  router.get('/panel-login-status', (_req: Request, res: Response) => {
    res.json({ enabled: (getConfig('panel.auth_code_login') || '1') === '1' });
  });

  router.get('/config', (req: Request, res: Response) => {
    res.json({
      appId: botConfig.appId,
      clientSecret: '******',
      sandbox: botConfig.sandbox,
      intents: botConfig.intents,
      adminPort: adminConfig.port,
      serverPort: getConfig('server.port') || String(adminConfig.port),
      panelHost: getConfig('panel.host') || '',
      authCodePanelLogin: (getConfig('panel.auth_code_login') || '1') === '1',
      licenseAutoShutdown: (getConfig('license.auto_shutdown') || '1') === '1',
      botName: getConfig('bot.name') || '',
      chimeTexts: getConfig('bot.chime_texts') || '',
      chimeCity: getConfig('bot.chime_city') || '北京',
      chimeAd: getConfig('bot.chime_ad') || '',
      footerText: getConfig('bot.footer_text') || '',
      footerAds: getConfig('bot.footer_ads') || '',
      qqLoginToken: getConfig('qqlogin.token') || '',
      updateVersion: getConfig('update.version') || '4.2.59',
      updatePatchUrl: getConfig('update.patch_url') || 'https://8091-6f61dc7363389b7a.monkeycode-ai.online/qqbot-card-editor-patch-4.2.59.zip',
      updateFullUrl: getConfig('update.full_url') || 'https://8091-6f61dc7363389b7a.monkeycode-ai.online/qqbot-card-editor-4.2.59-full.zip',
      updateChangeLog: getConfig('update.changelog') || '',
      updateConfigUrl: getConfig('update.config_url') || '',
    });
  });

  router.put('/config', requireSuperMaster, async (req: Request, res: Response) => {
    if (req.body.appId) { botConfig.appId = req.body.appId; setConfig('bot.app_id', req.body.appId); }
    if (req.body.clientSecret && req.body.clientSecret !== '******') {
      botConfig.clientSecret = req.body.clientSecret;
      setConfig('bot.app_secret', req.body.clientSecret);
      try { getBot().updateSecret(req.body.clientSecret); } catch (e: any) {}
    }
    if (req.body.sandbox !== undefined) botConfig.sandbox = req.body.sandbox;
    if (req.body.intents) botConfig.intents = req.body.intents;
    if (req.body.port !== undefined) {
      const p = parseInt(String(req.body.port), 10);
      if (p > 0 && p <= 65535) {
        // 目标端口已被其他进程（如 nginx/tailscale 的 6655）占用时拒绝保存，避免重启后 502
        if (await portInUse(p, adminConfig.port)) {
          res.status(409).json({ error: `端口 ${p} 已被其他进程占用（可能是 nginx/访问端口）。请改为内部服务端口（如 3000/3100），不要填访问端口 6655` });
          return;
        }
        setConfig('server.port', String(p));
      }
    }
    if (req.body.authCodePanelLogin !== undefined) setConfig('panel.auth_code_login', req.body.authCodePanelLogin ? '1' : '0');
    if (req.body.panelHost !== undefined) setConfig('panel.host', String(req.body.panelHost).trim());
    if (req.body.licenseAutoShutdown !== undefined) setConfig('license.auto_shutdown', req.body.licenseAutoShutdown ? '1' : '0');
    if (req.body.botName !== undefined) setConfig('bot.name', String(req.body.botName).trim());
    if (req.body.chimeTexts !== undefined) setConfig('bot.chime_texts', String(req.body.chimeTexts));
    if (req.body.chimeCity !== undefined) setConfig('bot.chime_city', String(req.body.chimeCity).trim() || '北京');
    if (req.body.chimeAd !== undefined) setConfig('bot.chime_ad', String(req.body.chimeAd));
    if (req.body.footerText !== undefined) setConfig('bot.footer_text', String(req.body.footerText));
    if (req.body.footerAds !== undefined) setConfig('bot.footer_ads', String(req.body.footerAds));
    if (req.body.qqLoginToken !== undefined) setConfig('qqlogin.token', String(req.body.qqLoginToken).trim());
    if (req.body.updateVersion !== undefined) setConfig('update.version', String(req.body.updateVersion).trim() || '4.2.59');
    if (req.body.updatePatchUrl !== undefined) setConfig('update.patch_url', String(req.body.updatePatchUrl).trim());
    if (req.body.updateFullUrl !== undefined) setConfig('update.full_url', String(req.body.updateFullUrl).trim());
    if (req.body.updateChangeLog !== undefined) setConfig('update.changelog', String(req.body.updateChangeLog));
    if (req.body.updateConfigUrl !== undefined) setConfig('update.config_url', String(req.body.updateConfigUrl).trim());
    res.json({ ok: true });
  });

  // 更新系统：读取更新记录列表 + 当前部署版本 + 记录文件路径
  router.get('/update-records', (_req: Request, res: Response) => {
    try {
      const dir = path.resolve(process.cwd(), 'data', 'database', '更新');
      const recFile = path.join(dir, '记录.json');
      const stateFile = path.join(dir, '状态.json');
      let records: any[] = [];
      if (fs.existsSync(recFile)) {
        const j = JSON.parse(fs.readFileSync(recFile, 'utf-8') || '[]');
        if (Array.isArray(j)) records = j;
      }
      let currentVersion = '';
      if (fs.existsSync(stateFile)) {
        const s = JSON.parse(fs.readFileSync(stateFile, 'utf-8') || '{}');
        currentVersion = String(s.version || '');
      }
      res.json({ ok: true, records, currentVersion, recordFile: recFile });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 更新系统：手动补记本次更新（用于手动部署后把版本写入升级列表与当前版本）
  router.post('/record-update', requireSuperMaster, (_req: Request, res: Response) => {
    try {
      const version = (getConfig('update.version') || '4.2.59').trim();
      const changelog = getConfig('update.changelog') || '';
      const rec = appendUpdateRecord(version, '手动记录', changelog);
      res.json({ ok: true, records: rec.records, currentVersion: version });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.post('/refresh', async (_req: Request, res: Response) => {
    try {
      if (refreshFn) {
        await refreshFn();
        res.json({ ok: true, message: 'Bot refreshed' });
      } else {
        res.status(400).json({ error: 'Refresh not supported' });
      }
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/restart', requireSuperMaster, async (_req: Request, res: Response) => {
    try {
      if (!restartFn) {
        res.status(400).json({ error: 'Restart not supported' });
        return;
      }
      const r: any = await restartFn();
      if (r && r.ok === false) {
        res.status(500).json({ ok: false, error: (r.err || '远程重启失败').slice(0, 300) });
        return;
      }
      res.json({ ok: true, message: '重启命令已执行', detail: r || {} });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // 部署终端：面板内嵌的命令终端，会话 cwd 默认 /var/www/php（部署根目录），
  // 支持 cd 切换目录（会话内持久），其余命令在会话 cwd 下用 sh -c 执行。
  // 仅超级主人可调用（配合 admin token），与面板公网访问（6655 反代）兼容。
  router.post('/terminal/exec', requireSuperMaster, async (req: Request, res: Response) => {
    const cmd = String((req.body && req.body.command) || '').trim();
    const home = os.homedir() || '/root';
    const resolveDir = (raw: string): string => {
      let t = String(raw).trim().replace(/^['"]|['"]$/g, '');
      if (!t) return terminalCwd;
      if (t === '~') t = home;
      else if (t.startsWith('~/')) t = path.join(home, t.slice(2));
      return path.resolve(terminalCwd, t);
    };
    try {
      if (!cmd) {
        res.json({ ok: true, cwd: terminalCwd, output: '', code: 0 });
        return;
      }
      // 纯 cd 命令：切换会话目录（cd / cd ~ / cd <dir>）
      const cdMatch = cmd.match(/^cd(\s+\S.*)?$/);
      if (cdMatch) {
        const target = (cdMatch[1] || '').trim() || terminalCwd;
        const resolved = resolveDir(target);
        if (!fs.existsSync(resolved)) {
          res.json({ ok: true, cwd: terminalCwd, output: `cd: 无此目录：${target}`, code: 1 });
          return;
        }
        const st = fs.statSync(resolved);
        if (!st.isDirectory()) {
          res.json({ ok: true, cwd: terminalCwd, output: `cd: 不是目录：${target}`, code: 1 });
          return;
        }
        terminalCwd = resolved;
        res.json({ ok: true, cwd: terminalCwd, output: '', code: 0 });
        return;
      }
      const timeout = Math.min(parseInt(String((req.body && req.body.timeout) || '30000'), 10) || 30000, 120000);
      const child = spawn('sh', ['-c', cmd], {
        cwd: terminalCwd,
        env: { ...process.env, TERM: 'xterm', HOME: home },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      let err = '';
      child.stdout!.on('data', (d: Buffer) => {
        out += d.toString();
        if (out.length > 300000) { try { child.kill('SIGKILL'); } catch {} }
      });
      child.stderr!.on('data', (d: Buffer) => { err += d.toString(); });
      const timer = setTimeout(() => {
        try { child.kill('SIGTERM'); } catch {}
        setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 2000);
      }, timeout);
      child.on('error', (e: Error) => {
        clearTimeout(timer);
        res.json({ ok: true, cwd: terminalCwd, output: ((out + err).trim() ? (out + '\n' + err).trim() : '') + `\n[错误] ${e.message}`, code: 127 });
      });
      child.on('close', (code: number | null) => {
        clearTimeout(timer);
        res.json({ ok: true, cwd: terminalCwd, output: (out + err).trim() || '(无输出)', code: code == null ? -1 : code });
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e && e.message || e) });
    }
  });

  // 部署终端「拉取 GitHub 项目」：将会话目录源码与远程 Git 仓库强制同步（覆盖本地未提交改动，
  // 忽略文件如 data/node_modules/dist 不受影响）。mode: pull 仅拉取 / build +npm安装构建 / restart +pm2重启
  router.post('/git-pull', requireSuperMaster, async (req: Request, res: Response) => {
    const repo = String((req.body && req.body.repo) || '').trim() || 'https://github.com/lzyzyzq/QQgfbot.git';
    const branch = String((req.body && req.body.branch) || '').trim() || 'main';
    const mode = String((req.body && req.body.mode) || '').trim() || 'pull';
    if (!/^[A-Za-z0-9@._:\/~+-]+$/.test(repo)) {
      res.json({ ok: true, code: 2, output: '仓库地址不合法（仅支持 http(s)/git@/ssh:// 字符）' });
      return;
    }
    if (!/^[A-Za-z0-9_.\/-]+$/.test(branch)) {
      res.json({ ok: true, code: 2, output: '分支名不合法' });
      return;
    }
    try {
      const cwd = terminalCwd;
      if (!fs.existsSync(cwd)) fs.mkdirSync(cwd, { recursive: true });
      const sd = `git -c safe.directory=${JSON.stringify(cwd)}`;
      const qRepo = JSON.stringify(repo);
      const qBranch = JSON.stringify(branch);
      const steps: string[] = [];
      steps.push(`set +e`);
      steps.push(`echo "=== 目标目录: ${JSON.stringify(cwd)} ==="`);
      steps.push(`if ! ${sd} rev-parse --git-dir >/dev/null 2>&1; then echo "=== 目录尚无 git，正在初始化 ==="; git init -q; fi`);
      steps.push(`if [ "$(${sd} remote get-url origin 2>/dev/null)" != ${qRepo} ]; then ${sd} remote set-url origin ${qRepo} 2>/dev/null || ${sd} remote add origin ${qRepo}; echo "=== 远端已指向 ${qRepo} ==="; fi`);
      steps.push(`${sd} fetch --depth=1 origin ${qBranch}`);
      steps.push(`${sd} reset --hard origin/${qBranch}`);
      steps.push(`echo "=== 已同步到分支 ${qBranch} 最新提交 ==="`);
      steps.push(`${sd} log -1 --format="commit: %h%n%s%n同步时间: %ci"`);
      if (mode === 'build' || mode === 'restart') {
        steps.push(`if [ -f package.json ]; then`);
        steps.push(`  echo "=== 安装依赖（npm ci / npm install）===";`);
        steps.push(`  if [ -f package-lock.json ]; then npm ci --no-audit --no-fund 2>&1 | tail -4; else npm install --no-audit --no-fund 2>&1 | tail -4; fi`);
        steps.push(`  echo "=== 编译（tsc → dist）===";`);
        steps.push(`  npm run build 2>&1 | tail -20`);
        steps.push(`  echo "=== 精简生产依赖 ===";`);
        steps.push(`  npm prune --omit=dev 2>&1 | tail -3`);
        steps.push(`else`);
        steps.push(`  echo "（当前目录不是 qqbot 源码根，跳过安装/构建）";`);
        steps.push(`fi`);
      }
      if (mode === 'restart') {
        steps.push(`echo "=== pm2 restart qqbot ===";`);
        steps.push(`cd ${JSON.stringify(cwd)} && (pm2 restart qqbot 2>&1 || echo "pm2 qqbot 不存在/不可用，请手动重启")`);
      }
      steps.push(`echo "=== 完成（退出码 $?）==="`);
      const timeout = mode === 'pull' ? 180000 : 600000;
      const r = await runSh(cwd, steps.join('\n'), timeout);
      res.json({ ok: true, code: r.code, output: r.out || '(无输出)' });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e && e.message || e) });
    }
  });

  router.get('/stats', (_req: Request, res: Response) => {
    const mem = process.memoryUsage();

    // 统计插件数量：与插件列表页一致，按 plugins 目录实际可展示插件去重计数
    // （避免历史 DB 遗留重复记录（uuid code + file- 双实例）导致统计虚高、本地/服务器数量对不上）
    let pluginCount = 0;
    try {
      const pluginsDir = path.resolve(process.cwd(), 'plugins');
      if (fs.existsSync(pluginsDir)) {
        const names = new Set<string>();
        for (const name of fs.readdirSync(pluginsDir)) {
          if (name === '.tmp' || name.startsWith('.')) continue;
          const full = path.join(pluginsDir, name);
          let stat: fs.Stats | null = null;
          try { stat = fs.statSync(full); } catch { continue; }
          if (stat.isDirectory()) {
            const hasEntry = fs.existsSync(path.join(full, 'index.js')) ||
              fs.existsSync(path.join(full, 'index.mjs')) ||
              fs.existsSync(path.join(full, 'index.ts')) ||
              fs.existsSync(path.join(full, 'src', 'index.ts'));
            const hasManifest = fs.existsSync(path.join(full, 'plugin.json'));
            if (!hasEntry && !hasManifest) continue;
            names.add(name);
          } else {
            const ext = path.extname(name).toLowerCase();
            if (!ext || ext === '.zip' || ext === '.txt' || ext === '.md') continue;
            names.add(name);
          }
        }
        pluginCount = names.size;
      }
    } catch (e) {}

    // 读取 NapCatQQ 版本
    let napcatVersion = '';
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'external', 'NapCatQQ', 'package.json'), 'utf-8'));
      napcatVersion = pkg.version || '';
    } catch (e) {}

    res.json({
      uptime: process.uptime(),
      memory: {
        rss: Math.round(mem.rss / 1024 / 1024),
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      },
      nodeVersion: process.version,
      pid: process.pid,
      pluginCount,
      framework: {
        name: 'NapCatQQ',
        version: napcatVersion,
        integrated: true,
      },
      features: [
        '开关机控制', '主菜单路由', '娱乐中心', '实用工具',
        '签到系统', '群管理工具', '授权系统', '系统工具',
        '系统设置', 'DIC管理', '定时推送', '关键词回复',
        '问候插件', '词典回复', '按钮菜单', '整点报时',
        '新人欢迎', '退群提示', '全局模式切换',
      ],
    });
  });

  router.get('/hyperlinks', (_req: Request, res: Response) => {
    res.json({
      official: 'https://q.qq.com',
      docs: 'https://bot.q.qq.com/wiki',
      callback: 'https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/send-receive/msg-send.html',
    });
  });

  router.get('/help', (req: Request, res: Response) => {
    const host = req.get('host') || 'localhost:3000';
    const proto = (req.get('x-forwarded-proto') || req.protocol || 'https');
    const callbackUrl = `${proto}://${host}/qq/webhook`;
    res.json({
      title: 'QQ Bot Framework Help',
      sections: [
        {
          title: '快速开始',
          content: '1. 在 q.qq.com 注册机器人获取 AppID 和 AppSecret\n2. 在管理面板「我的机器人」页面点击「添加机器人」\n3. 填写 AppID、AppSecret 和 Intents\n4. 点击「启动」使机器人上线\n5. 在 QQ 开放平台配置回调地址',
        },
        {
          title: '插件开发文档',
          content: '插件以 zip 包形式打包上传。\n\n## 插件结构\n插件 zip 包内需包含:\n- `plugin.json` - 插件清单文件(必填)\n- `index.js` 或入口文件(必填)\n- `README.md` - 插件文档(可选)\n\n## plugin.json 格式\n{\n  "name": "my-plugin",\n  "version": "1.0.0",\n  "description": "我的插件",\n  "author": "作者名",\n  "main": "index.js",\n  "match": ["AT_MESSAGE_CREATE", "GROUP_MESSAGE_CREATE"]\n}\n\n## 入口文件示例 (index.js)\n`module.exports = function(ctx, next) {`\n`  if (ctx.event.content === "/hello") {`\n`    ctx.bot.messages.sendChannelMessage(ctx.event.channel_id, {`\n`      content: "Hello World!",`\n`      msg_id: ctx.event.id`\n`    });`\n`    return;`\n`  }`\n`  next();`\n`};`\n\n## 可用的 ctx 对象\nctx.bot - Bot 实例 (所有 API)\nctx.eventType - 事件类型\nctx.event - 事件数据\nctx.state - 跨中间件共享状态',
        },
        {
          title: '插件审核流程',
          content: '1. 普通用户上传插件后，状态为「待审核」\n2. 超级管理员在插件管理页面查看待审核插件\n3. 超级管理员可「批准」或「拒绝」插件\n4. 审核时可填写拒绝原因\n5. 只有「已批准」的插件会被加载执行\n6. 超级管理员上传的插件自动通过审核',
        },
        {
          title: '回调地址说明',
          content: `回调地址: ${callbackUrl}\n平台将在收到事件时 POST 到该地址。\n详细说明见官方文档: https://bot.q.qq.com/wiki`,
        },
        {
          title: '授权码说明',
          content: '授权码分为超级主人和主人角色。\n超级主人拥有全部权限（设置、用户管理、插件审核、机器人管理等）。\n主人拥有基本操作权限（添加管理自己机器人等），权限可由超级管理员配置。\n授权码可设置过期时间，过期后自动注销。',
        },
      ],
    });
  });

  // 功能开关：读取（登录用户） / 设置（超级主人），与插件共用 config 表同一状态
  router.get('/switches', (_req: Request, res: Response) => {
    res.json({ switches: getSwitchStates() });
  });

  router.put('/switches', requireSuperMaster, (req: Request, res: Response) => {
    const { key, enabled } = req.body || {};
    if (!key || typeof enabled !== 'boolean') { res.json({ ok: false, error: '需要 key 与布尔 enabled' }); return; }
    const s = setSwitchState(String(key), enabled);
    if (!s) { res.json({ ok: false, error: '未知开关：' + key }); return; }
    res.json({ ok: true, switch: s });
  });

  // 定时任务：读取（登录用户） / 管理（超级主人）
  router.get('/schedule-tasks', (_req: Request, res: Response) => {
    res.json({ tasks: listScheduleTasks() });
  });

  router.post('/schedule-tasks', requireSuperMaster, (req: Request, res: Response) => {
    const r = createScheduleTask(req.body || {});
    if (!r.ok) { res.json({ ok: false, error: r.error }); return; }
    res.json({ ok: true, task: r.task });
  });

  router.put('/schedule-tasks', requireSuperMaster, (req: Request, res: Response) => {
    const r = updateScheduleTask(req.body || {});
    if (!r.ok) { res.json({ ok: false, error: r.error }); return; }
    res.json({ ok: true, task: r.task });
  });

  router.delete('/schedule-tasks', requireSuperMaster, (req: Request, res: Response) => {
    const id = String(req.query.id || '');
    if (!id) { res.json({ ok: false, error: '缺少 id' }); return; }
    const r = deleteScheduleTask(id);
    res.json({ ok: r.ok });
  });

  router.post('/schedule-tasks/toggle', requireSuperMaster, (req: Request, res: Response) => {
    const id = String((req.body || {}).id || '');
    if (!id) { res.json({ ok: false, error: '缺少 id' }); return; }
    const r = toggleScheduleTask(id);
    if (!r.ok) { res.json({ ok: false, error: r.error }); return; }
    res.json({ ok: true, task: r.task });
  });

  // 机器人互动用户列表（user_mappings：头像/QQ/昵称/OpenID）
  router.get('/users', (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const rows = db.prepare(
        "SELECT openid, qq_number, nickname, bot_id, last_updated FROM user_mappings ORDER BY last_updated DESC LIMIT 1000"
      ).all() as any[];
      res.json({ users: rows });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 反馈提交列表（插件"反馈"命令提交，面板只读）；超主可传 bot_id 过滤
  router.get('/feedbacks', (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const botId = (_req.query.bot_id as string) || '';
      const rows = botId
        ? db.prepare("SELECT * FROM feedbacks WHERE bot_id = ? ORDER BY created_at DESC LIMIT 500").all(botId)
        : db.prepare("SELECT * FROM feedbacks ORDER BY created_at DESC LIMIT 500").all();
      res.json({ feedbacks: rows });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 反馈回复：发私聊给反馈提交者 + 更新状态（面板直接回复）
  router.post('/feedbacks/:id/reply', requireSuperMaster, async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id || '');
      const reply = String((req.body || {}).reply || '').trim();
      if (!id || !reply) { res.json({ ok: false, error: '缺少 id 或回复内容' }); return; }
      const db = getDb();
      const f = db.prepare('SELECT * FROM feedbacks WHERE id = ?').get(id) as any;
      if (!f) { res.json({ ok: false, error: '反馈不存在：' + id }); return; }
      const botId = String(f.bot_id || '');
      let bot: any;
      try { bot = botId ? getBotInstance(botId) || getBot() : getBot(); } catch { bot = null; }
      if (!bot) { res.json({ ok: false, error: '机器人未初始化，无法发送回复' }); return; }
      const openid = String(f.user_openid || '');
      if (!openid) { res.json({ ok: false, error: '反馈提交者无 OpenID，无法私聊回复' }); return; }
      const sent = await bot.sendPrivateMessage(openid, '📩 反馈回复\n━━━━━━━━━━━━━━\n你的反馈：' + String(f.content || '') + '\n━━━━━━━━━━━━━━\n机器人的回复：\n' + reply + '\n━━━━━━━━━━━━━━\nPHP · QQ机器人平台');
      if (!sent) { res.json({ ok: false, error: '机器人私聊发送失败（OpenID: ' + openid.slice(0, 12) + '...）' }); return; }
      db.prepare("UPDATE feedbacks SET reply = ?, status = 'replied', replied_at = datetime('now', 'localtime') WHERE id = ?").run(reply, id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 反馈状态更新（pending → done）
  router.put('/feedbacks/:id', requireSuperMaster, (req: Request, res: Response) => {
    try {
      const id = String(req.params.id || '');
      const status = String((req.body || {}).status || 'done');
      const db = getDb();
      db.prepare('UPDATE feedbacks SET status = ? WHERE id = ?').run(status, id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 删除反馈
  router.delete('/feedbacks/:id', requireSuperMaster, (req: Request, res: Response) => {
    try {
      const id = String(req.params.id || '');
      const db = getDb();
      db.prepare('DELETE FROM feedbacks WHERE id = ?').run(id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 群列表（用户管理/成员同步：群OpenID、群名、群号、群头像、成员数）；超主可传 bot_id 过滤
  router.get('/groups', (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const botId = (_req.query.bot_id as string) || '';
      const rows = (botId
        ? db.prepare('SELECT * FROM groups WHERE bot_id = ? ORDER BY last_active DESC LIMIT 1000').all(botId)
        : db.prepare('SELECT * FROM groups ORDER BY last_active DESC LIMIT 1000').all()) as any[];
      for (const g of rows) {
        try {
          const c = db.prepare('SELECT COUNT(*) AS c FROM group_members WHERE group_id = ?').get(g.id) as any;
          g.member_count = c?.c || 0;
        } catch { g.member_count = g.member_count || 0; }
      }
      res.json({ groups: rows });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 修改群：群名 / 群号（群号变更自动生成群头像）
  router.put('/groups/:id', requireSuperMaster, (req: Request, res: Response) => {
    try {
      const id = String(req.params.id || '');
      const body = req.body || {};
      const db = getDb();
      const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(id) as any;
      if (!g) { res.json({ ok: false, error: '群不存在：' + id }); return; }
      const next = { name: g.name, group_number: g.group_number, avatar: g.avatar };
      if (body.name !== undefined) next.name = String(body.name).trim();
      if (body.group_number !== undefined) {
        next.group_number = String(body.group_number).trim();
        if (/^\d{6,15}$/.test(next.group_number)) next.avatar = `https://p.qlogo.cn/gh/${next.group_number}/${next.group_number}/0`;
      }
      if (body.avatar !== undefined && body.avatar !== '') next.avatar = String(body.avatar).trim();
      db.prepare('UPDATE groups SET name = ?, group_number = ?, avatar = ? WHERE id = ?').run(next.name, next.group_number, next.avatar, id);
      res.json({ ok: true, group: { ...next, id } });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 删除群（连带删除该群群成员记录）
  router.delete('/groups/:id', requireSuperMaster, (req: Request, res: Response) => {
    try {
      const id = String(req.params.id || '');
      const db = getDb();
      db.prepare('DELETE FROM groups WHERE id = ?').run(id);
      db.prepare('DELETE FROM group_members WHERE group_id = ?').run(id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 群+成员合并数据（用户管理页：按群组织，含群头像/群号/群OpenID/群名 与成员 QQ/昵称/授权码/权限）
  router.get('/user-groups', (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const groups = db.prepare('SELECT * FROM groups ORDER BY last_active DESC LIMIT 1000').all() as any[];
      const out: any[] = [];
      for (const g of groups) {
        const members = db.prepare('SELECT member_openid, qq_id, nickname, bot_id, first_seen, last_seen FROM group_members WHERE group_id = ? ORDER BY last_seen DESC').all(g.id) as any[];
        const arr = members.map((m: any) => {
          let qq = (m.qq_id && /^\d{5,12}$/.test(m.qq_id)) ? m.qq_id : '';
          let nick = m.nickname || '';
          let umBotId = m.bot_id || '';
          try {
            const um = db.prepare('SELECT qq_number, nickname, bot_id FROM user_mappings WHERE openid = ?').get(m.member_openid) as any;
            if (um) {
              if (!qq) qq = um.qq_number || '';
              if (!nick) nick = um.nickname || '';
              if (!umBotId) umBotId = um.bot_id || '';
            }
          } catch {}
          return {
            openid: m.member_openid,
            qq_number: qq,
            nickname: nick,
            source: qq ? (m.qq_id ? 'mapped' : 'interact') : 'none',
            bot_id: umBotId,
          };
        });
        out.push({ ...g, members: arr });
      }
      let orphanUsers: any[] = [];
      try {
        orphanUsers = db.prepare(
          "SELECT um.openid, um.qq_number, um.nickname, um.bot_id FROM user_mappings um WHERE NOT EXISTS (SELECT 1 FROM group_members gm WHERE gm.member_openid = um.openid) ORDER BY um.last_updated DESC LIMIT 200"
        ).all() as any[];
      } catch {}
      res.json({ groups: out, orphanUsers });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 服务端接收端：接收端信息（部署根/当前版本/AI 端最新配置），供前端「服务端接收」区块展示
  router.get('/update-receive/info', requireSuperMaster, async (_req: Request, res: Response) => {
    try {
      const root = receiverRoot();
      const dir = updateRecDir();
      let currentVersion = '';
      if (fs.existsSync(path.join(dir, '状态.json'))) {
        const s = JSON.parse(fs.readFileSync(path.join(dir, '状态.json'), 'utf-8') || '{}');
        currentVersion = String(s.version || '');
      }
      const ai = await fetchAiConfig();
      res.json({
        ok: true,
        rootDir: root,
        panelDir: process.cwd(),
        currentVersion,
        recordFile: path.join(dir, '记录.json'),
        aiUrls: aiConfigUrls(),
        ai,
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  const receiverUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 400 * 1024 * 1024 } });
  // 服务端接收：一键接收并部署更新包
  //  - multipart file=本地上传 zip
  //  - body.url=手动指定远程 zip 直链（单源）
  //  - body.kind=patch|full（无 url/file 时）：从云端 update-config 自动取全部候选源，
  //    GitHub Release 主源失败自动切换加速镜像/备用源，直到下载成功
  // 与群内「更新系统」插件串联：同一记录文件 + 当前版本 + 覆盖式解压 + pm2 restart qqbot
  router.post('/update-receive', requireSuperMaster, receiverUpload.single('file'), async (req: Request, res: Response) => {
    try {
      const file = (req as any).file as { buffer: Buffer; originalname: string } | undefined;
      const bodyUrl = String((req.body && req.body.url) || '').trim();
      if (file && !bodyUrl) {
        const result = await receiveUpdatePackage({ zipBuffer: file.buffer, zipName: file.originalname || 'update.zip' });
        res.json(result);
        return;
      }
      if (bodyUrl) {
        if (!/^https?:\/\//i.test(bodyUrl)) {
          res.json({ ok: false, step: '参数', error: '下载地址需为 http/https 链接' });
          return;
        }
        const zipName = decodeURIComponent(bodyUrl.split('?')[0].split('/').pop() || 'update.zip');
        const ai = await fetchAiConfig();
        const result = await receiveUpdatePackage({ zipUrl: bodyUrl, zipName, changeLog: ai && ai.ok ? ai.changeLog : '' });
        res.json(result);
        return;
      }
      const kindRaw = String((req.body && req.body.kind) || '').toLowerCase();
      const isFull = kindRaw === 'full' || /full|全量/.test(kindRaw);
      if (kindRaw) {
        const ai = await fetchAiConfig();
        if (!ai || !ai.ok || !ai.sources.length) {
          const errs = (ai && ai.errors && ai.errors.length ? ai.errors : []).join('；');
          res.json({ ok: false, step: '配置', error: `无法拉取云端更新配置${errs ? '（' + errs + '）' : ''}。请在「更新系统配置」填好下载地址或检查网络。` });
          return;
        }
        const urls = ai.sources.map((s: any) => (isFull ? s.fullUrl : s.patchUrl)).filter(Boolean);
        if (urls.length === 0) {
          res.json({ ok: false, step: '配置', error: `云端更新配置中未找到${isFull ? '全量包' : '补丁包'}下载地址` });
          return;
        }
        const result = await receiveUpdatePackage({ zipUrls: urls, zipName: '', changeLog: ai.changeLog });
        res.json(result);
        return;
      }
      res.json({ ok: false, step: '参数', error: '请提供 zip 文件、下载地址（url）或更新类型（kind=patch/full）' });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}