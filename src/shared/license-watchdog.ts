// 激活码生命周期看门狗
// 1. 授权码到期 → 自动停机其归属用户名下的机器人（记录 licenseStopped 标记）
// 2. 授权码续期/重发后 → 自动恢复之前因到期停机的机器人
// 受 config `license.auto_shutdown` 开关控制（默认启用）
import { getDb, getConfig, getQQByOpenid } from '../db/index';
import type { AdminAuth } from '../admin/auth';
import type { BotRegistry } from '../admin/registry';
import { createLogger } from '../utils/logger';

const logger = createLogger('license');

interface LicenseCodeRow {
  code: string;
  role: string;
  created_by: string;
  expires_at: string | null;
  is_permanent: number;
  used_by: string;
}

function resolveUser(usedBy: string, admins: any[]): any | null {
  const byOpenid = admins.find((u) => u.openid && u.openid === usedBy);
  if (byOpenid) return byOpenid;
  try {
    const qq = getQQByOpenid(usedBy);
    if (qq) {
      const byQq = admins.find((u) => u.qq && String(u.qq) === String(qq));
      if (byQq) return byQq;
    }
  } catch {}
  return null;
}

export function runLicenseCheck(adminAuth: AdminAuth, botRegistry: BotRegistry): void {
  try {
    if (getConfig('license.auto_shutdown') === '0') return;
    const db = getDb();
    const admins = adminAuth.getAdmins();
    const codes = db.prepare(
      `SELECT code, role, created_by, expires_at, is_permanent, used_by
       FROM auth_codes WHERE used_by IS NOT NULL AND used_by != '' AND used_by != 'api'`
    ).all() as LicenseCodeRow[];

    // 每个用户聚合：只要还有任一授权码有效即视为有效
    const userState: Record<string, { valid: boolean; codes: string[] }> = {};
    for (const c of codes) {
      const user = resolveUser(c.used_by, admins);
      if (!user) continue;
      const valid = c.is_permanent === 1 || !c.expires_at || new Date(c.expires_at).getTime() > Date.now();
      if (!userState[user.username]) {
        userState[user.username] = { valid, codes: [c.code] };
      } else {
        userState[user.username].valid = userState[user.username].valid || valid;
        userState[user.username].codes.push(c.code);
      }
    }

    for (const username of Object.keys(userState)) {
      const state = userState[username];
      for (const bot of botRegistry.list(username)) {
        if (!state.valid && bot.status === 'running' && !bot.licenseStopped) {
          botRegistry.setStatus(bot.id, 'stopped');
          botRegistry.setLicenseFlag(bot.id, true);
          logger.info(`[license] 授权码已全部到期，机器人「${bot.name}」自动停机（归属 ${username}）`);
        } else if (state.valid && bot.licenseStopped && bot.status === 'stopped') {
          botRegistry.setStatus(bot.id, 'running');
          botRegistry.setLicenseFlag(bot.id, false);
          logger.info(`[license] 授权码已续期/重发，机器人「${bot.name}」自动恢复运行（归属 ${username}）`);
        }
      }
    }
  } catch (e: any) {
    logger.warn(`license check error: ${e.message}`);
  }
}

export function startLicenseWatchdog(adminAuth: AdminAuth, botRegistry: BotRegistry, intervalMs = 60000): NodeJS.Timeout {
  runLicenseCheck(adminAuth, botRegistry);
  const timer = setInterval(() => {
    runLicenseCheck(adminAuth, botRegistry);
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  logger.info(`license watchdog started (interval=${intervalMs}ms)`);
  return timer;
}
