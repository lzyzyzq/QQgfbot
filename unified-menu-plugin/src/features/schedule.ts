import type { CtxLike } from '../types';
import { state } from '../core/state';

let timer: ReturnType<typeof setInterval> | null = null;

export function start(ctx: CtxLike): void {
  if (timer) return;
  timer = setInterval(() => {
    try {
      const d = new Date();
      if (d.getMinutes() !== 0 || d.getSeconds() > 30) return;
      const cfg = state.config() as any;
      if (cfg.chimeEnabled !== true) return;
      const groups = state.chimeGroups();
      const msg = '⏰ ' + d.getHours() + ' 点整';
      for (const gid of groups) {
        if (!state.moduleEnabled('', 'chime')) continue;
        try {
          if (cfg.chimeMode === 'image' && ctx.bot.sendMenuCard) {
            ctx.bot.sendMenuCard(gid, { title: '⏰ 报时', subtitle: msg, items: [{ label: '📋 查看主菜单' }], footer: '发送「主菜单」返回' }).catch(() => {});
          } else {
            ctx.bot.sendGroupMessage(gid, msg).catch(() => {});
          }
        } catch {}
      }
    } catch {}
  }, 30000);
}

export function stop(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
