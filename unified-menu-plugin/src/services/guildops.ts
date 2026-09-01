import type { CtxLike } from '../types';

// 频道管理（子频道 v1 API）：查询/创建/修改/删除/发帖/删帖/公告/活跃度/签到
// 破坏性操作（创建/修改/删除/删帖/违规处理）由调用方做 isMaster 校验

function fmtAny(x: any): string {
  try { return JSON.stringify(x); } catch { return String(x); }
}

export async function guildList(ctx: CtxLike): Promise<string> {
  const gs = await ctx.bot.getGuilds();
  if (!gs || !gs.length) return '📢 频道列表：机器人暂未加入任何频道';
  return '📢 我加入的频道（' + gs.length + '）：\n' + gs.map((g: any) => '• ' + g.name + '（' + g.id + '）').join('\n') + '\n\n发送「频道列表 频道ID」查看子频道';
}

export async function channelList(ctx: CtxLike, guildId: string): Promise<string> {
  if (!guildId) return guildList(ctx);
  const cs = await ctx.bot.getChannels(guildId);
  if (!cs || !cs.length) return '🗂 该频道暂无子频道（' + guildId + '）';
  const lines = cs.map((c: any) => {
    const typeName = c.type === 4 ? '分类' : c.type === 2 ? '语音' : '文字';
    return '• ' + c.name + '（' + c.id + '）[' + typeName + ']';
  });
  return '🗂 子频道列表（' + cs.length + '）：\n' + lines.join('\n');
}

export async function channelDetail(ctx: CtxLike, channelId: string): Promise<string> {
  if (!channelId) return '📄 格式：频道详情 <channel_id>';
  const c = await ctx.bot.getChannelDetail(channelId);
  if (!c) return '❌ 未找到该子频道（' + channelId + '）';
  return '📄 子频道详情：\n' + fmtAny(c).replace(/,/g, '\n');
}

export async function channelCreate(ctx: CtxLike, args: string): Promise<string> {
  const parts = args.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return '📝 格式：创建频道 <频道ID> <名称>';
  const guildId = parts[0];
  const name = parts.slice(1).join(' ');
  try {
    const r = await ctx.bot.createChannel(guildId, { name });
    return '✅ 子频道已创建：' + (r && r.name ? r.name : fmtAny(r));
  } catch (e: any) {
    return '❌ 创建失败：' + (e?.message || String(e));
  }
}

export async function channelRename(ctx: CtxLike, args: string): Promise<string> {
  const parts = args.split(/\s+/);
  if (parts.length < 2) return '✏️ 格式：修改频道 <channel_id> <新名称>';
  const channelId = parts[0];
  const name = parts.slice(1).join(' ');
  try {
    const r = await ctx.bot.modifyChannel(channelId, { name });
    return '✅ 子频道已改名为：' + name + (r ? '' : '（接口无返回）');
  } catch (e: any) {
    return '❌ 修改失败：' + (e?.message || String(e));
  }
}

export async function channelDelete(ctx: CtxLike, channelId: string): Promise<string> {
  if (!channelId) return '🗑 格式：删除频道 <channel_id>';
  try {
    await ctx.bot.deleteChannel(channelId);
    return '🗑 子频道已删除：' + channelId;
  } catch (e: any) {
    return '❌ 删除失败：' + (e?.message || String(e));
  }
}

export async function channelPost(ctx: CtxLike, args: string): Promise<string> {
  const parts = args.split(/\s+/);
  if (parts.length < 2) return '📝 格式：频道发帖 <channel_id> <内容>';
  const channelId = parts[0];
  const content = parts.slice(1).join(' ');
  const r = await ctx.bot.sendMessage(channelId, content);
  return r ? '✅ 已发送到子频道：' + content : '❌ 发送失败（检查子频道ID或机器人权限）';
}

export async function channelDelMsg(ctx: CtxLike, args: string): Promise<string> {
  const parts = args.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return '🗑 格式：频道删帖 <channel_id> <message_id>';
  try {
    await ctx.bot.deleteChannelMessage(parts[0], parts[1]);
    return '🗑 子频道消息已删除';
  } catch (e: any) {
    return '❌ 删除失败：' + (e?.message || String(e));
  }
}

export async function channelAnnounce(ctx: CtxLike, args: string): Promise<string> {
  const parts = args.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return '📢 格式：频道公告 <channel_id> <message_id>';
  return '📢 公告设置：把消息 ' + parts[1] + ' 设为子频道 ' + parts[0] + ' 的公告。\n（官方接口暂不支持直接设置公告，请手动操作或后续版本支持）';
}

export async function channelActivity(ctx: CtxLike, channelId: string): Promise<string> {
  if (!channelId) return '📊 格式：频道活跃度 <channel_id>';
  const msgs = await ctx.bot.getChannelMessages(channelId, 50);
  const n = Array.isArray(msgs) ? msgs.length : 0;
  const authors = new Set<string>();
  if (Array.isArray(msgs)) for (const m of msgs) if (m && m.author && m.author.id) authors.add(m.author.id);
  return '📊 子频道活跃度：\n消息数（最近50条）：' + n + '\n发言成员：' + authors.size + ' 人';
}

export async function channelMute(ctx: CtxLike, args: string): Promise<string> {
  const parts = args.split(/\s+/).filter(Boolean);
  if (parts.length < 3) return '🔇 格式：频道违规 <channel_id> <user_id> <秒数|移除>';
  const [guildId, userId, action] = parts;
  if (action === '移除' || action === 'remove') {
    try {
      await ctx.bot.removeGuildMember(guildId, userId);
      return '✅ 已将成员移出频道';
    } catch (e: any) {
      return '❌ 移除失败：' + (e?.message || String(e));
    }
  }
  const secs = parseInt(action, 10);
  if (isNaN(secs) || secs <= 0) return '🔇 秒数需为正整数，或用「移除」移出频道';
  try {
    await ctx.bot.muteGuildMember(guildId, userId, secs);
    return '🔇 已禁言成员 ' + userId + ' ' + secs + ' 秒';
  } catch (e: any) {
    return '❌ 禁言失败：' + (e?.message || String(e));
  }
}
