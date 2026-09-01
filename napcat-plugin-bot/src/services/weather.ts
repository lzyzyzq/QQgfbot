import { state } from '../core/state';
import { sendMsg } from '../core/actions';
import { httpGet } from '../core/utils';
import type { PluginContext, GroupEvent } from '../types';

export async function weather(ctx: PluginContext, event: GroupEvent, city: string): Promise<void> {
  if (!city) {
    await sendMsg(ctx, event, '用法：天气 <城市>');
    return;
  }
  const cfg = state.config;
  const base = String(cfg.weatherApiUrl || 'https://wttr.in').replace(/\/+$/, '');
  try {
    const url = `${base}/${encodeURIComponent(city)}?format=j1`;
    const res = await httpGet(url, 8000);
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    const data = JSON.parse(res.body);
    const cur = data.current_condition && data.current_condition[0];
    const today = data.weather && data.weather[0];
    if (!cur) throw new Error('无数据');
    const temp = cur.temp_C;
    const desc = cur.lang_zh && cur.lang_zh[0] ? cur.lang_zh[0].value : cur.weatherDesc[0].value;
    const feels = cur.FeelsLikeC;
    const humidity = cur.humidity;
    let msg = `🌤 ${city} 天气
当前：${temp}℃（体感 ${feels}℃）
天气：${desc}
湿度：${humidity}%`;
    if (today) {
      msg += `
最高：${today.maxtempC}℃ / 最低：${today.mintempC}℃`;
    }
    await sendMsg(ctx, event, msg);
  } catch (e: any) {
    await sendMsg(ctx, event, `查询天气失败（${e.message}）。请检查网络或 weatherApiUrl 配置。`);
  }
}
