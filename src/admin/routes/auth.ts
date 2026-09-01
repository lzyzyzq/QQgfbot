import { Router, type Request, type Response } from 'express';
import { AdminAuth } from '../auth';
import { requireSuperMaster } from '../middleware';
import { getDb, getConfig, setConfig, setUserMapping, updateQqNumber } from '../../db/index';
import { syncPermConfig } from '../../api/bot-system';
import type { UserPermission, AdminUser } from '../config';

export function createAuthRoutes(auth: AdminAuth): Router {
  const router = Router();

  router.post('/login', (req: Request, res: Response) => {
    const body = req.body || {};
    const code = String(body.code ?? body.password ?? '').trim();
    const username = String(body.username ?? '').trim();
    const ua = req.headers['user-agent'] || 'unknown';
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    console.log('[auth-login] ip=' + ip + ' ua=' + String(ua).slice(0, 60) + ' user=' + (username || '-') + ' body=' + JSON.stringify(body));
    if (!code) {
      res.status(400).json({ error: 'Missing authorization code' });
      return;
    }

    // 1. 先按管理员授权码（admin.json 的 password/loginAble）验证
    let user = auth.validateAuthCode(code);
    let viaPanelCode = false;

    // 2. 再尝试用机器人授权码（auth_codes 表激活码）登录面板（由开关控制是否可见面板）
    //    超级主人/小主人/会员激活码均可登录，角色按激活码角色映射（决定后台可见范围）
    if (!user) {
      const panelOpen = (getConfig('panel.auth_code_login') || '1') === '1';
      if (panelOpen) {
        const db = getDb();
        const row = db.prepare('SELECT code, role, expires_at, is_permanent, used_by FROM auth_codes WHERE code = ?').get(String(code).trim().toUpperCase()) as any;
        if (row) {
          const notExpired = row.is_permanent || (row.expires_at && new Date(row.expires_at) > new Date());
          if (notExpired) {
            // 授权码已由某 OpenID 激活且该 OpenID 绑定了 QQ 号时，优先沿用 admin.json 中该 QQ 对应的账号（用户名/角色/权限），
            // 避免登录后显示 code_XXX 这种不可识别的用户名；角色取两者较高者（超级主人激活码在任意后台都应保持超主身份）
            let matched: AdminUser | undefined;
            if (row.used_by) {
              const um = db.prepare('SELECT qq_number FROM user_mappings WHERE openid = ?').get(row.used_by) as any;
              if (um && um.qq_number) {
                matched = auth.getAdmins().find((a) => a.qq === String(um.qq_number) && a.loginAble !== false);
              }
            }
            const ROLE_RANK: Record<string, number> = { user: 0, member: 1, master: 2, super_master: 3 };
            const loginRole = matched && ROLE_RANK[matched.role] > ROLE_RANK[row.role] ? matched.role : row.role;
            user = matched
              ? {
                  username: matched.username,
                  password: '',
                  role: loginRole,
                  loginAble: true,
                  permissions: matched.permissions,
                }
              : {
                  username: 'code_' + row.code,
                  password: '',
                  role: row.role,
                  loginAble: true,
                };
            viaPanelCode = true;
          }
        }
      }
    }

    console.log('[auth-login] code=' + String(code).slice(0, 8) + '... validate=' + (user ? 'OK(' + user.username + ')' : 'FAIL'));
    if (!user) {
      const panelOpen = (getConfig('panel.auth_code_login') || '1') === '1';
      if (panelOpen) {
        res.status(403).json({ error: 'Invalid authorization code or expired' });
      } else {
        res.status(403).json({ error: '授权码登录面板未开启（需超级主人在系统设置开启）' });
      }
      return;
    }

    const token = auth.generateToken(user);
    syncPermConfig();
    res.cookie('admin_token', token, {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    });
    res.json({
      token,
      viaPanelCode,
      user: {
        username: user.username,
        role: user.role,
        permissions: user.permissions,
      },
    });
  });

  router.post('/logout', (_req: Request, res: Response) => {
    res.clearCookie('admin_token');
    res.json({ ok: true });
  });

  router.get('/me', (req: Request, res: Response) => {
    if (!req.adminUser) {
      res.json(null);
      return;
    }
    const user = auth.getUser(req.adminUser.username);
    // 密码安全策略（用户设定）：不强制修改；超主不提醒；小主人/会员提醒（可跳过）；
    // 从未修改过 → 提醒；已修改但距上次修改 ≥10 天 → 再次提醒。修改时间按用户独立记录。
    let shouldRemind = false;
    let passwordChangedAt = '';
    if (req.adminUser.role !== 'super_master') {
      if (req.adminUser.username.startsWith('code_')) {
        // 激活码登录用户：修改状态记录在 auth_codes.password_changed_at
        try {
          const ac = getDb().prepare('SELECT password_changed_at FROM auth_codes WHERE code = ?').get(req.adminUser.username.slice(5)) as any;
          if (ac) {
            passwordChangedAt = ac.password_changed_at || '';
          } else {
            // 当前会话的激活码已被替换（改码后旧 token 仍带旧码）→ 视为已修改过，不重复提醒
            passwordChangedAt = 'changed';
          }
        } catch {}
      } else {
        passwordChangedAt = user?.passwordChangedAt || '';
      }
      if (!passwordChangedAt) {
        shouldRemind = true;
      } else {
        try {
          const diffDays = (Date.now() - new Date(passwordChangedAt).getTime()) / 86400000;
          if (diffDays >= 10) shouldRemind = true;
        } catch { shouldRemind = false; }
      }
    }
    res.json({
      username: req.adminUser.username,
      role: req.adminUser.role,
      permissions: user?.permissions,
      shouldRemind,
      passwordChangedAt,
    });
  });

  // 修改本人登录凭据：
  // - admin.json 账号用户（含超主）：修改自身密码，超主同时同步 config.admin.password
  // - 激活码登录用户（code_XXX）：修改所使用激活码的值（auth_codes.code）
  router.put('/password', (req: Request, res: Response) => {
    if (!req.adminUser) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const { old, next } = req.body || {};
    if (!old || !next) { res.status(400).json({ error: 'old and next required' }); return; }
    if (String(next).length < 6) { res.status(400).json({ error: '新授权码至少 6 位' }); return; }

    // 激活码登录用户：修改自己使用的激活码
    if (req.adminUser.username.startsWith('code_')) {
      const db = getDb();
      const oldCode = req.adminUser.username.slice(5);
      const row = db.prepare('SELECT id, code, created_by, role FROM auth_codes WHERE code = ?').get(oldCode) as any;
      if (!row) { res.status(404).json({ error: '激活码不存在或已失效' }); return; }
      if (String(old).trim().toUpperCase() !== oldCode) { res.status(400).json({ error: '原授权码不正确' }); return; }
      const newCode = String(next).trim().toUpperCase();
      if (newCode === oldCode) { res.status(400).json({ error: '新授权码不能与原授权码相同' }); return; }
      const exists = db.prepare('SELECT id FROM auth_codes WHERE code = ?').get(newCode) as any;
      if (exists) { res.status(400).json({ error: '该授权码已被使用' }); return; }
      db.prepare('UPDATE auth_codes SET code = ?, password_changed_at = ? WHERE id = ?').run(newCode, new Date().toISOString(), row.id);
      res.json({ ok: true, message: '授权码已更新，下次登录请使用新授权码', newCode });
      return;
    }

    // admin.json 账号用户
    const user = auth.getUser(req.adminUser.username);
    if (!user) { res.status(404).json({ error: '用户不存在' }); return; }
    if (String(old) !== user.password) { res.status(400).json({ error: '原授权码不正确' }); return; }
    const now = new Date().toISOString();
    try {
      auth.updateUser(req.adminUser.username, { password: String(next), passwordChangedAt: now });
    } catch (e: any) {
      res.status(500).json({ error: '保存失败: ' + e.message });
      return;
    }
    // 超主同步 config.admin.password（登录时 config 与 admin.json 需一致）
    if (user.role === 'super_master') {
      try { setConfig('admin.password', String(next)); setConfig('admin.password_changed_at', now); } catch {}
    }
    res.json({ ok: true });
  });

  router.get('/admins', requireSuperMaster, (_req: Request, res: Response) => {
    res.json(auth.getAdmins().map(a => ({
      username: a.username, role: a.role, qq: a.qq || '',
      nickname: a.nickname || '', openid: a.openid || '', avatar: a.avatar || '',
      loginAble: a.loginAble, expireAt: a.expireAt,
      permissions: a.permissions,
    })));
  });

  router.post('/admins', requireSuperMaster, (req: Request, res: Response) => {
    const { username, password, role, qq, nickname, openid, avatar, loginAble, expireAt, permissions } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: 'Missing username or password' });
      return;
    }
    auth.addAdmin({
      username, password,
      role: role || 'master',
      qq: qq || undefined,
      nickname: nickname || undefined,
      openid: openid || undefined,
      avatar: avatar || undefined,
      loginAble: loginAble !== false,
      expireAt: expireAt || undefined,
      permissions: permissions || undefined,
      createdBy: req.adminUser?.username,
    });
    // 新增用户填了 OpenID+QQ 时同步写入 user_mappings（用户管理 OpenID 绑定列、机器人跨机器人身份识别均依赖该表）
    if (openid && qq) {
      try { setUserMapping(String(openid).trim(), String(qq).trim(), String(nickname || '').trim()); } catch {}
    }
    res.json({ ok: true });
  });

  router.put('/admins/:username/permissions', requireSuperMaster, (req: Request, res: Response) => {
    const perms: UserPermission = req.body;
    auth.updatePermissions(String(req.params.username), perms);
    res.json({ ok: true });
  });

  router.put('/admins/:username/expire', requireSuperMaster, (req: Request, res: Response) => {
    const { expireAt } = req.body;
    const user = auth.getUser(String(req.params.username));
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    user.expireAt = expireAt || undefined;
    res.json({ ok: true });
  });

  router.put('/admins/:username', requireSuperMaster, (req: Request, res: Response) => {
    const { loginAble, password, qq, nickname, openid, avatar, role, expireAt } = req.body;
    const user = auth.getUser(String(req.params.username));
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    const patch: Record<string, unknown> = {};
    if (loginAble !== undefined) patch.loginAble = loginAble;
    if (password) patch.password = password;
    // 超级主人可修改 QQ/OpenID（含自己）；空值提交不覆盖已有值
    if (qq !== undefined && String(qq).trim() !== '') patch.qq = String(qq).trim();
    if (nickname !== undefined) patch.nickname = nickname;
    if (openid !== undefined && String(openid).trim() !== '') patch.openid = String(openid).trim();
    if (avatar !== undefined) patch.avatar = avatar;
    if (role !== undefined) patch.role = role as AdminUser['role'];
    if (expireAt !== undefined) patch.expireAt = expireAt || undefined;
    auth.updateUser(String(req.params.username), patch);
    // OpenID/QQ 任一变化时同步 user_mappings，保证用户管理 OpenID 绑定列与机器人身份识别一致
    const finalQq = String(patch.qq || user.qq || '').trim();
    const finalOpenid = String(patch.openid || user.openid || '').trim();
    if (finalQq) {
      try {
        // 管理员修改 QQ 号时，将旧 QQ 在所有机器人（OpenID）上的绑定统一更新为新 QQ，
        // 保证其他机器人上该用户的身份识别（openid→qq）随之生效
        const oldQq = String(user.qq || '').trim();
        if (oldQq && oldQq !== finalQq) updateQqNumber(oldQq, finalQq);
        if (finalOpenid) setUserMapping(finalOpenid, finalQq, String(patch.nickname || user.nickname || '').trim());
      } catch {}
    }
    res.json({ ok: true });
  });

  router.delete('/admins/:username', requireSuperMaster, (req: Request, res: Response) => {
    const ok = auth.removeAdmin(String(req.params.username));
    if (ok) res.json({ ok: true });
    else res.status(404).json({ error: 'Admin not found' });
  });

  return router;
}
