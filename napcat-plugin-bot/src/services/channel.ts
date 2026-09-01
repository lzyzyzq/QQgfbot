import { state } from '../core/state';
import { callApi, sendMsg } from '../core/actions';
import type { PluginContext, GroupEvent } from '../types';

export async function channelList(ctx: PluginContext, event: GroupEvent): Promise<void> {
  const raw = await callApi(ctx, 'get_qq_channel_list', {});
  const list = Array.isArray(raw) ? raw : raw?.data || [];
  if (!list || !list.length) {
    await sendMsg(ctx, event, '未获取到频道列表（可能尚未接入频道能力）。');
    return;
  }
  const lines: string[] = [];
  for (const g of list) {
    const guildId = g.guild_id || g.guildId || g.id;
    const guildName = g.guild_name || g.name || '未命名频道组';
    const rawCh = await callApi(ctx, 'get_qq_channel_guild_member_list', { guild_id: guildId });
    const chs = Array.isArray(rawCh) ? rawCh : rawCh?.data || [];
    if (chs && chs.length) {
      lines.push(`📢 ${guildName}（${guildId}）：`);
      for (const c of chs) {
        lines.push(`   - ${c.channel_name || c.name || '未命名'}（${c.channel_id || c.id}）`);
      }
    } else {
      lines.push(`📢 ${guildName}（${guildId}）：暂无频道`);
    }
  }
  await sendMsg(ctx, event, `频道列表（${list.length} 个频道组）：\n${lines.join('\n')}`);
}

export async function channelTest(ctx: PluginContext, event: GroupEvent): Promise<void> {
  const channelId = String(state.config.channelId || '7989734378509876559').trim();
  if (!channelId) {
    await sendMsg(ctx, event, '未配置测试频道 ID（可在插件配置中设置 channelId）。');
    return;
  }
  const res = await callApi(ctx, 'send_qq_channel_msg', {
    channel_id: channelId,
    message: `频道测试：来自${event.message_type === 'group' ? `群 ${event.group_id}` : '私聊'}的测试消息（${new Date().toLocaleString('zh-CN')}）`,
  });
  const ok = res && (res.status === 'ok' || res.retcode === 0 || res.ok === true);
  if (ok) {
    await sendMsg(ctx, event, `✅ 已向频道 ${channelId} 发送测试消息。`);
  } else {
    await sendMsg(ctx, event, `❌ 频道测试发送失败：${res?.message || res?.error || '未知错误'}`);
  }
}
