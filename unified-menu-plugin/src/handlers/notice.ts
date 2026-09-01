import type { CtxLike } from '../types';
import { state } from '../core/state';

export async function onMemberJoin(ctx: CtxLike, data: any): Promise<void> {
  const cfg = state.config();
  if (!cfg.welcomeEnabled) return;
  const groupId = data?.groupId || '';
  const botId = data?.botId || '';
  if (!groupId || !state.moduleEnabled(botId, 'welcome')) return;
  const nickname = data?.member?.nickname || '新成员';
  const text = '👋 欢迎 ' + nickname + ' 加入本群！\n\n🎁 本群发送「菜单」有惊喜，快来试试吧~';
  try {
    await ctx.bot.sendGroupMessage(groupId, text);
  } catch (e: any) {
    ctx.logger?.error?.('welcome send failed: ' + (e?.message || String(e)));
  }
}
