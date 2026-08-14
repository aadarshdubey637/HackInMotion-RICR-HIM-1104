'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useTranslation } from '@/lib/language-context';
import { ApiError } from '@/lib/api';
import { Notice } from '@/components/ui';

/**
 * "Continue with Google".
 *
 * Google Identity Services draws the button itself rather than us styling one.
 * Two reasons, and the second is the one that matters here:
 *
 *  1. Google's branding terms require their own button for this flow.
 *  2. It is localised by Google — passing `locale` renders the label in the
 *     farmer's language, including the five Indian languages this app ships.
 *     A hand-rolled button would need six more translations and would still
 *     look unfamiliar to someone who recognises the Google button by sight and
 *     cannot read the label at all.
 *
 * The whole component is optional by design. With no client id configured it
 * renders nothing, and if the Google script cannot load — blocked, or a farmer
 * on no signal — it also renders nothing rather than leaving a dead button on
 * the screen. Email sign-in is always there underneath.
 */

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
const SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

interface CredentialResponse {
  /** The ID token (a JWT). Named `credential` by GIS. */
  credential?: string;
}

interface GoogleIdentityServices {
  accounts: {
    id: {
      initialize(config: {
        client_id: string;
        callback: (response: CredentialResponse) => void;
        auto_select?: boolean;
      }): void;
      renderButton(
        parent: HTMLElement,
        options: {
          type?: 'standard' | 'icon';
          theme?: 'outline' | 'filled_blue' | 'filled_black';
          size?: 'small' | 'medium' | 'large';
          text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
          shape?: 'rectangular' | 'pill' | 'circle' | 'square';
          logo_alignment?: 'left' | 'center';
          width?: number;
          locale?: string;
        },
      ): void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentityServices;
  }
}

/**
 * Load the GIS script once per page, even if two of these buttons mount.
 * The promise is cached so a second caller awaits the same load.
 */
let scriptPromise: Promise<void> | null = null;

function loadGoogleScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.google?.accounts?.id) return Promise.resolve();

  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('gsi failed')));
      return;
    }

    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // Allow a later mount to retry — a farmer who regains signal and
      // navigates back should get the button.
      scriptPromise = null;
      reject(new Error('gsi failed'));
    };
    document.head.appendChild(script);
  });

  return scriptPromise;
}

export function GoogleSignIn({
  text = 'continue_with',
}: {
  text?: 'continue_with' | 'signup_with';
}) {
  const { loginWithGoogle } = useAuth();
  const { language, t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * GIS calls this from outside React once the farmer picks an account. Held in
   * a ref so re-rendering never re-initialises the library mid-sign-in.
   */
  const handleCredential = useCallback(
    async (response: CredentialResponse) => {
      if (!response.credential) {
        setError(t('auth.googleError'));
        return;
      }

      setError(null);
      setBusy(true);
      try {
        await loginWithGoogle(response.credential, language);
        // On success the auth context navigates away, so `busy` is left set
        // deliberately — clearing it would flash the button back for a moment.
      } catch (err) {
        setBusy(false);
        setError(err instanceof ApiError ? err.message : t('auth.googleError'));
      }
    },
    [loginWithGoogle, language, t],
  );

  const callbackRef = useRef(handleCredential);
  useEffect(() => {
    callbackRef.current = handleCredential;
  }, [handleCredential]);

  useEffect(() => {
    if (!CLIENT_ID) return;

    let cancelled = false;

    loadGoogleScript()
      .then(() => {
        const parent = containerRef.current;
        if (cancelled || !parent || !window.google) return;

        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: (response) => void callbackRef.current(response),
        });

        // Clear first: this effect re-runs when the language changes, and GIS
        // appends a fresh button rather than replacing the old one.
        parent.replaceChildren();
        window.google.accounts.id.renderButton(parent, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text,
          shape: 'pill',
          logo_alignment: 'center',
          // Matches the max-w-sm auth card. GIS needs a number, not a %.
          width: 320,
          locale: language,
        });

        setAvailable(true);
      })
      .catch(() => {
        // Offline or blocked. Stay hidden; email sign-in still works.
        if (!cancelled) setAvailable(false);
      });

    return () => {
      cancelled = true;
    };
  }, [language, text]);

  if (!CLIENT_ID) return null;

  return (
    <div className={available ? 'mt-5' : undefined}>
      {available ? (
        <div className="mb-4 flex items-center gap-3" aria-hidden>
          <span className="h-px flex-1 bg-soil-200" />
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            {t('auth.or')}
          </span>
          <span className="h-px flex-1 bg-soil-200" />
        </div>
      ) : null}

      {error ? (
        <div className="mb-3">
          <Notice tone="warn">{error}</Notice>
        </div>
      ) : null}

      {/* GIS renders into this node. Centred because its width is fixed. */}
      <div
        ref={containerRef}
        className={busy ? 'flex justify-center opacity-60' : 'flex justify-center'}
        aria-busy={busy}
        aria-label={t('auth.continueWithGoogle')}
      />
    </div>
  );
}
