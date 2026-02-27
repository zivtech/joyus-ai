import { Request, Response, NextFunction } from 'express';

import { getUserFromToken } from './verify.js';

export interface AuthenticatedRequest extends Request {
  authUser?: {
    id: string;
    email: string;
    name: string | null;
  };
}

export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.substring(7);
}

export async function requireTokenAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const user = await getUserFromToken(token);
  if (!user) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  req.authUser = {
    id: user.id,
    email: user.email,
    name: user.name,
  };
  next();
}
