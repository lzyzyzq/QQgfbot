import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { getConfig, setConfig } from '../db/index';

// ===== 邮件服务与邮箱验证码 =====
// SMTP 配置存 config KV（smtp.host/port/secure/user/pass/from/senderName），由超级主人在系统设置维护；
// 未配置时回退系统默认通道 smtp.default.*（部署者预置）。
// 验证码持久化存 config KV（emailcode.<scene>:<email>）：6 位数字、10 分钟有效、
// 同一目标 60 秒内限发一次、连续错 5 次作废；服务重启不丢失。

export const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
const SEND_INTERVAL_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

interface EmailCodeEntry {
  code: string;
  exp: number;
  attempts: number;
  lastSentAt: number;
}

function loadCodeEntry(scene: string, email: string): EmailCodeEntry | null {
  try {
    const raw = getConfig('emailcode.' + scene + ':' + String(email).trim().toLowerCase());
    if (!raw) return null;
    const entry = JSON.parse(raw) as EmailCodeEntry;
    if (!entry || !entry.code || typeof entry.exp !== 'number') return null;
    if (Date.now() > entry.exp) {
      setConfig('emailcode.' + scene + ':' + String(email).trim().toLowerCase(), '');
      return null;
    }
    return entry;
  } catch { return null; }
}

function saveCodeEntry(scene: string, email: string, entry: EmailCodeEntry | null): void {
  setConfig('emailcode.' + scene + ':' + String(email).trim().toLowerCase(), entry ? JSON.stringify(entry) : '');
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  senderName: string;
}

// 两级配置：超级主人后台配置（smtp.*）优先；未配置时回退系统默认通道（smtp.default.*，由部署者预置）
export function getSmtpConfig(): SmtpConfig | null {
  const levels: Array<{ prefix: string }> = [
    { prefix: 'smtp' },
    { prefix: 'smtp.default' },
  ];
  for (const lv of levels) {
    const host = String(getConfig(lv.prefix + '.host') || '').trim();
    const user = String(getConfig(lv.prefix + '.user') || '').trim();
    const pass = String(getConfig(lv.prefix + '.pass') || '').trim();
    if (host && user && pass) {
      const port = Math.trunc(Number(getConfig(lv.prefix + '.port')) || 465);
      const secure = String(getConfig(lv.prefix + '.secure') || (port === 465 ? '1' : '0')) === '1';
      const from = String(getConfig(lv.prefix + '.from') || '').trim() || user;
      // 发件人显示名（收件箱里展示的名字）：超主后台 smtp.senderName → 系统默认 smtp.default.senderName → 兜底「QQ Bot 面板」
      const senderName = String(getConfig(lv.prefix + '.senderName') || '').trim()
        || (lv.prefix === 'smtp' ? String(getConfig('smtp.default.senderName') || '').trim() : '')
        || 'QQ Bot 面板';
      return { host, port, secure, user, pass, from, senderName };
    }
  }
  return null;
}

// 当前生效的是否为系统默认通道（超主后台未配置自己的 SMTP 时）
export function isUsingDefaultChannel(): boolean {
  const host = String(getConfig('smtp.host') || '').trim();
  const user = String(getConfig('smtp.user') || '').trim();
  const pass = String(getConfig('smtp.pass') || '').trim();
  if (host && user && pass) return false;
  const dHost = String(getConfig('smtp.default.host') || '').trim();
  const dUser = String(getConfig('smtp.default.user') || '').trim();
  const dPass = String(getConfig('smtp.default.pass') || '').trim();
  return Boolean(dHost && dUser && dPass);
}

let cachedTransport: Transporter | null = null;
let cachedConfigKey = '';

function getTransport(): Transporter | null {
  const cfg = getSmtpConfig();
  if (!cfg) return null;
  // 配置变化时重建连接池
  const key = [cfg.host, cfg.port, cfg.secure, cfg.user, cfg.pass, cfg.from, cfg.senderName].join('|');
  if (cachedTransport && cachedConfigKey === key) return cachedTransport;
  cachedTransport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
  });
  cachedConfigKey = key;
  return cachedTransport;
}

export function isMailConfigured(): boolean {
  return getSmtpConfig() !== null;
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || '').trim());
}

async function sendMail(to: string, subject: string, html: string): Promise<void> {
  const transporter = getTransport();
  if (!transporter) throw new Error('系统邮件通道未就绪：请超级主人在 系统设置 → 邮件服务（SMTP） 中配置发件邮箱');
  const cfg = getSmtpConfig()!;
  // 发件人显示名可配置（收件箱列表展示的名字）
  await transporter.sendMail({ from: `"${cfg.senderName}" <${cfg.from}>`, to, subject, html });
}

function codeTemplate(code: string, scene: string, senderName: string): { subject: string; html: string } {
  const purpose = scene === 'register' ? '注册账号' : '绑定邮箱';
  return {
    subject: `【${senderName}】${purpose}验证码：${code}`,
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
<div style="font-size:18px;font-weight:600;margin-bottom:12px">${senderName} - ${purpose}</div>
<div style="font-size:14px;color:#555;margin-bottom:16px">你的验证码为：</div>
<div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#2563eb;margin-bottom:16px">${code}</div>
<div style="font-size:13px;color:#888">验证码 10 分钟内有效，请勿泄露给他人。若非本人操作请忽略本邮件。</div>
</div>`,
  };
}

// 发送验证码（60 秒限频，限频状态持久化）。返回剩余等待秒数（>0 表示被限频）。
export async function sendEmailCode(scene: 'register' | 'bind', email: string): Promise<{ sent: boolean; retryAfter: number }> {
  const now = Date.now();
  const prev = loadCodeEntry(scene, email);
  if (prev && now - prev.lastSentAt < SEND_INTERVAL_MS) {
    return { sent: false, retryAfter: Math.ceil((SEND_INTERVAL_MS - (now - prev.lastSentAt)) / 1000) };
  }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const tpl = codeTemplate(code, scene, getSmtpConfig()?.senderName || 'QQ Bot 面板');
  await sendMail(email.trim(), tpl.subject, tpl.html);
  saveCodeEntry(scene, email, { code, exp: now + EMAIL_CODE_TTL_MS, attempts: 0, lastSentAt: now });
  return { sent: true, retryAfter: 0 };
}

// 校验并消费验证码；成功返回 true，失败抛出中文错误
export function verifyEmailCode(scene: 'register' | 'bind', email: string, code: string): boolean {
  const entry = loadCodeEntry(scene, email);
  if (!entry) throw new Error('验证码不存在或已过期，请重新获取');
  if (Date.now() > entry.exp) {
    saveCodeEntry(scene, email, null);
    throw new Error('验证码已过期，请重新获取');
  }
  if (String(code).trim() !== entry.code) {
    entry.attempts += 1;
    if (entry.attempts >= MAX_ATTEMPTS) {
      saveCodeEntry(scene, email, null);
      throw new Error('验证码错误次数过多，请重新获取');
    }
    saveCodeEntry(scene, email, entry);
    throw new Error('验证码错误');
  }
  saveCodeEntry(scene, email, null);
  return true;
}

// SMTP 配置测试邮件（仅超主设置页使用）
export async function sendTestMail(to: string): Promise<void> {
  await sendMail(to.trim(), `【${getSmtpConfig()?.senderName || 'QQ Bot 面板'}】SMTP 配置测试邮件`, '<div style="font-family:sans-serif;font-size:14px">这是一封测试邮件，收到即说明邮件服务配置成功。</div>');
}
