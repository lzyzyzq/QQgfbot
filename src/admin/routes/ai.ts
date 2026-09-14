import { Router, type Request, type Response } from 'express';
import fs from 'fs';
import { AdminAuth } from '../auth';
import { requireSuperMaster } from '../middleware';
import { queryCoinLogs } from '../../db/index';
import {
  getBotAiConfig, saveBotAiConfig,
  listProviders, saveProviders, toProviderView,
  callModel, COIN_COST_PER_CALL,
} from '../../core/ai-reply';
import { AI_PRESET_PERSONAS, SIDEBAR_PAGES, type AiProvider, type AiBotConfig } from '../ai-config';

// 校验当前用户对机器人是否有管理权（owner 或超级主人）
function canManageBot(auth: AdminAuth, username: string, role: string, appId: string): boolean {
  if (role === 'super_master') return true;
  try {
    const bots = JSON.parse(fs.readFileSync('data/bots.json', 'utf-8'));
    const b = Array.isArray(bots) ? bots.find((x: any) => x && x.appId === appId) : undefined;
    return Boolean(b && b.owner === username);
  } catch {
    return false;
  }
}

function sanitizeBotConfig(cfg: AiBotConfig): AiBotConfig {
  return { ...cfg, ownKey: cfg.ownKey ? '******' : '' };
}

export function createAiRoutes(auth: AdminAuth): Router {
  const router = Router();

  // ===== AI 兜底配置 =====
  router.get('/config', (req: Request, res: Response) => {
    const appId = String(req.query.bot || '').trim();
    if (!appId) { res.status(400).json({ error: 'Missing bot appId' }); return; }
    const me = req.adminUser!;
    if (!canManageBot(auth, me.username, me.role, appId)) {
      res.status(403).json({ error: 'No permission for this bot' }); return;
    }
    const cfg = getBotAiConfig(appId);
    const owner = (() => {
      try {
        const bots = JSON.parse(fs.readFileSync('data/bots.json', 'utf-8'));
        const b = Array.isArray(bots) ? bots.find((x: any) => x && x.appId === appId) : undefined;
        return String(b?.owner || '');
      } catch { return ''; }
    })();
    const ownerUser = owner ? auth.getUser(owner) : undefined;
    const isSuper = me.role === 'super_master';
    res.json({
      config: sanitizeBotConfig(cfg),
      providers: toProviderView(listProviders()),
      owner,
      ownerCoins: typeof ownerUser?.coins === 'number' ? ownerUser.coins : 0,
      coinCost: COIN_COST_PER_CALL,
      isSuper,
    });
  });

  router.put('/config', (req: Request, res: Response) => {
    const appId = String(req.query.bot || '').trim();
    if (!appId) { res.status(400).json({ error: 'Missing bot appId' }); return; }
    const me = req.adminUser!;
    if (!canManageBot(auth, me.username, me.role, appId)) {
      res.status(403).json({ error: 'No permission for this bot' }); return;
    }
    const body = req.body || {};
    const prev = getBotAiConfig(appId);
    const cfg: AiBotConfig = {
      enabled: Boolean(body.enabled),
      providerId: String(body.providerId || '').trim(),
      keyMode: body.keyMode === 'own' ? 'own' : 'system',
      // 前端回传掩码 ****** 时保留原值
      ownKey: body.ownKey === '******' ? prev.ownKey : String(body.ownKey || ''),
      baseUrl: String(body.baseUrl || '').trim(),
      model: String(body.model || '').trim(),
      temperature: Math.min(2, Math.max(0, Number(body.temperature) || 0.8)),
      maxTokens: Math.min(4096, Math.max(16, Number(body.maxTokens) || 512)),
      memoryRounds: Math.min(20, Math.max(0, Math.trunc(Number(body.memoryRounds) || 0))),
      systemPrompt: String(body.systemPrompt || '').slice(0, 4000),
      groupEnabled: body.groupEnabled !== false,
      c2cEnabled: body.c2cEnabled !== false,
      groupTrigger: body.groupTrigger === 'all' ? 'all' : 'at',
      toolsJson: String(body.toolsJson || '').slice(0, 20000),
    };
    // 校验供应商存在
    if (cfg.providerId && !listProviders().some((p) => p.id === cfg.providerId)) {
      res.status(400).json({ error: '供应商不存在' }); return;
    }
    saveBotAiConfig(appId, cfg);
    res.json({ ok: true });
  });

  // 在线测试：直接调用模型，不扣金币、不写对话记忆
  router.post('/test', async (req: Request, res: Response) => {
    const body = req.body || {};
    const appId = String(body.bot || '').trim();
    const message = String(body.message || '').trim();
    if (!appId || !message) { res.status(400).json({ error: '缺少机器人或测试消息' }); return; }
    const me = req.adminUser!;
    if (!canManageBot(auth, me.username, me.role, appId)) {
      res.status(403).json({ error: 'No permission for this bot' }); return;
    }
    const cfg = getBotAiConfig(appId);
    const provider = cfg.providerId ? listProviders().find((p) => p.id === cfg.providerId) : undefined;
    if (!provider) { res.status(400).json({ error: '请先选择模型供应商并保存配置' }); return; }
    if (cfg.keyMode === 'own' && !cfg.ownKey) { res.status(400).json({ error: '密钥方式为自己的密钥时请先填写 API Key' }); return; }
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (cfg.systemPrompt && cfg.systemPrompt.trim()) messages.push({ role: 'system', content: cfg.systemPrompt.trim() });
    messages.push({ role: 'user', content: message });
    try {
      const reply = await callModel(provider, cfg, messages);
      res.json({ reply });
    } catch (e: any) {
      res.status(502).json({ error: String(e.message || e) });
    }
  });

  // ===== 供应商管理（仅超级主人） =====
  router.get('/providers', requireSuperMaster, (_req: Request, res: Response) => {
    res.json({ providers: listProviders() });
  });

  router.post('/providers', requireSuperMaster, (req: Request, res: Response) => {
    const body = req.body || {};
    const name = String(body.name || '').trim();
    if (!name) { res.status(400).json({ error: '请填写供应商名称' }); return; }
    const list = listProviders();
    const id = String(body.id || '').trim() || `prov_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const existingIdx = list.findIndex((p) => p.id === id);
    const prev = existingIdx >= 0 ? list[existingIdx] : undefined;
    const item: AiProvider = {
      id,
      name,
      format: String(body.format || 'openai').trim() || 'openai',
      baseUrl: String(body.baseUrl || '').trim(),
      model: String(body.model || '').trim(),
      // 未填密钥且为编辑时保留原密钥
      systemKey: body.systemKey ? String(body.systemKey) : (prev?.systemKey || ''),
    };
    if (existingIdx >= 0) list[existingIdx] = item; else list.push(item);
    saveProviders(list);
    res.json({ ok: true, id });
  });

  router.delete('/providers/:id', requireSuperMaster, (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    const list = listProviders().filter((p) => p.id !== id);
    saveProviders(list);
    res.json({ ok: true });
  });

  // ===== 金币 =====
  router.get('/coins', (req: Request, res: Response) => {
    const me = req.adminUser!;
    const target = String(req.query.username || '').trim() || me.username;
    if (target !== me.username && me.role !== 'super_master') {
      res.status(403).json({ error: 'Super master only' }); return;
    }
    const u = auth.getUser(target);
    res.json({
      username: target,
      coins: typeof u?.coins === 'number' ? u.coins : 0,
      logs: queryCoinLogs(target, 50),
    });
  });

  router.post('/coins/adjust', requireSuperMaster, (req: Request, res: Response) => {
    const body = req.body || {};
    const username = String(body.username || '').trim();
    const delta = Math.trunc(Number(body.delta) || 0);
    const reason = String(body.reason || '').trim();
    if (!username) { res.status(400).json({ error: '缺少用户名' }); return; }
    if (!delta) { res.status(400).json({ error: '增减数量不能为 0' }); return; }
    if (!auth.getUser(username)) { res.status(404).json({ error: '用户不存在' }); return; }
    const balance = auth.adjustCoins(username, delta, reason || (delta > 0 ? '管理员增加' : '管理员扣减'), req.adminUser!.username);
    res.json({ ok: true, balance });
  });

  // ===== 侧边栏权限（仅超级主人） =====
  router.get('/pages', requireSuperMaster, (req: Request, res: Response) => {
    const username = String(req.query.username || '').trim();
    if (!username) { res.status(400).json({ error: '缺少用户名' }); return; }
    const u = auth.getUser(username);
    if (!u) { res.status(404).json({ error: '用户不存在' }); return; }
    res.json({
      username,
      // null=按角色默认全部可用
      allowedPages: auth.getAllowedPages(username),
      raw: Array.isArray(u.allowedPages) ? u.allowedPages : [],
    });
  });

  router.put('/pages', requireSuperMaster, (req: Request, res: Response) => {
    const body = req.body || {};
    const username = String(body.username || '').trim();
    const pages = Array.isArray(body.pages) ? body.pages.map((p: any) => String(p)).filter(Boolean) : [];
    if (!username) { res.status(400).json({ error: '缺少用户名' }); return; }
    const u = auth.getUser(username);
    if (!u) { res.status(404).json({ error: '用户不存在' }); return; }
    if (u.role === 'super_master') { res.status(400).json({ error: '超级主人不受限制' }); return; }
    const valid = new Set(SIDEBAR_PAGES.map((p) => p.id));
    const filtered = pages.filter((p: string) => valid.has(p));
    // 空列表=恢复默认（全部可用）：写入 null/undefined 移除限制
    auth.updateUser(username, { allowedPages: filtered.length ? filtered : undefined });
    res.json({ ok: true, allowedPages: auth.getAllowedPages(username) });
  });

  // ===== 元数据：预设人设 / 页面清单 / 默认供应商 =====
  router.get('/meta', (_req: Request, res: Response) => {
    res.json({ personas: AI_PRESET_PERSONAS, pages: SIDEBAR_PAGES, coinCost: COIN_COST_PER_CALL });
  });

  return router;
}
