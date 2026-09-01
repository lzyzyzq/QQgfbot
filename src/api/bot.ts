import { Router, Request, Response } from 'express';
import { getBot } from '../core/bot';
import { setConfig, getConfig, getDb } from '../db/index';
import { getPluginEngine } from './index';
import { resetWebhookManager } from '../server';

const router = Router();

function getPowerPluginId(): string | null {
  try {
    const row = getDb().prepare("SELECT id FROM plugins WHERE name = '开关机控制'").get() as any;
    return row ? row.id : null;
  } catch { return null; }
}

function powerKey(key: string): string {
  const pid = getPowerPluginId() || 'builtin-power';
  return 'plugin.' + pid + '.' + key;
}

function getMasters() {
  try {
    const superRaw = getConfig(powerKey('super_master_id'));
    const miniRaw = getConfig(powerKey('mini_masters'));
    let superMaster = null;
    let miniMasters: any[] = [];
    if (superRaw) {
      try { superMaster = JSON.parse(superRaw); } catch { superMaster = { id: superRaw }; }
    }
    if (miniRaw) {
      try { miniMasters = JSON.parse(miniRaw); } catch { miniMasters = []; }
    }
    return { super_master_id: superMaster, mini_masters: miniMasters };
  } catch {
    return { super_master_id: null, mini_masters: [] };
  }
}

router.get('/bot/status', (req: Request, res: Response) => {
  try {
    const bot = getBot();
    res.json({
      status: bot.getStatus(),
      config: bot.getConfig(),
      // read masters from plugin KV store
      ...getMasters(),
    });
  } catch {
    res.json({
      status: 'stopped',
      config: {
        appId: getConfig('bot.app_id') || '',
        appSecret: '***',
      },
    });
  }
});

router.post('/bot/start', async (req: Request, res: Response) => {
  try {
    const bot = getBot();
    if (bot.getStatus() !== 'stopped' && bot.getStatus() !== 'error') {
      res.status(400).json({ error: `Bot is already ${bot.getStatus()}` });
      return;
    }
    await bot.start();
    res.json({ status: bot.getStatus(), message: 'Bot started' });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to start bot: ${err.message}` });
  }
});

router.post('/bot/stop', async (req: Request, res: Response) => {
  try {
    const bot = getBot();
    await bot.stop();
    res.json({ status: bot.getStatus(), message: 'Bot stopped' });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to stop bot: ${err.message}` });
  }
});

router.post('/bot/restart', async (req: Request, res: Response) => {
  try {
    const bot = getBot();
    if (bot.getStatus() !== 'stopped') {
      await bot.stop();
    }
    const engine = getPluginEngine();
    await engine.shutdown();
    resetWebhookManager();
    await engine.loadAllFromDb();
    await bot.start();
    res.json({ status: bot.getStatus(), message: 'Bot restarted, all plugins reloaded' });
  } catch (err: any) {
    res.status(500).json({ error: `Restart failed: ${err.message}` });
  }
});

router.put('/bot/config', (req: Request, res: Response) => {
  const { appId, appSecret } = req.body;

  if (!appId || !appSecret) {
    res.status(400).json({ error: 'appId and appSecret are required' });
    return;
  }

  setConfig('bot.app_id', appId);
  setConfig('bot.app_secret', appSecret);

  const botConfig = req.body;
  if (botConfig.qqClientId) {
    setConfig('qq_oauth.client_id', botConfig.qqClientId);
  }
  if (botConfig.qqClientSecret) {
    setConfig('qq_oauth.client_secret', botConfig.qqClientSecret);
  }
  if (botConfig.qqRedirectUri) {
    setConfig('qq_oauth.redirect_uri', botConfig.qqRedirectUri);
  }

  res.json({ message: 'Configuration saved' });
});

router.delete('/masters/mini/:id', (req: Request, res: Response) => {
  try {
    const targetId = req.params.id;
    const raw = getConfig(powerKey('mini_masters'));
    if (!raw) {
      res.status(404).json({ error: 'mini_masters not found' });
      return;
    }
    let masters: any[];
    try { masters = JSON.parse(raw); } catch { masters = []; }
    const idx = masters.findIndex((m: any) => m.id === targetId);
    if (idx === -1) {
      res.status(404).json({ error: 'mini master not found' });
      return;
    }
    masters.splice(idx, 1);
    setConfig(powerKey('mini_masters'), JSON.stringify(masters));
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/masters/super', (req: Request, res: Response) => {
  try {
    const { qqId } = req.body;
    if (!qqId || !String(qqId).trim()) {
      res.status(400).json({ error: 'qqId is required' });
      return;
    }
    const trimmed = String(qqId).trim();
    const superObj = {
      id: trimmed,
      qqId: trimmed,
      added_at: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }),
    };
    setConfig(powerKey('super_master_id'), JSON.stringify(superObj));
    res.json({ success: true, super_master_id: superObj });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
