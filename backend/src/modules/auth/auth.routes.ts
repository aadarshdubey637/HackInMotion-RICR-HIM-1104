import { Router } from 'express';
import { handler, userId, ok } from '../../common/http';
import { validateBody } from '../../common/validate';
import { authenticate } from './auth.middleware';
import {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  changePasswordSchema,
  updateProfileSchema,
  googleAuthSchema,
  verifyEmailSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from './auth.schema';
import * as service from './auth.service';
import { sendVerificationOtp, verifyOtp } from './email-otp';
import { requestPasswordReset, resetPassword } from './password-reset';

export const authRouter = Router();

// ───────────────────────── Registration ─────────────────────────

/**
 * POST /api/auth/register — create a farmer account and sign in.
 *
 * 201, and the body is the same `{ user, tokens }` login returns — the farmer is
 * signed in by the act of registering and goes straight to the dashboard.
 */
authRouter.post(
  '/register',
  validateBody(registerSchema),
  handler(async (req, res) => {
    const result = await service.register(req.body);
    ok(res, result, 201);
  }),
);

// ───────────────────────── Sign in ─────────────────────────

/** POST /api/auth/login — username or Gmail, plus password. */
authRouter.post(
  '/login',
  validateBody(loginSchema),
  handler(async (req, res) => {
    const result = await service.login(req.body);
    ok(res, result);
  }),
);

/**
 * POST /api/auth/google — sign in or sign up with a Google ID token.
 *
 * 200 for an existing account, 201 when this created one, so the client can
 * tell a new farmer from a returning one without a second request.
 *
 * A Google account is verified by Google, has no password and no username, and
 * needs no mobile number.
 */
authRouter.post(
  '/google',
  validateBody(googleAuthSchema),
  handler(async (req, res) => {
    const { isNewUser, ...result } = await service.loginWithGoogle(req.body);
    ok(res, { ...result, isNewUser }, isNewUser ? 201 : 200);
  }),
);

// ───────────────────── Forgotten password ─────────────────────
//
// The mirror image of the verification routes above: those are authenticated
// because the farmer is already signed in, and these cannot be, because being
// unable to sign in is the entire reason for them. Everything that follows from
// that — one reply for every address, no 429, no 404 — is in password-reset.ts.

/**
 * POST /api/auth/forgot-password — email a reset code.
 *
 * Always 200 with the same body, whether or not that address has an account.
 * The only failure is 502, when the server has no mailbox configured at all.
 */
authRouter.post(
  '/forgot-password',
  validateBody(forgotPasswordSchema),
  handler(async (req, res) => {
    const result = await requestPasswordReset(req.body.email);
    ok(res, {
      ...result,
      // Phrased as a conditional on purpose: it is true for an address with no
      // account, and it is the same sentence either way.
      message: 'If that Gmail address has an account, a reset code is on its way.',
    });
  }),
);

/**
 * POST /api/auth/reset-password — submit the code and the new password.
 *
 * On success every session for the account is revoked, so no tokens come back
 * here and the farmer signs in with the password they just chose. 400 with the
 * message keyed to `code` for anything wrong with the code.
 */
authRouter.post(
  '/reset-password',
  validateBody(resetPasswordSchema),
  handler(async (req, res) => {
    await resetPassword(req.body);
    ok(res, { message: 'Password changed. Please sign in with your new password.' });
  }),
);

/** POST /api/auth/refresh — exchange a refresh token for a new pair. */
authRouter.post(
  '/refresh',
  validateBody(refreshTokenSchema),
  handler(async (req, res) => {
    const tokens = await service.refreshTokens(req.body.refreshToken);
    ok(res, { tokens });
  }),
);

/** POST /api/auth/logout — invalidate one session. */
authRouter.post(
  '/logout',
  validateBody(refreshTokenSchema),
  handler(async (req, res) => {
    await service.logout(req.body.refreshToken);
    ok(res, { message: 'Logged out' });
  }),
);

/** GET /api/auth/me — current user profile. */
authRouter.get(
  '/me',
  authenticate,
  handler(async (req, res) => {
    const user = await service.getProfile(userId(req));
    ok(res, { user });
  }),
);

/** PATCH /api/auth/me */
authRouter.patch(
  '/me',
  authenticate,
  validateBody(updateProfileSchema),
  handler(async (req, res) => {
    const user = await service.updateProfile(userId(req), req.body);
    ok(res, { user });
  }),
);

// ───────────────────── Email verification (OTP) ─────────────────────
//
// Both routes are authenticated. Registration already returns tokens, so the
// farmer holds one by the time this screen appears, and taking the identity from
// the token rather than the body is what stops these endpoints from being an
// account-existence oracle or a way to send mail to arbitrary addresses.

/**
 * POST /api/auth/send-otp — email a 6-digit code to the signed-in farmer.
 *
 * 429 with `retryAfter` while the 60-second resend cooldown is running or the
 * hourly ceiling is reached; 502 if Gmail rejected the message, or if the
 * mailbox is unconfigured on a non-development server. In development an
 * unconfigured mailbox prints the code to the server log instead of failing.
 */
authRouter.post(
  '/send-otp',
  authenticate,
  handler(async (req, res) => {
    const result = await sendVerificationOtp(userId(req));
    ok(res, result);
  }),
);

/**
 * POST /api/auth/verify-email — submit the code.
 *
 * Idempotent: an already-verified account returns 200 rather than an error.
 */
authRouter.post(
  '/verify-email',
  authenticate,
  validateBody(verifyEmailSchema),
  handler(async (req, res) => {
    await verifyOtp(userId(req), req.body.code);
    // The updated profile comes back so the client can replace its cached user
    // without a follow-up GET /me.
    const user = await service.getProfile(userId(req));
    ok(res, { user, message: 'Email verified' });
  }),
);

/** POST /api/auth/change-password — also revokes every other session. */
authRouter.post(
  '/change-password',
  authenticate,
  validateBody(changePasswordSchema),
  handler(async (req, res) => {
    await service.changePassword(userId(req), req.body);
    ok(res, { message: 'Password changed. Please sign in again.' });
  }),
);
