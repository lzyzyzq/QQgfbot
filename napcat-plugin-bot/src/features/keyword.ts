import { state } from '../core/state';
import type { GroupEvent } from '../types';

export function addKeyword(event: GroupEvent, args: string): string {
  const idx = args.search(/\s+/);
  if (idx === -1) return '用法：添加关键词 <词> <回复>';
  const kw = args.slice(0, idx).trim();
  const reply = args.slice(idx).trim();
  if (!kw || !reply) return '用法：添加关键词 <词> <回复>';
  const key = `k_${kw}`;
  state.data.keywordReplies[key] = { kw, reply, group: event.group_id ? String(event.group_id) : '' };
  state.saveData();
  return `✅ 关键词「${kw}」→ ${reply}`;
}

export function delKeyword(args: string): string {
  const kw = args.trim();
  if (!kw) return '用法：删除关键词 <词>';
  const key = `k_${kw}`;
  if (state.data.keywordReplies[key]) {
    delete state.data.keywordReplies[key];
    state.saveData();
    return `✅ 已删除关键词「${kw}」`;
  }
  return `未找到关键词「${kw}」`;
}

export function keywordMatch(text: string, groupId: string): string | null {
  for (const v of Object.values(state.data.keywordReplies)) {
    if (v.group && v.group !== String(groupId)) continue;
    if (text.includes(v.kw)) return v.reply;
  }
  return null;
}

export function keywordList(label: string): string {
  const list = Object.values(state.data.keywordReplies);
  return list.length
    ? `${label}：
${list.map((v) => `  ${v.kw} → ${v.reply}`).join('\n')}`
    : `${label}为空。`;
}
