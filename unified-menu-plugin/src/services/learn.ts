import { state } from '../core/state';

export function learn(keyword: string, reply: string): string {
  if (!keyword || !reply) return '❌ 格式：学习 关键词=回复内容';
  state.setDictItem(keyword, reply);
  return '📚 已学习：' + keyword + ' → ' + reply;
}

export function del(keyword: string): string {
  state.delDictItem(keyword);
  return '🗑 已删除词条：' + keyword;
}

export function list(): string {
  const d = state.dict();
  const keys = Object.keys(d);
  if (!keys.length) return '📋 词条列表：暂无，发送「学习 关键词=回复」添加';
  return '📋 词条列表（' + keys.length + '）：\n' + keys.slice(0, 50).map((k) => '• ' + k).join('\n');
}

export function lookup(content: string): string | null {
  const d = state.dict();
  for (const k of Object.keys(d)) {
    if (k && content.includes(k)) return d[k];
  }
  return null;
}

// 全部功能模块名（moduleEnabled 语义：空列表=全部开启；非空=白名单）
const ALL_MODULES = ['random', 'games', 'learn', 'ai', 'util', 'sign', 'note', 'auth', 'groupadm', 'guild', 'sys'];

export function setDicEnabled(botId: string, on: boolean): string {
  let list = state.modules(botId);
  if (on) {
    if (list.length === 0) return '🟢 dic回复已开启';
    if (!list.includes('learn')) {
      list.push('learn');
      state.setModules(botId, list);
    }
    return '🟢 dic回复已开启';
  }
  if (list.length === 0) {
    state.setModules(botId, ALL_MODULES.filter((m) => m !== 'learn'));
    return '🔴 dic回复已关闭（其他功能保持开启）';
  }
  if (list.includes('learn')) {
    state.setModules(botId, list.filter((m) => m !== 'learn'));
  }
  return '🔴 dic回复已关闭';
}
