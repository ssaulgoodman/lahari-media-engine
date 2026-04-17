/**
 * Auth middleware — verifies Supabase JWT and attaches user to request.
 *
 * Uses the service-role client to verify the token server-side.
 * Adds `req.userId` (UUID string) for downstream route handlers.
 */
import { Request, Response, NextFunction } from 'express';
import { getSB } from '../database.js';

// Extend Express Request to carry userId
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }

  const token = authHeader.slice(7);
  try {
    const { data: { user }, error } = await getSB().auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.userId = user.id;
    next();
  } catch (err: any) {
    return res.status(401).json({ error: 'Auth verification failed' });
  }
};
