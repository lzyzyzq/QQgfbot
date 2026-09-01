import crypto from 'crypto';
import { getConfig } from '../db/index';

export function signClickPayload(group: string, user: string, data: string): string {
  const secret = getConfig('bot.app_secret') || 'qqbot-platform';
  return crypto.createHash('sha256').update(`${group}|${user}|${data}|${secret}`).digest('hex').slice(0, 24);
}

export function verifyClickPayload(group: string, user: string, data: string, sig: string): boolean {
  if (!sig || sig.length < 8) return false;
  return signClickPayload(group, user, data) === sig;
}

export function safeCompare(a: string, b: string): boolean {
  try {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}
