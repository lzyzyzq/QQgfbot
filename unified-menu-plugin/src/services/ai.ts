import { state } from '../core/state';

export async function chat(prompt: string): Promise<string> {
  const cfg = state.config() as any;
  const key = cfg.aiKey || '';
  const base = cfg.aiBaseUrl || 'https://api.deepseek.com/v1';
  const model = cfg.aiModel || 'deepseek-chat';
  if (!key) {
    return '🤖 AI 对话未配置密钥。请在面板 WebUI 或发送「AI配置 Key=你的APIKey」后使用。';
  }
  try {
    const r = await fetch(base.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1024,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return '🤖 AI 调用失败（' + r.status + '）：' + t.slice(0, 120);
    }
    const data: any = await r.json();
    const text = data?.choices?.[0]?.message?.content || '';
    return text ? '🤖 ' + text : '🤖 AI 无返回内容';
  } catch (e: any) {
    return '🤖 AI 调用异常：' + (e?.message || String(e)).slice(0, 120);
  }
}

export function setConfig(key: string, value: string): string {
  const k = key.trim();
  if (k === 'AI配置' || k.startsWith('AI配置 ')) {
    const parts = k.split(/\s+/).slice(1).join(' ').split('=');
    // 无参数时为查询
    const cfg = state.config() as any;
    if (parts.length < 2 || !parts[0] || !parts[1]) {
      return '🔧 AI 配置：\n密钥：' + (cfg.aiKey ? '已配置' : '未配置') + '\n模型：' + (cfg.aiModel || 'deepseek-chat') + '\n发送「AI配置 Key=xxx」设置密钥';
    }
    const kk = parts[0].trim();
    const vv = parts.slice(1).join('=').trim();
    if (kk === 'Key' || kk === 'key') {
      state.setConfig({ aiKey: vv });
      return '🔑 AI 密钥已保存';
    }
    if (kk === 'Model' || kk === 'model') {
      state.setConfig({ aiModel: vv });
      return '🤖 AI 模型已设为：' + vv;
    }
    if (kk === 'Base' || kk === 'base') {
      state.setConfig({ aiBaseUrl: vv });
      return '🌐 AI 接口地址已设为：' + vv;
    }
  }
  return '❓ 格式：AI配置 Key=xxx / Model=xxx / Base=xxx';
}
