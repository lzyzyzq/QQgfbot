import type { CtxLike, Envelope } from '../types';

// 群管：全员禁言开关（仅超管/小主人）
export async function muteAll(ctx: CtxLike, env: Envelope, enable: boolean): Promise<string> {
  const groupId = env.groupId || '';
  if (!groupId) return enable ? '🔒 全员禁言只能在群聊中使用' : '🔓 解除全员禁言只能在群聊中使用';
  if (!ctx.bot.muteAll) return '❌ 当前机器人不支持全员禁言接口';
  try {
    const r = await ctx.bot.muteAll(groupId, enable);
    if (r || r === undefined) {
      return enable
        ? '🔒 已开启全员禁言（仅群主/管理员可解除）'
        : '🔓 已解除全员禁言，群成员可正常发言';
    }
    return '❌ 操作失败，请确认机器人是群主或管理员';
  } catch (e: any) {
    return '❌ 操作失败：' + (e?.message || String(e));
  }
}

// 提取消息中的 @openid（支持 <@!openid> / <@openid> / 裸 openid）
function extractTarget(args: string): { openid: string; rest: string } {
  const m = args.match(/<@!?([A-Fa-f0-9]+)>/);
  if (m) return { openid: m[1], rest: args.replace(m[0], '').trim() };
  const t = args.trim().split(/\s+/);
  const first = t[0] || '';
  if (/^[A-Fa-f0-9]{20,}$/.test(first)) return { openid: first, rest: t.slice(1).join(' ') };
  return { openid: '', rest: args };
}

function needsGroup(env: Envelope): string | null {
  return env.groupId ? null : '只能在群聊中使用';
}

export async function muteUser(ctx: CtxLike, env: Envelope, args: string): Promise<string> {
  const noGroup = needsGroup(env);
  if (noGroup) return '🔇 ' + noGroup;
  const { openid, rest } = extractTarget(args);
  if (!openid) return '🔇 格式：禁言 <@用户> 分钟（如：禁言 <@openid> 5）';
  const mins = parseInt(rest.split(/\s+/)[0], 10);
  if (isNaN(mins) || mins <= 0) return '🔇 分钟数需为正整数';
  try {
    const r = await ctx.bot.muteMember(env.groupId, openid, mins * 60);
    return r ? '🔇 已禁言该成员 ' + mins + ' 分钟' : '❌ 禁言失败（请确认机器人是群主/管理员）';
  } catch (e: any) {
    return '❌ 禁言失败：' + (e?.message || String(e));
  }
}

export async function unmuteUser(ctx: CtxLike, env: Envelope, args: string): Promise<string> {
  const noGroup = needsGroup(env);
  if (noGroup) return '🔊 ' + noGroup;
  const { openid } = extractTarget(args);
  if (!openid) return '🔊 格式：解禁 <@用户>（如：解禁 <@openid>）';
  try {
    const r = await ctx.bot.unmuteMember(env.groupId, openid);
    return r ? '🔊 已解除该成员的禁言' : '❌ 解禁失败（请确认机器人是群主/管理员）';
  } catch (e: any) {
    return '❌ 解禁失败：' + (e?.message || String(e));
  }
}

export async function kickUser(ctx: CtxLike, env: Envelope, args: string): Promise<string> {
  const noGroup = needsGroup(env);
  if (noGroup) return '👢 ' + noGroup;
  const { openid } = extractTarget(args);
  if (!openid) return '👢 格式：踢人 <@用户>（如：踢人 <@openid>）';
  try {
    const r = await ctx.bot.kickMember(env.groupId, openid);
    return r ? '👢 已将该成员移出本群' : '❌ 踢人失败（请确认机器人是群主/管理员）';
  } catch (e: any) {
    return '❌ 踢人失败：' + (e?.message || String(e));
  }
}
