import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { prisma } from '../../common/prisma';
import { config } from '../../config';
import { logger } from '../../common/logger';
import { 
  AuthenticationError, 
  ConflictError, 
  NotFoundError,
  ValidationError 
} from '../../common/errors';
import type { 
  RegisterInput, 
  LoginInput, 
  ChangePasswordInput,
  UpdateProfileInput 
} from './auth.schema';

export interface TokenPayload {
  userId: string;
  email: string;
  role: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface UserResponse {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  language: string;
  role: string;
  avatarUrl: string | null;
  isVerified: boolean;
  createdAt: Date;
}

function generateTokens(payload: TokenPayload): AuthTokens {
  const accessToken = jwt.sign(payload, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN,
  });
  
  const refreshToken = jwt.sign(
    { ...payload, type: 'refresh' },
    config.JWT_SECRET,
    { expiresIn: '30d' }
  );
  
  const decoded = jwt.decode(accessToken) as { exp: number };
  const expiresIn = decoded.exp * 1000 - Date.now();
  
  return { accessToken, refreshToken, expiresIn };
}

function verifyToken(token: string): TokenPayload {
  try {
    return jwt.verify(token, config.JWT_SECRET) as TokenPayload;
  } catch (error) {
    throw new AuthenticationError('Invalid or expired token');
  }
}

export async function register(input: RegisterInput): Promise<{ user: UserResponse; tokens: AuthTokens }> {
  const existingUser = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() },
  });
  
  if (existingUser) {
    throw new ConflictError('Email already registered');
  }
  
  const passwordHash = await bcrypt.hash(input.password, config.BCRYPT_ROUNDS);
  
  const user = await prisma.user.create({
    data: {
      email: input.email.toLowerCase(),
      passwordHash,
      name: input.name,
      phone: input.phone,
      language: input.language || 'en',
    },
  });
  
  const payload: TokenPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
  };
  
  const tokens = generateTokens(payload);
  
  await prisma.session.create({
    data: {
      userId: user.id,
      token: tokens.refreshToken,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
  
  logger.info({ userId: user.id }, 'User registered');
  
  return { user: formatUserResponse(user), tokens };
}

export async function login(input: LoginInput): Promise<{ user: UserResponse; tokens: AuthTokens }> {
  const user = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() },
  });
  
  if (!user) {
    throw new AuthenticationError('Invalid email or password');
  }
  
  const isPasswordValid = await bcrypt.compare(input.password, user.passwordHash);
  
  if (!isPasswordValid) {
    throw new AuthenticationError('Invalid email or password');
  }
  
  const payload: TokenPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
  };
  
  const tokens = generateTokens(payload);
  
  await prisma.session.create({
    data: {
      userId: user.id,
      token: tokens.refreshToken,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
  
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });
  
  logger.info({ userId: user.id }, 'User logged in');
  
  return { user: formatUserResponse(user), tokens };
}

export async function refreshTokens(refreshToken: string): Promise<AuthTokens> {
  const session = await prisma.session.findUnique({
    where: { token: refreshToken },
    include: { user: true },
  });
  
  if (!session || session.expiresAt < new Date()) {
    throw new AuthenticationError('Invalid or expired refresh token');
  }
  
  await prisma.session.delete({ where: { id: session.id } });
  
  const payload: TokenPayload = {
    userId: session.user.id,
    email: session.user.email,
    role: session.user.role,
  };
  
  const tokens = generateTokens(payload);
  
  await prisma.session.create({
    data: {
      userId: session.user.id,
      token: tokens.refreshToken,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
  
  return tokens;
}

export async function logout(refreshToken: string): Promise<void> {
  await prisma.session.deleteMany({
    where: { token: refreshToken },
  });
}

export async function logoutAll(userId: string): Promise<void> {
  await prisma.session.deleteMany({
    where: { userId },
  });
}

export async function changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  
  if (!user) {
    throw new NotFoundError('User', userId);
  }
  
  const isCurrentPasswordValid = await bcrypt.compare(input.currentPassword, user.passwordHash);
  
  if (!isCurrentPasswordValid) {
    throw new ValidationError('Current password is incorrect');
  }
  
  const newPasswordHash = await bcrypt.hash(input.newPassword, config.BCRYPT_ROUNDS);
  
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: newPasswordHash },
  });
  
  await logoutAll(userId);
  
  logger.info({ userId }, 'Password changed');
}

export async function updateProfile(userId: string, input: UpdateProfileInput): Promise<UserResponse> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      name: input.name,
      phone: input.phone,
      language: input.language,
      avatarUrl: input.avatarUrl,
    },
  });
  
  return formatUserResponse(user);
}

export async function getProfile(userId: string): Promise<UserResponse> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  
  if (!user) {
    throw new NotFoundError('User', userId);
  }
  
  return formatUserResponse(user);
}

export async function verifyAccessToken(token: string): Promise<TokenPayload> {
  return verifyToken(token);
}

export async function getUserFromToken(token: string): Promise<UserResponse> {
  const payload = verifyToken(token);
  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  
  if (!user) {
    throw new AuthenticationError('User not found');
  }
  
  return formatUserResponse(user);
}

function formatUserResponse(user: {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  language: string;
  role: string;
  avatarUrl: string | null;
  isVerified: boolean;
  createdAt: Date;
}): UserResponse {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    language: user.language,
    role: user.role,
    avatarUrl: user.avatarUrl,
    isVerified: user.isVerified,
    createdAt: user.createdAt,
  };
}

export async function cleanupExpiredSessions(): Promise<number> {
  const result = await prisma.session.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  
  logger.info({ deleted: result.count }, 'Cleaned up expired sessions');
  return result.count;
}