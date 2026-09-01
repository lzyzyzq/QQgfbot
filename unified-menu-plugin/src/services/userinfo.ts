import type { CtxLike, Envelope } from '../types';

async function localApi(path: string): Promise<any | null> {
  try {
    const port = (typeof process !== 'undefined' && process.env && process.env.PORT) ? Number(process.env.PORT) : 3000;
    const r = await fetch('http://127.0.0.1:' + port + path, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function roleLabel(r: string): string {
  return r === 'super_master' ? '超级主人' : r === 'master' ? '小主人' : r === 'member' ? '会员' : '普通用户';
}

export interface PersonalResult {
  text: string;
  cardData: any | null;
}

export async function personalInfo(ctx: CtxLike, env: Envelope): Promise<PersonalResult> {
  const groupId = env.groupId || '';
  const userId = env.userId || '';
  const info = await localApi(
    '/api/bot/userinfo?user_openid=' + encodeURIComponent(userId) + '&group_openid=' + encodeURIComponent(groupId)
  );

  if (!info || !info.user_openid) {
    const nick = (env.raw as any)?.author?.username || '未知';
    return { text: '👤 个人信息\n昵称：' + nick + '\n（后端数据暂不可用，请稍后重试）', cardData: null };
  }

  const uname = info.username || '未设置昵称';
  const qq = info.qq_number || '未绑定';
  const permLabel = roleLabel(info.panel_role || info.auth_role || '');
  const authTxt = info.authorized ? '已激活授权' : '未激活授权';

  const text = [
    '👤 个人信息',
    '━━━━━━━━━━━━━━',
    '群名：' + (info.group_name || '未知群'),
    '昵称：' + uname,
    'QQ号：' + qq,
    'OpenID：' + info.user_openid,
    '权限：' + permLabel,
    '授权：' + authTxt,
    '━━━━━━━━━━━━━━',
    qq === '未绑定' ? '📎 发送「绑定QQ 你的QQ号」可绑定真实QQ获取头像' : '头像：' + (info.avatar || '无'),
  ].join('\n');

  const cardData = {
    avatarUrl: info.avatar || '',
    nickname: uname,
    groupName: info.group_name || '未知群',
    qq,
    openid: info.user_openid,
    permission: permLabel,
    authText: authTxt,
    streak: '0',
    note: '个人信息',
  };

  return { text, cardData };
}
