import { Router, type Request, type Response } from 'express';
import type { BotManager } from '../manager';
import type { AdminAuth } from '../auth';
import {
  getSession, saveSession, clearSession, maskSession,
  getUpstreamConfig, saveUpstreamConfig, listActions, getLoginConfig,
  runAction, createQrcode, checkQrcode,
} from '../../core/open-platform';

export function createOpenPlatformRoutes(botManager: BotManager, adminAuth?: AdminAuth): Router {
  const router = Router();

  const isSuper = (req: Request) => req.adminUser?.role === 'super_master';

  // 机器人归属校验：超级主人放行，其余仅限 owner
  const findBot = (req: Request) => {
    const id = req.params.botId as string;
    const bot = botManager.getBot(id) || botManager.listBots().find((b) => String(b.appId) === String(id));
    if (!bot) return { bot: null as any, allowed: false };
    const allowed = isSuper(req) || req.adminUser?.username === bot.owner;
    return { bot, allowed };
  };

  // ---- 上游端点配置（超级主人）----
  router.get('/config', (_req: Request, res: Response) => {
    res.json(getUpstreamConfig());
  });
  router.put('/config', (req: Request, res: Response) => {
    if (!isSuper(req)) { res.status(403).json({ error: 'Super master only' }); return; }
    const cfg = req.body;
    if (!cfg || typeof cfg !== 'object') { res.status(400).json({ error: '配置格式错误' }); return; }
    saveUpstreamConfig(cfg);
    res.json({ ok: true });
  });

  // ---- 开发者登录态 ----
  router.get('/session', (_req: Request, res: Response) => {
    res.json(maskSession());
  });
  router.post('/session', (req: Request, res: Response) => {
    if (!isSuper(req)) { res.status(403).json({ error: 'Super master only' }); return; }
    const { uin, developerId, ticket } = req.body || {};
    if (!uin || !developerId || !ticket) { res.status(400).json({ error: 'uin / developerId / ticket 不能为空' }); return; }
    saveSession({ uin: String(uin), developerId: String(developerId), ticket: String(ticket) });
    res.json({ ok: true, ...maskSession() });
  });
  router.delete('/session', (req: Request, res: Response) => {
    if (!isSuper(req)) { res.status(403).json({ error: 'Super master only' }); return; }
    clearSession();
    res.json({ ok: true });
  });

  // 登录态来源模式（不含敏感字段）
  router.get('/login-config', (_req: Request, res: Response) => {
    const login = getLoginConfig();
    res.json({ mode: login.mode || 'manual', note: login.note || '' });
  });

  // 复用面板已有 QQ 登录：返回当前管理员绑定的 QQ 号 / OpenID，供开放平台页预填 uin
  router.get('/session/panel-qq', (req: Request, res: Response) => {
    const me = req.adminUser;
    if (!me) { res.status(401).json({ error: '未登录面板' }); return; }
    type Person = { username?: string; qq?: string; nickname?: string; openid?: string };
    let person: Person | undefined;
    if (adminAuth) {
      const admins = adminAuth.getAdmins() as Person[];
      person =
        admins.find((a) => a.username === me.username) ||
        admins.find((a) => a.username === String(me.username).replace(/^qq_/, '')) ||
        admins.find((a) => a.username === 'admin' && me.role === 'super_master');
    }
    const qq = String(person?.qq || '').trim();
    res.json({
      qq,
      nickname: person?.nickname || '',
      openid: person?.openid || '',
      hasQq: !!qq,
      hasOpenid: !!(person?.openid),
    });
  });

  // ---- 可用动作清单 ----
  router.get('/cgi-actions', (_req: Request, res: Response) => {
    res.json({ actions: listActions() });
  });

  // ---- 扫码 ----
  router.post('/qrcode/create', async (req: Request, res: Response) => {
    const result = await createQrcode(req.body || {});
    res.status(result.ok ? 200 : 502).json(result);
  });
  router.post('/qrcode/check', async (req: Request, res: Response) => {
    const result = await checkQrcode(req.body || {});
    res.status(result.ok ? 200 : 502).json(result);
  });

  // ---- 机器人维度：只读专用接口 ----
  router.get('/:botId/info', async (req: Request, res: Response) => {
    const { bot, allowed } = findBot(req);
    if (!bot) { res.status(404).json({ error: 'Bot not found' }); return; }
    if (!allowed) { res.status(403).json({ error: 'Access denied' }); return; }
    const result = await runAction('info', { app_id: bot.appId });
    res.status(result.ok ? 200 : 502).json(result);
  });

  router.get('/:botId/members', async (req: Request, res: Response) => {
    const { bot, allowed } = findBot(req);
    if (!bot) { res.status(404).json({ error: 'Bot not found' }); return; }
    if (!allowed) { res.status(403).json({ error: 'Access denied' }); return; }
    const result = await runAction('members', { app_id: bot.appId, app_type: req.query.app_type || 2 });
    res.status(result.ok ? 200 : 502).json(result);
  });

  router.get('/:botId/msg-tpl', async (req: Request, res: Response) => {
    const { bot, allowed } = findBot(req);
    if (!bot) { res.status(404).json({ error: 'Bot not found' }); return; }
    if (!allowed) { res.status(403).json({ error: 'Access denied' }); return; }
    const result = await runAction('msg-tpl', { app_id: bot.appId, start: req.query.start || 0, limit: req.query.limit || 50 });
    res.status(result.ok ? 200 : 502).json(result);
  });

  // ---- 机器人维度：通用 CGI 与写操作 ----
  router.post('/:botId/cgi', async (req: Request, res: Response) => {
    const { bot, allowed } = findBot(req);
    if (!bot) { res.status(404).json({ error: 'Bot not found' }); return; }
    if (!allowed) { res.status(403).json({ error: 'Access denied' }); return; }
    const { action, params } = req.body || {};
    if (!action || typeof action !== 'string') { res.status(400).json({ error: '缺少 action' }); return; }
    const result = await runAction(action, { app_id: bot.appId, ...(params || {}) });
    res.status(result.ok ? 200 : 502).json(result);
  });

  router.post('/:botId/msg-tpl/delete', async (req: Request, res: Response) => {
    const { bot, allowed } = findBot(req);
    if (!bot) { res.status(404).json({ error: 'Bot not found' }); return; }
    if (!allowed) { res.status(403).json({ error: 'Access denied' }); return; }
    const { tplid, qrcode } = req.body || {};
    if (!tplid || !qrcode) { res.status(400).json({ error: '缺少 tplid 或 qrcode' }); return; }
    const result = await runAction('msg-tpl/delete', { app_id: bot.appId, tplid, qrcode });
    res.status(result.ok ? 200 : 502).json(result);
  });

  router.post('/:botId/reset-credentials', async (req: Request, res: Response) => {
    const { bot, allowed } = findBot(req);
    if (!bot) { res.status(404).json({ error: 'Bot not found' }); return; }
    if (!allowed) { res.status(403).json({ error: 'Access denied' }); return; }
    const { type, qrcode } = req.body || {};
    if (!type || !qrcode) { res.status(400).json({ error: '缺少 type 或 qrcode' }); return; }
    const result = await runAction('reset-credentials', { app_id: bot.appId, type, qrcode });
    res.status(result.ok ? 200 : 502).json(result);
  });

  return router;
}
