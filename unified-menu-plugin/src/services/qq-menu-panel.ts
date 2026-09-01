import type { CtxLike } from '../types';

// QQ 官方自定义菜单与指令面板（服务端 API v2/menu、v2/panels）
// 命令入口：/菜单面板 查询 / 菜单面板 列表 / 菜单面板 创建 ...（仅超管）

function fmt(x: any): string {
  try { return JSON.stringify(x, null, 2); } catch { return String(x); }
}

export async function cmd(ctx: CtxLike, args: string): Promise<string> {
  const a = args.trim().split(/\s+/).filter(Boolean);
  const op = (a[0] || '').toLowerCase();
  const bot = ctx.bot;

  if (!op || op === '查询' || op === '详情' || op === 'query') {
    // 查询全局自定义菜单
    if (a.length <= 1) {
      const r = await bot.getGlobalMenu();
      return '📋 全局自定义菜单：\n' + (r ? fmt(r) : '（空或获取失败）');
    }
    // 查询指令面板详情 /菜单面板 详情 <panel_id>
    if (a[1] === '面板' || op === '详情') {
      const pid = a[a.length - 1];
      const r = await bot.getPanelDetail(pid);
      return '🗂 指令面板详情：\n' + (r ? fmt(r) : '（获取失败）');
    }
    const r = await bot.getGlobalMenu();
    return '📋 全局自定义菜单：\n' + (r ? fmt(r) : '（空或获取失败）');
  }

  if (op === '修改' || op === 'set') {
    const payload = args.slice(args.indexOf(' ') + 1);
    try {
      const r = await bot.setGlobalMenu(JSON.parse(payload));
      return '✅ 全局自定义菜单已修改：\n' + (r ? fmt(r) : '');
    } catch (e: any) {
      return '❌ 修改失败：' + (e?.message || String(e)).slice(0, 200);
    }
  }

  if (op === '列表' || op === 'list') {
    const r = await bot.getPanels();
    return '🗂 指令面板列表：\n' + (r ? fmt(r) : '（空或获取失败）');
  }

  if (op === '创建' || op === 'create') {
    const payload = args.slice(args.indexOf(' ') + 1);
    try {
      const r = await bot.createPanel(JSON.parse(payload));
      return '✅ 指令面板已创建：\n' + (r ? fmt(r) : '');
    } catch (e: any) {
      return '❌ 创建失败：' + (e?.message || String(e)).slice(0, 200);
    }
  }

  if (op === '修改面板' || op === 'edit') {
    const rest = args.split(/\s+/).slice(1);
    const pid = rest[0];
    const payload = rest.slice(1).join(' ');
    try {
      const r = await bot.updatePanel(pid, JSON.parse(payload));
      return '✅ 指令面板已修改：\n' + (r ? fmt(r) : '');
    } catch (e: any) {
      return '❌ 修改失败：' + (e?.message || String(e)).slice(0, 200);
    }
  }

  if (op === '删除' || op === 'delete') {
    const pid = a[1];
    if (!pid) return '❌ 格式：/菜单面板 删除 <panel_id>';
    try {
      await bot.deletePanel(pid);
      return '🗑 指令面板已删除：' + pid;
    } catch (e: any) {
      return '❌ 删除失败：' + (e?.message || String(e)).slice(0, 200);
    }
  }

  if (op === '关联' || op === 'target') {
    const rest = args.split(/\s+/).slice(1);
    const pid = rest[0];
    const payload = rest.slice(1).join(' ');
    try {
      const r = await bot.updatePanelTarget(pid, JSON.parse(payload));
      return '🔗 指令面板关联对象已修改：\n' + (r ? fmt(r) : '');
    } catch (e: any) {
      return '❌ 关联修改失败：' + (e?.message || String(e)).slice(0, 200);
    }
  }

  return '📌 用法：\n/菜单面板 查询（全局菜单）\n/菜单面板 修改 <JSON>\n/菜单面板 列表\n/菜单面板 创建 <JSON>\n/菜单面板 详情 <panel_id>\n/菜单面板 修改面板 <panel_id> <JSON>\n/菜单面板 删除 <panel_id>\n/菜单面板 关联 <panel_id> <JSON>';
}
