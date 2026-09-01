import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import type { AdminConfig, JwtPayload, AdminUser, UserPermission } from './config';

const CONFIG_FILE = path.resolve('data', 'admin.json');
const SECRET_FILE = path.resolve('data', 'jwt.secret');

function loadPersistedSecret(authCode: string): string {
  try {
    if (fs.existsSync(SECRET_FILE)) {
      const saved = fs.readFileSync(SECRET_FILE, 'utf-8').trim();
      if (saved) return saved;
    }
  } catch {}
  const secret = 'qqbot-admin-' + authCode + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  try {
    const dir = path.dirname(SECRET_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SECRET_FILE, secret);
  } catch (e) {
    console.error('Failed to persist jwt secret:', e);
  }
  return secret;
}

function loadPersistedAdmins(): AdminUser[] | null {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch {}
  return null;
}

function saveAdmins(admins: AdminUser[]) {
  try {
    const dir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(admins, null, 2));
  } catch (e) {
    console.error('Failed to persist admin config:', e);
  }
}

export class AdminAuth {
  private config: AdminConfig;
  private jwtSecret: string;

  constructor(config: AdminConfig) {
    this.config = config;
    // 从持久化文件恢复管理员列表
    const persisted = loadPersistedAdmins();
    if (persisted && persisted.length > 0) {
      this.config.admins = persisted;
    }
    // 持久化 jwtSecret：多实例共享端口时 token 也能互相验证，避免登录后随机 401
    this.jwtSecret = loadPersistedSecret(config.authCode);
  }

  validateAuthCode(code: string): AdminUser | null {
    for (const admin of this.config.admins) {
      if (admin.password === code && admin.loginAble) {
        if (admin.expireAt && Date.now() > admin.expireAt) {
          return null;
        }
        return admin;
      }
    }
    return null;
  }

  generateToken(user: AdminUser): string {
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      username: user.username,
      role: user.role,
    };
    return jwt.sign(payload, this.jwtSecret, {
      expiresIn: (this.config.sessionExpireHours + 'h') as any,
    });
  }

  verifyToken(token: string): JwtPayload | null {
    try {
      return jwt.verify(token, this.jwtSecret) as JwtPayload;
    } catch {
      return null;
    }
  }

  getUser(username: string): AdminUser | undefined {
    return this.config.admins.find(a => a.username === username);
  }

  updateUser(username: string, patch: Partial<AdminUser>): boolean {
    const user = this.config.admins.find(a => a.username === username);
    if (!user) return false;
    Object.assign(user, patch);
    saveAdmins(this.config.admins);
    return true;
  }

  findByQQ(qq: string): AdminUser | undefined {
    return this.config.admins.find(a => a.qq === qq);
  }

  addAdmin(user: AdminUser): void {
    const exists = this.config.admins.find(a => a.username === user.username);
    if (exists) {
      Object.assign(exists, user);
    } else {
      this.config.admins.push(user);
    }
    saveAdmins(this.config.admins);
  }

  updatePermissions(username: string, permissions: UserPermission): boolean {
    const user = this.config.admins.find(a => a.username === username);
    if (!user) return false;
    user.permissions = permissions;
    saveAdmins(this.config.admins);
    return true;
  }

  removeAdmin(username: string): boolean {
    const idx = this.config.admins.findIndex(a => a.username === username);
    if (idx !== -1) {
      this.config.admins.splice(idx, 1);
      saveAdmins(this.config.admins);
      return true;
    }
    return false;
  }

  getAdmins(): AdminUser[] {
    return this.config.admins.map(a => ({
      username: a.username,
      password: a.password,
      role: a.role,
      qq: a.qq,
      nickname: a.nickname,
      openid: a.openid,
      avatar: a.avatar,
      loginAble: a.loginAble,
      expireAt: a.expireAt,
      permissions: a.permissions,
    }));
  }
}
