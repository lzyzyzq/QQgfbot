// 后台「可视化卡片 → 插件源码接入」代码生成器（M3 gen-card 后端核心）
// 职责：
//   1. generatePluginBlockCode(pluginName, config) —— 生成「内置卡片配置 + 渲染接入函数」的 JS 代码段；
//   2. 幂等 marker（/*__UCARD_BEGIN__*/ … /*__UCARD_END__*/）—— 重复生成原位更新，不重复插入；
//   3. injectCodeSegment / stripCodeSegment —— 注入/还原（供 gen-card 与 undo 使用）；
//   4. assertInjectableSourceFile —— 仅 js/mjs 可注入，其它类型抛业务错误（由路由转 400）。
// 生成的代码段风格对齐用户样例插件（module.exports = { manifest, methods, onEnable(ev, ctx) }），
// 自包含一段注释标明「由后台编辑器可视化生成，可手工修改」。
import { configToJs } from '../core/block-render';

/** 幂等 marker（段起点注释） */
export const UCARD_BEGIN = '/*__UCARD_BEGIN__*/';
/** 幂等 marker（段终点注释） */
export const UCARD_END = '/*__UCARD_END__*/';
/** 业务错误文案：非 js/mjs 不支持注入源码（路由据此转 400） */
export const UCARD_UNSUPPORTED_MESSAGE = '该类型不支持注入源码，请使用配置方式渲染';

/** 判断源码是否已含可视化生成段（含 BEGIN 与 END） */
export function hasUCardSegment(code: string): boolean {
  const s = String(code || '');
  return s.indexOf(UCARD_BEGIN) >= 0 && s.indexOf(UCARD_END, s.indexOf(UCARD_BEGIN) + UCARD_BEGIN.length) >= 0;
}

/**
 * 非 js/mjs 文件不可注入（py/php/file 资源、zip 目录的 ts 入口等）：
 * 命中时抛出带 code=ERR_UCARD_UNSUPPORTED 的业务错误，路由捕获后转 400。
 */
export function assertInjectableSourceFile(fileName: string): void {
  if (!/\.(js|mjs)$/i.test(String(fileName || ''))) {
    const err: any = new Error(UCARD_UNSUPPORTED_MESSAGE);
    err.code = 'ERR_UCARD_UNSUPPORTED';
    throw err;
  }
}

/**
 * 生成「内置卡片配置 + 渲染函数」JS 代码段（含幂等 marker，段内自包含注释）。
 * config 为整卡配置 { show_avatar?, main_page, pages }，configToJs 负责序列化。
 */
export function generatePluginBlockCode(pluginName: string, config: any): string {
  const name = String(pluginName || '').trim() || '未命名插件';
  const configJs = configToJs(config);
  const lines: string[] = [];
  lines.push(UCARD_BEGIN);
  lines.push('// ========================================================================');
  lines.push('// 通用卡片接入段：后台「可视化卡片编排」为插件「' + name + '」生成（M3 gen-card）。');
  lines.push('// 由后台编辑器可视化生成，可手工修改；重复生成仅原位更新本段，不覆盖你写的其它逻辑。');
  lines.push('// ------------------------------------------------------------------------');
  lines.push('// 使用方法（在你的插件代码中任选其一）：');
  lines.push('//   1) 触发回复整卡（群聊/私聊自动按 markdown 发送）：');
  lines.push('//        await this.menuCardReply(ctx, data);            // 当前主页面');
  lines.push('//        await this.menuCardReply(ctx, data, \'页面名\'); // 指定页面');
  lines.push('//   2) 只取 markdown 文本不发消息：');
  lines.push('//        var md = renderUniversalMenu(configUniversalMenu, { ctx: ctx, author: data.author, groupId: data.groupId, botId: data.botId });');
  lines.push('// ========================================================================');
  lines.push('');
  lines.push('// 内置卡片配置（可视化编排快照：menu-config 里保存的当前配置；可手工修改）');
  lines.push('var configUniversalMenu = ' + configJs + ';');
  lines.push('');
  lines.push('// 渲染函数：把 config 渲染为 markdown 文本。');
  lines.push('// data 需携带 { ctx }（插件运行上下文，含 ctx.engine 统一渲染 API）；缺省时返回空串。');
  lines.push('function renderUniversalMenu(config, data, page) {');
  lines.push('  var cfg = config || configUniversalMenu;');
  lines.push('  var d = data || {};');
  lines.push('  var ctx = d.ctx || null;');
  lines.push('  var engine = (ctx && ctx.engine) || d.engine || null;');
  lines.push('  var pg = page || null;');
  lines.push('  try {');
  lines.push('    // 指定页面：读存储中的 menu-config 渲染该页');
  lines.push('    if (pg && engine && engine.renderMenu) {');
  lines.push('      var mdp = engine.renderMenu(null, pg, d);');
  lines.push('      if (mdp) return mdp;');
  lines.push('    }');
  lines.push('  } catch (e) {}');
  lines.push('  try {');
  lines.push('    if (engine && engine.renderBlocks) {');
  lines.push('      var md = engine.renderBlocks(cfg, d);');
  lines.push('      if (md) return md;');
  lines.push('    }');
  lines.push('  } catch (e) {}');
  lines.push('  try {');
  lines.push('    if (engine && engine.renderMenu) {');
  lines.push('      var md2 = engine.renderMenu(null, null, d);');
  lines.push('      if (md2) return md2;');
  lines.push('    }');
  lines.push('  } catch (e) {}');
  lines.push('  return \'\';');
  lines.push('}');
  lines.push('');
  lines.push('// 自动把 menuCardReply 方法挂到 CommonJS 插件对象（module.exports.methods.menuCardReply）。');
  lines.push('// ESM(.mjs) 插件无 module 全局，可自行在导出对象 methods 里引用上方 renderUniversalMenu。');
  lines.push('(function (_m) {');
  lines.push('  if (!_m || typeof _m !== \'object\') return;');
  lines.push('  if (!_m.methods) _m.methods = {};');
  lines.push('  if (_m.methods.menuCardReply) return;');
  lines.push('  _m.methods.menuCardReply = async function (ctx, data, page) {');
  lines.push('    try {');
  lines.push('      var d = data || {};');
  lines.push('      if (!d.ctx) d.ctx = ctx;');
  lines.push('      var gid = d.groupId || \'\';');
  lines.push('      var uid = (d.author && d.author.openid) || \'\';');
  lines.push('      var msgId = d.id || undefined;');
  lines.push('      var md = renderUniversalMenu(null, d, page);');
  lines.push('      if (!md) return null;');
  lines.push('      if (ctx && ctx.bot) {');
  lines.push('        if (gid && ctx.bot.sendMarkdownGroup) return await ctx.bot.sendMarkdownGroup(gid, md, msgId);');
  lines.push('        if (uid && ctx.bot.sendMarkdownC2C) return await ctx.bot.sendMarkdownC2C(uid, md, msgId);');
  lines.push('        if (gid && ctx.bot.sendGroupMessage) return await ctx.bot.sendGroupMessage(gid, md, msgId);');
  lines.push('        if (uid && ctx.bot.sendPrivateMessage) return await ctx.bot.sendPrivateMessage(uid, md, msgId);');
  lines.push('      }');
  lines.push('      return md;');
  lines.push('    } catch (e) {');
  lines.push('      try { ctx && ctx.logger && ctx.logger.error(\'通用卡片发送失败: \' + ((e && e.message) || e)); } catch (e2) {}');
  lines.push('      return null;');
  lines.push('    }');
  lines.push('  };');
  lines.push('})(typeof module !== \'undefined\' && module.exports ? module.exports : null);');
  lines.push(UCARD_END);
  return lines.join('\n');
}

/**
 * 把源码中已存在的可视化生成段（BEGIN…END 两行 marker 及其间内容）整块剥离，
 * 返回不含生成段的原文件内容（供 undo / 幂等重生成）。
 * 找不到完整 marker 时原样返回，不做任何改动。
 */
export function stripCodeSegment(code: string): string {
  const s = String(code || '');
  const b = s.indexOf(UCARD_BEGIN);
  if (b < 0) return s;
  const e = s.indexOf(UCARD_END, b + UCARD_BEGIN.length);
  if (e < 0) return s;
  const lineStart = s.lastIndexOf('\n', b) + 1; // BEGIN 所在行行首
  let lineEnd = s.indexOf('\n', e + UCARD_END.length); // END 所在行尾换行（-1 = 无）
  if (lineEnd < 0) lineEnd = s.length;
  else lineEnd = lineEnd + 1; // 连同换行一起移除，保证还原干净
  return s.slice(0, lineStart) + s.slice(lineEnd);
}

/**
 * 注入生成段：
 * - 若源码已含 marker → 先 strip 旧段再原位替换（幂等，不重复累积）；
 * - 否则追加到文件尾。
 * segment 缺省/为空时原样返回 code（无副作用）。
 */
export function injectCodeSegment(code: string, segment?: string): string {
  const seg = segment == null ? '' : String(segment);
  if (!seg) return String(code || '');
  const base = stripCodeSegment(String(code || ''));
  const tail = base.replace(/\n+$/, '');
  if (!tail) return seg.replace(/\n+$/, '') + '\n';
  return tail + '\n' + seg.replace(/\n+$/, '') + '\n';
}
