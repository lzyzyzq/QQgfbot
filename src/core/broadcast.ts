// GitHub 云端广播模块
// ------------------------------------------------------------------
// 广播任务定义（broadcast/*.json）托管在 GitHub 仓库：
//   broadcast/broadcast.json      —— 目录/索引；每项任务可「内联完整任务」或 {file:'任务.json'} 引用单文件
//   broadcast/任务.json           —— 单个任务文件（可选，被目录引用）
// 任务字段（JSON）：
//   id        必填，字母/数字/_/-，≤32 位
//   name      名称（群内/面板显示）
//   enabled   默认 true
//   send      'text'（文字） | 'image'（把文字渲染成图片发送）
//   target    'all'（全部群）| 'one'（单一群 groupId）| 'list'（目标群列表 groups）
//   content   固定文本内容（可含 {time} 北京时间、{image:URL} 追加图片）
//   api       可选：{ url, jsonPath? } 从 API 抓取内容广播；jsonPath 用 .a.b[0]，
//             纯文本原文返回，数组/对象逐行/格式化转文本
//   schedule  { time:'HH:MM' }（每天）或 { intervalMin:n }；缺省=手动广播
// 发送范围：全部群 / 单一群 / 目标群；方式：文本或图片；内容可从 API 抓取；
// 定时任务由 schedule-runner 每分钟扫描本机定时任务到点执行（同步接口登记）。
// ------------------------------------------------------------------
import fs from 'fs';
import path from 'path';
import { getDb } from '../db/index';
import { createLogger } from '../utils/logger';
import { renderTextCard } from './card';
import { getBotInstance } from './bot';

const logger = createLogger('broadcast');

export interface BroadcastApi {
  url: string;
  jsonPath?: string;
  /** 数组热点渲染：api.format='list' 时按 TOP 列表输出（取 title/hot/url 常见字段） */
  format?: string;
  /** list 模式最多取几条（默认 10） */
  top?: number;
  /** list 模式标题里的地域文案（对应 {city} 占位） */
  city?: string;
}

export interface BroadcastSchedule {
  time?: string;
  intervalMin?: number;
}

export interface BroadcastTask {
  id: string;
  name: string;
  enabled: boolean;
  send: 'text' | 'image';
  target: 'all' | 'one' | 'list';
  groupId?: string;
  groups?: string[];
  content?: string;
  api?: BroadcastApi;
  schedule?: BroadcastSchedule;
  city?: string;
  createdAt?: string;
}

export interface BroadcastCatalog {
  ok: boolean;
  sourceUrl?: string;
  sourceLabel?: string;
  tasks: BroadcastTask[];
  errors: string[];
}

// 云端广播目录唯一候选源：AI 服务器 8091（用户指定；GitHub 不再作机器人内容源，代码仓库仍照常同步）
export const BROADCAST_URLS: string[] = [
  'https://8091-6f61dc7363389b7a.monkeycode-ai.online/broadcast/broadcast.json',
];

function localRepoDir(): string {
  // 开发/部署目录可能即 git 仓库根（broadcast/ 与 package.json 同级）
  try {
    if (fs.existsSync(path.resolve(process.cwd(), 'broadcast', 'broadcast.json'))) {
      return path.resolve(process.cwd(), 'broadcast');
    }
  } catch {
    /* ignore */
  }
  return '';
}

function bjNowFull(): string {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  const weeks = ['日', '一', '二', '三', '四', '五', '六'];
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} 星期${weeks[d.getUTCDay()]}`;
}

async function httpText(url: string, timeoutMs = 9000): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; QQ-Bot-Server)', 'Accept': '*/*' },
    });
    if (!r.ok) return '';
    return await r.text();
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

/** 单条原始任务（可能是整对象，也可能是含 file 的引用）→ 解析出任务/错误 */
interface RawTask {
  obj?: any;
  file?: string;
}

function pushTask(tasks: BroadcastTask[], errors: string[], index: number, raw: any): void {
  if (!raw || typeof raw !== 'object') {
    errors.push(`第 ${index} 项不是 JSON 对象`);
    return;
  }
  if (typeof raw.file === 'string') return; // 引用交给读取层扩展
  const id = String(raw.id || '').trim();
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(id)) {
    errors.push(`第 ${index} 项缺少合法 id（字母/数字/_/-，≤32 位）`);
    return;
  }
  const name = String(raw.name || id);
  const enabled = raw.enabled !== false;
  const send = String(raw.send || 'text') === 'image' ? 'image' : 'text';
  const target = String(raw.target || 'all') === 'one' ? 'one' : (String(raw.target || '') === 'list' ? 'list' : 'all');
  if (target === 'one' && !String(raw.groupId || '').trim()) {
    errors.push(`任务 ${id} target=one 但缺少 groupId`);
    return;
  }
  if (target === 'list' && (!Array.isArray(raw.groups) || !raw.groups.length)) {
    errors.push(`任务 ${id} target=list 但缺少 groups 列表`);
    return;
  }
  const task: BroadcastTask = {
    id,
    name,
    enabled,
    send,
    target,
    groupId: target === 'one' ? String(raw.groupId).trim() : undefined,
    groups: Array.isArray(raw.groups) ? raw.groups.map((g: any) => String(g).trim()).filter(Boolean) : [],
    content: String(raw.content || ''),
    api: undefined,
    schedule: undefined,
    city: raw.city ? String(raw.city).trim() : undefined,
    createdAt: raw.createdAt ? String(raw.createdAt) : undefined,
  };
  if (send === 'text' && !task.content && (!raw.api || !raw.api.url)) {
    errors.push(`任务 ${id} 既无 content 也无 api.url，将发送空内容`);
  }
  if (raw.api && typeof raw.api === 'object' && String(raw.api.url || '').trim()) {
    const api = raw.api as any;
    task.api = {
      url: String(api.url).trim(),
      jsonPath: api.jsonPath ? String(api.jsonPath) : undefined,
      format: api.format === 'list' ? 'list' : undefined,
      top: Number(api.top) > 0 ? Number(api.top) : undefined,
      city: api.city ? String(api.city).trim() : undefined,
    };
    if (!task.city) task.city = task.api.city || undefined;
  }
  if (raw.schedule && typeof raw.schedule === 'object') {
    const time = String(raw.schedule.time || '').trim();
    const intervalMin = Number(raw.schedule.intervalMin || 0);
    if (intervalMin > 0) task.schedule = { intervalMin };
    else if (/^([01]?\d|2[0-3]):[0-5]\d$/.test(time)) task.schedule = { time };
  }
  tasks.push(task);
}

/** 解析目录文档：支持顶层 { tasks:[...] }、{ files:[...] }、裸数组、或单个任务对象；返回任务与待解析的文件引用 */
function parseDoc(raw: any): { tasks: BroadcastTask[]; errors: string[]; refs: string[] } {
  const tasks: BroadcastTask[] = [];
  const errors: string[] = [];
  const refs: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return { tasks, errors: ['广播目录不是合法 JSON 对象'], refs };
  }
  const files = Array.isArray(raw.files) ? raw.files.map((f: any) => String(f).trim()).filter(Boolean) : [];
  for (const f of files) {
    if (/^[A-Za-z0-9._-]{1,80}\.json$/.test(f)) refs.push(f);
    else errors.push('引用文件格式不合法：' + f);
  }
  const entries = Array.isArray(raw.tasks) ? raw.tasks : (Array.isArray(raw) ? raw : (raw.id !== undefined ? [raw] : []));
  let i = 0;
  for (const rawTask of entries) {
    i += 1;
    if (rawTask && typeof rawTask === 'object' && typeof rawTask.file === 'string') {
      const f = String(rawTask.file).trim();
      if (/^[A-Za-z0-9._-]{1,80}\.json$/.test(f)) refs.push(f);
      else errors.push(`第 ${i} 项 file 引用格式不合法：${f}`);
      continue;
    }
    pushTask(tasks, errors, i, rawTask);
  }
  return { tasks, errors, refs };
}

let cache: BroadcastCatalog | null = null;
let cacheAt = 0;

/** 本地读取某文件（文件引用用）；返回 null 表示不存在/出错 */
function localRead(dir: string, file: string): any | null {
  try {
    const txt = fs.readFileSync(path.join(dir, file), 'utf-8');
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

/** 读取本地 broadcast/ 目录（主文件 + 单文件任务），离线和仓库根调试优先 */
function readLocalCatalog(): BroadcastCatalog | null {
  const dir = localRepoDir();
  if (!dir) return null;
  const main = localRead(dir, 'broadcast.json');
  if (main === null) return null;
  const { tasks, errors, refs } = parseDoc(main);
  for (const f of refs) {
    const sub = localRead(dir, f);
    if (sub === null) {
      errors.push('单文件任务缺失：broadcast/' + f);
      continue;
    }
    // 单文件任务允许是「单个任务对象」或「数组」
    if (Array.isArray(sub)) {
      sub.forEach((o: any, k: number) => pushTask(tasks, errors, k + 1, o));
    } else if (sub && sub.tasks) {
      parseDoc(sub).tasks.forEach((t) => tasks.push(t));
    } else {
      pushTask(tasks, errors, 0, sub);
    }
  }
  return { ok: true, sourceUrl: dir, sourceLabel: '本地仓库 broadcast/', tasks, errors };
}

/** 拉取云端广播目录（多源候选依次尝试，先本地文件后云端）；整目录+文件引用一起读取 */
export async function loadBroadcastCatalog(force = false): Promise<BroadcastCatalog> {
  if (!force && cache && Date.now() - cacheAt < 60000) return cache;
  const errors: string[] = [];
  const local = readLocalCatalog();
  if (local && local.ok) {
    cache = local;
    cacheAt = Date.now();
    return local;
  }
  if (local) errors.push(...local.errors);
  for (const url of BROADCAST_URLS) {
    const text = await httpText(url);
    if (!text) { errors.push(url + '：不可用'); continue; }
    try {
      const { tasks, errors: pe, refs } = parseDoc(JSON.parse(text));
      const base = url.slice(0, url.lastIndexOf('/') + 1);
      for (const f of refs) {
        const subText = await httpText(base + f);
        if (!subText) {
          pe.push('单文件任务缺失：broadcast/' + f);
          continue;
        }
        try {
          const sub = JSON.parse(subText);
          if (Array.isArray(sub)) sub.forEach((o: any, k: number) => pushTask(tasks, pe, k + 1, o));
          else if (sub && sub.tasks) parseDoc(sub).tasks.forEach((t) => tasks.push(t));
          else pushTask(tasks, pe, 0, sub);
        } catch {
          pe.push('单文件任务 ' + f + ' 不是合法 JSON');
        }
      }
      const c: BroadcastCatalog = { ok: true, sourceUrl: url, sourceLabel: url.replace(/^https:\/\//, ''), tasks, errors: pe };
      cache = c;
      cacheAt = Date.now();
      if (pe.length) logger.warn(`云端广播目录解析部分失败: ${pe.join('；')}`);
      return c;
    } catch {
      errors.push(url + '：不是合法 JSON');
    }
  }
  const c: BroadcastCatalog = { ok: false, sourceUrl: '', tasks: [], errors: errors.length ? errors : ['无可用的广播目录源'] };
  cache = c;
  cacheAt = Date.now();
  return c;
}

/** 全部可路由群（group_members 有归属机器人的群；无记录时回退 groups 表） */
export function allBroadcastGroupIds(): string[] {
  try {
    const db = getDb();
    const rows = db
      .prepare("SELECT DISTINCT group_id FROM group_members WHERE group_id != '' AND bot_id != ''")
      .all() as any[];
    const out = rows.map((r: any) => String(r.group_id));
    if (out.length) return out;
    const g = db.prepare("SELECT id FROM groups WHERE id IS NOT NULL AND id != ''").all() as any[];
    return g.map((r: any) => String(r.id));
  } catch {
    return [];
  }
}

/** 任务目标群列表：all→全部可路由群；one→groupId；list→groups */
export function taskTargetGroups(t: BroadcastTask): string[] {
  if (t.target === 'one') return [String(t.groupId || '')].filter(Boolean);
  if (t.target === 'list') return (t.groups || []).slice();
  return allBroadcastGroupIds();
}

/** 立即广播面板/群内支持覆盖目标：default=任务原样；all=全部；this/one=指定群；list=任务列表 */
export function overrideTargetGroups(t: BroadcastTask, target?: string, groupId?: string): string[] | null {
  if (!target || target === 'default') return null;
  if (target === 'all') return allBroadcastGroupIds();
  if (target === 'this' || target === 'one' || target === 'group') {
    const gid = String(groupId || t.groupId || '').trim();
    return gid ? [gid] : null;
  }
  if (target === 'list' && Array.isArray(t.groups) && t.groups.length) return t.groups.slice();
  return null;
}

function lookupValue(o: any, jp: string): any {
  let cur = o;
  const segs = String(jp || '').replace(/\[(\d+)\]/g, '.$1').split('.').map((s) => s.trim()).filter(Boolean);
  for (const s of segs) {
    if (cur == null) return undefined;
    cur = cur[s];
  }
  return cur;
}

/** 拉取 API 内容并转文本：jsonPath 取字段；字符串/数字原文；数组/对象格式化转文本 */
function apiToText(body: any, jp?: string): string {
  let v = body;
  if (jp) v = lookupValue(body, jp);
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    const lines: string[] = [];
    for (const it of v) {
      if (it == null) continue;
      if (typeof it === 'string') lines.push(it.trim());
      else if (typeof it === 'object') {
        const pick = it.title || it.name || it.content || it.text || it.desc;
        if (typeof pick === 'string' && pick.trim()) lines.push(pick.trim());
        else lines.push(JSON.stringify(it, null, 0).slice(0, 200));
      }
      else lines.push(String(it));
    }
    return lines.filter(Boolean).join('\n');
  }
  if (typeof v === 'object') return JSON.stringify(v, null, 2).slice(0, 3000);
  return String(v);
}

// ---------- 热点/资讯列表渲染（头条/微博等热门榜 JSON 通用适配） ----------
const HOT_TITLE_KEYS = ['title', 'Title', 'name', 'Name', 'word', 'Word', 'query', 'Query', 'hotword', 'hotWord', 'HotWord', 'note', 'Note', 'desc', 'Desc', 'content', 'abstract'];
const HOT_SCORE_KEYS = ['hotValue', 'HotValue', 'num', 'Num', 'hot', 'Hot', 'heat', 'Heat', 'readCount', 'ReadCount', 'score', 'Score', 'hot_num', 'hotscore'];
const HOT_URL_KEYS = ['url', 'Url', 'URL', 'link', 'Link'];

function hotPick(it: any, keys: string[]): string {
  if (!it || typeof it !== 'object') return '';
  for (const k of keys) {
    const v = it[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function hotScore(it: any): number {
  const s = hotPick(it, HOT_SCORE_KEYS);
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}

function renderHotList(arr: any[], top: number | undefined, city: string): string {
  const n = Math.max(1, Math.min(top || 10, arr.length));
  const lines = [`【${city || '热点'} TOP ${n}｜${bjNowFull()}】`];
  for (let i = 0; i < n; i++) {
    const it = arr[i];
    if (it == null) continue;
    const title = hotPick(it, HOT_TITLE_KEYS);
    if (!title) continue;
    const score = hotScore(it);
    const url = hotPick(it, HOT_URL_KEYS);
    let line = `${i + 1}. ${title}`;
    if (score > 0) line += `（热度 ${score}）`;
    if (url && /^https?:\/\//.test(url)) line += `\n   ${url}`;
    lines.push(line);
  }
  return lines.join('\n');
}

/** 计算任务广播文本：api.url 优先（失败回退 content）；{time}/{city} 替换；format=list 走热点渲染 */
export async function broadcastContent(t: BroadcastTask): Promise<{ text: string; via: 'content' | 'api' | 'empty'; err?: string }> {
  const city = String(t.city || t.api?.city || '').trim();
  if (t.api && t.api.url) {
    const url = t.api.url.replace(/\{city\}/g, encodeURIComponent(city || ''));
    const text = await httpText(url);
    if (text) {
      try {
        const j = JSON.parse(text);
        const v = lookupValue(j, t.api.jsonPath || '');
        if (t.api.format === 'list' && Array.isArray(v)) {
          return { text: renderHotList(v, t.api.top, city), via: 'api' };
        }
        return { text: apiToText(v == null ? j : v, ''), via: 'api' };
      } catch {
        return { text: text.slice(0, 3000), via: 'api' };
      }
    }
    if (t.content) return { text: t.content.replace(/\{time\}/g, bjNowFull()).replace(/\{city\}/g, city || '本地'), via: 'content', err: 'api 拉取失败，已用预设内容' };
    return { text: '', via: 'empty', err: 'api 拉取失败且无预设内容' };
  }
  const base = String(t.content || '').replace(/\{city\}/g, city || '本地');
  const out = base.replace(/\{time\}/g, bjNowFull());
  return { text: out, via: out.trim() ? 'content' : 'empty' };
}

/** 单群发送：send=image 时把文本渲染成图片发送（失败回退文字） */
async function sendToOne(bot: any, gid: string, text: string, sendImage: boolean): Promise<boolean> {
  if (!text) return false;
  if (sendImage) {
    try {
      const buf = await renderTextCard({ title: '📢 云端广播', text: text.slice(0, 1800), footer: bjNowFull() });
      if (buf && buf.length >= 128) {
        const up = await bot.uploadGroupImageBuffer(gid, buf, 'broadcast.png');
        if (up && (up.file_info || up.url)) {
          await bot.sendGroupImageMessage(gid, up.file_info || up.url);
          return true;
        }
      }
    } catch (err: any) {
      logger.warn(`广播群 ${gid} 图片发送失败，回退文字: ${err && err.message ? err.message : err}`);
    }
  }
  await bot.sendGroupMessage(gid, text);
  return true;
}

function botForGroupSend(gid: string): any {
  try {
    const row = getDb()
      .prepare("SELECT bot_id FROM group_members WHERE group_id = ? AND bot_id != '' ORDER BY last_seen DESC LIMIT 1")
      .get(gid) as any;
    if (row && row.bot_id) {
      const inst = getBotInstance(row.bot_id);
      if (inst) return inst;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

export interface BroadcastSendResult {
  ok: boolean;
  taskId: string;
  taskName: string;
  send: string;
  text: string;
  target: string[];
  total: number;
  sent: number;
  failed: string[];
  message?: string;
}

/** 立即广播：按任务目标（可覆盖 this/one/all/list）逐群发送，返回统计 */
export async function runBroadcastNow(
  t: BroadcastTask,
  opts: { target?: string; groupId?: string; dryRun?: boolean; send?: string } = {},
): Promise<BroadcastSendResult> {
  const { text } = await broadcastContent(t);
  let groups: string[] = overrideTargetGroups(t, opts.target, opts.groupId) || taskTargetGroups(t);
  groups = Array.from(new Set(groups));
  const sendImage = (opts.send ? opts.send === 'image' : t.send === 'image');
  const result: BroadcastSendResult = {
    ok: true,
    taskId: t.id,
    taskName: t.name,
    send: sendImage ? 'image' : 'text',
    text,
    target: groups,
    total: groups.length,
    sent: 0,
    failed: [],
  };
  if (opts.dryRun) {
    result.message = `（试播）将${sendImage ? '以图片' : '以文本'}发送到 ${groups.length} 个群`;
    return result;
  }
  if (!text && !sendImage) {
    result.ok = false;
    result.message = '内容为空，已取消发送（可配置 content 或 api.url）';
    return result;
  }
  for (const gid of groups) {
    try {
      const bot = botForGroupSend(gid);
      if (!bot) {
        result.failed.push(gid + '（无归属机器人）');
        continue;
      }
      const okSent = await sendToOne(bot, gid, text, sendImage);
      if (okSent) result.sent += 1;
      else result.failed.push(gid + '（发送返回空）');
    } catch (e: any) {
      result.failed.push(gid + '（' + ((e && e.message) || e) + '）');
    }
  }
  result.ok = groups.length === 0 || result.failed.length < groups.length;
  if (!groups.length) result.message = '当前没有可广播的群';
  return result;
}

/** 把云端任务登记/更新成本机定时任务（schedule-runner 到点执行；无定时配置的任务跳过） */
export async function syncBroadcastSchedules(): Promise<{
  ok: boolean;
  syncCount: number;
  removeCount: number;
  detail: { id: string; name: string; action: 'add' | 'update' | 'remove' | 'skip' | 'invalid'; time?: string; intervalMin?: number }[];
}> {
  const mod = await import('../shared/bot-controls');
  const cat = await loadBroadcastCatalog(true);
  const existing = mod.listScheduleTasks();
  const keptCloud = new Map<string, { enabled: boolean; scheduled: boolean }>();
  const detail: { id: string; name: string; action: 'add' | 'update' | 'remove' | 'skip' | 'invalid'; time?: string; intervalMin?: number }[] = [];
  for (const t of cat.tasks) {
    const scheduled = !!(t.schedule && (t.schedule.time || (t.schedule.intervalMin || 0) > 0));
    keptCloud.set(t.id, { enabled: t.enabled !== false, scheduled });
    if (!scheduled) {
      detail.push({ id: t.id, name: t.name, action: 'skip' });
      continue;
    }
    const taskId = 'gh_' + t.id;
    const prev = existing.find((x: any) => x.id === taskId);
    const groups = taskTargetGroups(t);
    const body: any = {
      id: taskId,
      type: 'broadcast',
      contentType: 'broadcast',
      text: '',
      time: t.schedule && t.schedule.time ? t.schedule.time : undefined,
      intervalMin: t.schedule && (t.schedule.intervalMin || 0) > 0 ? t.schedule.intervalMin : undefined,
      groups,
      sendType: t.send,
      cloudTaskId: t.id,
      enabled: t.enabled !== false,
    };
    try {
      if (prev) {
        const r = mod.updateScheduleTask({ id: taskId, ...body });
        detail.push({ id: t.id, name: t.name, action: r.ok ? 'update' : 'invalid', time: body.time, intervalMin: body.intervalMin });
      } else {
        const r = mod.createScheduleTask(body);
        detail.push({ id: t.id, name: t.name, action: r.ok ? 'add' : 'invalid', time: body.time, intervalMin: body.intervalMin });
        if (!r.ok) logger.warn(`同步云端广播定时失败 ${t.id}: ${r.error}`);
      }
    } catch (e: any) {
      detail.push({ id: t.id, name: t.name, action: 'invalid', time: body.time, intervalMin: body.intervalMin });
      logger.warn(`同步云端广播定时异常 ${t.id}: ${e.message || e}`);
    }
  }
  // 删除目录中已停用/无定时的旧云任务（不再触发）
  let removeCount = 0;
  for (const prev of existing) {
    if (!String(prev.cloudTaskId || '')) continue;
    const keep = keptCloud.get(String(prev.cloudTaskId));
    if (!keep || !keep.enabled || !keep.scheduled) {
      if (mod.deleteScheduleTask(prev.id)) removeCount += 1;
      detail.push({ id: String(prev.cloudTaskId), name: String(prev.cloudTaskId), action: 'remove' });
    }
  }
  return { ok: cat.ok, syncCount: detail.filter((d) => d.action === 'add' || d.action === 'update').length, removeCount, detail };
}

/** 按 id 取云端任务（立即广播/定时到点执行入口） */
export async function loadBroadcastTaskById(id: string): Promise<BroadcastTask | null> {
  const cat = await loadBroadcastCatalog(true);
  const t = cat.tasks.find((x) => x.id === id);
  return t || null;
}
