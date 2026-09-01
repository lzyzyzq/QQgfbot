import type { Request, Response, NextFunction } from 'express';
import { AdminAuth } from './auth';
import { ROLE_PERMISSIONS, type UserPermission } from './config';

export function getUserPermissions(auth: AdminAuth, username: string): UserPermission | null {
  const user = auth.getUser(username);
  if (!user) return null;
  if (user.permissions) return user.permissions;
  return ROLE_PERMISSIONS[user.role] || null;
}

  declare global {
    namespace Express {
      interface Request {
        adminUser?: {
          username: string;
          role: 'super_master' | 'master' | 'member' | 'user';
        };
      }
    }
  }

export function authMiddleware(auth: AdminAuth) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.path === '/auth/login' || req.path === '/auth/logout' || req.path === '/auth/qq-login' ||
        req.path === '/auth/qq-login-config' || req.path === '/auth/qq-bind' ||
        req.path === '/auth-codes/verify' || req.path === '/auth-codes/bind-qq' ||
        req.path === '/auth-codes/qq-by-openid' || req.path === '/auth-codes/openid-by-qq' ||
        req.path === '/api/auth/login' || req.path === '/api/auth/logout' || req.path === '/api/auth/qq-login' ||
        req.path === '/api/auth/qq-login-config' || req.path === '/api/auth/qq-bind' ||
        req.path === '/api/auth-codes/verify' || req.path === '/api/auth-codes/bind-qq' ||
        req.path === '/api/auth-codes/qq-by-openid' || req.path === '/api/auth-codes/openid-by-qq' ||
        req.path === '/auth/code' || req.path === '/auth/code/verify' ||
        req.path === '/api/auth/code' || req.path === '/api/auth/code/verify' ||
        req.path === '/system/panel-login-status' || req.path === '/api/system/panel-login-status' ||
        req.path === '/health' || req.path === '/api/health' ||
        req.path === '/api/click' || req.path === '/click') {
      next();
      return;
    }

    const WEBUI_PATH = /^\/?(api\/)?plugins\/[^/]+\/webui(\/|$)/;
    if (WEBUI_PATH.test(req.path)) {
      next();
      return;
    }

    const token = req.cookies?.admin_token || req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const payload = auth.verifyToken(token);
    if (!payload) {
      res.status(401).json({ error: 'Token expired or invalid' });
      return;
    }

    req.adminUser = { username: payload.username, role: payload.role };
    next();
  };
}

export function requireSuperMaster(req: Request, res: Response, next: NextFunction): void {
  if (req.adminUser?.role !== 'super_master') {
    res.status(403).json({ error: 'Super master only' });
    return;
  }
  next();
}
