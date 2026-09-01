import { Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { getDb } from '../db/index';

// 通用插件卡片配置 API：管理面板「测试菜单」页读写任意 js 插件的卡片配置
// 存储：config 表 key=plugin.<插件id>.config，值 = JSON { "<appid/botId>": { show_avatar, main_page, pages } }
// 区块类型：avatar(头像) / head_links(外显链接) / title(标题) / meta(昵称·ID·群) / divider(分割线) /
//           intro(说明) / rows(菜单项) / tips(提示) / footer_title(底部标题) / footer(底部代码块)
const router = Router();
const DEFAULT_PLUGIN = '测试菜单';

function normalizePluginName(raw: any): string {
  let n = String(raw || '').trim();
  if (!n) n = DEFAULT_PLUGIN;
  n = n.replace(/[\\/:*?"<>|]/g, '').trim();
  return n || DEFAULT_PLUGIN;
}

// 官方开放平台能力清单（对应「测试菜单」插件 officialDemo 的 case，供编辑器一键预置/追加）
// value 统一为指令「测试官方 <能力>」；available=false 表示平台接口未接入（点击会给出明确提示而非报错）
const OFFICIAL_CAPABILITIES: { label: string; value: string; desc: string; available: boolean }[] = [
  { label: '📝 文字消息', value: '测试官方 文字消息', desc: '基础文本消息 msg_type=0', available: true },
  { label: '🖼️ 图片消息', value: '测试官方 图片消息', desc: '富媒体图片（图为你头像）', available: true },
  { label: '🔊 语音消息', value: '测试官方 语音消息', desc: '富媒体语音（示例音频）', available: true },
  { label: '🎬 视频消息', value: '测试官方 视频消息', desc: '富媒体视频（示例视频）', available: true },
  { label: '📁 文件消息', value: '测试官方 文件消息', desc: '富媒体文件（示例 PDF）', available: true },
  { label: '📄 Markdown消息', value: '测试官方 Markdown消息', desc: 'markdown 富文本渲染', available: true },
  { label: '🔘 内联按钮', value: '测试官方 内联按钮', desc: '内联键盘按钮（type=11）', available: true },
  { label: '📇 文卡', value: '测试官方 文卡', desc: 'ARK 文卡（template 23）', available: true },
  { label: '🖼️ 大图卡', value: '测试官方 大图卡', desc: 'ARK 大图卡（template 37）', available: true },
  { label: '🔗 跳转卡', value: '测试官方 跳转卡', desc: 'ARK 跳转卡（template 24）', available: true },
  { label: '🗒️ 表单卡', value: '测试官方 表单卡', desc: 'ARK 表单卡（平台暂未接入）', available: false },
  { label: '💨 流式消息', value: '测试官方 流式消息', desc: '流式消息（平台暂未接入）', available: false },
  { label: '🗑️ 撤回消息', value: '测试官方 撤回消息', desc: '删除群内指定消息', available: true },
  { label: '😀 表情表态', value: '测试官方 表情表态', desc: '消息表情表态（平台暂未接入）', available: false },
  { label: '🏠 群信息', value: '测试官方 群信息', desc: '查询群资料（GET 群信息）', available: true },
  { label: '👥 群成员', value: '测试官方 群成员', desc: '群成员列表（前10）', available: true },
  { label: '📢 群公告', value: '测试官方 群公告', desc: '查看/发布群公告', available: true },
  { label: '🔇 全员禁言', value: '测试官方 全员禁言', desc: '查询全员禁言状态', available: true },
  { label: '🔕 禁言列表', value: '测试官方 禁言列表', desc: '查询全员禁言设置', available: true },
  { label: '📥 入群申请', value: '测试官方 入群申请', desc: '查看入群申请列表', available: true },
  { label: '🗂️ 群组列表', value: '测试官方 群组列表', desc: '当前机器人所在频道/群列表', available: true },
  { label: '📡 频道信息', value: '测试官方 频道信息', desc: '频道详情与子频道列表', available: true },
  { label: '🤖 机器人信息', value: '测试官方 机器人信息', desc: '机器人名称/ID/版本', available: true },
  { label: '👤 用户信息', value: '测试官方 用户信息', desc: '绑定QQ用户信息（昵称/头像）', available: true },
  { label: '🆔 OpenID查询', value: '测试官方 OpenID查询', desc: '展示当前消息发送者 openid', available: true }
];

// 保存配置后为每个页面（菜单）自动创建对应文件夹：data/menus/{插件名}/{页面名}/
function ensureMenuDirs(pages: Record<string, any> | undefined, pluginName: string): void {
  if (!pages || typeof pages !== 'object') return;
  try {
    const base = path.join(process.cwd(), 'data', 'menus');
    const pn = normalizePluginName(pluginName).replace(/[\\/:*?"<>|]/g, '_').trim() || '未命名';
    for (const name of Object.keys(pages)) {
      const safe = String(name).replace(/[\\/:*?"<>|]/g, '_').trim();
      if (safe) fs.mkdirSync(path.join(base, pn, safe), { recursive: true });
    }
  } catch { /* 目录创建失败不影响配置保存 */ }
}

// ========== 默认页面集合（blocks 模型，与插件内置默认一致） ==========
function defaultTestMenuPages() {
  return {
    '主菜单': {
      blocks: [
        { type: 'avatar', source: 'user' },
        { type: 'head_links', items: [{ label: '免@联系群主', type: 'cmd', value: '联系群主' }] },
        { type: 'title', text: '**🌟 空空 Bot 测试菜单**' },
        { type: 'meta', show: ['nickname', 'userid', 'group'] },
        { type: 'divider', text: '━━━━━━━━━━━━━━' },
        { type: 'intro', text: '点下方链接，指令会填入输入框，点发送即可使用 ↓' },
        {
          type: 'rows',
          rows: [
            [
              { label: '📅 签到', type: 'cmd', value: '签到' },
              { label: '📋 我的签到', type: 'cmd', value: '我的签到' }
            ],
            [
              { label: '📊 签到记录', type: 'cmd', value: '签到记录' }
            ],
            [
              { label: '🔮 今日运势', type: 'cmd', value: '今日运势' },
              { label: '🎲 掷骰子', type: 'cmd', value: '掷骰子' }
            ],
            [
              { label: '😄 笑话', type: 'cmd', value: '笑话' }
            ],
            [
              { label: '⚙️ 官方功能', type: 'cmd', value: '测试菜单 @官方功能' }
            ]
          ]
        },
        { type: 'tips', text: '📌 Tips: 签到为测试功能，点击后确认输入框指令再发送' },
        { type: 'divider', text: '━━━━━━━━━━━━━━' },
        { type: 'footer_title', text: '⚠️ 测试功能 ⚠️' },
        { type: 'footer', fence: 'text', lines: ['当前时间：{time}', '最后更新：2026-08-28'] }
      ]
    },
    '官方功能': {
      blocks: [
        { type: 'avatar', source: 'user' },
        { type: 'head_links', items: [{ label: '免@联系群主', type: 'cmd', value: '联系群主' }] },
        { type: 'title', text: '**⚙️ 官方开放平台功能**' },
        { type: 'meta', show: ['nickname', 'userid', 'group'] },
        { type: 'divider', text: '━━━━━━━━━━━━━━' },
        { type: 'intro', text: '以下是官方开放平台可实现的能力演示，点某项回填演示指令，点发送即可调用官方接口 ↓' },
        {
          type: 'rows',
          rows: [
            [
              { label: '📝 文字消息', type: 'cmd', value: '测试官方 文字消息' },
              { label: '🖼️ 图片消息', type: 'cmd', value: '测试官方 图片消息' }
            ],
            [
              { label: '🔊 语音消息', type: 'cmd', value: '测试官方 语音消息' },
              { label: '🎬 视频消息', type: 'cmd', value: '测试官方 视频消息' }
            ],
            [
              { label: '📄 Markdown消息', type: 'cmd', value: '测试官方 Markdown消息' },
              { label: '🔘 内联按钮', type: 'cmd', value: '测试官方 内联按钮' }
            ],
            [
              { label: '📇 文卡', type: 'cmd', value: '测试官方 文卡' },
              { label: '🖼️ 大图卡', type: 'cmd', value: '测试官方 大图卡' }
            ],
            [
              { label: '🔗 跳转卡', type: 'cmd', value: '测试官方 跳转卡' },
              { label: '💨 流式消息', type: 'cmd', value: '测试官方 流式消息' }
            ],
            [
              { label: '🗑️ 撤回消息', type: 'cmd', value: '测试官方 撤回消息' },
              { label: '🏠 群信息', type: 'cmd', value: '测试官方 群信息' }
            ],
            [
              { label: '👥 群成员', type: 'cmd', value: '测试官方 群成员' },
              { label: '🔇 禁言列表', type: 'cmd', value: '测试官方 禁言列表' }
            ],
            [
              { label: '🤖 机器人信息', type: 'cmd', value: '测试官方 机器人信息' }
            ],
            [
              { label: '🏠 返回主菜单', type: 'cmd', value: '测试菜单' }
            ]
          ]
        },
        { type: 'tips', text: '📌 每一项对应一个官方接口，指令格式：测试官方 <能力>；可在此新增/删除/编辑你的功能项' },
        { type: 'divider', text: '━━━━━━━━━━━━━━' },
        { type: 'footer_title', text: '⚠️ 官方能力提示 ⚠️' },
        { type: 'footer', fence: 'text', lines: ['当前时间：{time}', '最后更新：2026-08-28'] }
      ]
    }
  };
}

// 欢迎新用户插件的默认欢迎卡片（{nickname} 为入群新成员昵称占位，渲染时替换）
function defaultWelcomePages() {
  return {
    '欢迎页': {
      blocks: [
        { type: 'avatar', source: 'member' },
        { type: 'title', text: '**🎉 欢迎新用户入群**' },
        { type: 'meta', show: ['nickname', 'group'] },
        { type: 'divider', text: '━━━━━━━━━━━━━━' },
        { type: 'intro', text: '欢迎 {nickname} 加入本群！完成 QQ 绑定后可跨群识别身份、使用签到/运势等功能 ↓' },
        {
          type: 'rows',
          rows: [
            [
              { label: '📱 绑定QQ', type: 'cmd', value: '绑定QQ' }
            ],
            [
              { label: '📋 我的签到', type: 'cmd', value: '我的签到' },
              { label: '🎲 掷骰子', type: 'cmd', value: '掷骰子' }
            ]
          ]
        },
        { type: 'tips', text: '📌 点击「绑定QQ」链接，指令会填入输入框，点发送后按提示回复你的 QQ 号即可' },
        { type: 'divider', text: '━━━━━━━━━━━━━━' },
        { type: 'footer_title', text: '❤️ 欢迎新成员' },
        { type: 'footer', fence: 'text', lines: ['当前时间：{time}', '新人昵称：{nickname}'] }
      ]
    }
  };
}

// 未内置模板的插件给通用模板（插件读取 config 后即可渲染生效）
function defaultGenericPages() {
  return {
    '主菜单': {
      blocks: [
        { type: 'avatar', source: 'user' },
        { type: 'title', text: '**🧩 插件功能菜单**' },
        { type: 'meta', show: ['nickname', 'userid', 'group'] },
        { type: 'divider', text: '━━━━━━━━━━━━━━' },
        { type: 'intro', text: '点下方链接，指令会填入输入框，点发送即可使用 ↓' },
        { type: 'rows', rows: [[{ label: '✏️ 编辑此菜单', type: 'cmd', value: '编辑菜单' }]] },
        { type: 'tips', text: '📌 该插件尚未声明卡片渲染规则，以上为通用模板；插件读取配置后即生效' },
        { type: 'divider', text: '━━━━━━━━━━━━━━' },
        { type: 'footer', fence: 'text', lines: ['当前时间：{time}'] }
      ]
    }
  };
}

function defaultPagesFor(name: string) {
  if (name === '欢迎新用户') return defaultWelcomePages();
  if (name === '测试菜单') return defaultTestMenuPages();
  return defaultGenericPages();
}

function defaultConfigFor(name: string): any {
  const pages = defaultPagesFor(name);
  const first = Object.keys(pages)[0] || '主菜单';
  return { show_avatar: true, main_page: first, pages };
}

// 查询插件 id（name 匹配，回退 file-{name}）
function findPluginIdFor(name: string): string {
  try {
    const db = getDb();
    // 优先 file-{name} 文件插件 id（与引擎自动发现一致），避免被历史 uuid code 记录抢占导致配置读写错位
    const row = db.prepare('SELECT id FROM plugins WHERE id = ? LIMIT 1').get(`file-${name}`) as any;
    if (row && row.id) return String(row.id);
    const row2 = db.prepare('SELECT id FROM plugins WHERE name = ? LIMIT 1').get(name) as any;
    if (row2 && row2.id) return String(row2.id);
    const row3 = db.prepare('SELECT id FROM plugins WHERE id LIKE ? LIMIT 1').get(`file-${name}`) as any;
    if (row3 && row3.id) return String(row3.id);
  } catch {}
  return 'file-' + name;
}

// 读取全部配置（按 appid/botId 分组）
function readAll(pluginName: string): Record<string, any> {
  const id = findPluginIdFor(pluginName);
  try {
    const db = getDb();
    const row = db.prepare('SELECT value FROM config WHERE key = ?').get(`plugin.${id}.config`) as any;
    if (row && row.value) {
      const parsed = JSON.parse(row.value);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {}
  return {};
}

function writeAll(all: Record<string, any>, pluginName: string): boolean {
  const id = findPluginIdFor(pluginName);
  try {
    const db = getDb();
    db.prepare(
      'INSERT INTO config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP'
    ).run(`plugin.${id}.config`, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

// 清洗单个菜单项（type: cmd=回填指令 / cmd_auto=一键触发 / link=跳转 / image=发送图片 / page=跳转页面 / plugin=调用插件）
function cleanItem(it: any): any | null {
  if (!it || typeof it !== 'object') return null;
  const label = String(it.label || '').trim();
  const type = ['link', 'image', 'page', 'plugin', 'cmd_auto'].indexOf(it.type) >= 0 ? it.type : 'cmd';
  const value = String(it.value || '').trim();
  if (!label || !value) return null;
  const clean: any = { label, type, value };
  // image 发送方式：send=直接发图片URL / draw=AI画图（值=绘画描述）
  if (type === 'image' && it.via === 'draw') clean.via = 'draw';
  return clean;
}

// 用户信息行（meta）合法数据源 key
const META_KEYS = ['nickname', 'userid', 'group', 'role', 'points', 'checkin_streak', 'checkin_date', 'fish_coins', 'fish_catches', 'farm_coins', '__custom'];

// 清洗单个区块
function cleanBlock(b: any, allowGroup = true): any | null {
  if (!b || typeof b !== 'object') return null;
  const t = String(b.type || '');
  const TYPES = allowGroup
    ? ['avatar', 'head_links', 'title', 'meta', 'divider', 'intro', 'rows', 'tips', 'footer_title', 'footer', '__group']
    : ['avatar', 'head_links', 'title', 'meta', 'divider', 'intro', 'rows', 'tips', 'footer_title', 'footer'];
  if (TYPES.indexOf(t) < 0) return null;
  const ALIGNS = ['left', 'center', 'right'];
  const nb: any = { type: t };
  const al = String(b.align || '');
  const defAlign = t === 'avatar' ? 'center' : 'left';
  if (ALIGNS.indexOf(al) >= 0 && al !== defAlign) nb.align = al;
  if (t === '__group') {
    const kids = (Array.isArray(b.children) ? b.children : []).map((k: any) => cleanBlock(k, false)).filter(Boolean);
    if (kids.length) {
      nb.children = kids;
      if (b.gap && Number(b.gap) >= 0 && Number(b.gap) <= 32) nb.gap = Math.round(Number(b.gap));
    }
  } else {
    if (t === 'avatar') {
      nb.source = b.source === 'none' ? 'none' : (b.source === 'member' ? 'member' : b.source === 'fixed' ? 'fixed' : 'user');
      if (nb.source === 'fixed') nb.value = String(b.value || '');
      const w = Math.round(Number(b.width));
      const h = Math.round(Number(b.height));
      if (w >= 20 && w <= 640) nb.width = w;
      if (h >= 20 && h <= 640) nb.height = h;
    } else if (t === 'head_links') {
      if (Array.isArray(b.items)) {
        nb.items = b.items.map(cleanItem).filter(Boolean);
      }
    } else if (t === 'title' || t === 'intro' || t === 'tips' || t === 'divider' || t === 'footer_title') {
      nb.text = String(b.text || '');
    } else if (t === 'meta') {
      const mf = Array.isArray(b.meta_fields) ? b.meta_fields : [];
      if (mf.length) {
        const metaOut: any[] = [];
        for (const f of mf) {
          if (!f || typeof f !== 'object' || !f.key) continue;
          const key = String(f.key);
          if (META_KEYS.indexOf(key) < 0) continue;
          const nf: any = { key };
          if (f.enabled === false) nf.enabled = false;
          const lbl = String(f.label || '').trim();
          if (lbl) nf.label = lbl;
          if (key === '__custom') {
            const pl = String(f.plugin || '').trim();
            const sk = String(f.skey || '').trim();
            if (!pl || !sk) continue;
            nf.plugin = pl;
            nf.skey = sk;
          }
          metaOut.push(nf);
        }
        if (metaOut.length) nb.meta_fields = metaOut;
      } else {
        let show = (Array.isArray(b.show) ? b.show : []).filter((s: any) => META_KEYS.indexOf(String(s)) >= 0);
        if (!show.length) show = ['nickname', 'userid', 'group'];
        nb.show = show;
      }
    } else if (t === 'rows') {
      if (Array.isArray(b.rows)) {
        const rows: any[] = [];
        for (const r of b.rows) {
          if (!Array.isArray(r)) continue;
          const items: any[] = [];
          for (const it of r) {
            const item = cleanItem(it);
            if (item) items.push(item);
          }
          if (items.length) rows.push(items);
        }
        nb.rows = rows;
      }
    } else if (t === 'footer') {
      nb.fence = b.fence === '' ? '' : String(b.fence || 'text');
      nb.lines = (Array.isArray(b.lines) ? b.lines : []).map((l: any) => String(l || '')).filter((l: string) => l !== '');
    }
  }
  return nb;
}

// 清洗一个页面（blocks 模型优先，兼容旧字段）
function cleanPage(pg: any): any | null {
  if (!pg || typeof pg !== 'object') return null;
  if (Array.isArray(pg.blocks)) {
    const blocks = pg.blocks.map((b: any) => cleanBlock(b)).filter(Boolean);
    if (blocks.length) return { blocks };
  }
  const s: any = { title: String(pg.title || ''), intro: String(pg.intro || '') };
  if (Array.isArray(pg.rows)) {
    const rows: any[] = [];
    for (const r of pg.rows) {
      if (!Array.isArray(r)) continue;
      const items: any[] = [];
      for (const it of r) {
        const item = cleanItem(it);
        if (item) items.push(item);
      }
      if (items.length) rows.push(items);
    }
    s.rows = rows;
  }
  s.tips = String(pg.tips || '');
  s.footer_title = String(pg.footer_title || '');
  if (Array.isArray(pg.footer_lines)) {
    s.footer_lines = pg.footer_lines.map((l: any) => String(l || '')).filter((l: string) => l !== '');
  }
  return s;
}

function mergeConfig(cfg: any, pluginName: string): any {
  const def = defaultConfigFor(pluginName);
  const pages = (cfg && cfg.pages && typeof cfg.pages === 'object') ? cfg.pages : def.pages;
  const main = (cfg && cfg.main_page && pages[cfg.main_page]) ? cfg.main_page : def.main_page;
  if (!pages[main]) {
    const keys = Object.keys(pages);
    const m2 = keys[0] || '';
    if (m2) return { show_avatar: cfg ? cfg.show_avatar !== false : true, main_page: m2, pages };
  }
  return {
    show_avatar: cfg ? cfg.show_avatar !== false : true,
    main_page: main,
    pages
  };
}

// 读取插件声明的官方能力清单（单一来源：插件 manifest.capabilities）；未声明/加载失败时回退内置清单
function pluginCapabilitiesFor(pluginName: string): { label: string; value: string; desc: string; available: boolean }[] {
  try {
    const p = path.join(process.cwd(), 'plugins', pluginName + '.js');
    if (fs.existsSync(p)) {
      delete require.cache[require.resolve(p)];
      const mod = require(p) as any;
      const caps = mod && mod.manifest && Array.isArray(mod.manifest.capabilities) ? mod.manifest.capabilities : null;
      if (caps) {
        return caps.map((c: any) => ({
          label: String((c && c.label) || ''),
          value: String((c && c.value) || ''),
          desc: String((c && c.desc) || ''),
          available: !(c && c.available === false)
        })).filter((c: any) => c.label && c.value);
      }
    }
  } catch {}
  return OFFICIAL_CAPABILITIES;
}

// GET /api/menu-config/capabilities?plugin=xxx → 官方开放平台能力清单（编辑器预置选项；默认测试菜单）
router.get('/menu-config/capabilities', (_req, res) => {
  try {
    const pluginName = normalizePluginName(_req.query.plugin);
    res.json({ code: 200, plugin: pluginName, capabilities: pluginCapabilitiesFor(pluginName) });
  } catch (e: any) {
    res.json({ code: 200, capabilities: [], warn: String(e && e.message || e) });
  }
});

// GET /api/menu-config/plugins → 支持卡片编辑的 js 插件列表（永不 500：任何异常降级为空列表 + warn，前端正常编辑）
router.get('/menu-config/plugins', (_req, res) => {
  try {
    const db = getDb();
    // 兼容历史库缺 enabled 列：PRAGMA 探测列，不存在则用常量 0，避免整个接口 500 触发前端降级
    let hasEnabled = true;
    try {
      hasEnabled = (db.prepare('PRAGMA table_info(plugins)').all() as any[]).some((c: any) => c && c.name === 'enabled');
    } catch { hasEnabled = true; }
    const sql = hasEnabled
      ? "SELECT id, name, description, enabled FROM plugins WHERE id LIKE 'file-%' ORDER BY enabled DESC, name"
      : "SELECT id, name, description, 0 AS enabled FROM plugins WHERE id LIKE 'file-%' ORDER BY name";
    const rows = db.prepare(sql).all() as any[];
    const list = rows
      .filter((r: any) => {
        const n = String(r.name || '');
        if (!n) return false;
        if (/\.(py|txt|json|java|mjs|md|log|html?)$/i.test(n)) return false;
        return true;
      })
      .map((r: any) => {
        const meta = readMetaFor(String(r.name));
        return {
          id: String(r.id),
          name: String(r.name),
          description: (meta && meta.description) || String(r.description || ''),
          version: (meta && meta.version) || '',
          trigger: (meta && meta.trigger) || '',
          enabled: !!r.enabled,
          hasDefault: String(r.name) === '测试菜单' || String(r.name) === '欢迎新用户'
        };
      });
    res.json({ code: 200, plugins: list });
  } catch (e: any) {
    res.json({ code: 200, plugins: [], warn: String(e && e.message || e) });
  }
});

// ========== 插件元数据（名称/版本/用途/触发指令说明，可被后台编辑器编辑覆盖） ==========
function metaKeyFor(name: string): string {
  return `plugin.${findPluginIdFor(name)}.meta`;
}

function readMetaFor(name: string): any {
  try {
    const db = getDb();
    const row = db.prepare('SELECT value FROM config WHERE key = ?').get(metaKeyFor(name)) as any;
    if (row && row.value) {
      const parsed = JSON.parse(row.value);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {}
  return null;
}

// GET /api/menu-config/meta?plugin=xxx → 插件元数据（未覆盖时返回插件表原始 manifest 字段）
router.get('/menu-config/meta', (_req, res) => {
  const pluginName = normalizePluginName(_req.query.plugin);
  const db = getDb();
  let base: any = { name: pluginName, version: '', description: '', trigger: '' };
  try {
    const row = db.prepare('SELECT description FROM plugins WHERE name = ? OR id = ? LIMIT 1').get(pluginName, `file-${pluginName}`) as any;
    if (row && row.description) base.description = String(row.description);
  } catch {}
  const meta = readMetaFor(pluginName);
  res.json({ code: 200, plugin: pluginName, meta: Object.assign(base, meta || {}) });
});

// POST /api/menu-config/meta  body: { plugin?, meta: { name?, version?, description?, trigger? } }
router.post('/menu-config/meta', (req, res) => {
  const body = req.body || {};
  const pluginName = normalizePluginName(body.plugin);
  const m = (body.meta && typeof body.meta === 'object') ? body.meta : {};
  const clean: any = {};
  if (m.name) clean.name = String(m.name).trim().substring(0, 50);
  if (m.version) clean.version = String(m.version).trim().substring(0, 30);
  if (m.description) clean.description = String(m.description).trim().substring(0, 500);
  if (m.trigger) clean.trigger = String(m.trigger).trim().substring(0, 500);
  if (!Object.keys(clean).length) {
    res.status(400).json({ code: 400, msg: 'meta 内容为空' });
    return;
  }
  try {
    const db = getDb();
    db.prepare(
      'INSERT INTO config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP'
    ).run(metaKeyFor(pluginName), JSON.stringify(clean));
    res.json({ code: 200, msg: '插件信息已保存', plugin: pluginName, meta: clean });
  } catch (e: any) {
    res.status(500).json({ code: 500, msg: '保存失败', error: String(e && e.message || e) });
  }
});

// POST /api/menu-config/meta/reset  body: { plugin? } → 删除自定义元数据，恢复插件原始信息
router.post('/menu-config/meta/reset', (req, res) => {
  const pluginName = normalizePluginName((req.body || {}).plugin);
  try {
    const db = getDb();
    db.prepare('DELETE FROM config WHERE key = ?').run(metaKeyFor(pluginName));
    res.json({ code: 200, msg: '已恢复插件原始信息', plugin: pluginName });
  } catch (e: any) {
    res.status(500).json({ code: 500, msg: '操作失败', error: String(e && e.message || e) });
  }
});

// GET /api/menu-config?plugin=xxx&appid=xxx → 返回该 appid 配置（未配置返回默认）
router.get('/menu-config', (_req, res) => {
  const pluginName = normalizePluginName(_req.query.plugin);
  const appid = String(_req.query.appid || '').trim();
  const all = readAll(pluginName);
  if (!appid) {
    res.json({ code: 200, plugin: pluginName, configs: all });
    return;
  }
  const cfg = all[appid] && typeof all[appid] === 'object' ? all[appid] : null;
  res.json({ code: 200, plugin: pluginName, config: mergeConfig(cfg, pluginName) });
});

// GET /api/menu-config/keys?plugin=xxx → 已配置的 appid 列表
router.get('/menu-config/keys', (_req, res) => {
  const pluginName = normalizePluginName(_req.query.plugin);
  res.json({ code: 200, keys: Object.keys(readAll(pluginName)) });
});

// GET /api/menu-config/global-link-mode → 全局文字外显模式（on=链接式 / off=纯文本）
router.get('/menu-config/global-link-mode', (_req, res) => {
  let mode = 'on';
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM config WHERE key = 'global_link_mode'").get() as any;
    if (row && row.value) mode = String(row.value) === 'off' ? 'off' : 'on';
  } catch {}
  res.json({ code: 200, mode });
});

// PUT /api/menu-config/global-link-mode  body: { mode: 'on' | 'off' }
router.put('/menu-config/global-link-mode', (req, res) => {
  const mode = String((req.body || {}).mode || 'on') === 'off' ? 'off' : 'on';
  try {
    const db = getDb();
    db.prepare(
      "INSERT INTO config (key, value, updated_at) VALUES ('global_link_mode', ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP"
    ).run(mode);
    res.json({ code: 200, msg: '文字外显模式已切换为' + (mode === 'on' ? '链接式' : '纯文本'), mode });
  } catch (e: any) {
    res.status(500).json({ code: 500, msg: '保存失败', error: String(e && e.message || e) });
  }
});

// POST /api/menu-config  body: { plugin?, appid, config? }  config 为空/缺省 = 恢复默认
router.post('/menu-config', (req, res) => {
  const body = req.body || {};
  const pluginName = normalizePluginName(body.plugin);
  const appid = String(body.appid || '').trim();
  if (!appid) {
    res.status(400).json({ code: 400, msg: '缺少appid参数' });
    return;
  }
  const all = readAll(pluginName);
  const hasConfig = body.config && typeof body.config === 'object' && Object.keys(body.config).length > 0;
  if (!hasConfig) {
    delete all[appid];
    if (writeAll(all, pluginName)) {
      res.json({ code: 200, msg: '已恢复默认配置', plugin: pluginName, config: mergeConfig(null, pluginName) });
    } else {
      res.status(500).json({ code: 500, msg: '保存失败，请检查数据库写入权限' });
    }
    return;
  }
  const clean: any = {};
  clean.show_avatar = !!body.config.show_avatar;
  if (body.config.main_page) clean.main_page = String(body.config.main_page).trim();
  if (body.config.pages && typeof body.config.pages === 'object') {
    const pages: any = {};
    for (const name of Object.keys(body.config.pages)) {
      const n = name.trim();
      if (!n) continue;
      const page = cleanPage(body.config.pages[name]);
      if (page) pages[n] = page;
    }
    clean.pages = pages;
  }
  all[appid] = clean;
  if (writeAll(all, pluginName)) {
    ensureMenuDirs(clean.pages, pluginName);
    res.json({ code: 200, msg: '保存成功', plugin: pluginName, config: mergeConfig(clean, pluginName) });
  } else {
    res.status(500).json({ code: 500, msg: '保存失败，请检查数据库写入权限' });
  }
});

// ========== 外显文字指令扫描：自动读取各插件源码中的 mqqapi 外显链接 ==========
// 匹配 [label](mqqapi://aio/%69nlinecmd?command=指令&enter=false&reply=false) 字面量，
// 以及 ctx.link.linkify('文字','指令') / ctx.engine.menuLink('文字',{value:'指令'}) 这类代码调用。
const EXTERN_LINK_RES = [
  /\[([^\]]+)\]\((mqqapi:\/\/[^)\s]+)\)/g,
  /linkify\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/g,
  /menuLink\(\s*['"]([^'"]+)['"]\s*,\s*\{?[^}]*?value\s*:\s*['"]([^'"]+)['"][^}]*\}?\s*\)/g,
];

function parseExternLinks(code: string): Array<{ label: string; command: string; enter: boolean }> {
  const out: Array<{ label: string; command: string; enter: boolean }> = [];
  if (!code) return out;
  for (const re of EXTERN_LINK_RES) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(code)) !== null) {
      try {
        if (re.source.indexOf('mqqapi') !== -1) {
          const label = m[1];
          const url = m[2];
          let command = '';
          let enter = false;
          const u = new URL(url);
          const cmd = u.searchParams.get('command');
          if (cmd) command = cmd;
          enter = (u.searchParams.get('enter') || 'false') === 'true';
          if (command && label) out.push({ label, command, enter });
        } else {
          const label = m[1];
          const command = m[2];
          if (label && command) out.push({ label, command, enter: false });
        }
      } catch { /* 忽略无法解析的链接 */ }
    }
  }
  // 去重（同一 label+command 只保留一次）
  const seen = new Set<string>();
  return out.filter((x) => {
    const k = x.label + '\u0000' + x.command;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// GET /api/menu-config/extern-links → 扫描全部插件源码，返回各插件的外显文字指令
router.get('/menu-config/extern-links', (_req, res) => {
  try {
    const db = getDb();
    let hasEnabled = true;
    try {
      hasEnabled = (db.prepare('PRAGMA table_info(plugins)').all() as any[]).some((c: any) => c && c.name === 'enabled');
    } catch { hasEnabled = true; }
    const sql = hasEnabled
      ? "SELECT name, enabled FROM plugins WHERE id LIKE 'file-%' ORDER BY enabled DESC, name"
      : "SELECT name FROM plugins WHERE id LIKE 'file-%' ORDER BY name";
    const rows = db.prepare(sql).all() as any[];
    const pluginsDir = path.resolve('plugins');
    const result: Array<{ plugin: string; enabled: boolean; links: Array<{ label: string; command: string; enter: boolean }> }> = [];
    for (const r of rows) {
      const name = String(r.name || '');
      if (!name) continue;
      if (/\.(py|txt|json|java|mjs|md|log|html?)$/i.test(name)) continue;
      let code = '';
      const candidates = [path.join(pluginsDir, name + '.js'), path.join(pluginsDir, name + '.mjs'), path.join(pluginsDir, name)];
      for (const f of candidates) {
        try {
          if (fs.existsSync(f) && fs.statSync(f).isFile()) { code = fs.readFileSync(f, 'utf-8'); break; }
        } catch {}
      }
      const links = parseExternLinks(code);
      if (links.length) result.push({ plugin: name, enabled: !!r.enabled, links });
    }
    res.json({ code: 200, plugins: result });
  } catch (e: any) {
    res.status(500).json({ code: 500, error: String(e && e.message || e) });
  }
});

// ========== 全局用户自定义变量管理（面板可增删改，插件经 ctx.engine.getVariable/setVariable 调用） ==========
const VARS_KEY = 'plugin.vars';

function readVarsMap(): Record<string, string> {
  try {
    const db = getDb();
    const row = db.prepare('SELECT value FROM config WHERE key = ?').get(VARS_KEY) as any;
    const parsed = row && row.value ? JSON.parse(row.value) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

function writeVarsMap(vars: Record<string, string>): boolean {
  try {
    const db = getDb();
    db.prepare(
      'INSERT INTO config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP'
    ).run(VARS_KEY, JSON.stringify(vars));
    return true;
  } catch { return false; }
}

// GET /api/menu-config/vars → 全部变量 { 名称: 值 }
router.get('/menu-config/vars', (_req, res) => {
  res.json({ code: 200, vars: readVarsMap() });
});

// PUT /api/menu-config/vars  body: { name, value } → 新增或更新单个变量
router.put('/menu-config/vars', (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim().replace(/[\\/:*?"<>|]/g, '');
  if (!name) { res.status(400).json({ code: 400, error: '变量名不能为空' }); return; }
  if (name.length > 50) { res.status(400).json({ code: 400, error: '变量名最长 50 字符' }); return; }
  const vars = readVarsMap();
  vars[name] = String(body.value ?? '');
  if (writeVarsMap(vars)) res.json({ code: 200, msg: '已保存', vars });
  else res.status(500).json({ code: 500, error: '保存失败，请检查数据库写入权限' });
});

// DELETE /api/menu-config/vars/:name → 删除变量
router.delete('/menu-config/vars/:name', (req, res) => {
  const name = String(req.params.name || '').trim();
  const vars = readVarsMap();
  if (Object.prototype.hasOwnProperty.call(vars, name)) {
    delete vars[name];
    if (writeVarsMap(vars)) res.json({ code: 200, msg: '已删除', vars });
    else res.status(500).json({ code: 500, error: '删除失败，请检查数据库写入权限' });
    return;
  }
  res.json({ code: 200, msg: '变量不存在', vars });
});

export default router;
