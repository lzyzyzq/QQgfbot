import { state } from './core/state';
import { buildConfigUI, groupEnabled } from './config';
import { handleMessage } from './handlers/message';
import { handleNotice } from './handlers/notice';
import { checkSchedules } from './features/schedule';
import type { PluginContext } from './types';

export let plugin_config_ui: any[] = [];

function startTimers(): void {
  const sched = setInterval(() => {
    try {
      checkSchedules();
    } catch (e: any) {
      state.ctx?.logger?.error('定时任务出错', e);
    }
  }, 30000);
  const chime = setInterval(() => {
    try {
      if (!state.config.hourlyChime) return;
      const d = new Date();
      if (d.getMinutes() === 0) {
        const msg = `⏰ ${d.getHours()} 点整`;
        for (const gid of Object.keys(state.data.groupSwitches)) {
          if (!groupEnabled(gid)) continue;
          state.ctx?.actions
            .call('send_msg', { message: msg, message_type: 'group', group_id: gid }, state.ctx.adapterName, state.ctx.pluginManager.config)
            .catch(() => {});
        }
      }
    } catch {}
  }, 30000);
  state.pushTimer(sched);
  state.pushTimer(chime);
}

export async function plugin_init(ctx: PluginContext): Promise<void> {
  state.init(ctx);
  ctx.logger.info('智能机器人插件初始化...');
  if (state.config.ownerIds && state.config.ownerIds.length) {
    const ids = String(state.config.ownerIds).split(/[，,;\s]+/).filter(Boolean);
    for (const id of ids) if (!state.data.owners.includes(id)) state.data.owners.push(id);
    state.saveData();
  }
  try {
    plugin_config_ui = buildConfigUI(ctx);
  } catch (e: any) {
    ctx.logger.warn('构建配置 UI 失败:', e);
  }
  startTimers();
  ctx.logger.info('智能机器人插件就绪');
}

export async function plugin_onmessage(ctx: PluginContext, event: any): Promise<void> {
  try {
    await handleMessage(ctx, event);
  } catch (e: any) {
    ctx.logger.error('处理消息异常:', e);
  }
}

export async function plugin_onevent(ctx: PluginContext, event: any): Promise<void> {
  try {
    await handleNotice(ctx, event);
  } catch (e: any) {
    ctx.logger.error('处理通知异常:', e);
  }
}

export async function plugin_cleanup(ctx: PluginContext): Promise<void> {
  ctx.logger.info('智能机器人插件清理中...');
  state.cleanup();
}

export async function plugin_get_config(): Promise<Record<string, any>> {
  return state.config;
}

export async function plugin_set_config(_ctx: PluginContext, config: Record<string, any>): Promise<void> {
  state.replaceConfig(config);
}
