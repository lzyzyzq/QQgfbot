// 通用卡片区块渲染核心（M3 统一渲染 API 的纯函数底座）
// 由「测试菜单」插件内置的 blocks→markdown 渲染逻辑（renderBlocks/alignPad/metaLines/
// renderMetaField/menuLink/nowText 等，见 .monkeycode-tmp-files/d742ff89-long-input…txt）移植而来，
// 抽为无引擎依赖的纯模块，供引擎级 renderCard/renderMenu/renderBlocks 与后台代码生成器复用。
// 区块类型与 menu-editor.html blockDefaults / menu-config sanitize 保持一致：
// avatar / head_links / title / meta / divider / intro / rows / tips / footer_title / footer / __group。
// 所有函数对脏输入容错：缺字段/非法 type 一律跳过，绝不抛异常。
//
// config 结构（三种形态均可）：
//   1) blocks 数组：[{ type, ... }]
//   2) 单页对象：{ blocks: [...] }
//   3) 整卡配置：{ show_avatar?, main_page, pages: { 页面名: { blocks: [...] } } }

export interface BlockRenderEngineLike {
  /** 生成菜单链接 markdown：type='link' 直接跳转，否则 mqqapi inlinecmd 回填指令（cmd_auto 一键触发） */
  menuLink?(label: string, item: any): string;
  /** OpenID → 用户聚合信息（含 nickname/qq_number/avatar 等） */
  getUserProfile?(openid: string, limit?: number): any;
  /** 群 OpenID → 群名 */
  getGroupName?(groupOpenid: string): string;
  /** 群 OpenID → 数字群号 */
  getGroupNumber?(groupOpenid: string): string;
  /** 群内成员角色（owner/admin/member/user/空） */
  getGroupMemberRole?(groupId: string, memberOpenid: string): string;
  /** 群成员头像 URL */
  getGroupMemberAvatar?(groupId: string, openid: string): string;
  /** 跨插件读取 storage 值 */
  getPluginStorage?(target: string, key: string): string | null;
  /** 查群主 { openid, qq_id, nickname, role } */
  findGroupOwner?(groupId: string): { openid: string; qq_id?: string; nickname?: string; role?: string } | null;
}

/** 渲染上下文（可选）：真实渲染用户相关信息行（meta）时提供引擎工具与身份判定 */
export interface BlockRenderCtxLike {
  engine?: BlockRenderEngineLike;
  identity?: {
    isSameUser?(openidA: string, openidB: string): boolean;
  };
}

/** 渲染数据（可选）：消息事件上下文，用于取发送者昵称/OpenID/群 OpenID 等 */
export interface BlockRenderData {
  author?: { openid?: string; username?: string; [k: string]: any } | null;
  groupId?: string;
  botId?: string;
  id?: string;
  [k: string]: any;
}

export interface BlockRenderOptions {
  /** 当前时间（{time} 占位替换用），缺省 Date.now() */
  now?: number | Date;
}

const DEFAULT_META_LABEL: Record<string, string> = {
  nickname: '👤 昵称',
  userid: '🆔 用户ID',
  group: '👥 群信息',
  role: '🔑 群内权限',
  points: '💰 积分',
  checkin_streak: '🔥 连续签到',
  checkin_date: '📅 最近签到',
  fish_coins: '🎣 钓鱼金币',
  fish_catches: '🐟 钓鱼收获',
  farm_coins: '🌾 农场金币',
};

const META_KEYS = ['nickname', 'userid', 'group', 'role', 'points', 'checkin_streak', 'checkin_date', 'fish_coins', 'fish_catches', 'farm_coins', '__custom'];

/** 区块类型的默认渲染字段名（用于 avatar 缺省宽度等） */
const DEFAULT_DIVIDER = '━━━━━━━━━━━━━━';

// ========== 时间格式化（固定北京时间 UTC+8，与测试菜单插件 nowText 一致） ==========
function nowText(at: Date): string {
  const d = new Date(at.getTime() + 8 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
}

// ========== 对齐近似（QQ markdown 无 text-align）：center 补 2 个全角空格，right 补 3 个 ==========
function alignPad(align: unknown, _def: string): string {
  if (align === 'right') return '　　　';
  if (align === 'center') return '　　';
  return '';
}

/** 从 ctxLike/默认实现解析菜单链接（与 engine.menuLink 同规则） */
function menuLinkOf(ctxLike: BlockRenderCtxLike | undefined | null, label: string, item: any): string {
  try {
    const fn = ctxLike && ctxLike.engine && ctxLike.engine.menuLink;
    if (fn) {
      const md = fn(label, item);
      if (typeof md === 'string' && md) return md;
    }
  } catch { /* 忽略引擎异常，走内置实现 */ }
  const type = (item && item.type) || 'cmd';
  let value = String((item && item.value) || '');
  if (type === 'link') return '[' + label + '](' + value + ')';
  if (type === 'image') value = (item && item.via === 'draw') ? '__draw:' + value : '__img:' + value;
  else if (type === 'page') value = '__page:' + value;
  else if (type === 'plugin') value = '__call:' + value;
  const enter = type === 'cmd_auto';
  return '[' + label + '](mqqapi://aio/%69nlinecmd?command=' + encodeURIComponent(value) + '&enter=' + enter + '&reply=false)';
}

/** 清洗后的 meta 字段列表：meta_fields 优先，其次 show 数组 */
function normalizeMetaFields(b: any): any[] {
  if (Array.isArray(b.meta_fields) && b.meta_fields.length) {
    const out: any[] = [];
    for (const f of b.meta_fields) {
      if (f && typeof f === 'object' && f.key) out.push(f);
    }
    return out;
  }
  let show = b.show || [];
  if (typeof show === 'string') show = [show];
  if (!Array.isArray(show)) show = [];
  const out: any[] = [];
  for (const s of show) {
    if (typeof s === 'string' && s) out.push({ key: s });
    else if (s && typeof s === 'object' && s.key) out.push(s);
  }
  return out;
}

/** 渲染单个 meta 字段值行；无上下文/数据时不虚构用户数据，返回 null 表示该行省略 */
function renderMetaFieldLine(
  ctxLike: BlockRenderCtxLike | undefined | null,
  data: BlockRenderData | undefined | null,
  f: any,
  env: { nickname: string; qq: string; userId: string; gid: string; groupName: string; groupNumber: string },
): string | null {
  const label = (f.label && String(f.label).trim()) || DEFAULT_META_LABEL[f.key] || '';
  const key = f.key;
  if (key === 'nickname') {
    return (label || '👤 昵称') + '：' + env.nickname + (env.qq ? '（QQ: ' + env.qq + '）' : '');
  }
  if (key === 'userid') return (label || '🆔 用户ID') + '：' + (env.userId || '未绑定');
  if (key === 'group') {
    if (!env.gid) return null;
    const gname = env.groupName || '未命名群';
    const gsuffix = env.groupNumber ? '（群号：' + env.groupNumber + '）' : '（' + env.gid + '）';
    return (label || '👥 群信息') + '：' + gname + gsuffix;
  }
  if (key === 'role') {
    if (!env.gid) return null;
    let role = '';
    try {
      const fn = ctxLike && ctxLike.engine && ctxLike.engine.getGroupMemberRole;
      if (fn) role = String(fn(env.gid, env.userId) || '');
    } catch { role = ''; }
    let txt: string;
    if (role === 'owner') txt = '群主';
    else if (role === 'admin') txt = '管理员';
    else if (role === 'super' || role === 'master') txt = '主人';
    else if (role) txt = role;
    else {
      // 群成员角色未设置时回退实时判断：超主 → 主人；群主 openid 同人 → 群主
      let isS = false;
      const same = ctxLike && ctxLike.identity && ctxLike.identity.isSameUser;
      const getPluginStorage = ctxLike && ctxLike.engine && ctxLike.engine.getPluginStorage;
      try {
        let sm: string | null = null;
        if (getPluginStorage) {
          try { sm = getPluginStorage('开关机控制', 'super_master_id'); } catch { sm = null; }
        }
        if (sm && same) {
          let arr: any = null;
          try { arr = JSON.parse(sm); } catch { arr = null; }
          if (Array.isArray(arr)) {
            for (const sid of arr) { if (same(String(sid), env.userId)) { isS = true; break; } }
          } else if (arr && typeof arr === 'object') {
            if (arr.id && same(String(arr.id), env.userId)) isS = true;
          } else if (sm && same(sm, env.userId)) isS = true;
        }
      } catch { /* 忽略 */ }
      let owner: any = null;
      try {
        const findOwner = ctxLike && ctxLike.engine && ctxLike.engine.findGroupOwner;
        if (findOwner) owner = findOwner(env.gid);
      } catch { owner = null; }
      if (isS) txt = '主人';
      else if (owner && same && same(String(owner.openid || ''), env.userId)) txt = '群主';
      else txt = '普通成员';
    }
    return (label || '🔑 群内权限') + '：' + txt;
  }
  if (key === 'points') {
    const v = readCrossStorage(ctxLike, '签到系统', 'checkin_' + env.userId + '_total');
    return (label || '💰 积分') + '：' + (v || '0');
  }
  if (key === 'checkin_streak') {
    const v = readCrossStorage(ctxLike, '签到系统', 'checkin_' + env.userId + '_streak');
    return (label || '🔥 连续签到') + '：' + (v || '0') + ' 天';
  }
  if (key === 'checkin_date') {
    const v = readCrossStorage(ctxLike, '签到系统', 'checkin_' + env.userId + '_date');
    return (label || '📅 最近签到') + '：' + (v || '未签到');
  }
  if (key === 'fish_coins' || key === 'fish_catches') {
    const raw = readCrossStorage(ctxLike, '娱乐中心', 'fish_' + env.userId);
    let obj: any = null;
    try { obj = raw ? JSON.parse(raw) : null; } catch { obj = null; }
    if (key === 'fish_coins') return (label || '🎣 钓鱼金币') + '：' + ((obj && obj.coins) || 0);
    return (label || '🐟 钓鱼收获') + '：' + ((obj && obj.catches) || 0) + ' 条';
  }
  if (key === 'farm_coins') {
    const raw = readCrossStorage(ctxLike, '娱乐中心', 'farm_' + env.userId);
    let obj: any = null;
    try { obj = raw ? JSON.parse(raw) : null; } catch { obj = null; }
    return (label || '🌾 农场金币') + '：' + ((obj && obj.coins) || 0);
  }
  if (key === '__custom') {
    const skey = String(f.skey || '').replace(/\{id\}/g, env.userId);
    const plugin = String(f.plugin || '').trim();
    if (!plugin || !skey) return null;
    const prefix = 'data:';
    if (plugin.indexOf(prefix) === 0) {
      // data: 数据文件型取值依赖插件 ctx.data.readJSON，纯渲染核心未提供时跳过
      const ctxData = (ctxLike as any) && (ctxLike as any).data;
      const readJSON = ctxData && ctxData.readJSON;
      if (!readJSON) return null;
      const fileName = plugin.substring(prefix.length).trim();
      if (!fileName) return null;
      const segs = skey.split(':');
      const uidTok = (segs[0] || '').trim();
      const field = (segs.slice(1).join(':') || '').trim();
      const uid = uidTok === '{id}' ? env.userId : uidTok;
      let dobj: any = null;
      try { dobj = readJSON(fileName, null); } catch { dobj = null; }
      const title = label || '📊 ' + fileName;
      if (dobj && typeof dobj === 'object') {
        const member = dobj[uid] !== undefined ? dobj[uid] : (dobj.members ? dobj.members[uid] : undefined);
        if (member !== undefined && member !== null) {
          const val = field ? member[field] : member;
          return title + '：' + (val === undefined || val === null ? '无' : String(val));
        }
      }
      return title + '：无';
    }
    const v = readCrossStorage(ctxLike, plugin, skey);
    return (label || '📊 ' + skey) + '：' + (v || '无');
  }
  return null;
}

function readCrossStorage(ctxLike: BlockRenderCtxLike | undefined | null, target: string, key: string): string | null {
  try {
    const fn = ctxLike && ctxLike.engine && ctxLike.engine.getPluginStorage;
    return fn ? fn(target, key) : null;
  } catch { return null; }
}

/** 从任意配置形态中解析出「页面 blocks 数组」 */
export function resolvePageBlocks(config: any): any[] {
  if (!config || typeof config !== 'object') return [];
  if (Array.isArray(config)) return config;
  // 形态 2：{ blocks: [...] }
  if (Array.isArray((config as any).blocks)) return (config as any).blocks;
  // 形态 3：{ main_page, pages: {...} }
  const pages = (config as any).pages;
  if (pages && typeof pages === 'object') {
    const keys = Object.keys(pages);
    if (!keys.length) return [];
    let key = '';
    const main = (config as any).main_page;
    if (main && pages[main]) key = main;
    else key = keys[0];
    const page = pages[key];
    if (page && Array.isArray(page.blocks)) return page.blocks;
    return [];
  }
  return [];
}

/**
 * 把 blocks 配置渲染为 markdown/文本行并 join('\n')。
 * - config：blocks 数组 / { blocks } / { main_page, pages } 三种形态均可
 * - ctxLike / data：可选，提供后 meta 用户信息行会取真实数据；缺省时仅渲染
 *   title/intro/rows/divider/tips/footer 等无需用户上下文的区块行，meta 中依赖
 *   群/用户上下文的行自动省略（不虚构数据）
 * - footer 区块 lines 中的 {time} 占位替换为当前北京时间
 * - 脏输入容错：非法 type / 缺字段一律跳过，不抛异常
 */
export function renderBlocksToMarkdown(
  config: any,
  ctxLike?: BlockRenderCtxLike | null,
  data?: BlockRenderData | null,
  opts?: BlockRenderOptions,
): string {
  try {
    const lines: string[] = [];
    const blocks = resolvePageBlocks(config);
    if (!blocks.length) return '';
    renderBlocksToLines(ctxLike, data, blocks, lines, opts);
    return lines.join('\n');
  } catch {
    // 极端异常兜底：渲染失败返回空串（调用方按无卡片处理）
    return '';
  }
}

/** 内部：按顺序逐区块渲染为文本行（__group 递归处理） */
function renderBlocksToLines(
  ctxLike: BlockRenderCtxLike | undefined | null,
  data: BlockRenderData | undefined | null,
  blocks: any[],
  lines: string[],
  opts?: BlockRenderOptions,
): void {
  const now = opts && opts.now !== undefined ? new Date(opts.now) : new Date();
  const author = data && data.author && typeof data.author === 'object' ? data.author : {};
  const userId = String((author as any).openid || '');
  let profile: any = null;
  try {
    const getProfile = ctxLike && ctxLike.engine && ctxLike.engine.getUserProfile;
    if (getProfile) profile = getProfile(userId, 1);
  } catch { profile = null; }
  const nickname = (profile && profile.nickname) || (author as any).username || (userId || '未绑定昵称');
  const qq = (profile && profile.qq_number) || '';
  const gid = String((data && data.groupId) || '');
  let groupName = '';
  let groupNumber = '';
  if (gid) {
    try {
      const gn = ctxLike && ctxLike.engine && ctxLike.engine.getGroupName;
      if (gn) groupName = String(gn(gid) || '');
    } catch { groupName = ''; }
    try {
      const gnum = ctxLike && ctxLike.engine && ctxLike.engine.getGroupNumber;
      if (gnum) groupNumber = String(gnum(gid) || '');
    } catch { groupNumber = ''; }
  }
  const env = { nickname, qq, userId, gid, groupName, groupNumber };
  const ts = nowText(now);
  const timeText = ts;

  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue;
    const type = String(b.type || '');
    if (!type) continue;
    const pad = alignPad(b.align, type === 'avatar' ? 'center' : 'left');
    switch (type) {
      case 'avatar': {
        if (b.source === 'none') break;
        let avatar = (profile && profile.avatar) || '';
        if (b.source === 'fixed' && b.value) avatar = String(b.value);
        if (b.source === 'member' && gid) {
          try {
            const gmAv = ctxLike && ctxLike.engine && ctxLike.engine.getGroupMemberAvatar;
            const mb = gmAv ? gmAv(gid, userId) : '';
            if (mb) avatar = mb;
          } catch { /* 忽略 */ }
        }
        if (!avatar) break;
        const nw = Math.round(Number(b.width));
        const nh = Math.round(Number(b.height));
        const aw = nw >= 20 && nw <= 640 ? nw : 50;
        const ah = nh >= 20 && nh <= 640 ? nh : 50;
        lines.push(pad + '![头像 #' + aw + 'px #' + ah + 'px](' + avatar + ')');
        break;
      }
      case 'head_links': {
        if (Array.isArray(b.items) && b.items.length) {
          const links: string[] = [];
          for (const it of b.items) {
            if (it && typeof it === 'object' && it.label && it.value) links.push(menuLinkOf(ctxLike, String(it.label), it));
          }
          if (links.length) lines.push(pad + links.join('　|　'));
        }
        break;
      }
      case 'title':
        if (b.text) lines.push(pad + b.text);
        break;
      case 'meta': {
        const fields = normalizeMetaFields(b);
        for (const f of fields) {
          if (f.enabled === false) continue;
          const line = renderMetaFieldLine(ctxLike, data, f, env);
          if (line) lines.push(pad + line);
        }
        break;
      }
      case 'divider':
        lines.push(pad + (b.text || DEFAULT_DIVIDER));
        break;
      case 'intro':
        if (b.text) {
          lines.push(pad + b.text);
          lines.push('');
        }
        break;
      case 'rows': {
        const rows = Array.isArray(b.rows) ? b.rows : [];
        for (const row of rows) {
          if (!row || typeof row !== 'object') continue;
          const items = Array.isArray(row) ? row : [row];
          const cells: string[] = [];
          for (const item of items) {
            if (item && typeof item === 'object' && item.label && item.value) cells.push(menuLinkOf(ctxLike, String(item.label), item));
          }
          if (cells.length) lines.push(pad + cells.join('　|　'));
        }
        break;
      }
      case 'tips':
        if (b.text) {
          lines.push('');
          lines.push(pad + b.text);
        }
        break;
      case 'footer_title':
        if (b.text) lines.push(pad + b.text);
        break;
      case 'footer': {
        const fl = (Array.isArray(b.lines) ? b.lines : []).map((s: any) => String(s).replace(/\{time\}/g, timeText));
        if (fl.length) {
          const fence = b.fence === '' ? '' : String(b.fence || 'text');
          lines.push('');
          if (fence) lines.push('```' + fence);
          for (const line of fl) lines.push(pad + line);
          if (fence) lines.push('```');
        }
        break;
      }
      case '__group': {
        const kids = Array.isArray(b.children) ? b.children : [];
        if (!kids.length) break;
        const kidRows: Array<{ align: string; lines: string[] }> = [];
        for (const kid of kids) {
          if (!kid || typeof kid !== 'object') continue;
          const sub: string[] = [];
          // 子块行内已带各自 align 前缀（递归 renderBlocksToLines 按块 pad），此处不再重复添加
          renderBlocksToLines(ctxLike, data, [kid], sub, opts);
          kidRows.push({ align: kid.align || 'left', lines: sub });
        }
        // 并排近似：每个子块都只产出 1 行且都不含图片 → 用分隔符连成一行；否则按顺序纵向输出
        const allSingle = kidRows.length > 0 && kidRows.every((k) => k.lines.length === 1);
        const anyImg = kidRows.some((k) => /^!\[/.test(k.lines[0] || ''));
        if (allSingle && !anyImg) {
          lines.push(pad + kidRows.map((k) => k.lines[0]).join('　|　'));
        } else {
          for (const kr of kidRows) {
            for (const kl of kr.lines) lines.push(kl);
          }
        }
        break;
      }
      default:
        // 未知类型区块：跳过
        break;
    }
  }
}

/**
 * 把整卡配置（{ show_avatar?, main_page, pages }）序列化为可嵌入 JS 源码的对象字面量字符串。
 * 生成的文本是合法 JS 表达式，可赋值：var configUniversalMenu = <configToJs(...)>;
 */
export function configToJs(config: any): string {
  const safe = resolvePageConfigForJs(config);
  let json = JSON.stringify(safe, null, 2);
  if (json === undefined) json = '{}';
  // 对象键去引号美化（仅匹配行首缩进后的 "key": 形式，不会误伤字符串值）
  json = json.replace(/^(\s*)"([A-Za-z_$][A-Za-z0-9_$]*)"(\s*):/gm, '$1$2$3:');
  return json;
}

/** configToJs 用：归一化为 { show_avatar, main_page, pages }，非法输入返回 {} */
function resolvePageConfigForJs(config: any): any {
  if (!config || typeof config !== 'object') return {};
  const out: any = {};
  if (typeof config.show_avatar === 'boolean') out.show_avatar = config.show_avatar;
  const pages = config.pages && typeof config.pages === 'object' ? config.pages : null;
  if (pages) {
    const cleanPages: any = {};
    for (const name of Object.keys(pages)) {
      const p = pages[name];
      if (p && typeof p === 'object' && Array.isArray(p.blocks) && p.blocks.length) {
        cleanPages[name] = { blocks: p.blocks };
      }
    }
    if (Object.keys(cleanPages).length) {
      out.pages = cleanPages;
      const main = config.main_page && cleanPages[config.main_page] ? config.main_page : Object.keys(cleanPages)[0];
      out.main_page = main;
      return out;
    }
  }
  // 纯 blocks 数组/页对象形态：包装为单一「主菜单」页
  const blocks = resolvePageBlocks(config);
  if (blocks.length) {
    out.pages = { 主菜单: { blocks } };
    out.main_page = '主菜单';
  }
  return out;
}
