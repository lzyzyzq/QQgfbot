import { Router, Request, Response } from 'express';
import { requirePerm } from '../middleware';
import { getConfig, setConfig } from '../../db/index';
import type { CustomPage } from '../config';

// 自定义页面持久化：bot.db config 表 custom_pages（JSON 数组，全局共享）
export function loadCustomPages(): CustomPage[] {
  try {
    const raw = getConfig('custom_pages');
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function persistCustomPages(list: CustomPage[]) {
  setConfig('custom_pages', JSON.stringify(list));
}

function sortPages(list: CustomPage[]): CustomPage[] {
  return [...list].sort((a, b) => (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0));
}

function sanitizePage(body: any, id: string): CustomPage | null {
  const name = String(body.name || '').trim().slice(0, 30);
  const type = body.type === 'link' ? 'link' : 'html';
  const content = String(body.content || '').trim();
  if (!name) return null;
  if (type === 'link' && !/^https?:\/\//i.test(content)) return null;
  if (type === 'html' && !content) return null;
  return {
    id,
    name,
    type,
    content: type === 'html' ? content.slice(0, 200000) : content.slice(0, 2000),
    enabled: body.enabled !== false,
    order: Math.trunc(Number(body.order) || 0),
    createdAt: Math.trunc(Number(body.createdAt) || Date.now()),
  };
}

export function createCustomPagesRoutes(): Router {
  const router = Router();
  const canManage = requirePerm('canManageCustomPages');

  // 登录用户：已启用的自定义页面（前端动态侧边栏与页面渲染）
  router.get('/', (_req: Request, res: Response) => {
    res.json({ pages: sortPages(loadCustomPages().filter((p) => p.enabled)) });
  });

  // 管理端全量（含停用）
  router.get('/all', canManage, (_req: Request, res: Response) => {
    res.json({ pages: sortPages(loadCustomPages()) });
  });

  router.post('/', canManage, (req: Request, res: Response) => {
    const page = sanitizePage(req.body, 'custom_' + Date.now().toString(36));
    if (!page) { res.status(400).json({ error: '页面名称必填；外链需 http(s) 地址；HTML 内容不能为空' }); return; }
    const list = loadCustomPages();
    if (list.some((p) => p.name === page.name)) { res.status(400).json({ error: '已存在同名页面' }); return; }
    list.push(page);
    persistCustomPages(list);
    res.json({ ok: true, page });
  });

  router.put('/:id', canManage, (req: Request, res: Response) => {
    const list = loadCustomPages();
    const idx = list.findIndex((p) => p.id === req.params.id);
    if (idx === -1) { res.status(404).json({ error: '页面不存在' }); return; }
    const page = sanitizePage({ ...list[idx], ...req.body, createdAt: list[idx].createdAt }, req.params.id);
    if (!page) { res.status(400).json({ error: '页面名称必填；外链需 http(s) 地址；HTML 内容不能为空' }); return; }
    if (list.some((p, i) => i !== idx && p.name === page.name)) { res.status(400).json({ error: '已存在同名页面' }); return; }
    list[idx] = page;
    persistCustomPages(list);
    res.json({ ok: true, page });
  });

  router.delete('/:id', canManage, (req: Request, res: Response) => {
    const list = loadCustomPages();
    const next = list.filter((p) => p.id !== req.params.id);
    if (next.length === list.length) { res.status(404).json({ error: '页面不存在' }); return; }
    persistCustomPages(next);
    res.json({ ok: true });
  });

  return router;
}
