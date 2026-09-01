import { Router, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getPluginEngine } from './index';
import { getConfig } from '../db/index';
import { createLogger } from '../utils/logger';

const logger = createLogger('system-api');

export function createSystemRoutes(dataDir: string): Router {
  const router = Router();

  // 系统状态
  router.get('/status', (_req: Request, res: Response) => {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const cpuUsage = os.loadavg();
    const uptime = os.uptime();

    res.json({
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      uptime: Math.floor(uptime),
      memory: {
        total: Math.floor(totalMem / 1024 / 1024),
        free: Math.floor(freeMem / 1024 / 1024),
        used: Math.floor((totalMem - freeMem) / 1024 / 1024),
        usagePercent: Math.round(((totalMem - freeMem) / totalMem) * 100),
      },
      cpu: {
        load1: cpuUsage[0],
        load5: cpuUsage[1],
        load15: cpuUsage[2],
      },
      node: process.version,
      pid: process.pid,
    });
  });

  // 刷新插件（从磁盘重新加载）
  router.post('/refresh', async (_req: Request, res: Response) => {
    try {
      const engine = getPluginEngine();
      if (!engine) { res.status(500).json({ error: 'Plugin engine not available' }); return; }
      await engine.loadAllFromDb();
      logger.info('Plugins refreshed');
      res.json({ ok: true, message: 'Plugins refreshed from disk' });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // 更新日志
  router.get('/changelog', (_req: Request, res: Response) => {
    const changelogPath = path.join(dataDir, '..', 'CHANGELOG.md');
    if (fs.existsSync(changelogPath)) {
      res.json({ content: fs.readFileSync(changelogPath, 'utf-8') });
    } else {
      res.json({ content: '# 更新日志\n\n暂无更新记录。' });
    }
  });

  // 更新更新日志
  router.put('/changelog', (req: Request, res: Response) => {
    const changelogPath = path.join(dataDir, '..', 'CHANGELOG.md');
    fs.writeFileSync(changelogPath, req.body.content || '');
    res.json({ ok: true });
  });

  // 获取配置（脱敏）
  router.get('/config', (_req: Request, res: Response) => {
    try {
      const botAppId = getConfig('bot.app_id');
      const isSandbox = getConfig('bot.sandbox');
      const webhookPort = getConfig('webhook.port');
      res.json({
        bot: {
          appId: botAppId ? (botAppId as string).substring(0, 4) + '****' : '未配置',
          configured: !!botAppId,
          sandbox: isSandbox === 'true' || String(isSandbox) === 'true',
        },
        webhook: {
          port: webhookPort || process.env.PORT || 5200,
        },
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
