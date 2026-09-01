import { state } from '../core/state';
import { callApi, sendMsg } from '../core/actions';
import { stripCQ } from '../core/utils';
import type { PluginContext, GroupEvent } from '../types';

export function isOwner(qq: string | number | undefined): boolean {
  const id = String(qq ?? '');
  return state.config.ownerIds.includes(id) || state.data.owners.includes(id);
}

export function isGroupAdmin(event: GroupEvent): boolean {
  return event.sender?.role === 'owner' || event.sender?.role === 'admin';
}

export function checkOwner(event: GroupEvent): boolean {
  return isOwner(event.user_id) || (event.message_type === 'group' && isGroupAdmin(event));
}

export function checkManagePermission(event: GroupEvent): boolean {
  const p = state.config.recallPermission || 'owner';
  if (p === 'admin') return checkOwner(event);
  return isOwner(event.user_id);
}

export function extractTarget(event: GroupEvent, args: string): { qq: string; duration: string | null } | null {
  const raw = event.raw_message || '';
  const at = raw.match(/\[CQ:at,qq=(\d+)\]/);
  if (at) {
    const nums2 = args.match(/\d+/g);
    const duration = nums2 && nums2.length > 1 ? nums2[nums2.length - 1] : null;
    return { qq: at[1], duration };
  }
  const nums = args.match(/\d+/g);
  if (nums && nums.length) return { qq: nums[0], duration: nums.length > 1 ? nums[1] : null };
  return null;
}

export async function groupInfo(ctx: PluginContext, event: GroupEvent): Promise<void> {
  const res = await callApi(ctx, 'get_group_info', { group_id: String(event.group_id) });
  if (!res) {
    await sendMsg(ctx, event, '获取群信息失败。');
    return;
  }
  const info = res;
  await sendMsg(
    ctx,
    event,
    `【群信息】
群名：${info.group_name}
群号：${event.group_id}
成员数：${info.member_count ?? '未知'}
${info.memo ? `群公告：${info.memo}` : ''}`
  );
}

export async function groupStats(ctx: PluginContext, event: GroupEvent): Promise<void> {
  const res = await callApi(ctx, 'get_group_member_list', { group_id: String(event.group_id) });
  if (!Array.isArray(res)) {
    await sendMsg(ctx, event, '获取成员列表失败。');
    return;
  }
  const list = res;
  const total = list.length;
  const owners = list.filter((m) => m.role === 'owner').length;
  const admins = list.filter((m) => m.role === 'admin').length;
  const male = list.filter((m) => m.sex === 'male').length;
  const female = list.filter((m) => m.sex === 'female').length;
  await sendMsg(
    ctx,
    event,
    `【群统计】
总成员：${total}
群主：${owners}
管理员：${admins}
男：${male} / 女：${female}`
  );
}

export async function groupMuteAll(ctx: PluginContext, event: GroupEvent, action: boolean): Promise<void> {
  const res = await callApi(ctx, 'set_group_whole_ban', { group_id: String(event.group_id), enable: action });
  await sendMsg(ctx, event, res === null ? '操作失败（可能没有权限）' : action ? '✅ 已开启全员禁言' : '✅ 已解除全员禁言');
}

export async function groupMute(ctx: PluginContext, event: GroupEvent, target: string, duration: number): Promise<void> {
  const res = await callApi(ctx, 'set_group_ban', { group_id: String(event.group_id), user_id: target, duration });
  await sendMsg(ctx, event, res === null ? '禁言失败（可能没有权限）' : `✅ 已禁言 ${target} ${duration / 60} 分钟`);
}

export async function groupKick(ctx: PluginContext, event: GroupEvent, target: string): Promise<void> {
  const res = await callApi(ctx, 'set_group_kick', { group_id: String(event.group_id), user_id: target });
  await sendMsg(ctx, event, res === null ? '踢人失败（可能没有权限）' : `✅ 已将 ${target} 移出群聊`);
}

export async function groupPunchCard(ctx: PluginContext, event: GroupEvent): Promise<void> {
  const res = await callApi(ctx, 'send_group_sign', { group_id: String(event.group_id) });
  await sendMsg(ctx, event, res === null ? '群打卡失败（当前 QQ 版本可能不支持）' : '✅ 群打卡成功！');
}

export async function sendPoke(ctx: PluginContext, event: GroupEvent, target: string): Promise<void> {
  if (!target) {
    await sendMsg(ctx, event, '用法：戳一戳 @某人');
    return;
  }
  const params: Record<string, any> = {
    user_id: String(event.user_id),
    target_id: target,
  };
  if (event.message_type === 'group' && event.group_id) {
    params.group_id = String(event.group_id);
  }
  const res = await callApi(ctx, 'send_poke', params);
  await sendMsg(ctx, event, res === null ? '戳一戳失败。' : `👆 已戳了戳 ${target}`);
}

export async function markEssence(ctx: PluginContext, event: GroupEvent, msgId: string): Promise<void> {
  if (!msgId) {
    await sendMsg(ctx, event, '用法：设为精华 <消息ID>');
    return;
  }
  const res = await callApi(ctx, 'set_essence_msg', { message_id: msgId });
  await sendMsg(ctx, event, res === null ? '设置精华失败（需要群主/管理员权限）。' : '✅ 已设为精华消息。');
}

export async function sendGroupAnnouncement(ctx: PluginContext, event: GroupEvent, content: string): Promise<void> {
  if (!content) {
    await sendMsg(ctx, event, '用法：群公告 <内容>');
    return;
  }
  const res = await callApi(ctx, '_send_group_notice', { group_id: String(event.group_id), content });
  await sendMsg(ctx, event, res === null ? '发布群公告失败（需要群主/管理员权限）。' : '✅ 群公告已发布。');
}

export async function setGroupName(ctx: PluginContext, event: GroupEvent, name: string): Promise<void> {
  if (!name) {
    await sendMsg(ctx, event, '用法：设置群名 <名字>');
    return;
  }
  const res = await callApi(ctx, 'set_group_name', { group_id: String(event.group_id), group_name: name });
  await sendMsg(ctx, event, res === null ? '设置群名失败（需要群主权限）。' : `✅ 群名已改为：${name}`);
}

export async function setGroupAdmin(ctx: PluginContext, event: GroupEvent, target: string): Promise<void> {
  if (!target) {
    await sendMsg(ctx, event, '用法：设管理 @某人');
    return;
  }
  const res = await callApi(ctx, 'set_group_admin', { group_id: String(event.group_id), user_id: target, enable: true });
  await sendMsg(ctx, event, res === null ? '设置管理员失败（需要群主权限）。' : `✅ 已将 ${target} 设为管理员。`);
}

export async function removeGroupAdmin(ctx: PluginContext, event: GroupEvent, target: string): Promise<void> {
  if (!target) {
    await sendMsg(ctx, event, '用法：取消管理 @某人');
    return;
  }
  const res = await callApi(ctx, 'set_group_admin', { group_id: String(event.group_id), user_id: target, enable: false });
  await sendMsg(ctx, event, res === null ? '取消管理员失败（需要群主权限）。' : `✅ 已取消 ${target} 的管理员。`);
}

export async function deleteMsg(ctx: PluginContext, event: GroupEvent, msgId: string): Promise<void> {
  if (!msgId) {
    await sendMsg(ctx, event, '用法：撤回 <消息ID>');
    return;
  }
  const res = await callApi(ctx, 'delete_msg', { message_id: msgId });
  await sendMsg(ctx, event, res === null ? '撤回失败。' : '✅ 已尝试撤回。');
}
