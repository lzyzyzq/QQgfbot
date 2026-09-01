import type { CtxLike, Envelope } from '../types';
import { isSuper } from './perms';

async function localApi(method: string, path: string, body?: any): Promise<any | null> {
  try {
    const port = (typeof process !== 'undefined' && process.env && process.env.PORT) ? Number(process.env.PORT) : 3000;
    const r = await fetch('http://127.0.0.1:' + port + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

const ROLE_NAMES: Record<string, string> = { super_master: '超级主人', master: '小主人', member: '会员' };

function roleName(r: string): string {
  return ROLE_NAMES[r] || r || '会员';
}

// 生成激活码（仅私聊、超级主人）：获取激活码 [角色] [分钟]
export async function genCode(ctx: CtxLike, env: Envelope, args: string): Promise<string> {
  if (env.groupId) return '🔑 激活码请在私聊中生成，请私聊机器人发送「获取激活码 [超级主人|小主人|会员] [分钟]」';
  if (!isSuper(ctx, env.userId || '')) return '权限不足，仅超级主人可生成激活码';
  const parts = args.split(/\s+/).filter(Boolean);
  let role = 'member';
  const r0 = parts[0] || '';
  if (r0 === '超级主人' || r0 === '超主' || r0 === 'super_master') role = 'super_master';
  else if (r0 === '小主人' || r0 === '主人' || r0 === 'master') role = 'master';
  const expireMin = parseInt(parts[1], 10) || 0;
  const body: any = { role, created_by: env.userId || 'bot' };
  if (expireMin > 0) body.expires_in_minutes = expireMin;
  const res = await localApi('POST', '/api/bot/auth-codes', body);
  if (res && res.ok) {
    return '✅ 激活码已生成：' + res.code + '\n角色：' + roleName(res.role_label || res.role) + '\n有效期：' + (res.is_permanent ? '永久' : (expireMin || 0) + ' 分钟');
  }
  return '❌ 生成失败，请稍后重试';
}

// 激活授权码（群聊）：激活授权码 <激活码>
export async function activateCode(ctx: CtxLike, env: Envelope, args: string): Promise<string> {
  const code = args.split(/\s+/).filter(Boolean)[0] || '';
  if (!code) return '🔓 格式：激活授权码 <激活码>';
  const res = await localApi('POST', '/api/bot/auth-codes/verify', { code: code.toUpperCase(), openid: env.userId || '' });
  if (!res || !res.valid) return '❌ ' + ((res && res.error) || '激活码无效或已被使用');

  const role = res.role === 'super_master' ? 'super_master' : res.role === 'master' ? 'master' : 'member';
  const uid = env.userId || '';

  if (role === 'super_master') {
    const cur = String(ctx.storage.get('super_master_id') || '');
    let curId = '';
    try { curId = JSON.parse(cur).id || ''; } catch { curId = cur; }
    if (curId && curId !== uid) return '❌ 超级主人已存在，无法覆盖';
    ctx.storage.set('super_master_id', JSON.stringify({ id: uid, qqId: (env.raw as any)?.author?.qqId || uid, added_at: new Date().toISOString() }));
    return '✅ 激活成功！你已成为超级主人！\n可生成激活码、管理面板';
  }

  if (role === 'master') {
    let minis: any[] = [];
    try { minis = JSON.parse(ctx.storage.get('mini_masters') || '[]'); } catch {}
    const hit = minis.find((m) => m && m.id === uid);
    if (hit) hit.activated = true;
    else minis.push({ id: uid, qqId: (env.raw as any)?.author?.qqId || uid, activated: true, activated_at: new Date().toISOString() });
    ctx.storage.set('mini_masters', JSON.stringify(minis));
    return '✅ 激活成功！你已成为小主人！\n私聊机器人发送「登录」获取面板账号';
  }

  let members: any[] = [];
  try { members = JSON.parse(ctx.storage.get('members') || '[]'); } catch {}
  const hit2 = members.find((m) => m && m.id === uid);
  if (hit2) hit2.activated = true;
  else members.push({ id: uid, qqId: (env.raw as any)?.author?.qqId || uid, activated: true, activated_at: new Date().toISOString() });
  ctx.storage.set('members', JSON.stringify(members));
  return '✅ 激活成功！你已成为会员！\n可使用会员专属功能！';
}

// 登录信息（私聊）：返回面板账号与授权码
export async function loginInfo(ctx: CtxLike, env: Envelope): Promise<string> {
  if (env.groupId) return '🔐 登录信息请在私聊中获取，请私聊机器人发送「登录」';
  const uid = env.userId || '';
  const pinfo = await localApi('GET', '/api/bot/panel-info');
  const linfo = await localApi('GET', '/api/bot/auth-codes/login-info?openid=' + encodeURIComponent(uid));
  if (!linfo || !linfo.codes || linfo.codes.length === 0) {
    return '❌ 未找到你的授权记录\n请在群聊中发送「激活授权码 [激活码]」完成激活后，再私聊发送「登录」获取面板登录信息。';
  }
  const baseUrl = (pinfo && pinfo.url) || '';
  let text = '🔐 面板登录信息\n━━━━━━━━━━━━━━\n';
  for (const c of linfo.codes) {
    text += '用户名：' + (linfo.qq_number || linfo.openid) + '\n授权码：' + c.code + '\n角色：' + (c.role_label || roleName(c.role)) + '\n━━━━━━━━━━━━━━\n';
  }
  text += baseUrl ? '前往面板登录：' + baseUrl + '\n（账号=用户名，密码=授权码）' : '前往你的机器人管理面板登录：\n（账号=用户名，密码=授权码）\n提示：面板地址可在系统设置-面板域名中配置';
  return text;
}
