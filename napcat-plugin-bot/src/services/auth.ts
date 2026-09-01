import { state } from '../core/state';
import { sendMsg } from '../core/actions';
import { httpGet, httpRequest } from '../core/utils';
import type { PluginContext, GroupEvent } from '../types';

export async function fetchAuthCodes(): Promise<{ ok: boolean; msg?: string; codes?: string[] }> {
  const cfg = state.config;
  const base = String(cfg.authServerUrl || '').replace(/\/+$/, '');
  const apiPath = String(cfg.authApiPath || '/api/auth/code');
  let url = base + apiPath;
  if (cfg.authMethod === 'html' && !apiPath.includes('?')) {
    url += `?t=${Date.now()}`;
  }
  try {
    const res = await httpGet(url, cfg.authTimeout);
    if (res.status !== 200) return { ok: false, msg: `授权服务器返回 ${res.status}` };
    if (cfg.authMethod === 'html') {
      const codes2 = (res.body.match(/[A-Z0-9]{8,32}/gi) || []).slice(0, 10);
      if (!codes2.length) return { ok: false, msg: '网页中未提取到授权码' };
      return { ok: true, codes: [...new Set(codes2)].map(String) };
    }
    let data: any;
    try {
      data = JSON.parse(res.body);
    } catch {
      return { ok: false, msg: '授权服务器返回的不是合法 JSON' };
    }
    const field = String(cfg.authCodeField || 'code');
    let codes: any = Array.isArray(data) ? data : data[field];
    if (!codes && data.data) {
      const d = data.data;
      codes = Array.isArray(d) ? d : d[field];
    }
    if (codes === undefined || codes === null) {
      const obj = data;
      codes = obj.codes || obj.list || obj.result || [];
    }
    if (typeof codes === 'string') codes = codes.split(/[\s,，;；]+/).filter(Boolean);
    if (!Array.isArray(codes) || !codes.length) return { ok: false, msg: '授权响应中未找到授权码字段' };
    return { ok: true, codes: codes.map((c: any) => String(c)) };
  } catch (e: any) {
    return { ok: false, msg: `授权服务器连接失败: ${e.message}` };
  }
}

export async function grantCode(ctx: PluginContext, event: GroupEvent): Promise<void> {
  const res = await fetchAuthCodes();
  if (!res.ok) {
    await sendMsg(ctx, event, `获取激活码失败：${res.msg}`);
    return;
  }
  const list = res.codes!.slice(0, 10).map((c) => `  ${c}`).join('\n');
  await sendMsg(
    ctx,
    event,
    `成功获取 ${res.codes!.length} 个激活码：
${list}

发送「激活 <授权码>」即可激活授权。`
  );
}

export async function activateCode(ctx: PluginContext, event: GroupEvent, code: string): Promise<void> {
  code = (code || '').trim().toUpperCase();
  if (!code) {
    await sendMsg(ctx, event, '用法：激活 <授权码>');
    return;
  }
  const uid = String(event.user_id);
  // 优先向授权服务器（面板）验证/激活授权码，使 data/bot.db 的 auth_codes 表同步标记使用
  const cfg = state.config;
  const base = String(cfg.authServerUrl || '').replace(/\/+$/, '');
  const verifyPath = String(cfg.authVerifyPath || '/api/auth/code/verify');
  if (base && verifyPath) {
    try {
      const res = await httpRequest(base + verifyPath, {
        method: 'POST',
        body: { code, openid: uid },
        timeout: cfg.authTimeout,
      });
      let data: any = null;
      try {
        data = JSON.parse(res.body);
      } catch {}
      if (res.status !== 200 || !data || data.valid !== true) {
        await sendMsg(ctx, event, `激活失败：${data?.error || `面板返回 ${res.status}`}`);
        return;
      }
    } catch (e: any) {
      await sendMsg(ctx, event, `激活失败：无法连接授权服务器（${e.message}）`);
      return;
    }
  }
  const now = Date.now();
  if (state.data.activatedCodes[code]) {
    if (state.data.activatedCodes[code].owner === uid) {
      await sendMsg(ctx, event, '该授权码已由你激活。');
    } else {
      await sendMsg(ctx, event, '该授权码已被其他用户激活。');
    }
    return;
  }
  state.data.activatedCodes[code] = { owner: uid, time: now, group: event.group_id ? String(event.group_id) : '' };
  state.saveData();
  await sendMsg(ctx, event, `激活成功！授权码 ${code} 已绑定到你的 QQ。`);
}

export async function authStatus(ctx: PluginContext, event: GroupEvent): Promise<void> {
  const uid = String(event.user_id);
  const mine = Object.entries(state.data.activatedCodes).filter(([, v]) => v.owner === uid);
  if (!mine.length) {
    await sendMsg(ctx, event, '你还没有激活任何授权码。发送「获取激活码」获取。');
    return;
  }
  const lines = mine.map(([code, v]) => `  ${code}（激活于 ${new Date(v.time).toLocaleString('zh-CN')}）`);
  await sendMsg(ctx, event, `你已激活 ${mine.length} 个授权码：
${lines.join('\n')}`);
}
