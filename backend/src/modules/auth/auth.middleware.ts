import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, TokenPayload } from './auth.service';
import { AuthenticationError } from '../../common/errors';
import { logger } from '../../common/logger';

export interface AuthenticatedRequest extends Request {
  user?: TokenPayload;
}

export const authenticate = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AuthenticationError('Authorization header required');
    }
    
    const token = authHeader.slice(7);
    const payload = await verifyAccessToken(token);
    
    req.user = payload;
    next();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      logger.warn({ 
        ip: req.ip, 
        path: req.path,
        error: error.message 
      }, 'Authentication failed');
    }
    next(error);
  }
};

export const optionalAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const payload = await verifyAccessToken(token);
      req.user = payload;
    }
    
    next();
  } catch (error) {
    next();
  }
};

export const authorize = (...roles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new AuthenticationError('Authentication required');
    }
    
    if (!roles.includes(req.user.role)) {
      throw new AuthenticationError('Insufficient permissions');
    }
    
    next();
  };
};

export const requireFarmer = authorize('FARMER', 'ADMIN');
export const requireAdvisor = authorize('ADVISOR', 'ADMIN');
export const requireAdmin = authorize('ADMIN');