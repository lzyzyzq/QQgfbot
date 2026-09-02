import { getConfig, setConfig } from '../db/index';

export interface SwitchDef {
  key: string;
  name: string;
  desc: string;
}

export interface SwitchState extends SwitchDef {
  enabled: boolean;
}

// 功能开关注册表：插件按钮菜单 / 管理面板 / 调度器共用同一份状态（config 表）
export const SWITCH_DEFS: SwitchDef[] = [
  { key: 'morning_report', name: '每日早报', desc: '每日定时推送早报' },
  { key: 'evening_report', name: '每日晚报', desc: '每日定时推送晚报' },
  { key: 'chime', name: '整点报时', desc: '整点/半点准时报时' },
  { key: 'weather_report', name: '天气播报', desc: '定时播报天气' },
  { key: 'broadcast', name: '定时播报', desc: '定时任务播报总开关' },
  { key: 'welcome', name: '欢迎语', desc: '新人入群欢迎消息' },
  { key: 'leave_notice', name: '退群提示', desc: '成员退群提醒' },
  { key: 'checkin', name: '签到系统', desc: '每日签到与积分' },
];

function swKey(key: string): string {
  return 'switch.' + key;
}

export function resolveSwitchKey(input: string): string | null {
  const k = String(input || '').trim();
  if (!k) return null;
  const def = SWITCH_DEFS.find((s) => s.key === k || s.name === k);
  return def ? def.key : null;
}

export function getSwitchStates(): SwitchState[] {
  return SWITCH_DEFS.map((s) => ({
    ...s,
    enabled: (getConfig(swKey(s.key)) || '1') === '1',
  }));
}

export function getSwitchState(key: string): boolean {
  const def = SWITCH_DEFS.find((s) => s.key === key);
  if (!def) return false;
  return (getConfig(swKey(key)) || '1') === '1';
}

export function setSwitchState(input: string, enabled: boolean): SwitchState | null {
  const key = resolveSwitchKey(input);
  const def = key ? SWITCH_DEFS.find((s) => s.key === key) : undefined;
  if (!def) return null;
  setConfig(swKey(def.key), enabled ? '1' : '0');
  return { ...def, enabled };
}

export interface ScheduleTask {
  id: string;
  type: 'broadcast' | 'toggle';
  enabled: boolean;
  botId?: string;
  contentType: string;
  text?: string;
  city?: string;
  time?: string;
  intervalMin?: number;
  groups?: string[];
  switchKey?: string;
  switchTo?: boolean;
  /** contentType='plugin' 时：要读取播报的插件名（如 报时 / 娱乐中心 / 讲笑话） */
  pluginName?: string;
  /** contentType='plugin' 时：传给插件的指令（如 讲个笑话） */
  pluginCommand?: string;
  /** 播报时 @ 的用户（QQ 号或 OpenID，逗号/空格分隔），自动转成 markdown @ */
  atUsers?: string[];
  /** 外显文字模式：true=文本中 [文字](mqqapi://...) 外显链接以 markdown 渲染可点击（默认随全局开关） */
  linkMode?: boolean;
  /** 播报发送方式：text=文字消息（默认），image=将播报文本渲染为图片发送 */
  sendType?: 'text' | 'image';
  /** contentType='broadcast' 时：GitHub 云端广播任务 id（broadcast/broadcast.json 里的 id） */
  cloudTaskId?: string;
}

export const CLOUD_BROADCAST_TYPE = 'broadcast';

const TASK_CFG_KEY = 'schedule_tasks';
const CONTENT_TYPES = ['chime', 'weather', 'morning', 'evening', 'text', 'plugin', 'broadcast'];

function readTasks(): ScheduleTask[] {
  try {
    const raw = getConfig(TASK_CFG_KEY) || '[]';
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeTasks(tasks: ScheduleTask[]) {
  setConfig(TASK_CFG_KEY, JSON.stringify(tasks));
}

function validTime(s: string): boolean {
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test(s || '');
}

export function listScheduleTasks(): ScheduleTask[] {
  return readTasks().sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

function pickId(raw: string, tasks: ScheduleTask[]): { ok: boolean; id?: string; error?: string } {
  const custom = String(raw || '').trim();
  if (!custom) return { ok: true, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) };
  if (!ID_PATTERN.test(custom)) return { ok: false, error: '任务 ID 仅支持字母/数字/_/-，1-32 位' };
  if (tasks.some((t) => t.id === custom)) return { ok: false, error: '任务 ID 已存在：' + custom };
  return { ok: true, id: custom };
}

export function createScheduleTask(input: Partial<ScheduleTask>): { ok: boolean; task?: ScheduleTask; error?: string } {
  const type = input.type === 'toggle' ? 'toggle' : 'broadcast';
  if (type === 'toggle') {
    const swKey = resolveSwitchKey(String(input.switchKey || ''));
    if (!swKey) return { ok: false, error: '未知开关：' + input.switchKey };
    if (typeof input.switchTo !== 'boolean') return { ok: false, error: 'switchTo 需为布尔值' };
    if (!validTime(String(input.time || ''))) return { ok: false, error: '定时开关需要有效时间（HH:MM）' };
  } else {
    if (!CONTENT_TYPES.includes(input.contentType || '')) return { ok: false, error: '无效的播报内容类型' };
    if (input.contentType === 'plugin' && !String(input.pluginName || '').trim()) {
      return { ok: false, error: '读取插件播报需要填写插件名' };
    }
    const hasTime = validTime(String(input.time || ''));
    const hasInterval = Number(input.intervalMin || 0) > 0;
    if (!hasTime && !hasInterval) return { ok: false, error: '需要时间（HH:MM）或间隔分钟数' };
    if (hasInterval && Number(input.intervalMin) < 1) return { ok: false, error: '间隔需 ≥1 分钟' };
  }
  const existing = readTasks();
  const picked = pickId(String(input.id || ''), existing);
  if (!picked.ok) return { ok: false, error: picked.error };
  const task: ScheduleTask = {
    id: picked.id as string,
    type,
    enabled: input.enabled !== false,
    botId: String(input.botId || '').trim() || undefined,
    contentType: type === 'toggle' ? 'toggle' : (input.contentType || 'text'),
    text: input.text || '',
    city: input.city || '',
    time: input.time || '',
    intervalMin: Number(input.intervalMin || 0) > 0 ? Number(input.intervalMin) : undefined,
    groups: Array.isArray(input.groups) && input.groups.length ? input.groups.map((g) => String(g)).filter(Boolean) : [],
    switchKey: type === 'toggle' ? (resolveSwitchKey(String(input.switchKey || '')) || '') : '',
    switchTo: type === 'toggle' ? !!input.switchTo : undefined,
    pluginName: input.pluginName ? String(input.pluginName).trim() : undefined,
    pluginCommand: input.pluginCommand ? String(input.pluginCommand).trim() : undefined,
    atUsers: Array.isArray(input.atUsers) && input.atUsers.length ? input.atUsers.map((u) => String(u).trim()).filter(Boolean) : undefined,
    linkMode: typeof input.linkMode === 'boolean' ? input.linkMode : undefined,
    sendType: input.sendType === 'image' ? 'image' : 'text',
    cloudTaskId: input.contentType === 'broadcast' && input.cloudTaskId ? String(input.cloudTaskId).trim() : undefined,
  };
  const tasks = readTasks();
  tasks.push(task);
  writeTasks(tasks);
  return { ok: true, task };
}

export function updateScheduleTask(input: { id: string; newId?: string } & Partial<ScheduleTask>): { ok: boolean; task?: ScheduleTask; error?: string } {
  const tasks = readTasks();
  const idx = tasks.findIndex((t) => t.id === input.id);
  if (idx === -1) return { ok: false, error: '任务不存在' };
  const cur = tasks[idx];
  const newId = String(input.newId || '').trim();
  if (newId && newId !== cur.id) {
    if (!ID_PATTERN.test(newId)) return { ok: false, error: '任务 ID 仅支持字母/数字/_/-，1-32 位' };
    if (tasks.some((t) => t.id === newId)) return { ok: false, error: '任务 ID 已存在：' + newId };
  }
  const { id: _ignoreId, newId: _ignoreNewId, ...rest } = input as any;
  const next: ScheduleTask = {
    ...cur,
    ...rest,
    id: newId || cur.id,
    intervalMin: input.intervalMin !== undefined ? Number(input.intervalMin) : cur.intervalMin,
  };
  if (next.type === 'broadcast' && !validTime(String(next.time || '')) && !(Number(next.intervalMin || 0) > 0)) {
    return { ok: false, error: '需要时间（HH:MM）或间隔分钟数' };
  }
  tasks[idx] = next;
  writeTasks(tasks);
  return { ok: true, task: next };
}

export function deleteScheduleTask(id: string): { ok: boolean } {
  const tasks = readTasks();
  const next = tasks.filter((t) => t.id !== id);
  if (next.length === tasks.length) return { ok: false };
  writeTasks(next);
  return { ok: true };
}

export function toggleScheduleTask(id: string): { ok: boolean; task?: ScheduleTask; error?: string } {
  const tasks = readTasks();
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) return { ok: false, error: '任务不存在' };
  tasks[idx].enabled = !tasks[idx].enabled;
  writeTasks(tasks);
  return { ok: true, task: tasks[idx] };
}
