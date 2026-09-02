// 定时任务执行器：每分钟扫描 schedule_tasks（config 表 schedule_tasks 键），到点执行
// broadcast：chime/weather/morning/evening 生成播报文本，text 发送自定义文本（{time} 替换为北京时间）
// toggle：到点切换 switchKey 开关状态
// 发送目标按群归属路由（group_members 最新 bot_id），无归属回退默认 bot
import { getConfig, setConfig, getDb } from '../db/index';
import { getBotInstance } from './bot';
import { ScheduleTask, getSwitchState } from '../shared/bot-controls';
import { loadBroadcastTaskById, broadcastContent } from './broadcast';
import { renderTextCard } from './card';
import { createLogger } from '../utils/logger';

const runnerLogger = createLogger('schedule-runner');

let timer: NodeJS.Timeout | null = null;
const lastFire: Record<string, string> = {};

function bjNow() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const weeks = ['日', '一', '二', '三', '四', '五', '六'];
  const hhmm = pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
  const ymd = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return {
    hhmm,
    ymd,
    full: `${ymd} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} 星期${weeks[d.getUTCDay()]}`,
  };
}

function botForGroupId(groupOpenid: string) {
  try {
    const row = getDb()
      .prepare("SELECT bot_id FROM group_members WHERE group_id = ? AND bot_id != '' ORDER BY last_seen DESC LIMIT 1")
      .get(groupOpenid) as any;
    if (row && row.bot_id) {
      return getBotInstance(row.bot_id);
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

// 任务发送机器人：优先任务分配的 botId；未分配（旧任务）按群归属路由；都找不到则跳过不发
function botForTask(t: ScheduleTask, gid: string) {
  if (t.botId) {
    const inst = getBotInstance(t.botId);
    if (inst) return inst;
    runnerLogger.warn(`定时任务 ${t.id} 分配的机器人 ${t.botId} 不在线，跳过群 ${gid}`);
    return undefined;
  }
  const inst = botForGroupId(gid);
  if (!inst) runnerLogger.warn(`定时任务 ${t.id} 群 ${gid} 无归属机器人，跳过发送`);
  return inst;
}

// 功能开关门控：broadcast 任务按内容类型对应开关，关闭则跳过发送；toggle 任务不受门控
const SWITCH_BY_TYPE: Record<string, string> = {
  chime: 'chime',
  weather: 'weather_report',
  morning: 'morning_report',
  evening: 'evening_report',
};

function switchEnabledFor(t: ScheduleTask): boolean {
  if (t.type !== 'broadcast') return true;
  return getSwitchState(SWITCH_BY_TYPE[t.contentType] || 'broadcast');
}

// 抓取当日热点标题（知乎日报，免费无需 Key），失败返回空数组
async function fetchHotNews(max = 5): Promise<string[]> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const resp = await fetch('https://news-at.zhihu.com/api/4/news/latest', {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; QQ-Bot-Server)' },
    });
    clearTimeout(timer);
    if (!resp.ok) return [];
    const data: any = await resp.json();
    return ((data && data.stories) || [])
      .slice(0, max)
      .map((s: any) => String(s && s.title || '').trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

// 内容里支持 {image:URL} 模板：文本外附带发送图片
function extractImages(content: string): { text: string; images: string[] } {
  const images: string[] = [];
  const text = String(content || '').replace(/\{image:([^}]+)\}/g, (_m: string, u: string) => {
    const url = String(u || '').trim();
    if (/^https?:\/\//i.test(url)) images.push(url);
    return '';
  });
  return { text: text.trim(), images };
}

// 把 @ 用户列表（QQ 号或 OpenID）解析为 openid 数组：OpenID 原样，QQ 号反查 user_mappings/group_members
function resolveAtOpenids(users: string[]): string[] {
  const out: string[] = [];
  if (!Array.isArray(users) || !users.length) return out;
  const db = getDb();
  for (const u of users) {
    const s = String(u == null ? '' : u).trim();
    if (!s) continue;
    if (/^[A-Fa-f0-9]{16,}$/.test(s)) { out.push(s); continue; }
    if (/^\d{5,15}$/.test(s)) {
      try {
        const r1 = db.prepare('SELECT openid FROM user_mappings WHERE qq_number = ? LIMIT 1').get(s) as any;
        if (r1 && r1.openid) { out.push(r1.openid); continue; }
        const r2 = db.prepare("SELECT member_openid FROM group_members WHERE qq_id = ? AND member_openid != '' LIMIT 1").get(s) as any;
        if (r2 && r2.member_openid) { out.push(r2.member_openid); continue; }
      } catch { /* 忽略单条解析失败 */ }
    }
  }
  return out;
}

// 判断该播报是否需要 markdown 发送：任务显式外显模式、文本含外显/超链接、或配置了 @用户
function needMarkdown(t: ScheduleTask, text: string): boolean {
  if (t.linkMode === true) return true;
  if (/\[[^\]]+\]\((?:https?:|mqqapi:)[^)]*\)/.test(text || '')) return true;
  if (Array.isArray(t.atUsers) && t.atUsers.length) return true;
  return false;
}

// 构建带 @ 的 markdown：@ 置于内容最前
function buildBroadcastMd(text: string, openids: string[]): string {
  if (openids.length) {
    const ats = openids.map((o) => '<at user_id="' + o + '"></at>').join(' ');
    return ats + '\n' + String(text || '');
  }
  return String(text || '');
}

// 发送播报文本：需外显/@ 时走 markdown（可点击外显文字），失败回退普通文本
async function sendBroadcastText(bot: any, gid: string, text: string, t: ScheduleTask): Promise<any> {
  if (needMarkdown(t, text)) {
    const openids = resolveAtOpenids(t.atUsers || []);
    const md = buildBroadcastMd(text, openids);
    try {
      const r = await bot.sendMarkdownGroup(gid, md);
      if (r) return r;
    } catch (err: any) {
      runnerLogger.warn(`定时任务 ${t.id} markdown 发送群 ${gid} 失败，回退文本: ${err && err.message ? err.message : err}`);
    }
  }
  return bot.sendGroupMessage(gid, text);
}

// 读取插件播报：调用插件 broadcast/handleCommand/handle 方法，插件内部用 ctx.bot 按群归属自动路由发送
let schedulerGetEngine: (() => any) | null = null;
export function setSchedulerEngine(getter: () => any): void {
  schedulerGetEngine = getter;
}

async function callPluginBroadcast(t: ScheduleTask, gid: string): Promise<void> {
  try {
    let engine: any = null;
    if (schedulerGetEngine) {
      try { engine = schedulerGetEngine(); } catch (e: any) { runnerLogger.warn(`定时任务 ${t.id} 获取插件引擎异常: ${e && e.message ? e.message : e}`); }
    }
    if (!engine) {
      try {
        const mod: any = require('../api/index');
        if (typeof mod.getPluginEngine === 'function') engine = mod.getPluginEngine();
      } catch (e: any) { runnerLogger.warn(`定时任务 ${t.id} 回退加载插件引擎失败: ${e && e.message ? e.message : e}`); }
    }
    if (!engine || typeof engine.callPluginMethod !== 'function') {
      runnerLogger.warn(`定时任务 ${t.id} 插件引擎不可用，跳过插件播报`);
      return;
    }
    const name = String(t.pluginName || '').trim();
    if (!name) return;
    const cmd = String(t.pluginCommand || t.text || '').trim();
    const fakeData: any = {
      botId: t.botId || '',
      groupId: gid,
      author: { openid: '__scheduler__', username: '定时任务' },
      content: cmd,
      id: undefined,
    };
    const methods = ['broadcast', 'handleCommand', 'handle'];
    for (const m of methods) {
      try {
        await engine.callPluginMethod(name, m, fakeData);
        runnerLogger.info(`定时任务 ${t.id} 插件播报已触发: 插件=${name} 方法=${m} 群=${gid}`);
        return;
      } catch (e: any) {
        runnerLogger.warn(`定时任务 ${t.id} 插件 ${name}.${m} 调用失败: ${e && e.message ? e.message : e}`);
      }
    }
    runnerLogger.warn(`定时任务 ${t.id} 插件 ${name} 无 broadcast/handleCommand/handle 方法`);
  } catch (err: any) {
    runnerLogger.warn(`定时任务 ${t.id} 插件播报异常: ${err && err.message ? err.message : err}`);
  }
}

async function sendImageFor(bot: any, gid: string, url: string) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const resp = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!resp.ok) return;
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length < 128) return;
    const up = await bot.uploadGroupImageBuffer(gid, buf, 'task_image.png');
    if (up && (up.file_info || up.url)) {
      await bot.sendGroupImageMessage(gid, up.file_info || up.url);
    }
  } catch {
    /* ignore */
  }
}

// 播报文本渲染为图片发送：任务选择「图片」发送时使用；渲染/发送失败回退文字
const TEXT_TITLE: Record<string, string> = {
  chime: '整点报时',
  weather: '天气播报',
  morning: '每日早报',
  evening: '每日晚报',
  text: '定时播报',
};
async function sendTextImage(bot: any, gid: string, text: string, t: ScheduleTask): Promise<void> {
  try {
    const buf = await renderTextCard({
      title: TEXT_TITLE[t.contentType] || '定时播报',
      text,
      footer: bjNow().full,
    });
    if (buf.length < 128) return;
    const up = await bot.uploadGroupImageBuffer(gid, buf, 'broadcast.png');
    if (up && (up.file_info || up.url)) {
      await bot.sendGroupImageMessage(gid, up.file_info || up.url);
      return;
    }
  } catch (err: any) {
    runnerLogger.warn(`定时任务 ${t.id} 图片发送群 ${gid} 失败，回退文字: ${err && err.message ? err.message : err}`);
  }
  await bot.sendGroupMessage(gid, text);
}

function contentFor(t: ScheduleTask): string {
  const n = bjNow();
  if (t.contentType === 'chime') return `⏰ 整点报时\n${n.full}`;
  if (t.contentType === 'weather') {
    return `🌤 定时天气播报（${t.city || '北京'}）\n${n.full}\n请在网页后端配置天气接口以获取完整播报`;
  }
  if (t.contentType === 'morning') {
    return t.text ? `🌅 每日早报\n${t.text}` : `🌅 早上好！\n${n.full}\n美好的一天从此刻开始～`;
  }
  if (t.contentType === 'evening') {
    return t.text ? `🌇 每日晚报\n${t.text}` : `🌙 晚上好！\n${n.full}\n今天辛苦啦，早点休息～`;
  }
  return String(t.text || '').replace('{time}', n.full);
}

function applySwitch(t: ScheduleTask) {
  try {
    const key = String(t.switchKey || '');
    if (!key) return;
    const cur = getConfig(key);
    if (t.switchTo === true && String(cur) !== 'true') setConfig(key, 'true');
    else if (t.switchTo === false && String(cur) !== 'false') setConfig(key, 'false');
  } catch {
    /* ignore */
  }
}

// 抓取天气播报内容：调用本服务天气接口（含 5 天预报），失败返回 null 走默认占位
async function fetchWeatherText(city: string): Promise<string | null> {
  try {
    const port = process.env.PORT || '3000';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const resp = await fetch('http://127.0.0.1:' + port + '/api/bot/weather?city=' + encodeURIComponent(city || '北京'), {
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const d: any = await resp.json();
    if (!d || !d.ok) return null;
    const days: any[] = Array.isArray(d.forecast7) && d.forecast7.length
      ? d.forecast7
      : (Array.isArray(d.forecast5) ? d.forecast5 : []);
    const wd = ['日', '一', '二', '三', '四', '五', '六'];
    let lines = '🌤 天气播报（' + (d.city || city) + '）\n━━━━━━━━━━━━━━\n';
    lines += '当前：' + (d.desc || '-') + ' ' + (d.temp ?? '-') + '°C';
    if (d.feels) lines += '（体感' + d.feels + '°C）';
    if (d.humidity) lines += ' 湿度' + d.humidity + '%';
    if (d.wind) lines += ' ' + (d.winddir || '') + (d.windLevel || d.wind || '') + '级';
    lines += '\n';
    if (d.today) lines += d.today + '\n';
    if (d.warnings && d.warnings.length) {
      const w0 = d.warnings[0];
      lines += '⚠️ ' + (w0.type || '预警') + (w0.level || '') + '：' + String(w0.content || '').slice(0, 50) + '\n';
    }
    const ext: string[] = [];
    for (const day of days) {
      const mx = Number(day.maxT), mn = Number(day.minT), dd = String(day.desc || '');
      if (!isNaN(mx) && mx >= 35) ext.push('高温' + mx + '°C');
      if (!isNaN(mn) && mn <= 0) ext.push('低温' + mn + '°C');
      if (/雷暴/.test(dd)) ext.push('雷暴');
      if (/大雨|暴雨|强降雨/.test(dd)) ext.push('强降雨');
    }
    if (ext.length) lines += '⚠️ 极端天气提示：' + Array.from(new Set(ext)).slice(0, 3).join('、') + '\n';
    if (days.length) {
      lines += '━━━━━━━━━━━━━━\n📅 未来' + days.length + '天\n';
      for (let i = 0; i < days.length; i++) {
        const day = days[i];
        const wIndex = new Date(String(day.date || '')).getDay();
        lines += (i === 0 ? '今天' : '周' + wd[wIndex]) + ' ' + (day.desc || '-') + ' ' + (day.minT ?? '?') + '~' + (day.maxT ?? '?') + '°C\n';
      }
    }
    const info: string[] = [];
    if (d.sunrise || d.sunset) info.push('☀️ 日出' + (d.sunrise || '-') + ' 日落' + (d.sunset || '-'));
    if (d.air) info.push('😷 空气质量：' + (d.air.level || '-') + ' ' + (d.air.aqi || '-') + (d.air.pm25 ? '（PM2.5 ' + d.air.pm25 + '）' : ''));
    if (d.uvIndex) info.push('🌞 紫外线：' + (d.uvLevel || '-') + ' ' + (d.uvIndex || '-') + (d.uvTip ? '，' + d.uvTip : ''));
    if (d.pressure || d.visibility) info.push('💨 气压' + (d.pressure || '-') + 'hPa 能见度' + (d.visibility || '-') + 'km');
    if (info.length) lines += '━━━━━━━━━━━━━━\n' + info.join('\n') + '\n';
    return lines.replace(/\n+$/, '');
  } catch {
    return null;
  }
}

// 全部群任务（groups 为空）回退到所有有归属机器人的群
function allGroupIds(): string[] {
  try {
    const rows = getDb()
      .prepare("SELECT DISTINCT group_id FROM group_members WHERE group_id != '' AND bot_id != ''")
      .all() as any[];
    return rows.map((r) => String(r.group_id));
  } catch {
    return [];
  }
}

async function dispatch(t: ScheduleTask) {
  if (!switchEnabledFor(t)) {
    runnerLogger.info(`定时任务 ${t.id} 功能开关已关闭，跳过`);
    return;
  }
  let content = contentFor(t);
  let sendAsImage = t.sendType === 'image';
  if (t.contentType === 'broadcast') {
    // GitHub 云端广播：到点重新拉取目录拿最新任务定义（含 content/api），失败跳过
    const bId = String(t.cloudTaskId || '').trim();
    if (!bId) {
      runnerLogger.warn(`定时任务 ${t.id} 缺少云端广播任务 cloudTaskId`);
      return;
    }
    const bt = await loadBroadcastTaskById(bId);
    if (!bt) {
      runnerLogger.warn(`定时任务 ${t.id} 云端广播任务不存在或目录不可用: ${bId}`);
      return;
    }
    const ct = await broadcastContent(bt);
    content = ct.text;
    sendAsImage = bt.send === 'image';
  } else if (t.contentType === 'weather') {
    const w = await fetchWeatherText(t.city || '北京');
    if (w) content = w;
  } else if (t.contentType === 'morning' || t.contentType === 'evening') {
    const hot = await fetchHotNews();
    if (hot.length) {
      const head = t.contentType === 'morning' ? '🔥 早热点' : '🌙 晚热点';
      content += '\n━━━━━━━━━━━━━━\n' + head + '\n' + hot.map((h, i) => (i + 1) + '. ' + h).join('\n');
    }
  }
  const { text, images } = extractImages(content);
  const groups = Array.isArray(t.groups) && t.groups.length ? t.groups : allGroupIds();
  runnerLogger.info(`定时任务触发: id=${t.id} type=${t.type} contentType=${t.contentType} time=${t.time || '-'} botId=${t.botId || '按群归属'} groups=${groups.length} images=${images.length} plugin=${t.pluginName || '-'} at=${Array.isArray(t.atUsers) ? t.atUsers.length : 0} linkMode=${t.linkMode === undefined ? '全局' : t.linkMode}`);
  for (const gid of groups) {
    try {
      const bot = botForTask(t, gid);
      if (!bot) continue;
      if (t.contentType === 'plugin') {
        await callPluginBroadcast(t, gid);
        continue;
      }
      if (text) {
        if (sendAsImage) {
          await sendTextImage(bot, gid, text, t);
          runnerLogger.info(`定时任务 ${t.id} 已以图片发送到群 ${gid}`);
        } else {
          sendBroadcastText(bot, gid, text, t)
            .then(() => runnerLogger.info(`定时任务 ${t.id} 已发送到群 ${gid}`))
            .catch((err: any) => runnerLogger.warn(`定时任务 ${t.id} 发送群 ${gid} 失败: ${err && err.message ? err.message : err}`));
        }
      }
      for (const imgUrl of images) {
        await sendImageFor(bot, gid, imgUrl);
      }
    } catch (err: any) {
      runnerLogger.warn(`定时任务 ${t.id} 发送群 ${gid} 异常: ${err && err.message ? err.message : err}`);
    }
  }
}

function tick() {
  try {
    const raw = getConfig('schedule_tasks') || '[]';
    const tasks = (JSON.parse(raw) as ScheduleTask[]) || [];
    const n = bjNow();
    for (const t of tasks) {
      if (!t.enabled) continue;
      if (t.type === 'toggle') {
        const fk = t.id + '@' + n.hhmm;
        if (t.time === n.hhmm && lastFire[fk] !== n.ymd) {
          lastFire[fk] = n.ymd;
          applySwitch(t);
        }
        continue;
      }
      const interval = Number(t.intervalMin || 0);
      if (interval > 0) {
        const last = Number(lastFire[t.id + '@iv'] || 0);
        const nowTs = Date.now();
        if (nowTs - last >= interval * 60 * 1000) {
          lastFire[t.id + '@iv'] = String(nowTs);
          dispatch(t);
        }
        continue;
      }
      const fk = t.id + '@' + n.hhmm;
      if (t.time === n.hhmm && lastFire[fk] !== n.ymd) {
        lastFire[fk] = n.ymd;
        dispatch(t);
      }
    }
  } catch {
    /* ignore */
  }
}

export function startScheduleRunner(getEngine?: () => any) {
  if (getEngine) setSchedulerEngine(getEngine);
  if (timer) return;
  timer = setInterval(tick, 60 * 1000);
  if (typeof timer.unref === 'function') timer.unref();
  tick();
}

export function stopScheduleRunner() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
