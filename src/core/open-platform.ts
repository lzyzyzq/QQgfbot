import crypto from 'crypto';
import { getConfig, setConfig } from '../db/index';
import { createLogger } from '../utils/logger';

const logger = createLogger('open-platform');

const CONFIG_KEY = 'openPlatform.config';
const SESSION_KEY = 'openPlatform.session';
const SECRET_KEY = 'openPlatform.secret';

export interface OpenSession {
  uin: string;
  developerId: string;
  ticket: string;
}

export interface UpstreamEndpoint {
  method?: string;
  path: string;
  query?: string[];
  timeout?: number;
}

// 开发者登录态来源：
//   manual  = 手动粘贴浏览器 Cookie / 三要素
//   panel   = 复用面板已有 QQ 登录（心月互联 / NapCat）确认 QQ 号，票据仍需手动补齐
//   custom  = 指向自建的 q.qq.com 扫码实现（用户此前做好的那套）
//   builtin = 直接用配置里的 q.qq.com 官方扫码端点
export type LoginMode = 'manual' | 'panel' | 'custom' | 'builtin';

export interface LoginFieldMap {
  url?: string;
  token?: string;
  status?: string;
  done?: string;
  uin?: string;
  developerId?: string;
  ticket?: string;
}

export interface LoginConfig {
  mode?: LoginMode;
  create?: UpstreamEndpoint;
  check?: UpstreamEndpoint;
  qrcodeMap?: LoginFieldMap;
  sessionMap?: LoginFieldMap;
  note?: string;
}

export interface UpstreamConfig {
  baseUrl?: string;
  endpoints?: Record<string, UpstreamEndpoint>;
  sessionHeaders?: Record<string, string>;
  login?: LoginConfig;
}

export interface OpResult {
  ok: boolean;
  data?: any;
  error?: string;
  status?: number;
  code?: string;
  hint?: string;
}

// 上游 Qticket 属高敏凭据：配置中仅存密文，进程内加解密
function secretKey(): Buffer {
  let hex = getConfig(SECRET_KEY);
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    hex = crypto.randomBytes(32).toString('hex');
    setConfig(SECRET_KEY, hex);
  }
  return Buffer.from(hex, 'hex');
}

function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
}

function decrypt(payload: string): string | null {
  try {
    const [ivB64, tagB64, dataB64] = String(payload).split('.');
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function getUpstreamConfig(): UpstreamConfig {
  try {
    const raw = getConfig(CONFIG_KEY);
    const cfg = raw ? JSON.parse(raw) : {};
    return cfg && typeof cfg === 'object' ? cfg : {};
  } catch {
    return {};
  }
}

export function saveUpstreamConfig(cfg: UpstreamConfig): void {
  setConfig(CONFIG_KEY, JSON.stringify(cfg || {}));
}

export function getSession(): OpenSession | null {
  const raw = getConfig(SESSION_KEY);
  if (!raw) return null;
  const plain = decrypt(raw);
  if (!plain) return null;
  try {
    const s = JSON.parse(plain);
    if (s && s.uin && s.developerId && s.ticket) {
      return { uin: String(s.uin), developerId: String(s.developerId), ticket: String(s.ticket) };
    }
  } catch {}
  return null;
}

export function saveSession(s: OpenSession): void {
  setConfig(SESSION_KEY, encrypt(JSON.stringify({
    uin: String(s.uin || '').trim(),
    developerId: String(s.developerId || '').trim(),
    ticket: String(s.ticket || '').trim(),
  })));
}

export function clearSession(): void {
  setConfig(SESSION_KEY, '');
}

// 脱敏回显：仅暴露是否存在与部分 QQ 号
export function maskSession(): { loggedIn: boolean; uin?: string; developerId?: string } {
  const s = getSession();
  if (!s) return { loggedIn: false };
  const uin = s.uin.length > 5 ? s.uin.slice(0, 3) + '***' + s.uin.slice(-2) : s.uin.slice(0, 1) + '***';
  return {
    loggedIn: true,
    uin,
    developerId: s.developerId.length > 4 ? s.developerId.slice(0, 2) + '***' : '***',
  };
}

// 会话字段注入上游请求头模板：{uin} / {developerId} / {ticket}
function applyTemplate(tpl: string, vars: Record<string, string>): string {
  return String(tpl).replace(/\{(\w+)\}/g, (_m, k) => vars[k] ?? '');
}

export function listActions(): string[] {
  const cfg = getUpstreamConfig();
  return Object.keys(cfg.endpoints || {}).sort();
}

/** 按点路径读取嵌套字段：map.foo 为空时返回 undefined（由调用方走默认回退）。 */
function pick(obj: any, path?: string): any {
  if (!path || obj == null) return undefined;
  return path.split('.').reduce((acc: any, k) => (acc == null ? acc : acc[k]), obj);
}

function notConfigured(action: string): OpResult {
  const cfg = getUpstreamConfig();
  const mode = cfg.login?.mode || 'manual';
  return {
    ok: false,
    code: 'NOT_CONFIGURED',
    error: '上游接口未配置：' + action,
    hint: '当前登录态来源模式为「' + mode + '」。可在右上角「上游配置」填写 login 端点，或改用「手动填写」/「面板 QQ」。',
  };
}

/** 底层调用：显式传入端点，避免 runAction 再次查表。 */
async function runWithEndpoint(
  cfg: UpstreamConfig,
  action: string,
  ep: UpstreamEndpoint,
  params: Record<string, any>,
  session: OpenSession | null,
  forceSession = false,
): Promise<OpResult> {
  if (!cfg.baseUrl || !ep || !ep.path) return notConfigured(action);
  const s = session;
  const needSession = forceSession || (!action.startsWith('qrcode.') && !(ep as any).noSession);
  if (needSession && !s) return { ok: false, error: '未登录开发者账号' };

  let url: URL;
  try {
    url = new URL(ep.path, cfg.baseUrl);
  } catch {
    return { ok: false, error: '上游地址无效：' + ep.path };
  }

  const vars: Record<string, string> = { uin: s?.uin || '', developerId: s?.developerId || '', ticket: s?.ticket || '' };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  for (const [k, v] of Object.entries(cfg.sessionHeaders || {})) headers[k] = applyTemplate(v, vars);

  const method = String(ep.method || 'GET').toUpperCase();
  const payload: Record<string, any> = { ...params };
  let body: string | undefined;
  if (method === 'GET') {
    for (const key of ep.query || []) {
      if (payload[key] !== undefined && payload[key] !== null && payload[key] !== '') {
        url.searchParams.set(key, String(payload[key]));
      }
    }
  } else {
    body = JSON.stringify(payload);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(3000, Math.min(60000, ep.timeout || 15000)));
  try {
    const res = await fetch(url.toString(), { method, headers, body, signal: ctrl.signal });
    const text = await res.text();
    let data: any = text;
    try { data = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok) return { ok: false, status: res.status, error: (data && (data.message || data.msg)) || ('HTTP ' + res.status), data };
    return { ok: true, data };
  } catch (e: any) {
    logger.warn(`runAction ${action} failed: ${e.message}`);
    return { ok: false, error: e.name === 'AbortError' ? '上游请求超时' : ('上游请求失败：' + e.message) };
  } finally {
    clearTimeout(timer);
  }
}

/** 调用单个上游动作；未配置端点时返回明确错误，不抛异常。 */
export async function runAction(action: string, params: Record<string, any> = {}, session?: OpenSession | null): Promise<OpResult> {
  const cfg = getUpstreamConfig();
  const ep = cfg.endpoints?.[action];
  if (!cfg.baseUrl || !ep || !ep.path) return notConfigured(action);
  const s = session ?? getSession();
  return runWithEndpoint(cfg, action, ep, params, s);
}

function loginEndpoint(cfg: UpstreamConfig, kind: 'create' | 'check'): UpstreamEndpoint | undefined {
  const fromLogin = kind === 'create' ? cfg.login?.create : cfg.login?.check;
  if (fromLogin && fromLogin.path) return fromLogin;
  return cfg.endpoints?.['qrcode.' + kind];
}

/** 扫码：创建二维码（type=login 登录 / auth 授权机器人管理），返回归一化的 {url, token, raw}。 */
export async function createQrcode(payload: Record<string, any>): Promise<OpResult> {
  const cfg = getUpstreamConfig();
  const ep = loginEndpoint(cfg, 'create');
  if (!ep || !cfg.baseUrl) return notConfigured('qrcode.create');
  const r = await runWithEndpoint(cfg, 'qrcode.create', ep, payload, payload.type === 'auth' ? getSession() : null);
  if (!r.ok) return r;
  const map = cfg.login?.qrcodeMap || {};
  const d = r.data || {};
  const url = pick(d, map.url) ?? (d.url || d.qrcode_url || d.qr_url || d.qrcodeUrl || '');
  const token = pick(d, map.token) ?? (d.qrcode || d.qr_code || d.token || d.qrToken || '');
  if (!url) {
    return { ok: false, error: '上游未返回二维码地址', data: d, hint: '可在上游配置 login.qrcodeMap.url 指定二维码字段路径。' };
  }
  return { ok: true, data: { url: String(url), token: String(token || ''), raw: d } };
}

/** 扫码：轮询/确认二维码结果，返回归一化的 {uin, developerId, ticket, authorized, status, raw}。 */
export async function checkQrcode(payload: Record<string, any>): Promise<OpResult> {
  const cfg = getUpstreamConfig();
  const ep = loginEndpoint(cfg, 'check');
  if (!ep || !cfg.baseUrl) return notConfigured('qrcode.check');
  const r = await runWithEndpoint(cfg, 'qrcode.check', ep, payload, getSession(), true);
  if (!r.ok) return r;
  const map = cfg.login?.qrcodeMap || {};
  const smap = cfg.login?.sessionMap || {};
  const d = r.data || {};
  const status = String(pick(d, map.status) ?? d.status ?? '');
  const authorized = !!(pick(d, map.done) ?? d.authorized ?? d.confirmed ?? /confirmed|success|ok|done|authorized/i.test(status));
  const uin = String(pick(d, smap.uin) ?? d.uin ?? d.qq ?? '');
  const developerId = String(pick(d, smap.developerId) ?? d.developerId ?? d.quid ?? '');
  const ticket = String(pick(d, smap.ticket) ?? d.ticket ?? d.qticket ?? '');
  return { ok: true, data: { uin, developerId, ticket, authorized, status, raw: d } };
}

export function getLoginConfig(): LoginConfig {
  const cfg = getUpstreamConfig();
  return cfg.login || { mode: 'manual' };
}
