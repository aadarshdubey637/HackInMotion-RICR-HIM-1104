import { randomUUID } from 'node:crypto';
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
  UpdateProfileInput,
  GoogleAuthInput
} from './auth.schema';
import { verifyGoogleIdToken } from './google';

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
  /** Null on accounts created through Google Sign-In, which never pick one. */
  username: string | null;
  name: string;
  phone: string | null;
  language: string;
  role: string;
  avatarUrl: string | null;
  isVerified: boolean;
  createdAt: Date;
}

function generateTokens(payload: TokenPayload): AuthTokens {
  // JWT_EXPIRES_IN is a free-form env string ("7d", "12h"); the library types
  // it as a narrow literal union, so it is asserted rather than widened here.
  const accessOptions = { expiresIn: config.JWT_EXPIRES_IN } as jwt.SignOptions;

  const accessToken = jwt.sign(payload, config.JWT_SECRET, accessOptions);

  const refreshToken = jwt.sign(
    {
      ...payload,
      type: 'refresh',
      // A unique token id, and it is load-bearing rather than decorative.
      //
      // Without it this JWT is a pure function of (payload, secret, iat) — and
      // `iat` has one-second resolution. Two sessions for the same farmer inside
      // the same second therefore produce byte-identical tokens, which collide
      // with `Session.token @unique` and surface as "A record with this value
      // already exists". Reproduced with two concurrent logins; a double-tapped
      // sign-in button is all it takes.
      //
      // It also means a stolen refresh token can be revoked by deleting its one
      // session, rather than being indistinguishable from a freshly issued one.
      jti: randomUUID(),
    },
    config.JWT_SECRET,
    { expiresIn: '30d' }
  );

  const decoded = jwt.decode(accessToken) as { exp: number };
  const expiresIn = decoded.exp * 1000 - Date.now();
  
  return { accessToken, refreshToken, expiresIn };
}

/**
 * Verify an **access** token, and nothing else.
 *
 * Access and refresh tokens are both signed with `JWT_SECRET`, so `jwt.verify`
 * alone cannot tell them apart — a refresh token, which lives in the client for
 * thirty days, would otherwise work as a bearer token. Anything carrying the
 * `type: 'refresh'` marker is therefore rejected here explicitly. Access tokens
 * already issued to signed-in farmers stay valid: they carry no such claim.
 */
function verifyToken(token: string): TokenPayload {
  let decoded: TokenPayload & { type?: string };

  try {
    decoded = jwt.verify(token, config.JWT_SECRET) as TokenPayload & { type?: string };
  } catch (error) {
    throw new AuthenticationError('Invalid or expired token');
  }

  if (decoded.type || !decoded.userId) {
    throw new AuthenticationError('Invalid or expired token');
  }

  return { userId: decoded.userId, email: decoded.email, role: decoded.role };
}

// ═══════════════════════════ Registration ═══════════════════════════
//
// One request creates the account and signs the farmer in. The three identifiers
// — full name, Gmail address and mobile number — are validated by
// `registerSchema`, checked for availability here, and written together with a
// bcrypt hash of the chosen password. There is no username: the Gmail address is
// the credential (see the header on `registerSchema`). Nothing about the mobile
// number is verified: it is contact detail, not a second credential.

/**
 * Reject identifiers that already belong to somebody.
 *
 * Each clash gets its own message keyed to its own field, so the frontend can
 * highlight the box that needs changing. `details` follows the shape
 * `validate.ts` produces, which the frontend already renders inline.
 */
async function assertIdentifiersAreFree(input: {
  email: string;
  phone: string;
}): Promise<void> {
  // findFirst, not two findUniques: `phone` carries a plain index rather than a
  // unique one — see the note on the field in schema.prisma for why a unique
  // index is not possible there.
  const clash = await prisma.user.findFirst({
    where: {
      OR: [{ email: input.email }, { phone: input.phone }],
    },
    select: { email: true, phone: true },
  });

  if (!clash) return;

  if (clash.email === input.email) {
    throw new ConflictError('That Gmail address already has an account. Please sign in instead.', {
      email: 'This Gmail address is already registered. Try signing in.',
    });
  }

  throw new ConflictError('That mobile number already has an account. Please sign in instead.', {
    phone: 'This mobile number is already registered. Try signing in.',
  });
}

/**
 * Create an account and sign the farmer straight in.
 *
 * Returns exactly the `{ user, tokens }` shape that `login` and `loginWithGoogle`
 * return, which is what makes "registered" and "signed in" the same moment: the
 * frontend hands this to the same `afterAuth` it uses for login, and the farmer
 * lands on the dashboard without ever seeing the sign-in screen.
 *
 * The password is stored only as a bcrypt hash at `BCRYPT_ROUNDS`; the plaintext
 * is never written or logged.
 */
export async function register(
  input: RegisterInput,
): Promise<{ user: UserResponse; tokens: AuthTokens }> {
  await assertIdentifiersAreFree({
    email: input.email,
    phone: input.phone,
  });

  const passwordHash = await bcrypt.hash(input.password, config.BCRYPT_ROUNDS);

  let user;
  try {
    user = await prisma.user.create({
      data: {
        email: input.email,
        // `username` is left unset on purpose — the field is not written at all
        // rather than written as null, which is what keeps the sparse unique
        // index in apply-sparse-indexes.ts from seeing a pile of duplicates.
        passwordHash,
        name: input.name,
        phone: input.phone,
        language: input.language || 'en',
      },
    });
  } catch (error) {
    // P2002 is the sparse unique index (see schema.prisma) catching a race that
    // `assertIdentifiersAreFree` lost by milliseconds. Same message either way.
    if ((error as { code?: string }).code === 'P2002') {
      throw new ConflictError(
        'Someone just took that Gmail address or mobile number. Please try a different one.',
      );
    }
    throw error;
  }

  const tokens = generateTokens({ userId: user.id, email: user.email, role: user.role });

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

  logger.info({ userId: user.id }, 'User registered');

  return { user: formatUserResponse(user), tokens };
}

/**
 * Sign in with a Gmail address — or a username, on an account old enough to
 * have one — plus a password.
 *
 * This is the only door a returning farmer needs. Logging out does not send
 * anyone back to registration: the account and its password hash outlive the
 * session, so signing back in is one form with two fields. A farmer who has
 * forgotten the password takes `password-reset.ts` instead, which is the other
 * way back in and does not need this one to work first.
 *
 * The username branch is kept for accounts created before registration stopped
 * asking for one. New accounts have none, so in practice this matches on email.
 *
 * `identifier` arrives already lowercased from the schema, matching how both
 * `username` and `email` are stored.
 */
export async function login(input: LoginInput): Promise<{ user: UserResponse; tokens: AuthTokens }> {
  // findFirst with an OR rather than two lookups: `username` has no unique
  // index (see schema.prisma), so findUnique is not available on it anyway.
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ email: input.identifier }, { username: input.identifier }],
    },
  });

  if (!user) {
    // Deliberately does not distinguish "no such account" from "wrong password".
    // Naming which half failed would turn this endpoint into a way to check
    // whether a given farmer has an account here.
    throw new AuthenticationError('Incorrect username/email or password');
  }

  // A Google-only account has no password hash. Say so plainly instead of
  // "invalid password": the farmer typed a password for an account that has
  // never had one, and telling them to use the Google button is the only
  // reply that gets them in. bcrypt.compare would also throw on a null hash.
  if (!user.passwordHash) {
    throw new AuthenticationError(
      'This account uses Google Sign-In. Please tap "Continue with Google".',
    );
  }

  const isPasswordValid = await bcrypt.compare(input.password, user.passwordHash);

  if (!isPasswordValid) {
    throw new AuthenticationError('Incorrect username/email or password');
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

/**
 * Sign in (or sign up) with Google.
 *
 * One endpoint covers both, because the farmer does not know or care which one
 * they are doing — they tapped "Continue with Google". Three cases, resolved in
 * this order:
 *
 *  1. **Known Google account** (`googleId` matches) — sign in.
 *  2. **Existing password account with the same verified email** — link Google
 *     to it and sign in. Refusing here would be actively harmful: the farmer
 *     would be locked out of their own farm data by an "email already
 *     registered" error, with no way to reason about why. Linking is safe only
 *     because Google told us the address is verified, which `verifyGoogleIdToken`
 *     enforces.
 *  3. **Nobody** — create the account. No password is set; `passwordHash` stays
 *     null and the account signs in through Google from then on.
 */
export async function loginWithGoogle(
  input: GoogleAuthInput,
): Promise<{ user: UserResponse; tokens: AuthTokens; isNewUser: boolean }> {
  const identity = await verifyGoogleIdToken(input.idToken);

  // findFirst, not findUnique: googleId carries an index but no unique
  // constraint — see the note on the field in schema.prisma.
  let user = await prisma.user.findFirst({ where: { googleId: identity.googleId } });
  let isNewUser = false;

  if (!user) {
    const byEmail = await prisma.user.findUnique({ where: { email: identity.email } });

    if (byEmail) {
      user = await prisma.user.update({
        where: { id: byEmail.id },
        data: {
          googleId: identity.googleId,
          // Google has verified the address, so the account is now verified.
          isVerified: true,
          // Only fill an avatar that is missing — never overwrite one the
          // farmer chose themselves.
          avatarUrl: byEmail.avatarUrl ?? identity.picture,
        },
      });
      logger.info({ userId: user.id }, 'Linked Google account to existing user');
    } else {
      user = await prisma.user.create({
        data: {
          email: identity.email,
          googleId: identity.googleId,
          name: identity.name,
          avatarUrl: identity.picture,
          // The screen they signed in from wins; Google's account locale is
          // the fallback, and it may be a language this app does not ship —
          // an unknown value is harmless, the UI falls back to English.
          language: input.language ?? identity.locale?.split('-')[0] ?? 'en',
          isVerified: true,
        },
      });
      isNewUser = true;
      logger.info({ userId: user.id }, 'User registered via Google');
    }
  }

  const tokens = generateTokens({ userId: user.id, email: user.email, role: user.role });

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

  logger.info({ userId: user.id, isNewUser }, 'User signed in with Google');

  return { user: formatUserResponse(user), tokens, isNewUser };
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

  // Nothing to change, and no current password to check it against.
  if (!user.passwordHash) {
    throw new ValidationError(
      'This account signs in with Google, so it has no password to change.',
    );
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

/**
 * Update the editable parts of a profile.
 *
 * Changing `phone` is checked for uniqueness: registration treats the mobile
 * number as an identifier, so without a check here anyone could type another
 * farmer's number into their own profile and take it over.
 */
export async function updateProfile(userId: string, input: UpdateProfileInput): Promise<UserResponse> {
  const current = await prisma.user.findUnique({ where: { id: userId } });

  if (!current) {
    throw new NotFoundError('User', userId);
  }

  const phoneChanged = input.phone !== undefined && input.phone !== current.phone;

  if (phoneChanged) {
    const taken = await prisma.user.findFirst({
      where: { phone: input.phone, id: { not: userId } },
      select: { id: true },
    });

    if (taken) {
      throw new ConflictError('That mobile number is already used by another account.', {
        phone: 'This mobile number is already in use.',
      });
    }
  }

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
  username: string | null;
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
    username: user.username,
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
