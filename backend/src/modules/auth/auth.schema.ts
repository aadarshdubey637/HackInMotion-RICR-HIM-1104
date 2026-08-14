import { z } from 'zod';

/**
 * Auth request schemas.
 *
 * Messages are written to be shown directly to the farmer, so they avoid
 * jargon and say what to do rather than what went wrong internally.
 */

// ───────────────────────── Shared field validators ─────────────────────────

/**
 * Gmail address, lowercased.
 *
 * Restricted to gmail.com because registration is paired with "Continue with
 * Google": a farmer who signs up with their Gmail today and taps the Google
 * button next month lands on the *same* account, since `loginWithGoogle` links
 * by verified email. Allowing other providers would quietly create a second,
 * empty account for anyone who switched buttons.
 *
 * The local part is only checked for general email validity. Gmail's own rules
 * (6-30 characters, no underscores) do not apply to older accounts or to
 * `+alias` addresses, and rejecting a working address is worse than accepting
 * an unusable one — an unusable one simply never gets a Google sign-in.
 *
 * Dots are NOT stripped. Gmail treats `a.b@` and `ab@` as one inbox, but Google
 * hands us the address as written in the account, and `loginWithGoogle` matches
 * on it exactly. Normalising here would break that match.
 */
const gmailAddress = z
  .string()
  .trim()
  .toLowerCase()
  .email('Please enter a valid email address')
  .refine((value) => value.endsWith('@gmail.com'), {
    message: 'Please use a Gmail address ending in @gmail.com',
  });

/**
 * Indian mobile number, normalised to E.164 (`+919876543210`).
 *
 * Accepts what farmers actually type — `98765 43210`, `098765-43210`,
 * `+91 98765 43210`, `919876543210` — because the number on the SIM is the
 * thing that matters and none of those spellings are wrong. Everything is
 * reduced to one canonical form before it reaches the database, so the same
 * handset cannot register twice by being typed differently.
 *
 * The first digit must be 6-9: that is the whole of India's mobile numbering
 * range.
 */
const indianMobile = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s()\-.]/g, ''))
  .transform((value) => {
    // Strip whichever prefix was used, leaving the bare 10-digit subscriber
    // number. `0` is the domestic trunk prefix; `+91`/`91` the country code.
    if (value.startsWith('+91')) return value.slice(3);
    if (value.startsWith('91') && value.length === 12) return value.slice(2);
    if (value.startsWith('0') && value.length === 11) return value.slice(1);
    return value;
  })
  .refine((value) => /^[6-9]\d{9}$/.test(value), {
    message: 'Please enter a valid 10-digit Indian mobile number',
  })
  .transform((value) => `+91${value}`);

/**
 * Username, lowercased.
 *
 * Lowercasing is a deliberate simplification rather than a limitation: a farmer
 * typing their name on a phone keypad at 6am should not be locked out by a
 * capital letter, and two accounts differing only in case would be a
 * support problem forever. Dots and underscores are allowed inside the name but
 * not at either end, which keeps `ramesh_kumar` and `ramesh.kumar` available
 * without also allowing `_ramesh_`.
 */
const username = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Username must be at least 3 characters')
  .max(20, 'Username must be 20 characters or fewer')
  .regex(
    /^[a-z0-9]([a-z0-9._]*[a-z0-9])?$/,
    'Use only letters, numbers, dots and underscores — starting and ending with a letter or number',
  )
  .refine((value) => !/[._]{2,}/.test(value), {
    message: 'Dots and underscores cannot be next to each other',
  });

const password = z.string().min(8, 'Password must be at least 8 characters').max(128);

const fullName = z.string().trim().min(2, 'Please enter your full name').max(100);

// ───────────────────────── Registration ─────────────────────────

/**
 * POST /auth/register — one form, one request, account created.
 *
 * Every identifier is checked for availability server-side before the insert, so
 * "username already taken" comes back keyed to the field that caused it and the
 * frontend can highlight that box.
 *
 * `confirmPassword` is compared here rather than trusted from the browser. The
 * frontend checks it too, for an instant error, but a mismatch reaching this
 * point means something is wrong with the request and it must not create an
 * account whose password the farmer does not know.
 */
export const registerSchema = z
  .object({
    name: fullName,
    username,
    email: gmailAddress,
    phone: indianMobile,
    password,
    confirmPassword: z.string().min(1, 'Please re-enter your password'),
    /** Language selected on the sign-up screen, saved with the account. */
    language: z.string().trim().min(2).max(10).default('en'),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: 'Both passwords must match',
    // Anchored to the second field: that is the one the farmer should retype.
    path: ['confirmPassword'],
  });

// ───────────────────────── Sign in ─────────────────────────

/**
 * POST /auth/login
 *
 * Accepts a username *or* an email address in one field. `email` is still read
 * as a fallback so that clients written against the previous contract — and the
 * cached frontend bundle a farmer may still have loaded — keep working.
 */
export const loginSchema = z
  .object({
    identifier: z.string().trim().min(1).optional(),
    email: z.string().trim().min(1).optional(),
    password: z.string().min(1, 'Please enter your password'),
  })
  .transform((value, ctx) => {
    const identifier = value.identifier ?? value.email;

    if (!identifier) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['identifier'],
        message: 'Please enter your username or email',
      });
      return z.NEVER;
    }

    // Lowercased for both lookups: usernames are stored lowercased, and email
    // addresses are case-insensitive in every way that matters here.
    return { identifier: identifier.toLowerCase(), password: value.password };
  });

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

/**
 * Google Sign-In. `language` is the language the farmer had selected on the
 * sign-in screen — it is applied to a *newly created* account so the app does
 * not snap back to English the moment they sign up.
 */
export const googleAuthSchema = z.object({
  idToken: z.string().min(1, 'Google sign-in token is missing'),
  language: z.string().trim().min(2).max(10).optional(),
});

// ───────────────────────── Profile ─────────────────────────

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Please enter your current password'),
  newPassword: password,
});

/**
 * `phone` runs through the same normaliser as registration, so a number edited
 * here cannot collide with another account's by being spelled differently.
 */
export const updateProfileSchema = z.object({
  name: fullName.optional(),
  phone: indianMobile.optional(),
  language: z.string().trim().min(2).max(10).optional(),
  avatarUrl: z.string().url().optional(),
});

// ───────────────────────── Email verification ─────────────────────────

/**
 * POST /auth/verify-email
 *
 * Only the code is accepted. The address being verified is read from the
 * authenticated account, never from the body — see the header comment in
 * email-otp.ts for why that matters.
 *
 * Spaces are stripped before validation because the code is usually pasted from
 * the email, and a trailing space is not a wrong code.
 */
export const verifyEmailSchema = z.object({
  code: z
    .string()
    .trim()
    .transform((value) => value.replace(/\s/g, ''))
    .refine((value) => /^\d{6}$/.test(value), {
      message: 'Please enter the 6-digit code from your email',
    }),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type GoogleAuthInput = z.infer<typeof googleAuthSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
