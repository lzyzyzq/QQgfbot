import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { getConfig } from '../db/index';

// ===== 邮件服务与邮箱验证码 =====
// SMTP 配置存 config KV（smtp.host/port/secure/user/pass/from），由超级主人在系统设置维护。
// 验证码存内存（重启失效即可接受）：6 位数字、10 分钟有效、同一目标 60 秒内限发一次、连续错 5 次作废。

export const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
const SEND_INTERVAL_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

interface EmailCodeEntry {
  code: string;
  exp: number;
  attempts: number;
  lastSentAt: number;
}

// scene 区分用途：register（注册验证）/ bind（本人改绑邮箱）
const codeStore = new Map<string, EmailCodeEntry>();
let cachedTransport: Transporter | null = null;
let cachedConfigKey = '';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export function getSmtpConfig(): SmtpConfig | null {
  const host = String(getConfig('smtp.host') || '').trim();
  const user = String(getConfig('smtp.user') || '').trim();
  const pass = String(getConfig('smtp.pass') || '').trim();
  if (!host || !user || !pass) return null;
  const port = Math.trunc(Number(getConfig('smtp.port')) || 465);
  const secure = String(getConfig('smtp.secure') || (port === 465 ? '1' : '0')) === '1';
  const from = String(getConfig('smtp.from') || '').trim() || user;
  return { host, port, secure, user, pass, from };
}

function getTransport(): Transporter | null {
  const cfg = getSmtpConfig();
  if (!cfg) return null;
  // 配置变化时重建连接池
  const key = [cfg.host, cfg.port, cfg.secure, cfg.user, cfg.pass, cfg.from].join('|');
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
  if (!transporter) throw new Error('管理员尚未配置邮件服务（SMTP），请联系超级主人');
  const cfg = getSmtpConfig()!;
  await transporter.sendMail({ from: `"QQ Bot 面板" <${cfg.from}>`, to, subject, html });
}

function codeKey(scene: string, email: string): string {
  return scene + ':' + String(email).trim().toLowerCase();
}

function codeTemplate(code: string, scene: string): { subject: string; html: string } {
  const purpose = scene === 'register' ? '注册账号' : '绑定邮箱';
  return {
    subject: `【QQ Bot 面板】${purpose}验证码：${code}`,
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
<div style="font-size:18px;font-weight:600;margin-bottom:12px">QQ Bot 管理面板 - ${purpose}</div>
<div style="font-size:14px;color:#555;margin-bottom:16px">你的验证码为：</div>
<div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#2563eb;margin-bottom:16px">${code}</div>
<div style="font-size:13px;color:#888">验证码 10 分钟内有效，请勿泄露给他人。若非本人操作请忽略本邮件。</div>
</div>`,
  };
}

// 发送验证码（60 秒限频）。返回剩余等待秒数（>0 表示被限频）。
export async function sendEmailCode(scene: 'register' | 'bind', email: string): Promise<{ sent: boolean; retryAfter: number }> {
  const key = codeKey(scene, email);
  const prev = codeStore.get(key);
  const now = Date.now();
  if (prev && now - prev.lastSentAt < SEND_INTERVAL_MS) {
    return { sent: false, retryAfter: Math.ceil((SEND_INTERVAL_MS - (now - prev.lastSentAt)) / 1000) };
  }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const tpl = codeTemplate(code, scene);
  await sendMail(email.trim(), tpl.subject, tpl.html);
  codeStore.set(key, { code, exp: now + EMAIL_CODE_TTL_MS, attempts: 0, lastSentAt: now });
  return { sent: true, retryAfter: 0 };
}

// 校验并消费验证码；成功返回 true，失败抛出中文错误
export function verifyEmailCode(scene: 'register' | 'bind', email: string, code: string): boolean {
  const key = codeKey(scene, email);
  const entry = codeStore.get(key);
  if (!entry) throw new Error('验证码不存在或已过期，请重新获取');
  if (Date.now() > entry.exp) {
    codeStore.delete(key);
    throw new Error('验证码已过期，请重新获取');
  }
  if (String(code).trim() !== entry.code) {
    entry.attempts += 1;
    if (entry.attempts >= MAX_ATTEMPTS) {
      codeStore.delete(key);
      throw new Error('验证码错误次数过多，请重新获取');
    }
    throw new Error('验证码错误');
  }
  codeStore.delete(key);
  return true;
}

// SMTP 配置测试邮件（仅超主设置页使用）
export async function sendTestMail(to: string): Promise<void> {
  await sendMail(to.trim(), '【QQ Bot 面板】SMTP 配置测试邮件', '<div style="font-family:sans-serif;font-size:14px">这是一封测试邮件，收到即说明邮件服务配置成功。</div>');
}
