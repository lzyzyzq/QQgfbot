import { state } from '../core/state';
import { sendMsg } from '../core/actions';
import type { PluginContext, GroupEvent } from '../types';

const SONG_SEARCH_URLS: Record<string, (kw: string) => string> = {
  netease: (kw) => `https://music.163.com/#/search/m/?s=${encodeURIComponent(kw)}`,
  tencent: (kw) => `https://c.y.qq.com/base/fcgi-bin/u?__=yqr2kN_1&t=search&word=${encodeURIComponent(kw)}`,
  kugou: (kw) => `https://www.kugou.com/yy/html/search.html#searchType=yuanqu&searchKeyWord=${encodeURIComponent(kw)}`,
  migu: (kw) => `https://music.migu.cn/v3/music/search?q=${encodeURIComponent(kw)}`,
};

const PLATFORM_NAMES: Record<string, string> = {
  netease: '网易云',
  tencent: 'QQ音乐',
  kugou: '酷狗',
  migu: '咪咕',
};

export async function song(ctx: PluginContext, event: GroupEvent, keyword: string): Promise<void> {
  if (!keyword) {
    await sendMsg(ctx, event, '用法：点歌/唱歌/唱首歌 <歌名>');
    return;
  }
  const platforms: string[] = state.config.songPlatforms || ['netease', 'tencent', 'kugou'];
  const lines = [`🎵 为你找到「${keyword}」的播放/搜索链接：`];
  for (const p of platforms) {
    const fn = SONG_SEARCH_URLS[p];
    if (fn) lines.push(`• ${PLATFORM_NAMES[p] || p}：${fn(keyword)}`);
  }
  await sendMsg(ctx, event, lines.join('\n'));
}
