import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getConfig } from '../db/index';

const JWT_SECRET_KEY = 'bot.admin.secret';

function getJwtSecret(): string {
  return getConfig('admin.jwt_secret') || 'qq-bot-platform-default-secret';
}

export function generateToken(userId: string): string {
  return jwt.sign({ userId }, getJwtSecret(), { expiresIn: '24h' });
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const publicPaths = ['/api/auth/login', '/api/auth/qq-login'];

  if (publicPaths.includes(req.path)) {
    next();
    return;
  }

  if (req.path.startsWith('/api/')) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authorization token required' });
      return;
    }

    const token = authHeader.substring(7);

    try {
      const decoded = jwt.verify(token, getJwtSecret()) as { userId: string };
      (req as any).userId = decoded.userId;
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
  } else {
    next();
  }
}
