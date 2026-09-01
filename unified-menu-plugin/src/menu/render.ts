import type { CtxLike, Envelope, MenuNode } from '../types';

function getMode(ctx: CtxLike): 'text' | 'image' {
  try {
    const m = ctx.engine.getGlobalMode ? ctx.engine.getGlobalMode() : 'text';
    return m === 'image' ? 'image' : 'text';
  } catch {
    return 'text';
  }
}

// 构建 QQ 键盘按钮：每行最多 4 个、最多 4 行（超出部分仅可通过发送指令触发），末尾附「返回主菜单」按钮。
// 按钮 enter=true：点击后文字填入输入框，用户点发送即触发对应功能。
function buildRows(items: Array<{ label: string; action?: string }>): any[] {
  const rows: any[] = [];
  const maxRows = 4;
  const maxPerRow = 4;
  for (let i = 0; i < items.length && rows.length < maxRows; i += maxPerRow) {
    const chunk = items.slice(i, i + maxPerRow);
    rows.push({
      buttons: chunk.map((it) => {
        const action = it.action || it.label;
        return {
          id: action,
          render_data: { label: it.label, visited_label: it.label, style: 3 },
          action: { type: 2, data: action, enter: true, permission: { type: 2 } },
        };
      }),
    });
  }
  rows.push({
    buttons: [
      {
        id: '主菜单',
        render_data: { label: '🏠 返回主菜单', visited_label: '返回主菜单', style: 3 },
        action: { type: 2, data: '主菜单', enter: true, permission: { type: 2 } },
      },
    ],
  });
  return rows;
}

function keyboardMd(title: string, footer: string): string {
  return '**' + title + '**\n\n👇 点击按钮，按钮文字会自动填入输入框，点发送即可触发\n\n━━━━━━━━━━━━━━\n' + footer;
}

function buildKeyboard(title: string, items: Array<{ label: string; action?: string }>, footer: string): { content: string; rows: any[] } {
  return { content: keyboardMd(title, footer), rows: buildRows(items) };
}

export function plainMenu(title: string, items: Array<{ label: string; action?: string }>, footer: string): string {
  const lines: string[] = [title, ''];
  for (const it of items) {
    lines.push(it.label + '（发送「' + (it.action || it.label) + '」）');
  }
  lines.push('');
  lines.push(footer);
  return lines.join('\n');
}

export async function sendMenu(ctx: CtxLike, env: Envelope, node: MenuNode): Promise<void> {
  const items = (node.children || []).map((c) => ({ label: c.label, action: c.action }));
  const footer = '💖 赞助广告位招租 | 联系QQ:511742399';
  const title = node.label + (node.children ? '（' + node.children.length + '项）' : '');
  const groupId = env.groupId || '';
  const channelId = env.channelId || '';
  const msgId = env.msgId;

  if (!groupId && channelId) {
    // 频道消息：仅支持纯文本
    try {
      await ctx.bot.sendMessage(channelId, plainMenu(title, items, footer), msgId);
    } catch {}
    return;
  }

  if (!groupId) {
    // 私聊：键盘按钮，降级纯文本
    if (ctx.bot.sendKeyboardC2C) {
      try {
        const ok = await ctx.bot.sendKeyboardC2C(env.userId, buildKeyboard(title, items, footer), msgId);
        if (ok) return;
      } catch {}
    }
    try {
      await ctx.bot.sendPrivateMessage(env.userId, plainMenu(title, items, footer), msgId);
    } catch {}
    return;
  }

  if (getMode(ctx) === 'image' && ctx.bot.sendMenuCard) {
    try {
      const ok = await ctx.bot.sendMenuCard(groupId, {
        title: node.label,
        subtitle: '点击菜单项进入或触发功能',
        items: items.map((it) => ({ label: it.label })),
        footer,
      }, msgId);
      if (ok) return;
    } catch {}
  }

  // 文字/按钮模式：QQ 键盘按钮（点击后填入输入框，用户点发送触发）
  if (ctx.bot.sendKeyboardGroup) {
    try {
      const r = await ctx.bot.sendKeyboardGroup(groupId, buildKeyboard(title, items, footer), msgId);
      if (r) return;
    } catch {}
  }

  // 兜底：纯文本
  try {
    await ctx.bot.sendGroupMessage(groupId, plainMenu(title, items, footer), msgId);
  } catch {}
}

export function normalizeMode(ctx: CtxLike): void {
  const m = getMode(ctx);
  if (ctx.engine && ctx.engine.setGlobalMode && m === 'text') {
    // text_link 已被 engine 归一化，这里仅兜底
  }
}
