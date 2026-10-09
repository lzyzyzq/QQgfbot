import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { requirePerm } from '../middleware';
import { getConfig, setConfig } from '../../db/index';
import { SIDEBAR_PAGES } from '../ai-config';
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

// ===== 内置侧边栏页面覆盖配置（v1.0.30）：超主可改名/启停/排序全部内置页面 =====
// v1.0.31 扩展：html（页面顶部自定义内容注入）+ roles（页面级角色可见性）
// 存储：bot.db config 表 sidebar_overrides，结构 { pageId: { name?, enabled?, order?, html?, roles? } }
export interface SidebarOverride {
  name?: string;
  enabled?: boolean;
  order?: number;
  html?: string;
  htmlBottom?: string;
  roles?: string[];
}

export function loadSidebarOverrides(): Record<string, SidebarOverride> {
  try {
    const raw = getConfig('sidebar_overrides');
    const o = raw ? JSON.parse(raw) : {};
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

function persistSidebarOverrides(o: Record<string, SidebarOverride>) {
  setConfig('sidebar_overrides', JSON.stringify(o));
}

const VALID_ROLES = ['super_master', 'master', 'member', 'user'];

export function createCustomPagesRoutes(): Router {
  const router = Router();
  const canManage = requirePerm('canManageCustomPages');

  // 登录用户：已启用的自定义页面 + 内置页覆盖配置（前端动态侧边栏）
  router.get('/', (_req: Request, res: Response) => {
    res.json({ pages: sortPages(loadCustomPages().filter((p) => p.enabled)), overrides: loadSidebarOverrides() });
  });

  // 管理端全量（自定义页含停用 + 内置页清单 + 覆盖配置）
  router.get('/all', canManage, (_req: Request, res: Response) => {
    res.json({ pages: sortPages(loadCustomPages()), builtin: SIDEBAR_PAGES, overrides: loadSidebarOverrides() });
  });

  // 内置页面覆盖：改名 / 启停 / 排序（id 为内置页面 id，如 dashboard）
  // v1.0.33：读取内置页面源码（从 index.html 平衡抽取 id="page-xxx" 容器片段），供超主在管理区查看
  router.get('/builtin/:id/source', canManage, (req: Request, res: Response) => {
    const pid = req.params.id;
    if (!SIDEBAR_PAGES.some((p) => p.id === pid)) { res.status(404).json({ error: '内置页面不存在' }); return; }
    try {
      const htmlPath = path.resolve(process.cwd(), 'src', 'admin', 'web', 'index.html');
      const html = fs.readFileSync(htmlPath, 'utf-8');
      // 掩码 script/style 区段（等长空格替换，保持索引）：避免 JS 字符串里的 </div> 干扰标签平衡计数
      const masked = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, (mm) => ' '.repeat(mm.length));
      const openRe = new RegExp('<div[^>]*id="page-' + pid + '"[^>]*>');
      const m = openRe.exec(masked);
      if (!m) { res.json({ ok: true, source: '', total: html.length, note: '页面容器未找到（可能为动态生成页面）' }); return; }
      // div 标签平衡计数，取到配对结束标签（在掩码文本上计数，索引映射回原文）
      let depth = 0; let i = m.index; const n = masked.length; let end = -1;
      while (i < n) {
        const nextOpen = masked.indexOf('<div', i);
        const nextClose = masked.indexOf('</div>', i);
        if (nextClose < 0) break;
        if (nextOpen >= 0 && nextOpen < nextClose) { depth++; i = nextOpen + 4; }
        else { depth--; i = nextClose + 6; if (depth === 0) { end = i; break; } }
      }
      if (end < 0) end = n;
      const startTag = html.slice(m.index, html.indexOf('>', m.index) + 1);
      const gt = html.indexOf('>', m.index) + 1;
      const source = startTag + '\n' + html.slice(gt, end - 6);
      res.json({ ok: true, source, total: html.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.put('/builtin/:id', canManage, (req: Request, res: Response) => {
    const builtin = SIDEBAR_PAGES.find((p) => p.id === req.params.id);
    if (!builtin) { res.status(404).json({ error: '内置页面不存在' }); return; }
    const ov = loadSidebarOverrides();
    const cur = ov[req.params.id] || {};
    const next: SidebarOverride = { ...cur };
    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim().slice(0, 30);
      // 空白 = 恢复默认名称；与默认同名也视为无覆盖
      next.name = name ? (name === builtin.name ? undefined : name) : undefined;
    }
    if (req.body.enabled !== undefined) next.enabled = req.body.enabled === true;
    // enabled=true 等价默认行为，视为无覆盖
    if (next.enabled === true) delete next.enabled;
    if (req.body.order !== undefined) {
      // null = 恢复默认排序；数字 = 自定义排序值
      next.order = req.body.order === null ? undefined : Math.trunc(Number(req.body.order) || 0);
    }
    // v1.0.31：页面顶部自定义 HTML 注入（空串 = 清除）
    if (req.body.html !== undefined) {
      const html = String(req.body.html || '').slice(0, 100000);
      next.html = html ? html : undefined;
    }
    // v1.0.34：页面底部自定义 HTML 注入（空串 = 清除）
    if (req.body.htmlBottom !== undefined) {
      const htmlB = String(req.body.htmlBottom || '').slice(0, 100000);
      next.htmlBottom = htmlB ? htmlB : undefined;
    }
    // v1.0.31：页面级角色可见性（空数组/null = 全部角色可见；不含 super_master，超主恒可见）
    if (req.body.roles !== undefined) {
      const roles = Array.isArray(req.body.roles)
        ? req.body.roles.map((r: any) => String(r)).filter((r: string) => VALID_ROLES.includes(r) && r !== 'super_master')
        : [];
      next.roles = roles.length ? roles : undefined;
    }
    if (next.name === undefined) delete next.name;
    if (next.order === undefined) delete next.order;
    if (next.html === undefined) delete next.html;
    if (next.htmlBottom === undefined) delete next.htmlBottom;
    if (next.roles === undefined) delete next.roles;
    ov[req.params.id] = next;
    if (!Object.keys(next).length) delete ov[req.params.id];
    persistSidebarOverrides(ov);
    res.json({ ok: true, override: next });
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
