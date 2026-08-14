/**
 * Google Sign-In token verification.
 *
 * Flow: the browser runs Google Identity Services, the farmer picks their
 * account, and Google hands the browser a signed **ID token** (a JWT). The
 * browser posts that token here; this file proves it is genuine and extracts
 * the identity from it.
 *
 * Why this flow rather than the server-side authorization-code exchange:
 *
 *  - No client *secret* exists anywhere in the system, so there is no secret to
 *    leak in a repo, a screenshot, or a deploy log. The client id is public by
 *    design — it ships in the browser bundle.
 *  - No redirect URIs, no callback route, no session cookie needed to carry
 *    OAuth state. It slots into the JWT auth already here: verify, then issue
 *    our own tokens exactly as password login does.
 *
 * What verification must check, all of which `verifyIdToken` does for us:
 * signature against Google's rotating public keys, `iss` is Google, `aud` is
 * *our* client id, and the token is unexpired. The `aud` check is the one that
 * matters most — without it, an ID token issued to any other Google app would
 * be accepted here, which would let that app's developer sign in as any of our
 * farmers.
 */

import { OAuth2Client } from 'google-auth-library';
import { config } from '../../config';
import { AuthenticationError, ValidationError } from '../../common/errors';

/** The claims we rely on, narrowed from Google's payload. */
export interface GoogleIdentity {
  /** Google's stable account id. Never changes, even if the email does. */
  googleId: string;
  email: string;
  /** True when Google has verified the address belongs to this person. */
  emailVerified: boolean;
  name: string;
  picture: string | null;
  /** BCP-47 locale from the Google account, e.g. "hi" — used as a language hint. */
  locale: string | null;
}

/**
 * Built once and reused: the client caches Google's public keys, so a new
 * instance per request would re-fetch them and make every sign-in slower.
 */
let client: OAuth2Client | null = null;

function getClient(): OAuth2Client {
  if (!config.GOOGLE_CLIENT_ID) {
    // A 400, not a 500: the request is fine, the deployment simply has no
    // Google credentials, and the frontend should not have offered the button.
    throw new ValidationError('Google Sign-In is not configured on this server');
  }
  client ??= new OAuth2Client(config.GOOGLE_CLIENT_ID);
  return client;
}

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  const oauthClient = getClient();

  let payload;
  try {
    const ticket = await oauthClient.verifyIdToken({
      idToken,
      audience: config.GOOGLE_CLIENT_ID as string,
    });
    payload = ticket.getPayload();
  } catch {
    // Bad signature, wrong audience, expired — all indistinguishable to the
    // caller on purpose. A precise reason here only helps someone probing.
    throw new AuthenticationError('Google sign-in failed. Please try again.');
  }

  if (!payload?.sub || !payload.email) {
    throw new AuthenticationError('Google did not return an account we can use');
  }

  // Google can issue tokens for unverified addresses. Accepting one would let
  // someone sign up with an address they do not own and, worse, get linked to
  // an existing password account that legitimately owns it.
  const emailVerified = payload.email_verified === true;
  if (!emailVerified) {
    throw new AuthenticationError(
      'Your Google email address is not verified. Please verify it with Google first.',
    );
  }

  return {
    googleId: payload.sub,
    email: payload.email.toLowerCase(),
    emailVerified,
    // `name` is optional in the payload; the local part of the address is a
    // far better placeholder than an empty heading on the dashboard.
    name: payload.name?.trim() || payload.email.split('@')[0],
    picture: payload.picture ?? null,
    locale: payload.locale ?? null,
  };
}
