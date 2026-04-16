import type { NextFunction, Request, Response } from 'express';
import { getRuntimeConfig } from '../../../config/runtimeConfig.js';

function isLoopbackHost(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '::ffff:127.0.0.1';
}

export function dashboardAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const adminKey = getRuntimeConfig().dashboard.http.adminApiKey;
  if (!adminKey) {
    const host = req.hostname || req.ip || req.socket.remoteAddress;
    if (isLoopbackHost(host)) {
      next();
      return;
    }
    res.status(403).json({ error: 'Admin access restricted to localhost' });
    return;
  }

  const provided = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (provided === adminKey) {
    next();
    return;
  }

  res.status(401).json({
    error: 'Admin API key required. Set INDEX_SERVER_ADMIN_API_KEY and pass via Authorization: Bearer <key>',
  });
}