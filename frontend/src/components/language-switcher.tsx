'use client';

import { useEffect, useRef, useState } from 'react';
import { Globe, Check, Volume2, VolumeX } from 'lucide-react';
import { useTranslation } from '@/lib/language-context';
import { useVoice } from '@/lib/voice';
import { LANGUAGES, LANGUAGE_CODES, translations, type Language } from '@/lib/translations';
import { api, tokenStore } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Language picker.
 *
 * Three things happen on a change, and all three matter:
 *
 *  1. The interface switches immediately, from local state — a farmer on a bad
 *     connection must never wait on a round-trip to read their own screen.
 *  2. The choice is saved to the account in the background, so the same farmer
 *     on a different phone gets their language back. Failure is silent; the
 *     local choice already took effect and is persisted in localStorage.
 *  3. The new language is spoken aloud as confirmation. This is the part that
 *     is easy to skip and shouldn't be: a farmer who cannot read the label
 *     needs to *hear* that they landed on the right one. It also surfaces
 *     immediately whether this device actually has that voice installed.
 */
export function LanguageSwitcher({
  /** `bar` for the app header, `inline` for the signed-out auth pages. */
  variant = 'bar',
  className,
}: {
  variant?: 'bar' | 'inline';
  className?: string;
}) {
  const { language, setLanguage, t } = useTranslation();
  const voice = useVoice();
  const [open, setOpen] = useState(false);
  /** Set when the chosen language has no installed voice on this device. */
  const [voiceWarning, setVoiceWarning] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click and on Escape — a dropdown left open over the
  // dashboard hides exactly the content the farmer just came to read.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function choose(next: Language) {
    setOpen(false);
    setVoiceWarning(null);

    if (next === language) return;

    setLanguage(next);

    // Persist to the account when signed in. Fire and forget: the interface
    // has already changed and localStorage holds the choice regardless.
    if (tokenStore.get()) {
      void api.auth.updateProfile({ language: next }).catch(() => undefined);
    }

    // Speak the confirmation in the language just chosen.
    if (voice.supported) {
      const spoken = voice.resolve(next);
      const confirmation = translateIn(next, 'voice.languageSwitched', {
        language: LANGUAGES[next].nativeLabel,
      });
      voice.speak(confirmation, next);

      if (spoken.fellBack) {
        setVoiceWarning(
          translateIn(next, 'voice.noVoiceInstalled', {
            language: LANGUAGES[next].nativeLabel,
          }),
        );
      }
    }
  }

  const current = LANGUAGES[language];

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('nav.language')}
        className={cn(
          'flex min-h-[44px] items-center gap-1.5 rounded-xl font-semibold transition',
          variant === 'bar'
            ? 'px-2.5 text-slate-600 hover:bg-soil-100'
            : 'border border-soil-300 bg-white px-3 text-slate-700 hover:bg-soil-50',
        )}
      >
        <Globe className="h-5 w-5 shrink-0" aria-hidden />
        <span className="text-sm">{current.nativeLabel}</span>
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label={t('nav.language')}
          className="absolute right-0 z-50 mt-1 w-52 overflow-hidden rounded-2xl border border-soil-200 bg-white py-1 shadow-lg"
        >
          {LANGUAGE_CODES.map((code) => {
            const meta = LANGUAGES[code];
            const active = code === language;
            // Flagging missing voices here sets expectations *before* the
            // farmer relies on read-aloud in the field.
            const hasVoice = voice.supported ? voice.hasLanguage(code) : true;

            return (
              <button
                key={code}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => choose(code)}
                className={cn(
                  'flex min-h-[44px] w-full items-center gap-2.5 px-3 text-left transition',
                  active ? 'bg-brand-50' : 'hover:bg-soil-50',
                )}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                  {active ? <Check className="h-4 w-4 text-brand-700" aria-hidden /> : null}
                </span>

                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block truncate text-sm font-semibold',
                      active ? 'text-brand-800' : 'text-slate-800',
                    )}
                  >
                    {meta.nativeLabel}
                  </span>
                  {meta.label !== meta.nativeLabel ? (
                    <span className="block truncate text-xs text-slate-500">{meta.label}</span>
                  ) : null}
                </span>

                {voice.supported ? (
                  hasVoice ? (
                    <Volume2 className="h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden />
                  ) : (
                    <VolumeX
                      className="h-3.5 w-3.5 shrink-0 text-amber-500"
                      aria-label="No voice installed for this language"
                    />
                  )
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {voiceWarning ? (
        <p
          role="status"
          className="absolute right-0 z-40 mt-1 w-60 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow-sm"
        >
          {voiceWarning}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Translate into a specific language rather than the active one.
 *
 * `setLanguage` has not re-rendered this component yet at the moment we need
 * the confirmation string, and reading it from the old language would announce
 * the switch in the language being switched *away* from.
 */
function translateIn(
  language: Language,
  path: string,
  variables: Record<string, string | number>,
): string {
  const dictionaries = translations as unknown as Record<
    string,
    Record<string, Record<string, string>>
  >;

  const [section, key] = path.split('.');
  const template =
    dictionaries[language]?.[section]?.[key] ?? dictionaries.en?.[section]?.[key] ?? '';

  return Object.entries(variables).reduce(
    (text, [name, value]) => text.replace(new RegExp(`{${name}}`, 'g'), String(value)),
    template,
  );
}
