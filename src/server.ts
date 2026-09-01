import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import zlib from 'zlib';

// ===== 管理面板 imports =====
import { AdminAuth } from './admin/auth';
import { Logger } from './admin/logger';
import { BotRegistry } from './admin/registry';
import { BotManager } from './admin/manager';
import { authMiddleware } from './admin/middleware';
import { createAuthRoutes } from './admin/routes/auth';
import { createPluginRoutes } from './admin/routes/plugin';
import { createFileRoutes } from './admin/routes/file';
import { createSystemRoutes } from './admin/routes/system';
import { createBotRoutes } from './admin/routes/bot';
import { createNapcatRoutes } from './admin/routes/napcat';
import editorRoutes from './admin/routes/editor';
import type { AdminConfig } from './admin/config';

// ===== 业务 API imports =====
import { initDb, closeDb, getConfig, setConfig, getDb } from './db/index';
import { seedExamplePlugins } from './db/seed';
import { EventBus, initAssignmentCache } from './core/event-bus';
import { startScheduleRunner } from './core/schedule-runner';
import { createBot, getBot, registerBot, runWithBotContext, currentBotId, getBotInstance, alsBotId } from './core/bot';
import { WebhookManager } from './core/webhook';
import { PluginEngine } from './plugin/engine';
import { setPluginEngine } from './api/index';
import { startLicenseWatchdog } from './shared/license-watchdog';
import authRoutes from './api/auth';
import botRoutes from './api/bot';
import pluginRoutes from './api/plugin';
import logRoutes from './api/log';
import authCodesRoutes from './api/auth-codes';
import botAuthCodesRoutes from './api/bot-auth-codes';
import botSystemRoutes, { syncPermConfig } from './api/bot-system';
import timeOffsetRoutes from './api/time-offset';
import filesRoutes from './api/files';
import groupsRoutes from './api/groups';
import menuConfigRoutes from './api/menu-config';
import { createLogger } from './utils/logger';
import { verifyClickPayload } from './utils/click-sign';
import { spawn } from 'child_process';

const serverLogger = createLogger('server');
const DATA_DIR = path.resolve('data');
const PLUGINS_DIR = path.resolve('plugins');

let eventBus: EventBus;
let webhookManager: WebhookManager;
let webhookManagers = new Map<string, WebhookManager>();
let pluginEngine: PluginEngine;
let botRegistryRef: BotRegistry | null = null;

export function getWebhookManager(): WebhookManager { return webhookManager; }
export function resetWebhookManager(): void { webhookManager = undefined as any; }

// 按 AppID 获取（或创建）WebhookManager：每个机器人用各自 AppSecret 派生密钥验签
// Secret 变更后缓存自动失效重建（避免修改机器人 Secret 后仍用旧密钥验签导致回调校验失败）
export function getWebhookManagerFor(appId: string): WebhookManager | undefined {
  if (!appId) return undefined;
  let secret = '';
  // 主机器人（与 config 一致）允许用 config 中的 Secret；多机器人必须来自 registry 配置
  try {
    const cfgId = String(getConfig('bot.app_id') || '');
    const cfgSecret = String(getConfig('bot.app_secret') || '');
    if (appId === cfgId && cfgSecret) secret = cfgSecret;
  } catch {}
  if (botRegistryRef) {
    const entry = botRegistryRef.list().find((b) => b.appId === appId);
    if (entry?.clientSecret) secret = entry.clientSecret;
  }
  if (!secret) return undefined;
  const cached = webhookManagers.get(appId);
  if (cached && cached.secret === secret) return cached;
  const m = new WebhookManager(eventBus, appId, secret);
  webhookManagers.set(appId, m);
  return m;
}

export function clearWebhookManagerPool(): void {
  webhookManagers.clear();
  webhookManager = undefined as any;
}

// 确保某 AppID 的 BotCore 已注册并已获取 access_token（用于消息发送）。
// 只有拿到该 AppID 自己的 Secret 才注册核心；否则不注册，让 getBot() 回退到默认 BotCore，
// 避免用默认 Secret 顶替其他机器人导致 AccessToken 无效(40011027) 401。
function ensureBotInstance(appId: string): void {
  try {
    if (getBotInstance(appId)) return;
    let secret = '';
    if (botRegistryRef) {
      const entry = botRegistryRef.list().find((b) => b.appId === appId);
      if (entry?.clientSecret) secret = entry.clientSecret;
    }
    if (!secret) {
      try {
        const defaultAppId = getConfig('bot.app_id') || '';
        if (appId && appId === defaultAppId) secret = String(getConfig('bot.app_secret') || '');
      } catch {}
    }
    if (!secret) return;
    const core = registerBot(eventBus, appId, secret);
    core.start().catch((err: any) => {
      serverLogger.warn(`BotCore ${appId} start failed (仍可接收消息，发送暂不可用): ${err.message}`);
    });
  } catch (err: any) {
    serverLogger.warn(`ensureBotInstance(${appId}) failed: ${err.message}`);
  }
}

const app = express();
function resolveServerPort(): number {
  try {
    const cfg = getConfig('server.port');
    if (cfg) {
      const p = parseInt(String(cfg), 10);
      if (p > 0 && p <= 65535) return p;
    }
  } catch {}
  return process.env.PORT ? parseInt(process.env.PORT) : 3000;
}

// ===== 真实服务器重启 =====
// 通过 spawn 拉起新进程（reusePort 双进程短暂共存），新进程就绪后写标记文件，旧进程读到后退出
const RESTART_MARKER = path.join(process.cwd(), '.restart-ready');
// 单实例锁：防止误启多个 server 实例共享端口导致 token 鉴权错乱
const INSTANCE_LOCK = path.join(process.cwd(), '.server.pid');

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function acquireInstanceLock(): void {
  if (process.env.QBOT_RESTARTING === '1') return;
  try {
    if (fs.existsSync(INSTANCE_LOCK)) {
      const pid = Number(fs.readFileSync(INSTANCE_LOCK, 'utf-8').trim());
      if (pid > 0 && pid !== process.pid && processAlive(pid)) {
        serverLogger.error(`Another server instance (pid ${pid}) is already running. Exiting to avoid shared-port conflicts.`);
        closeDb();
        process.exit(0);
      }
    }
  } catch {}
}

function releaseInstanceLock(): void {
  try {
    if (fs.existsSync(INSTANCE_LOCK) && fs.readFileSync(INSTANCE_LOCK, 'utf-8').trim() === String(process.pid)) {
      fs.unlinkSync(INSTANCE_LOCK);
    }
  } catch {}
}

// 本机服务器重启：面板「重启机器人」「重启服务器」在本机执行 pm2 restart qqbot
// 当前部署环境即 armbian 服务器（/var/www/php，pm2 管理），与终端同一台机器，不再 SSH 远程。
function localRestart(): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    const cwd = '/var/www/php';
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('pm2', ['restart', 'qqbot'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e: any) {
      serverLogger.error(`Local restart spawn failed: ${e && e.message ? e.message : e}`);
      resolve({ ok: false, out: '', err: 'pm2 启动失败（请确认已安装 pm2）' });
      return;
    }
    let out = '';
    let err = '';
    child.stdout!.on('data', (d: Buffer) => { out += d.toString(); });
    child.stderr!.on('data', (d: Buffer) => { err += d.toString(); });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 60000);
    child.on('error', (e: Error) => {
      clearTimeout(timer);
      serverLogger.error(`Local restart spawn error: ${e.message}`);
      resolve({ ok: false, out, err: e.message });
    });
    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      serverLogger.info(`Local restart pm2: exit=${code} ${(out || err).trim().slice(0, 200)}`);
      resolve({ ok: code === 0, out: out.trim(), err: err.trim() });
    });
  });
}


// 保证"文字链接模式"的 [文字](url) 链接生成可用，无需用户手动填写面板对外地址
function autoEnsurePanelHost(req: any): void {
  try {
    if (getConfig('panel.host')) return;
    const host = String(req.get?.('host') || '').trim();
    if (!host) return;
    const isLocal = host.startsWith('localhost') || host.startsWith('127.') ||
      host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('172.') || host.endsWith('.local');
    const proto = isLocal ? 'http://' : 'https://';
    setConfig('panel.host', proto + host);
    serverLogger.info(`panel.host auto-detected from webhook Host: ${proto + host}`);
  } catch (e) { /* 不阻塞主流程 */ }
}

function realRestart(): void {
  try { fs.unlinkSync(RESTART_MARKER); } catch {}
  const entry = path.join(process.cwd(), 'dist', 'server.js');
  let child: ReturnType<typeof spawn> | null = null;
  try {
    child = spawn(process.execPath, [entry], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, QBOT_RESTARTING: '1' },
    });
    child.unref();
  } catch (err: any) {
    serverLogger.error(`Server restart: failed to spawn new process: ${err.message}`);
    return;
  }
  const t0 = Date.now();
  const poll = setInterval(() => {
    if (fs.existsSync(RESTART_MARKER)) {
      clearInterval(poll);
      serverLogger.info('Server restart: new process ready, exiting old process');
      process.exit(0);
    } else if (Date.now() - t0 > 20000) {
      clearInterval(poll);
      serverLogger.error('Server restart: new process did not become ready within 20s, keeping current process');
    }
  }, 500);
}

// ===== 1. QQ OAuth 回调（GET 请求，心月互联重定向） =====
app.get('/qq/webhook', async (req, res) => {
  // QQ 开放平台事件订阅 URL 校验：GET 请求带 X-Signature-Timestamp / X-Signature-Ed25519，
  // 验签通过后需原样回显时间戳，否则校验不通过
  const verifyTs = req.headers['x-signature-timestamp'] as string | undefined;
  const verifySig = req.headers['x-signature-ed25519'] as string | undefined;
  if (verifyTs && verifySig) {
    try {
      autoEnsurePanelHost(req);
      const appId = String(req.headers['x-bot-appid'] || '').trim() || String(req.query.app_id || '').trim() || '';
      let whManager: WebhookManager | undefined;
      if (appId) {
        whManager = getWebhookManagerFor(appId);
        if (!whManager) {
          res.status(503).json({ error: `Webhook not configured for app_id=${appId}` });
          return;
        }
      } else {
        const targetId = getConfig('bot.app_id') || '';
        whManager = getWebhookManagerFor(targetId) || getWebhookManager();
      }
      if (!whManager) {
        res.status(503).json({ error: 'Webhook not configured' });
        return;
      }
      if (!whManager.verifySignature(verifyTs, '', verifySig)) {
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
      res.set('Content-Type', 'text/plain');
      res.send(verifyTs);
      return;
    } catch (err: any) {
      res.status(503).json({ error: 'Webhook not configured: ' + err.message });
      return;
    }
  }
  const code = req.query.code as string;
  if (!code) {
    const host = req.get('host') || '';
    const isLocal = host.startsWith('localhost') || host.startsWith('127.');
    const proto = isLocal ? 'http://' : 'https://';
    res.send('<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QQ登录</title><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0f1419;color:#d9e0e8;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}.box{background:#1a1f2e;padding:40px;border-radius:12px;width:90%;max-width:380px;text-align:center;border:1px solid #2a3040}.box h2{color:#ef4444;margin-bottom:12px}.box p{color:#8892a4;font-size:14px}.box .code{background:#222840;padding:8px 12px;border-radius:6px;font-family:monospace;word-break:break-all;color:#22c55e}</style></head><body><div class="box"><h2>QQ登录失败</h2><p>未收到授权码</p><p>如需使用回调地址模式，请确保心月互联设置的回调地址为：</p><p class="code">' + proto + host + '/qq/webhook</p><p style="margin-top:16px"><strong>建议</strong>：在心月互联清空回调地址设置，让登录后自动跳回管理页面</p><p style="margin-top:12px"><a href="/" style="color:#3b82f6">返回管理面板</a></p></div></body></html>');
    return;
  }
  let nickname = 'QQ用户';
  try {
    const https = require('https');
    const userInfo: any = await new Promise((resolve, reject) => {
      https.get('https://qq.wch666.com/api/get_user_info.php?code=' + encodeURIComponent(code), (resp: any) => {
        let data = '';
        resp.on('data', (chunk: any) => { data += chunk; });
        resp.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); }
        });
      }).on('error', reject);
    });
    if (userInfo.nickname) nickname = userInfo.nickname;
  } catch {}
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QQ登录</title><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0f1419;color:#d9e0e8;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}.box{background:#1a1f2e;padding:40px;border-radius:12px;width:90%;max-width:380px;border:1px solid #2a3040;text-align:center}.box h2{color:#3b82f6;margin-bottom:8px}.box .nickname{color:#3b82f6;font-size:18px;font-weight:700;margin-bottom:4px}.box .sub{color:#8892a4;font-size:13px;margin-bottom:20px}.box input{width:100%;padding:12px;background:#222840;border:1px solid #2a3040;color:#d9e0e8;border-radius:8px;font-size:16px;margin-bottom:12px;box-sizing:border-box}.box button{width:100%;padding:12px;background:linear-gradient(135deg,#12B7F5,#0D8ECC);color:#fff;border:none;border-radius:8px;font-size:15px;cursor:pointer;font-weight:600}.box .err{color:#ef4444;margin-top:12px;font-size:14px;min-height:20px}</style></head><body><div class="box"><h2>QQ授权成功</h2><div class="nickname">${nickname}</div><div class="sub">请输入你的QQ号完成绑定</div><input type="text" id="qqInput" placeholder="输入QQ号"><button onclick="doLogin()">完成登录</button><div class="err" id="errMsg"></div></div><script>const code='${code}';async function doLogin(){const qq=document.getElementById('qqInput').value.trim();if(!qq){document.getElementById('errMsg').textContent='请输入QQ号';return}document.getElementById('errMsg').textContent='验证中...';try{const res=await fetch('/api/auth/qq-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,qq_number:qq})});const data=await res.json();if(data.success){document.getElementById('errMsg').innerHTML='<span style=\\\"color:#22c55e\\\">登录成功！跳转中...</span>';localStorage.setItem('admin_token',data.token);setTimeout(function(){window.location.href='/'},800)}else if(data.needQQ){document.getElementById('errMsg').textContent='请输入QQ号'}else if(data.error&&data.error.includes('未绑定')){document.getElementById('errMsg').textContent=data.error+'，请联系管理员在系统设置中绑定你的QQ号'}else{document.getElementById('errMsg').textContent=data.error||'登录失败'}}catch(e){document.getElementById('errMsg').textContent='网络错误，请重试'}}</script></body></html>`);
});

// ===== 1b. 按 AppID 独立回调链接（GET URL 校验）：/qq/:appId/webhook =====
// 每个机器人可在开放平台配置各自独立的消息 URL，服务端直接按路径 AppID 路由验签
app.get('/qq/:appId/webhook', async (req, res) => {
  const appId = String(req.params.appId || '').trim();
  const verifyTs = req.headers['x-signature-timestamp'] as string | undefined;
  const verifySig = req.headers['x-signature-ed25519'] as string | undefined;
  if (verifyTs && verifySig) {
    try {
      autoEnsurePanelHost(req);
      const whManager = getWebhookManagerFor(appId);
      if (!whManager) {
        res.status(503).json({ error: `Webhook not configured for app_id=${appId}` });
        return;
      }
      if (!whManager.verifySignature(verifyTs, '', verifySig)) {
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
      res.set('Content-Type', 'text/plain');
      res.send(verifyTs);
      return;
    } catch (err: any) {
      res.status(503).json({ error: 'Webhook not configured: ' + err.message });
      return;
    }
  }
  const code = req.query.code as string;
  if (code) {
    res.redirect('/qq/webhook?code=' + encodeURIComponent(code));
    return;
  }
  res.status(400).json({ error: `Expected URL verification request for app_id=${appId}` });
});

// ===== 2. Bot Webhook（POST，必须在 express.json() 之前） =====
// 2a. 统一回调链接：按请求头 X-Bot-Appid 路由到对应机器人（兼容历史配置）
app.post('/qq/webhook', express.raw({ type: '*/*' }), (req, res) => {
  try {
    autoEnsurePanelHost(req);
    // 多机器人：QQ 平台回调请求头 X-Bot-Appid 标识机器人，据此路由到对应机器人的验签密钥；
    // 兼容旧链接 ?app_id=<AppID>；两者都无时回退 config 默认机器人
    const headerAppId = String(req.headers['x-bot-appid'] || '').trim();
    const queryAppId = String(req.query.app_id || '').trim();
    const appId = headerAppId || queryAppId || '';
    const targetId = appId || (getConfig('bot.app_id') || '');
    serverLogger.info(`[webhook] POST app_id=${appId || '(none)'} headerAppId=${headerAppId || '(none)'} queryAppId=${queryAppId || '(none)'} target=${targetId || '(none)'} op=${(() => { try { const p = JSON.parse(String(req.body instanceof Buffer ? req.body.toString('utf8') : req.body || '{}')); return p.op; } catch { return '?'; } })()}`);
    let whManager: WebhookManager | undefined;
    if (appId) {
      // 明确指定了机器人：必须用该机器人自身 Secret 派生的密钥，找不到则拒绝而非回退
      whManager = getWebhookManagerFor(appId);
      if (!whManager) {
        serverLogger.warn(`[webhook] reject: not configured for app_id=${appId}`);
        res.status(503).json({ error: `Webhook not configured for app_id=${appId}` });
        return;
      }
    } else {
      whManager = getWebhookManagerFor(targetId) || getWebhookManager();
    }
    if (!whManager) {
      res.status(503).json({ error: 'Webhook not configured' });
      return;
    }
    const timestamp = req.headers['x-signature-timestamp'] as string;
    const signature = req.headers['x-signature-ed25519'] as string;
    const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : String(req.body || '');
    if (timestamp && signature) {
      if (!whManager.verifySignature(timestamp, rawBody, signature)) {
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    }
    const payload = JSON.parse(rawBody);
    const result = whManager.handleEvent(payload);
    if (payload.op === 0) {
      const botId = whManager.getBotId();
      if (botId) ensureBotInstance(botId);
      runWithBotContext(botId, () =>
        whManager.dispatchEvent(payload).catch((err: any) => {
          serverLogger.error(`Event dispatch error: ${err.message}`);
        })
      );
    }
    res.json(result);
  } catch (err: any) {
    serverLogger.error(`Webhook error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// 2b. 按 AppID 独立回调链接：每个机器人独立消息 URL，路径直接指定机器人
app.post('/qq/:appId/webhook', express.raw({ type: '*/*' }), (req, res) => {
  const appId = String(req.params.appId || '').trim();
  try {
    autoEnsurePanelHost(req);
    if (!appId) {
      res.status(400).json({ error: 'Missing appId in path' });
      return;
    }
    // 按路径 AppID 精确路由到该机器人自身 Secret 派生的密钥，找不到则拒绝而非回退
    const whManager = getWebhookManagerFor(appId);
    if (!whManager) {
      serverLogger.warn(`[webhook] reject: not configured for app_id=${appId}`);
      res.status(503).json({ error: `Webhook not configured for app_id=${appId}` });
      return;
    }
    const timestamp = req.headers['x-signature-timestamp'] as string;
    const signature = req.headers['x-signature-ed25519'] as string;
    const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : String(req.body || '');
    if (timestamp && signature) {
      if (!whManager.verifySignature(timestamp, rawBody, signature)) {
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    }
    const payload = JSON.parse(rawBody);
    const result = whManager.handleEvent(payload);
    if (payload.op === 0) {
      const botId = whManager.getBotId();
      if (botId) ensureBotInstance(botId);
      runWithBotContext(botId, () =>
        whManager.dispatchEvent(payload).catch((err: any) => {
          serverLogger.error(`Event dispatch error: ${err.message}`);
        })
      );
    }
    res.json(result);
  } catch (err: any) {
    serverLogger.error(`Webhook error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ===== 2. 通用中间件 =====
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// ===== gzip 压缩（静态资源/API JSON 响应，显著降低传输体积，解决网页加载慢） =====
const COMPRESSIBLE_MIME = /^text\/|^application\/json(;|$)|^application\/javascript(;|$)|^application\/x-javascript(;|$)/;
function gzipCompress() {
  return (req: any, res: any, next: any) => {
    const accept = String(req.headers['accept-encoding'] || '');
    if (!accept.includes('gzip')) return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const origWrite = res.write.bind(res);
    const origEnd = res.end.bind(res);
    const chunks: Buffer[] = [];
    let mode: 'undecided' | 'compress' | 'pass' = 'undecided';
    const decide = (): 'compress' | 'pass' => {
      const ct = String(res.getHeader('Content-Type') || '');
      return COMPRESSIBLE_MIME.test(ct) ? 'compress' : 'pass';
    };
    res.write = (chunk: any, encoding?: any, cb?: any) => {
      if (mode === 'undecided') mode = decide();
      if (mode === 'pass') return origWrite(chunk, encoding, cb);
      if (chunk !== undefined && chunk !== null) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      if (typeof cb === 'function') cb();
      return true;
    };
    res.end = (chunk?: any, encoding?: any, cb?: any) => {
      if (chunk !== undefined && chunk !== null) {
        if (mode === 'undecided') mode = decide();
        if (mode === 'compress') {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          const body = Buffer.concat(chunks);
          const gzBody = zlib.gzipSync(body);
          res.setHeader('Content-Encoding', 'gzip');
          res.setHeader('Vary', 'Accept-Encoding');
          res.removeHeader('Content-Length');
          res.setHeader('Content-Length', gzBody.length);
          return origEnd(gzBody);
        }
        return origEnd(chunk);
      }
      if (mode === 'compress' && chunks.length) {
        const body = Buffer.concat(chunks);
        const gzBody = zlib.gzipSync(body);
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Vary', 'Accept-Encoding');
        res.removeHeader('Content-Length');
        res.setHeader('Content-Length', gzBody.length);
        return origEnd(gzBody);
      }
      return origEnd();
    };
    next();
  };
}
app.use(gzipCompress());

// ===== 主启动函数 =====
async function main() {
  serverLogger.info('Starting QQ Bot Platform...');
  acquireInstanceLock();
  initDb();
  seedExamplePlugins();
  syncPermConfig();

  const PORT = resolveServerPort();

  // 让插件内 callLocalApi 等以 process.env.PORT 为端口的本地 API 调用与真实监听端口保持一致
  // （config server.port 优先，否则插件可能连到默认 3000 导致定时任务等本地接口全部失败）
  try { process.env.PORT = String(PORT); } catch {};

  let adminPassword = getConfig('admin.password');
  if (!adminPassword) {
    adminPassword = 'YZQ5201314..';
    setConfig('admin.password', adminPassword as string);
  }

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  // ===== 管理面板配置 =====
  const adminConfig: AdminConfig = {
    port: PORT, authCode: adminPassword,
    admins: [{
      username: 'superadmin', password: adminPassword,
      role: 'super_master', loginAble: true,
      permissions: { canAddBot: true, maxBots: 999, canEditBot: true, canDeleteBot: true, canUploadPlugin: true, canManageOwnPlugins: true, canUseAllPlugins: true, canEditPluginCode: true, canManageGroups: true, canTestPlugin: true },
    }],
    sessionExpireHours: 24, pluginsDir: PLUGINS_DIR, dataDir: DATA_DIR,
  };
  const adminAuth = new AdminAuth(adminConfig);
  const adminLogger = new Logger(path.join(DATA_DIR, 'bot.log'));
  const botRegistry = new BotRegistry(DATA_DIR);
  botRegistryRef = botRegistry;
  const botManager = new BotManager(botRegistry, adminLogger);

  // 机器人启停联动 BotCore（多机器人各自独立 access_token）
  botManager.on('botStarted', (id) => {
    const entry = botRegistry.get(id);
    if (!entry?.appId || !entry.clientSecret) return;
    try {
      const core = registerBot(eventBus, entry.appId, entry.clientSecret);
      core.start().catch((err: any) => serverLogger.warn(`BotCore ${entry.appId} start failed: ${err.message}`));
    } catch (err: any) { serverLogger.warn(`registerBot ${entry.appId} failed: ${err.message}`); }
  });
  botManager.on('botStopped', (id) => {
    const entry = botRegistry.get(id);
    if (!entry?.appId) return;
    const inst = getBotInstance(entry.appId);
    if (inst) inst.stop().catch(() => {});
  });

  // 修改机器人 AppSecret 后失效对应 WebhookManager 缓存，并同步 BotCore 密钥（旧 token 作废）
  botRegistry.on('updated', (bot: any) => {
    if (bot?.appId) {
      webhookManagers.delete(bot.appId);
      serverLogger.info(`WebhookManager cache cleared for ${bot.appId}`);
      const inst = getBotInstance(bot.appId);
      if (inst && bot.clientSecret) {
        inst.updateSecret(bot.clientSecret);
        serverLogger.info(`BotCore secret synced for ${bot.appId}`);
      }
    }
  });

  // 启动时将 config 表中的当前机器人（bot.app_id/app_secret）同步进 registry，
  // 保证仪表盘/机器人管理能展示真实在用的机器人（webhook 由 QQ 开放平台直接推送，registry 仅为展示层）
  const cfgAppId = getConfig('bot.app_id') || '';
  const cfgAppSecret = getConfig('bot.app_secret') || '';
  if (cfgAppId) {
    const existingBot = botRegistry.list().find((b) => b.appId === cfgAppId);
    if (existingBot) {
      botRegistry.setStatus(existingBot.id, 'running');
      if (cfgAppSecret && existingBot.clientSecret !== cfgAppSecret) {
        botRegistry.update(existingBot.id, { clientSecret: cfgAppSecret });
      }
    } else {
      const addedBot = botRegistry.add({
        name: getConfig('bot.name') || ('机器人 ' + cfgAppId),
        appId: cfgAppId,
        clientSecret: cfgAppSecret,
        intents: 0,
        sandbox: false,
        owner: 'superadmin',
      });
      botRegistry.setStatus(addedBot.id, 'running');
    }
    console.log(`[server] registry synced with config bot.app_id=${cfgAppId}`);
  }

  function getUpdateLog(): string {
    const p = path.resolve('CHANGELOG.md');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '# 更新日志\n\n暂无更新记录。';
  }

  function saveUpdateLog(content: string): void {
    const p = path.resolve('CHANGELOG.md');
    fs.writeFileSync(p, content, 'utf-8');
  }

  const botStatus = { appId: getConfig('bot.app_id') || '', clientSecret: '******', sandbox: false, intents: 0 };

  // ===== 机器人本地接口（仅本机访问，无需管理员认证，需在 authMiddleware 之前） =====
  app.use('/api/bot', botAuthCodesRoutes);
  app.use('/api/bot', botSystemRoutes);

  // ===== 统一认证中间件（所有 /api 路径） =====
  app.use('/api', authMiddleware(adminAuth));

  // ===== 管理面板 API 路由 =====
  app.use('/api/auth', createAuthRoutes(adminAuth));
  app.use('/api/bots', createBotRoutes(botManager));
  app.use('/api/napcat', createNapcatRoutes(adminAuth, eventBus));
  app.use('/api/editor', editorRoutes);
  app.use('/api/plugins', createPluginRoutes(PLUGINS_DIR, adminAuth));
  app.use('/api/files', createFileRoutes(path.resolve('.')));
  app.use('/api/system', createSystemRoutes(
    adminLogger,
    botStatus,
    adminConfig,
    getUpdateLog,
    saveUpdateLog,
    async () => {
      return localRestart();
    },
    async () => {
      const bot = getBot(); if (bot) { await bot.stop(); await bot.start(); }
    },
    adminAuth,
    botRegistry,
  ));

  // ===== 业务 API 路由 =====
  app.use('/api', authRoutes);
  app.use('/api', botRoutes);
  app.use('/api', pluginRoutes);
  app.use('/api', logRoutes);
  app.use('/api', authCodesRoutes);
  app.use('/api', timeOffsetRoutes);
  app.use('/api', filesRoutes);
  app.use('/api', groupsRoutes);
  app.use('/api', menuConfigRoutes);

  // 健康检查端点（公开）
  app.get('/api/health', (_req, res) => {
    res.json({
      uptime: process.uptime(),
      status: 'ok',
      memory: { rss: Math.round(process.memoryUsage().rss / 1024 / 1024) },
      pid: process.pid,
    });
  });

  // ===== QQ 授权码同步 API =====
  app.post('/api/auth/sync-qq-master', (req: any, res) => {
    if (req.adminUser?.role !== 'super_master') {
      res.status(403).json({ error: '仅超级主人可操作' });
      return;
    }
    const { qqOpenId } = req.body;
    if (!qqOpenId) {
      res.status(400).json({ error: '缺少 qqOpenId' });
      return;
    }
    const payload = JSON.stringify({ id: qqOpenId, name: '超级主人' });
    setConfig('super_master_id', payload);

    // 同步写入插件前缀 key，使插件可通过 storage.get('super_master_id') 读取
    try {
      const row = getDb().prepare("SELECT id FROM plugins WHERE name = '开关机控制'").get() as any;
      if (row) {
        setConfig('plugin.' + row.id + '.super_master_id', payload);
      }
    } catch (e) { /* ignore */ }

    res.json({ ok: true, message: 'QQ 超级主人 ID 已同步' });
  });

  app.get('/api/auth/qq-master', (req: any, res) => {
    const raw = getConfig('super_master_id') || '';
    let master: any = {};
    try {
      master = JSON.parse(raw);
    } catch (e) {
      master = { id: raw, name: '' };
    }
    // 超级主人绑定详情：超主 QQ 在各机器人(bot_id)下的 OpenID（每个机器人给同一用户分配不同 OpenID）
    let bindings: any[] = [];
    try {
      const adminsFile = path.join(process.cwd(), 'data', 'admin.json');
      if (fs.existsSync(adminsFile)) {
        const admins = JSON.parse(fs.readFileSync(adminsFile, 'utf-8') || '[]');
        const s = (Array.isArray(admins) ? admins : []).find((a: any) => a && a.role === 'super_master' && a.qq);
        if (s && s.qq) {
          master.qq = String(s.qq);
          if (!master.nickname) master.nickname = s.nickname || s.username || '超级主人';
          const rows = getDb().prepare(
            'SELECT openid, bot_id, nickname, last_updated FROM user_mappings WHERE qq_number = ? ORDER BY last_updated DESC'
          ).all(String(s.qq)) as any[];
          bindings = (rows || []).map((r) => ({
            openid: r.openid || '',
            bot_id: r.bot_id || '',
            nickname: r.nickname || '',
            last_updated: r.last_updated || '',
          }));
        }
      }
    } catch (e) { /* ignore */ }
    res.json({ master, bindings });
  });

  // ===== 部署脚本下载（Termux 等场景在线获取） =====
  const scriptsDir = path.resolve(process.cwd(), 'scripts');
  if (fs.existsSync(scriptsDir)) {
    app.use('/scripts', express.static(scriptsDir, {
      setHeaders: (res) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0, private');
      }
    }));
  }

  // ===== 交付包下载（一键修复 zip 等，供真机在线拉取） =====
  const releaseDir = path.resolve(process.cwd(), 'release');
  if (fs.existsSync(releaseDir)) {
    app.use('/release', express.static(releaseDir, {
      setHeaders: (res) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0, private');
      }
    }));
  }

  // ===== 开发文档（插件 API / BotAPI 参考，面板"开发文档"入口打开） =====
  const docsDir = path.resolve(process.cwd(), 'docs');
  if (fs.existsSync(docsDir)) {
    app.use('/docs', express.static(docsDir, {
      setHeaders: (res) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0, private');
      }
    }));
  }

  // ===== 前端 SPA（主界面） =====
  const webDir = path.resolve(__dirname, '..', 'src', 'admin', 'web');
  if (fs.existsSync(webDir)) {
    app.use(express.static(webDir, {
      setHeaders: (res) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0, private');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.set('Surrogate-Control', 'no-store');
      }
    }));
  }

  // ===== 文字链接点击落地页（全局"文字链接模式"：点击文字 → 自动触发指令并回复到群） =====
  const escHtml = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  app.get('/click', (req, res) => {
    const g = String(req.query.g || '');
    const u = String(req.query.u || '');
    const d = String(req.query.d || '');
    const s = String(req.query.s || '');
    res.set('Cache-Control', 'no-store');
    if (!verifyClickPayload(g, u, d, s)) {
      res.status(400).send('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>无效链接</title></head><body style="font-family:sans-serif;text-align:center;padding-top:80px"><h3>链接无效或已过期</h3><p style="color:#999">请回到群内重新点击菜单文字链接</p></body></html>');
      return;
    }
    res.send(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>指令发送中</title></head>
<body style="font-family:sans-serif;background:#f5f6fa;margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh">
<div style="background:#fff;border-radius:16px;padding:32px 40px;box-shadow:0 4px 20px rgba(0,0,0,.08);text-align:center;max-width:360px">
<h2 style="margin:0 0 8px;color:#333">正在触发指令</h2>
<p style="color:#666;font-size:15px;margin:0">${escHtml(d)}</p>
<div id="st" style="margin-top:16px;color:#888;font-size:13px">指令发送中…</div>
</div>
<script>
(async function(){
  try{
    var r=await fetch('/api/click',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({g:${JSON.stringify(g)},u:${JSON.stringify(u)},d:${JSON.stringify(d)},s:${JSON.stringify(s)}})});
    var j=await r.json();
    document.getElementById('st').textContent=(j&&j.ok)?'✅ 指令已发送，机器人正在群内处理…':'❌ '+((j&&j.error)||'触发失败');
  }catch(e){document.getElementById('st').textContent='❌ 网络错误，请重试';}
})();
</script></body></html>`);
  });

  app.post('/api/click', (req, res) => {
    try {
      const { g, u, d, s } = req.body || {};
      if (!verifyClickPayload(String(g || ''), String(u || ''), String(d || ''), String(s || ''))) {
        res.status(400).json({ ok: false, error: '链接签名无效' });
        return;
      }
      const now = Date.now();
      // 点击落地页无 webhook 上下文：按群归属（group_members 最近 bot_id）确定目标机器人，避免消息在多个机器人实例重复触发
      let clickBotId = '';
      try {
        const row = getDb().prepare(
          "SELECT bot_id FROM group_members WHERE group_id = ? AND bot_id != '' ORDER BY last_seen DESC LIMIT 1"
        ).get(String(g)) as any;
        if (row && row.bot_id) clickBotId = String(row.bot_id);
      } catch {}
      eventBus.emit('message.group', {
        id: '',
        content: String(d),
        author: { id: String(u), openid: String(u), qqId: '', member_openid: String(u), username: '链接点击' },
        timestamp: String(now),
        groupId: String(g),
        channelId: String(g),
        group_name: '点击回复',
        botId: clickBotId,
      });
      res.json({ ok: true, action: String(d) });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  if (fs.existsSync(webDir)) {
    app.get('*', (_req, res) => {
      const indexPath = path.join(webDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0, private');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.sendFile(indexPath);
      }
      else res.send('QQ Bot Platform - Frontend not built');
    });
  }

  // ===== 初始化机器人引擎 =====
  eventBus = new EventBus();
  initAssignmentCache();
  const bot = createBot(eventBus);
  try { webhookManager = new WebhookManager(eventBus); }
  catch (err: any) { serverLogger.warn(`WebhookManager init failed (回调验签不可用): ${err.message} —— 请在面板配置机器人 AppID/Secret 后重启`); }
  // 定时任务执行器：每分钟扫描 schedule_tasks，到点播报/切换开关（报时插件「定时报时」与网页后端定时任务共用）
  startScheduleRunner(() => pluginEngine);

  // 群操作机器人路由：消息链路（有 ALS 上下文）用触发机器人；定时任务等无上下文场景按群归属（group_members 最新 bot_id）选择
  function botForGroup(groupOpenid: string) {
    if (alsBotId()) return getBot();
    try {
      const row = getDb().prepare(
        "SELECT bot_id FROM group_members WHERE group_id = ? AND bot_id != '' ORDER BY last_seen DESC LIMIT 1"
      ).get(groupOpenid) as any;
      if (row && row.bot_id) {
        const inst = getBotInstance(row.bot_id);
        if (inst) return inst;
      }
    } catch {}
    return getBot();
  }

  // 私聊操作机器人路由：定时任务等无上下文场景按 user_mappings.bot_id（该 openid 最近交互过的机器人）选择
  function botForUser(openid: string) {
    if (alsBotId()) return getBot();
    try {
      const row = getDb().prepare(
        "SELECT bot_id FROM user_mappings WHERE openid = ? AND bot_id != '' ORDER BY last_updated DESC LIMIT 1"
      ).get(openid) as any;
      if (row && row.bot_id) {
        const inst = getBotInstance(row.bot_id);
        if (inst) return inst;
      }
    } catch {}
    return getBot();
  }

  pluginEngine = new PluginEngine(eventBus, {
    sendMessage: (channelId, content, msgId) => getBot().sendMessage(channelId, content, msgId),
    sendImageMessage: (channelId, imageUrl, msgId) => getBot().sendImageMessage(channelId, imageUrl, msgId),
    sendPrivateMessage: (openid, content, msgId) => botForUser(openid).sendPrivateMessage(openid, content, msgId),
    sendGroupMessage: (groupOpenid, content, msgId) => botForGroup(groupOpenid).sendGroupMessage(groupOpenid, content, msgId),
    sendKeyboardPrivate: (openid, keyboard, msgId) => botForUser(openid).sendKeyboardC2C(openid, keyboard, msgId),
    sendKeyboardGroup: (groupOpenid, keyboard, msgId) => botForGroup(groupOpenid).sendKeyboardGroup(groupOpenid, keyboard, msgId),
    sendMarkdownPrivate: (openid, markdown, templateId, params, msgId) => botForUser(openid).sendMarkdownC2C(openid, markdown, templateId, params, msgId),
    sendMarkdownGroup: (groupOpenid, markdown, templateId, params, msgId) => botForGroup(groupOpenid).sendMarkdownGroup(groupOpenid, markdown, templateId, params, msgId),
    sendGroupMarkdownWithImage: (groupOpenid, markdown, imageUrl, msgId) => botForGroup(groupOpenid).sendGroupMarkdownWithImage(groupOpenid, markdown, imageUrl, msgId),
    uploadGroupImage: (groupOpenid, imageUrl) => botForGroup(groupOpenid).uploadGroupImage(groupOpenid, imageUrl),
    uploadGroupImageBuffer: (groupOpenid, buffer, filename) => botForGroup(groupOpenid).uploadGroupImageBuffer(groupOpenid, buffer, filename),
    sendGroupImageMessage: (groupOpenid, fileInfo, msgId) => botForGroup(groupOpenid).sendGroupImageMessage(groupOpenid, fileInfo, msgId),
    uploadGroupVoice: (groupOpenid, audioUrl, filename) => botForGroup(groupOpenid).uploadGroupVoice(groupOpenid, audioUrl, filename),
    uploadGroupVoiceBuffer: (groupOpenid, buffer, filename) => botForGroup(groupOpenid).uploadGroupVoiceBuffer(groupOpenid, buffer, filename),
    sendGroupVoiceMessage: (groupOpenid, fileInfo, msgId) => botForGroup(groupOpenid).sendGroupVoiceMessage(groupOpenid, fileInfo, msgId),
    textToSpeech: (text, voice) => botForGroup('').textToSpeech(text, voice),
    sendGroupInfoCard: (groupOpenid, card, msgId) => botForGroup(groupOpenid).sendGroupInfoCard(groupOpenid, card, msgId),
    sendGroupDashboard: (groupOpenid, msgId) => botForGroup(groupOpenid).sendGroupDashboard(groupOpenid, msgId),
    sendMenuCard: (groupOpenid, menu, msgId) => botForGroup(groupOpenid).sendMenuCard(groupOpenid, menu, msgId),
    muteMember: (groupOpenid, memberOpenid, durationSecs) => botForGroup(groupOpenid).muteMember(groupOpenid, memberOpenid, durationSecs),
    unmuteMember: (groupOpenid, memberOpenid) => botForGroup(groupOpenid).unmuteMember(groupOpenid, memberOpenid),
    updateMuteMember: (groupOpenid, memberOpenid, durationSecs) => botForGroup(groupOpenid).updateMuteMember(groupOpenid, memberOpenid, durationSecs),
    getRestrictChatSetting: (groupOpenid) => botForGroup(groupOpenid).getRestrictChatSetting(groupOpenid),
    kickMember: (groupOpenid, memberOpenid, addBlacklist, deleteMsgDays) => botForGroup(groupOpenid).kickMember(groupOpenid, memberOpenid, addBlacklist, deleteMsgDays),
    deleteMessage: (groupOpenid, messageId, hideTip) => botForGroup(groupOpenid).deleteMessage(groupOpenid, messageId, hideTip),
    muteAll: (groupOpenid, enable, durationSecs) => botForGroup(groupOpenid).muteAll(groupOpenid, enable, durationSecs),
    setAnnouncement: (groupOpenid, content) => botForGroup(groupOpenid).setAnnouncement(groupOpenid, content),
    deleteAnnouncement: (groupOpenid, announcementId) => botForGroup(groupOpenid).deleteAnnouncement(groupOpenid, announcementId),
    getAnnouncements: (groupOpenid) => botForGroup(groupOpenid).getAnnouncements(groupOpenid),
    getJoinRequests: (groupOpenid) => botForGroup(groupOpenid).getJoinRequests(groupOpenid),
    getGroupInfo: (groupOpenid) => botForGroup(groupOpenid).getGroupInfo(groupOpenid),
    getGroupBotState: (groupOpenid) => botForGroup(groupOpenid).getGroupBotState(groupOpenid),
    getGroupMembers: (groupOpenid) => botForGroup(groupOpenid).getGroupMembers(groupOpenid),
    getGuilds: () => getBot().getGuilds(),
    getGuildDetail: (guildId) => getBot().getGuildDetail(guildId),
    getChannels: (guildId) => getBot().getChannels(guildId),
    getChannelDetail: (channelId) => getBot().getChannelDetail(channelId),
    getChannelMembers: (channelId) => getBot().getChannelMembers(channelId),
    getChannelMessages: (channelId, pageSize) => getBot().getChannelMessages(channelId, pageSize),
    deleteChannelMessage: (channelId, messageId) => getBot().deleteChannelMessage(channelId, messageId),
    setChannelUserPermission: (channelId, userId, permissionBit, add) => getBot().setChannelUserPermission(channelId, userId, permissionBit, add),
    createChannel: (guildId, payload) => getBot().createChannel(guildId, payload),
    modifyChannel: (channelId, payload) => getBot().modifyChannel(channelId, payload),
    deleteChannel: (channelId) => getBot().deleteChannel(channelId),
    getGuildMembers: (guildId, limit, after) => getBot().getGuildMembers(guildId, limit, after),
    removeGuildMember: (guildId, userId) => getBot().removeGuildMember(guildId, userId),
    muteGuildMember: (guildId, userId, seconds) => getBot().muteGuildMember(guildId, userId, seconds),
    getGuildAnnounces: (guildId) => getBot().getGuildAnnounces(guildId),
    createChannelAnnounce: (channelId, messageId) => getBot().createChannelAnnounce(channelId, messageId),
    deleteChannelAnnounce: (channelId, messageId) => getBot().deleteChannelAnnounce(channelId, messageId),
    createGuildAnnounce: (guildId, channelId, messageId, announceType) => getBot().createGuildAnnounce(guildId, channelId, messageId, announceType),
    deleteGuildAnnounce: (guildId, messageId) => getBot().deleteGuildAnnounce(guildId, messageId),
    getGuildMember: (guildId, userId) => getBot().getGuildMember(guildId, userId),
    getGuildRoles: (guildId) => getBot().getGuildRoles(guildId),
    createGuildRole: (guildId, name) => getBot().createGuildRole(guildId, name),
    updateGuildRole: (guildId, roleId, name) => getBot().updateGuildRole(guildId, roleId, name),
    deleteGuildRole: (guildId, roleId) => getBot().deleteGuildRole(guildId, roleId),
    createGuildRoleMember: (guildId, roleId, userId) => getBot().createGuildRoleMember(guildId, roleId, userId),
    deleteGuildRoleMember: (guildId, roleId, userId) => getBot().deleteGuildRoleMember(guildId, roleId, userId),
    getThreads: (channelId, pageSize) => getBot().getThreads(channelId, pageSize),
    getThreadDetail: (channelId, threadId) => getBot().getThreadDetail(channelId, threadId),
    postThread: (channelId, title, content, format) => getBot().postThread(channelId, title, content, format),
    deleteThread: (channelId, threadId) => getBot().deleteThread(channelId, threadId),
    getGlobalMenu: () => getBot().getGlobalMenu(),
    setGlobalMenu: (payload) => getBot().setGlobalMenu(payload),
    getPanels: () => getBot().getPanels(),
    createPanel: (payload) => getBot().createPanel(payload),
    getPanelDetail: (panelId) => getBot().getPanelDetail(panelId),
    updatePanel: (panelId, payload) => getBot().updatePanel(panelId, payload),
    deletePanel: (panelId) => getBot().deletePanel(panelId),
    updatePanelTarget: (panelId, payload) => getBot().updatePanelTarget(panelId, payload),
    getStatus: () => getBot().getStatus(),
  });
  setPluginEngine(pluginEngine);
  await pluginEngine.loadAllFromDb();

  // 启动 PHP 插件桥（执行 plugins/ 下的 .php 插件，需环境安装 php-cli）
  try {
    const { setupPhpPlugins } = require('./core/php-plugin');
    await setupPhpPlugins(eventBus, pluginEngine.getBotApi(), pluginEngine.getPluginsDir());
  } catch (e: any) {
    serverLogger.warn(`PHP 插件桥启动失败：${e.message}`);
  }

  // Python 插件：由 PluginEngine 按常驻协议（python-runtime）执行，旧一次性桥已废弃，不再启动
  // （旧协议 .py 插件已迁移到常驻协议，见 plugins/测试.py）

  const existingAppId = getConfig('bot.app_id');
  if (existingAppId) {
    try { await bot.start(); serverLogger.info('Bot auto-started'); }
    catch (err: any) { serverLogger.warn(`Bot auto-start failed: ${err.message}`); }
  }

  // 为 registry 中其他运行中的机器人注册 BotCore（各自独立 access_token 发消息）
  try {
    for (const entry of botRegistry.list()) {
      if (entry.appId && entry.appId !== existingAppId && entry.clientSecret) {
        try {
          const core = registerBot(eventBus, entry.appId, entry.clientSecret);
          await core.start();
          serverLogger.info(`Multi-bot instance started: ${entry.appId} (${entry.name})`);
        } catch (err: any) {
          serverLogger.warn(`Multi-bot ${entry.appId} start failed: ${err.message}`);
        }
      }
    }
  } catch (err: any) {
    serverLogger.warn(`Multi-bot registration error: ${err.message}`);
  }

  // 激活码到期自动关机 / 续期自动恢复（可在面板配置 license.auto_shutdown 开关）
  if (!getConfig('license.auto_shutdown')) setConfig('license.auto_shutdown', '1');
  startLicenseWatchdog(adminAuth, botRegistry, 60000);

  app.listen({ port: PORT, reusePort: true }, () => {
    serverLogger.info(`Server running at http://localhost:${PORT}`);
    serverLogger.info(`Admin panel: http://localhost:${PORT}`);
    try { fs.writeFileSync(RESTART_MARKER, String(process.pid)); } catch {}
    try { fs.writeFileSync(INSTANCE_LOCK, String(process.pid)); } catch {}
  });

  process.on('SIGINT', async () => { releaseInstanceLock(); await bot.stop(); await pluginEngine.shutdown(); closeDb(); process.exit(0); });
  process.on('SIGTERM', async () => { releaseInstanceLock(); await bot.stop(); await pluginEngine.shutdown(); closeDb(); process.exit(0); });
}

main().catch((err) => {
  serverLogger.error(`Failed to start: ${err.message}`);
  releaseInstanceLock();
  closeDb();
  process.exit(1);
});
