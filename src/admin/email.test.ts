import { describe, it, expect, vi, beforeEach } from 'vitest';

// SMTP 配置固定为已配置状态；nodemailer transporter mock 掉（不真实发信）
vi.mock('../db/index', () => ({
  getConfig: vi.fn((key: string) => {
    const map: Record<string, string> = {
      'smtp.host': 'smtp.test.local',
      'smtp.port': '465',
      'smtp.secure': '1',
      'smtp.user': 'bot@test.local',
      'smtp.pass': 'secret',
      'smtp.from': 'bot@test.local',
    };
    return map[key] || '';
  }),
}));
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: vi.fn(async () => ({})) })),
  },
}));

import { sendEmailCode, verifyEmailCode, isValidEmail, isMailConfigured } from './email';

describe('邮箱验证码引擎', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('isValidEmail 基本格式校验', () => {
    expect(isValidEmail('a@b.com')).toBe(true);
    expect(isValidEmail('a.b+c@d-domain.cn')).toBe(true);
    expect(isValidEmail('bad@@x.com')).toBe(false);
    expect(isValidEmail('no-at-sign')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });

  it('isMailConfigured 在 SMTP 配置齐全时为 true', () => {
    expect(isMailConfigured()).toBe(true);
  });

  it('发送验证码后正确验证并消费（一次性）', async () => {
    const r = await sendEmailCode('register', 'user1@test.com');
    expect(r.sent).toBe(true);
    // 无法直接拿到码——从 mock transporter 捕获 sendMail 参数中的验证码
    const { default: nodemailer } = await import('nodemailer');
    const transport = (nodemailer.createTransport as any).mock.results[0].value;
    const html: string = transport.sendMail.mock.calls[(transport.sendMail.mock.calls.length - 1)][0].html;
    const code = (html.match(/(\d{6})/) || [])[1];
    expect(code).toBeTruthy();
    expect(() => verifyEmailCode('register', 'user1@test.com', '000000' === code ? '111111' : '000000')).toThrow('验证码错误');
    expect(verifyEmailCode('register', 'user1@test.com', code)).toBe(true);
    // 一次性：再次验证应失败
    expect(() => verifyEmailCode('register', 'user1@test.com', code)).toThrow('验证码不存在或已过期');
  });

  it('同一邮箱 60 秒限频', async () => {
    const r1 = await sendEmailCode('bind', 'freq@test.com');
    expect(r1.sent).toBe(true);
    const r2 = await sendEmailCode('bind', 'freq@test.com');
    expect(r2.sent).toBe(false);
    expect(r2.retryAfter).toBeGreaterThan(0);
    // 60 秒后可再次发送
    vi.advanceTimersByTime(61 * 1000);
    const r3 = await sendEmailCode('bind', 'freq@test.com');
    expect(r3.sent).toBe(true);
  });

  it('错误 5 次后作废', async () => {
    await sendEmailCode('register', 'dead@test.com');
    const { default: nodemailer } = await import('nodemailer');
    const transport = (nodemailer.createTransport as any).mock.results[(nodemailer.createTransport as any).mock.results.length - 1].value;
    const html: string = transport.sendMail.mock.calls[(transport.sendMail.mock.calls.length - 1)][0].html;
    const code = (html.match(/(\d{6})/) || [])[1];
    const wrong = '000000' === code ? '111111' : '000000';
    for (let i = 0; i < 4; i++) {
      expect(() => verifyEmailCode('register', 'dead@test.com', wrong)).toThrow('验证码错误');
    }
    expect(() => verifyEmailCode('register', 'dead@test.com', wrong)).toThrow('验证码错误次数过多');
    // 即使第 6 次填对也作废
    expect(() => verifyEmailCode('register', 'dead@test.com', code)).toThrow('验证码不存在或已过期');
  });

  it('验证码 10 分钟过期', async () => {
    await sendEmailCode('bind', 'exp@test.com');
    const { default: nodemailer } = await import('nodemailer');
    const transport = (nodemailer.createTransport as any).mock.results[(nodemailer.createTransport as any).mock.results.length - 1].value;
    const html: string = transport.sendMail.mock.calls[(transport.sendMail.mock.calls.length - 1)][0].html;
    const code = (html.match(/(\d{6})/) || [])[1];
    vi.advanceTimersByTime(10 * 60 * 1000 + 1000);
    expect(() => verifyEmailCode('bind', 'exp@test.com', code)).toThrow('验证码已过期');
  });

  it('scene 隔离：register 与 bind 验证码互不通用', async () => {
    await sendEmailCode('register', 'scene@test.com');
    const { default: nodemailer } = await import('nodemailer');
    const transport = (nodemailer.createTransport as any).mock.results[(nodemailer.createTransport as any).mock.results.length - 1].value;
    const html: string = transport.sendMail.mock.calls[(transport.sendMail.mock.calls.length - 1)][0].html;
    const code = (html.match(/(\d{6})/) || [])[1];
    expect(() => verifyEmailCode('bind', 'scene@test.com', code)).toThrow('验证码不存在或已过期');
    expect(verifyEmailCode('register', 'scene@test.com', code)).toBe(true);
  });
});
