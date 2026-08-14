'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Mic, X, Loader2 } from 'lucide-react';
import { useTranslation } from '@/lib/language-context';
import {
  useSpeechRecognition,
  detectScriptLanguage,
  detectRomanisedLanguage,
} from '@/lib/speech';
import { useVoice } from '@/lib/voice';
import { matchCommand, commandExamples, type VoiceIntent } from '@/lib/voice-commands';
import { LANGUAGES, translations, type Language } from '@/lib/translations';
import { api, tokenStore } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Voice assistant: press, speak, and the app does the thing.
 *
 * Language handling is the interesting part. The recogniser has to be told
 * which language to expect, so we start with the one the app is set to — but
 * the transcript is then matched against every language's command vocabulary
 * at once. A phrase that only exists in Punjabi is proof the farmer is
 * speaking Punjabi, so the app switches to Punjabi, carries out the command,
 * and confirms *in Punjabi*. Script detection catches the same case for
 * dictated text.
 *
 * The farmer whose app is in English but who speaks only Marathi is covered by
 * the romanised marker sets in speech.ts, not by re-listening: an English
 * recogniser hands back Latin text, and the markers read the language out of it.
 * Reopening the microphone at someone who has finished speaking would buy a
 * minute of dead air and then fail anyway.
 */
/**
 * Broadcast so whichever page is mounted can narrate itself.
 *
 * The assistant lives in the shell and has no idea what is on screen; the
 * dashboard owns the data worth reading. An event keeps that boundary intact
 * without threading a callback through every page.
 */
export const READ_ALOUD_EVENT = 'sf:read-aloud';

export function VoiceAssistant({ onReadAloud }: { onReadAloud?: () => void }) {
  const router = useRouter();
  const { language, setLanguage, t } = useTranslation();
  const speech = useSpeechRecognition();
  const voice = useVoice();

  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<'idle' | 'listening' | 'thinking' | 'done' | 'failed'>(
    'idle',
  );
  const [heard, setHeard] = useState('');
  const [reply, setReply] = useState('');

  // Never leave the microphone open behind a closed sheet.
  useEffect(() => {
    if (!open) speech.stop();
  }, [open, speech]);

  /** Speak a line and show it, both in the language just decided on. */
  const respond = useCallback(
    (text: string, spokenIn: Language) => {
      setReply(text);
      if (voice.supported) voice.speak(text, spokenIn);
    },
    [voice],
  );

  const runIntent = useCallback(
    (intent: VoiceIntent, spokenIn: Language) => {
      switch (intent.kind) {
        case 'language': {
          setLanguage(intent.language);
          if (tokenStore.get()) {
            void api.auth.updateProfile({ language: intent.language }).catch(() => undefined);
          }
          respond(
            phraseIn(intent.language, 'voice.languageSwitched', {
              language: LANGUAGES[intent.language].nativeLabel,
            }),
            intent.language,
          );
          return;
        }

        case 'navigate': {
          const page = phraseIn(spokenIn, intent.pageKey, {});
          respond(phraseIn(spokenIn, 'voice.opening', { page }), spokenIn);
          router.push(intent.href);
          setTimeout(() => setOpen(false), 1200);
          return;
        }

        case 'log-issue': {
          respond(phraseIn(spokenIn, 'voice.opening', { page: phraseIn(spokenIn, 'nav.health', {}) }), spokenIn);
          router.push('/health');
          setTimeout(() => setOpen(false), 1200);
          return;
        }

        case 'read-aloud': {
          setOpen(false);
          if (onReadAloud) onReadAloud();
          else window.dispatchEvent(new CustomEvent(READ_ALOUD_EVENT));
          return;
        }

        case 'refresh': {
          setOpen(false);
          router.refresh();
          return;
        }
      }
    },
    [router, setLanguage, respond, onReadAloud],
  );

  async function listen() {
    setHeard('');
    setReply('');
    speech.reset();
    setStatus('listening');

    // One pass, in the language the app is set to. Which language the farmer
    // actually spoke is worked out from the transcript below — see speech.ts
    // for why re-listening in other locales is the wrong move.
    const transcript = await speech.listen(language);

    if (!transcript) {
      setStatus('failed');
      return;
    }

    setHeard(transcript);
    setStatus('thinking');

    const match = matchCommand(transcript);

    // Which language was spoken, from two kinds of evidence weighted by script.
    //
    // Indian script: a vocabulary hit outranks the script, because the
    // recogniser may have transliterated into the wrong one — Devanagari alone
    // cannot separate Hindi from Marathi, but a phrase from the Marathi list
    // can.
    //
    // Latin script (the recogniser was listening in English): the marker sets
    // outrank the vocabulary, because romanised command words are shared —
    // "mandi", "bhav" and "paani" sit in both the Hindi and Punjabi lists, so a
    // hit names an intent reliably but a language only by accident of ordering.
    // The markers weigh a whole sentence instead. The intent still comes from
    // the vocabulary either way.
    const script = detectScriptLanguage(transcript);
    const spokenIn = script
      ? (match?.language ?? script)
      : (detectRomanisedLanguage(transcript) ?? match?.language ?? language);

    // Speaking a different language than the interface is set to *is* the
    // request to switch — the farmer should not also have to find the picker.
    if (spokenIn !== language && spokenIn !== 'en') {
      setLanguage(spokenIn);
      if (tokenStore.get()) {
        void api.auth.updateProfile({ language: spokenIn }).catch(() => undefined);
      }
    }

    if (!match) {
      setStatus('failed');
      respond(phraseIn(spokenIn, 'voice.notUnderstood', {}), spokenIn);
      return;
    }

    setStatus('done');
    runIntent(match.intent, spokenIn);
  }

  if (!speech.supported && !voice.supported) return null;

  const examples = commandExamples(language);

  return (
    <>
      {/* Floating mic. Sits above the bottom navigation on mobile. */}
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          void listen();
        }}
        aria-label={t('voice.assistant')}
        className="fixed bottom-20 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg shadow-brand-600/30 transition active:scale-95 lg:bottom-6"
      >
        <Mic className="h-6 w-6" aria-hidden />
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label={t('voice.close')}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 bg-slate-900/40"
          />

          <div
            role="dialog"
            aria-label={t('voice.assistant')}
            className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl border-t border-soil-200 bg-white p-5 pb-8"
            style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))' }}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-800">{t('voice.assistant')}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t('voice.close')}
                className="btn-ghost px-2"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>

            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <div
                className={cn(
                  'flex h-20 w-20 items-center justify-center rounded-full transition',
                  status === 'listening'
                    ? 'animate-pulse bg-red-100 text-red-600'
                    : 'bg-brand-50 text-brand-700',
                )}
              >
                {status === 'thinking' ? (
                  <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
                ) : (
                  <Mic className="h-8 w-8" aria-hidden />
                )}
              </div>

              <p className="text-sm font-semibold text-slate-700" role="status">
                {!speech.supported
                  ? t('voice.notSupported')
                  : speech.error === 'mic-blocked'
                    ? t('voice.micBlocked')
                    : status === 'listening'
                      ? t('voice.listening')
                      : status === 'thinking'
                        ? t('voice.processing')
                        : status === 'failed' && !reply
                          ? t('voice.didNotCatch')
                          : t('voice.tapToSpeak')}
              </p>

              {speech.interim ? (
                <p className="text-sm italic text-slate-400">{speech.interim}</p>
              ) : null}

              {heard ? (
                <p className="text-sm text-slate-600">
                  <span className="font-semibold">{t('voice.youSaid')}:</span> {heard}
                </p>
              ) : null}

              {reply ? (
                <p className="rounded-xl bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-900">
                  {reply}
                </p>
              ) : null}
            </div>

            {status !== 'listening' && examples.length > 0 ? (
              <div className="mt-3 border-t border-soil-200 pt-3">
                <p className="mb-1.5 text-xs font-semibold text-slate-500">
                  {t('voice.tryExamples')}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {examples.map((example) => (
                    <span
                      key={example}
                      className="rounded-full bg-soil-100 px-2.5 py-1 text-xs text-slate-600"
                    >
                      “{example}”
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {speech.supported ? (
              <button
                type="button"
                onClick={() => void listen()}
                disabled={status === 'listening'}
                className="btn-primary mt-4 w-full"
              >
                <Mic className="h-5 w-5" aria-hidden />
                {status === 'listening' ? t('voice.listening') : t('voice.tapToSpeak')}
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}

/**
 * Translate into a named language rather than the active one.
 *
 * The whole point of this component is replying in the language the farmer
 * just spoke, which is often *not* the one React has re-rendered with yet.
 */
function phraseIn(
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
