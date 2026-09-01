import { state } from '../core/state';
import { sendMsg } from '../core/actions';
import type { PluginContext, GroupEvent } from '../types';

export async function handleNotice(ctx: PluginContext, event: GroupEvent): Promise<void> {
  if (event.post_type !== 'notice') return;
  if (event.notice_type === 'group_increase' && state.config.welcomeMsg) {
    const text = state.config.welcomeMsg.replace('{nickname}', `[CQ:at,qq=${event.user_id}]`);
    await sendMsg(ctx, { message_type: 'group', group_id: event.group_id, user_id: event.user_id } as GroupEvent, text);
  }
  if (event.notice_type === 'group_decrease' && state.config.byeMsg) {
    await sendMsg(ctx, { message_type: 'group', group_id: event.group_id, user_id: event.user_id } as GroupEvent, state.config.byeMsg);
  }
}
