import { Router, Request, Response } from 'express';
import { getConfig, setConfig, addSystemLog } from '../db/index';
import { generateToken } from '../middleware/auth';
import { updateMemberBinding } from '../core/napcat';
import https from 'https';

const router = Router();

// ========== 密码登录（保留） ==========
function ensureAdminPassword(): string {
  let password = getConfig('admin.password');
  if (!password) {
    password = 'YZQ5201314..';
    setConfig('admin.password', password);
  }
  return password;
}

function getAdminPassword(): string {
  return getConfig('admin.password') || '';
}

router.post('/auth/login', (req: Request, res: Response) => {
  const pass = req.body.password || req.body.code;
  if (!pass) {
    res.status(400).json({ error: 'Password is required' });
    return;
  }
  const adminPassword = ensureAdminPassword();
  if (pass !== adminPassword) {
    res.status(401).json({ error: 'Invalid password' });
    return;
  }
  const userId = 'admin';
  const token = generateToken(userId);
  res.json({ token, userId, message: 'Login successful' });
});

router.put('/auth/password', (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: 'currentPassword and newPassword are required' });
    return;
  }
  const adminPassword = getAdminPassword();
  if (currentPassword !== adminPassword) {
    res.status(401).json({ error: '当前密码错误' });
    return;
  }
  setConfig('admin.password', newPassword);
  res.json({ success: true, message: '密码已修改' });
});

router.get('/auth/status', (req: Request, res: Response) => {
  res.json({ authenticated: true, userId: (req as any).userId });
});

// ========== QQ 登录（新增） ==========

// 心月互联 QQ 登录服务
const QQ_LOGIN_SERVICE_URL = 'https://qq.wch666.com/api/qq.php';
// 默认 token（用户在系统设置「QQ 登录 Token」覆盖；申请地址 https://qq.wch666.com，有效期 30 天可反复申请）
const DEFAULT_QQ_LOGIN_TOKEN = '9448ed1682966f2f05ed4424c1cb1f42';

/** 公开接口：前端登录页读取 QQ 扫码登录跳转配置（token 已配置则优先，否则用默认 token 兜底） */
router.get('/auth/qq-login-config', (_req: Request, res: Response) => {
  const token = getConfig('qqlogin.token') || DEFAULT_QQ_LOGIN_TOKEN;
  res.json({
    url: QQ_LOGIN_SERVICE_URL,
    token,
    configured: !!getConfig('qqlogin.token'),
  });
});

router.post('/auth/qq-login', async (req: Request, res: Response) => {
  const { code, qq_number: manualQQ } = req.body;

  if (!code) {
    res.status(400).json({ error: 'Authorization code is required' });
    return;
  }

  try {
    // 1. 用 code 换取 QQ 用户信息
    const userInfo = await getQQUserInfo(code);

    if (!userInfo || userInfo.error) {
      res.status(401).json({ error: userInfo?.error || 'QQ 登录验证失败' });
      return;
    }

    // 2. 提取 QQ 号和昵称（心月互联不返回QQ号，仅返回昵称等资料）
    let qqNumber = userInfo.qq_number || userInfo.qq || '';
    const nickname = userInfo.nickname || userInfo.name || 'QQ用户';

    // 如果有手动输入的QQ号，优先使用
    if (!qqNumber && manualQQ) {
      qqNumber = String(manualQQ).trim();
    }

    // 如果仍无QQ号，返回昵称让用户手动输入
    if (!qqNumber) {
      res.json({
        needQQ: true,
        nickname,
        code,
        message: '请手动输入你的QQ号以完成绑定',
      });
      return;
    }

    // 3. 检查是否在管理员白名单中（双源：admin.json + config）
    const admins = getAdminsFromBothSources();
    let userRole = 'master';
    let found = false;

    for (const admin of admins) {
      if (admin.qq === qqNumber || admin.qqId === qqNumber) {
        found = true;
        userRole = admin.role || 'master';
        break;
      }
    }

    // 4. 如果没有任何管理员，第一个登录者自动成为超级主人
    if (!found && admins.length === 0) {
      addAdminToConfig({
        username: 'qq_' + qqNumber,
        qq: qqNumber,
        role: 'super_master',
        loginAble: true,
      });
      found = true;
      userRole = 'super_master';
    }

    if (!found) {
      res.status(403).json({
        error: '该 QQ 号未绑定管理员权限，请联系管理员添加',
        qq_number: qqNumber,
      });
      return;
    }

    // 5. 生成登录 Token
    const userId = 'qq_' + qqNumber;
    const token = generateToken(userId);

    // 6. 记录登录信息
    setConfig(`user.${userId}.qq`, qqNumber);
    setConfig(`user.${userId}.nickname`, nickname);
    setConfig(`user.${userId}.last_login`, new Date().toISOString());

    res.json({
      success: true,
      token,
      userId,
      qq_number: qqNumber,
      nickname,
      role: userRole,
      message: 'QQ 登录成功',
    });
  } catch (err: any) {
    console.error('QQ 登录错误:', err);
    res.status(500).json({ error: err.message || 'QQ 登录服务异常' });
  }
});

// 绑定真实 QQ 号到 openid（成员自助扫码 / 管理员绑自己，无需管理员白名单）
// 心月互联不返回真实 QQ 号，因此扫码后仍需用户手动输入 QQ 号
router.post('/auth/qq-bind', async (req: Request, res: Response) => {
  const { code } = req.body;
  const openid = String(req.body.openid || '').trim();
  const qq = String(req.body.qq_number || '').trim();

  if (!code) { res.status(400).json({ error: 'Authorization code is required' }); return; }
  if (!/^\d{5,12}$/.test(qq)) { res.status(400).json({ error: 'QQ 号应为 5-12 位数字' }); return; }
  if (!openid) { res.status(400).json({ error: 'openid is required' }); return; }

  try {
    const userInfo = await getQQUserInfo(code);
    if (!userInfo || userInfo.error) {
      res.status(401).json({ error: userInfo?.error || 'QQ 登录验证失败' });
      return;
    }
    const nickname = userInfo.nickname || userInfo.name || 'QQ用户';

    updateMemberBinding(openid, qq);
    setConfig(`qqbind.${qq}.nickname`, nickname);
    setConfig(`qqbind.${qq}.openid`, openid);
    setConfig(`qqbind.${qq}.time`, new Date().toISOString());
    addSystemLog('info', 'qqbind', `QQ ${qq}(${nickname}) 绑定成功`, `openid=${openid}`);
    res.json({ success: true, qq_number: qq, nickname, openid });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'QQ 绑定服务异常' });
  }
});

// ========== 辅助函数 ==========

// 通过 code 调用心月互联 API 获取用户信息
function getQQUserInfo(code: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = 'https://qq.wch666.com/api/get_user_info.php?code=' + encodeURIComponent(code);

    https.get(url, (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve(result);
        } catch {
          // 非 JSON 响应（如纯文本 "error"），返回原始数据用于调试
          resolve({ raw: data, _debug: 'API 返回了非 JSON 数据' });
        }
      });
    }).on('error', (err) => {
      reject(new Error('获取 QQ 用户信息失败: ' + err.message));
    });
  });
}

// 管理员白名单操作
function getAdminsFromConfig(): any[] {
  try {
    const raw = getConfig('admin.qq_users');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// 从 admin.json 读取 AdminAuth 管理的管理员列表
function getAdminsFromJson(): any[] {
  try {
    const fs = require('fs');
    const path = require('path');
    const adminPath = path.resolve('data', 'admin.json');
    if (fs.existsSync(adminPath)) {
      return JSON.parse(fs.readFileSync(adminPath, 'utf-8'));
    }
  } catch { /* ignore */ }
  return [];
}

// 合并双源管理员列表（admin.json + config），以 QQ 号去重
function getAdminsFromBothSources(): any[] {
  const jsonAdmins = getAdminsFromJson().filter((a: any) => a.qq);
  const configAdmins = getAdminsFromConfig();
  const seen = new Set<string>();
  const merged: any[] = [];
  for (const a of [...jsonAdmins, ...configAdmins]) {
    const qq = a.qq || a.qqId;
    if (qq && !seen.has(qq)) {
      seen.add(qq);
      merged.push(a);
    }
  }
  return merged;
}

function saveAdminsToConfig(admins: any[]): void {
  setConfig('admin.qq_users', JSON.stringify(admins));
}

function addAdminToConfig(admin: any): void {
  const admins = getAdminsFromConfig();
  admins.push(admin);
  saveAdminsToConfig(admins);
}

// ========== 管理员管理接口（可选） ==========
router.get('/auth/qq-admins', (req: Request, res: Response) => {
  res.json({ admins: getAdminsFromConfig() });
});

router.post('/auth/qq-admins', (req: Request, res: Response) => {
  const { qq, role } = req.body;
  if (!qq) {
    res.status(400).json({ error: 'qq is required' });
    return;
  }
  const admins = getAdminsFromConfig();
  admins.push({
    qq,
    role: role || 'master',
    loginAble: true,
    added_at: new Date().toISOString(),
  });
  saveAdminsToConfig(admins);
  res.json({ success: true });
});

router.delete('/auth/qq-admins/:qq', (req: Request, res: Response) => {
  const qq = req.params.qq;
  let admins = getAdminsFromConfig();
  admins = admins.filter((a: any) => a.qq !== qq);
  saveAdminsToConfig(admins);
  res.json({ success: true });
});

export default router;