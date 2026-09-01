import type { PluginContext, GroupEvent } from '../types';

export async function sendMsg(ctx: PluginContext, event: GroupEvent, message: any): Promise<void> {
  const params: Record<string, any> = {
    message,
    message_type: event.message_type,
  };
  if (event.message_type === 'group' && event.group_id) {
    params.group_id = String(event.group_id);
  }
  if (event.message_type === 'private' && event.user_id) {
    params.user_id = String(event.user_id);
  }
  try {
    await ctx.actions.call('send_msg', params, ctx.adapterName, ctx.pluginManager.config);
  } catch (e: any) {
    ctx.logger?.error('send_msg 失败:', e.message);
  }
}

export async function callApi(ctx: PluginContext, action: string, params: Record<string, any> = {}): Promise<any> {
  try {
    return await ctx.actions.call(action, params || {}, ctx.adapterName, ctx.pluginManager.config);
  } catch (e: any) {
    ctx.logger?.error(`API ${action} 失败:`, e.message);
    return null;
  }
}
