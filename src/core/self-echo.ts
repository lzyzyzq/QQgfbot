// 机器人自产消息回显记录
// QQ 开放平台会把机器人主动发送的消息（定时播报、插件回复等）也作为 webhook 事件推回。
// 若插件对任意消息回复，会形成"发送 → 回推 → 再回复 → 再回推"的无限循环刷屏。
// 通过记录机器人最近发送的内容，webhook 收到匹配的群/私聊消息时判定为自产回显并跳过分发。

interface EchoRecord {
  key: string;
  content: string;
  ts: number;
}

const recentEchoes: EchoRecord[] = [];
const TTL = 120000;
const MAX = 1000;

export function noteSelfSend(key: string, content: string): void {
  const c = String(content || '').trim().slice(0, 300);
  if (!c) return;
  recentEchoes.push({ key, content: c, ts: Date.now() });
  if (recentEchoes.length > MAX) {
    recentEchoes.splice(0, recentEchoes.length - MAX);
  }
}

export function isSelfEcho(key: string, content: string, windowMs = 30000): boolean {
  const c = String(content || '').trim().slice(0, 300);
  if (!c) return false;
  const now = Date.now();
  for (let i = recentEchoes.length - 1; i >= 0; i--) {
    const r = recentEchoes[i];
    if (now - r.ts > TTL) continue;
    if (now - r.ts > windowMs) break;
    if (r.key === key && r.content === c) return true;
  }
  return false;
}

// 发送侧重复抑制：同 key（机器人+群/会话）+内容 在 windowMs 内是否已发送过。
// 与 isSelfEcho 不同：isSelfEcho 只回看最后 windowMs（遇到更旧的记录即 break），
// 这里在全 TTL 窗口内按内容扫描，用于发送前拦截 QQ 会拒绝的重复文本。
export function wasRecentlySent(key: string, content: string, windowMs = 60000): boolean {
  const c = String(content || '').trim().slice(0, 300);
  if (!c) return false;
  const now = Date.now();
  for (let i = recentEchoes.length - 1; i >= 0; i--) {
    const r = recentEchoes[i];
    if (now - r.ts > TTL) continue;
    if (now - r.ts <= windowMs && r.key === key && r.content === c) return true;
  }
  return false;
}

export function clearSelfEcho(): void {
  recentEchoes.length = 0;
}
