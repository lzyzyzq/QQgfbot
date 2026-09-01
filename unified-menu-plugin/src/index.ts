import { state } from './core/state';
import { handle } from './handlers/message';
import { onMemberJoin } from './handlers/notice';
import { start as startSchedule, stop as stopSchedule } from './features/schedule';
import { sendMenu as renderSendMenu } from './menu/render';
import { MENU_TREE, rootOf } from './menu/tree';
import * as panelSvc from './services/qq-menu-panel';
import { webuiSchema } from './config';
import type { CtxLike, Envelope } from './types';

export const plugin_config_ui = webuiSchema;

function makeEnv(data: any, type: string): Envelope {
  const author = (data && data.author) || {};
  return {
    type,
    botId: data?.botId || '',
    groupId: data?.groupId || '',
    channelId: data?.channelId || '',
    userId: author?.openid || author?.id || data?.userId || data?.member_openid || '',
    content: data?.content || '',
    msgId: data?.id || data?.msgId || '',
    raw: data,
  };
}

const plugin: any = {
  manifest: {
    id: 'unified-menu',
    name: '统一菜单',
    version: '1.2.0',
    description: '统一菜单插件：按钮菜单/权限修复/全功能补全（娱乐/签到/授权/群管/频道/DIC）',
    author: '511742399',
  },

  onLoad(ctx: CtxLike): void {
    state.init(ctx);
  },

  onEnable(ctx: CtxLike): void {
    state.init(ctx);
    plugin._off = [];
    const reg = (evt: string, fn: (d: any) => void) => {
      try {
        const lid = ctx.eventBus.on(evt, fn, { pluginId: ctx.pluginId });
        plugin._off.push(lid);
      } catch (e: any) {
        ctx.logger?.error?.('subscribe ' + evt + ' failed: ' + (e?.message || e));
      }
    };
    const safeHandle = (d: any) => {
      handle(ctx, makeEnv(d, 'message')).catch((e: any) => ctx.logger?.error?.('msg: ' + (e?.message || e)));
    };
    reg('message.group', safeHandle);
    reg('message.c2c', safeHandle);
    reg('message.guild', safeHandle);
    reg('group.member.add', (d: any) => {
      onMemberJoin(ctx, d).catch((e: any) => ctx.logger?.error?.('welcome: ' + (e?.message || e)));
    });
    startSchedule(ctx);
    ctx.logger?.info?.('统一菜单插件已启用 v1.2.0（按钮菜单 + 权限修复 + 全功能补全）');
  },

  onDisable(ctx: CtxLike): void {
    stopSchedule();
    if (Array.isArray(plugin._off)) {
      for (const id of plugin._off) {
        try { ctx.eventBus.off(id); } catch {}
      }
    }
    plugin._off = [];
  },

  onUnload(ctx: CtxLike): void {
    this.onDisable(ctx);
  },

  methods: {
    // 供其他插件/管理调用：渲染指定层级菜单
    sendMenu(ctx2: CtxLike, data: any, opts: any): Promise<void> {
      const env: Envelope = {
        type: 'message.group',
        groupId: data?.groupId || '',
        userId: data?.author?.openid || data?.userId || '',
        msgId: data?.id || data?.msgId || '',
      };
      const node = opts?.node || rootOf();
      return renderSendMenu(ctx2, env, node);
    },
    getGlobalMode(ctx2: CtxLike): string {
      try { return ctx2.engine.getGlobalMode(); } catch { return 'text'; }
    },
    setGlobalMode(ctx2: CtxLike, m: string): void {
      try { ctx2.engine.setGlobalMode(m); } catch {}
    },
    getModules(ctx2: CtxLike, botId: string): string[] {
      return state.modules(botId);
    },
    setModules(ctx2: CtxLike, botId: string, list: string[]): string {
      state.setModules(botId, list);
      return 'ok';
    },
    getMenuTree(): any {
      return MENU_TREE;
    },
    queryMenuPanel(ctx2: CtxLike, args: string): Promise<string> {
      return panelSvc.cmd(ctx2, args || '');
    },
  },
};

export default plugin;
