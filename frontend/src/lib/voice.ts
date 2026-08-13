'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LANGUAGES, type Language } from './translations';

/**
 * Voice output via the Web Speech API.
 *
 * Accessibility matters here beyond convenience: many farmers have limited
 * literacy or are reading a phone in bright sunlight with dirty hands. Being
 * able to press one button and *hear* today's guidance is a genuine
 * improvement, not a gimmick.
 *
 * Language handling: the spoken locale follows whichever language the farmer
 * has selected in the app, so switching the interface to Punjabi switches the
 * narration to Punjabi too. Installed voices vary enormously by device, so
 * `resolve()` reports what will *actually* be spoken rather than what was
 * asked for — that lets the UI say "your phone has no Punjabi voice installed"
 * instead of silently reading Gurmukhi text with English phonetics, which is
 * unintelligible.
 *
 * We use SpeechSynthesis (output) only. Speech *recognition* is Chrome-only,
 * requires network round-trips, and handles Indian-accented regional languages
 * poorly — shipping it would promise more than it delivers.
 */

export interface ResolvedVoice {
  /** The language that will actually be spoken. */
  language: Language;
  /** BCP-47 tag handed to the synthesiser. */
  locale: string;
  /** True when the requested language had no installed voice and we fell back. */
  fellBack: boolean;
}

export interface VoiceState {
  /** Whether this browser can speak at all. */
  supported: boolean;
  speaking: boolean;
  /**
   * Speak the given text in the given language, cancelling anything already in
   * progress. Falls back to English when the language has no installed voice.
   */
  speak: (text: string, language?: Language) => void;
  stop: () => void;
  /** True when a voice for this language is actually installed on the device. */
  hasLanguage: (language: Language) => boolean;
  /** What would actually be spoken if `speak` were called with this language. */
  resolve: (language: Language) => ResolvedVoice;
}

/** Match on the base subtag: an installed "hi-IN" voice satisfies "hi". */
function matches(voice: SpeechSynthesisVoice, locale: string): boolean {
  const want = locale.toLowerCase().slice(0, 2);
  return voice.lang.toLowerCase().replace('_', '-').startsWith(want);
}

export function useVoice(): VoiceState {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    setSupported(true);

    // Voices load asynchronously in most browsers, and the first call often
    // returns an empty list.
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);

    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', load);
      // Stop any narration when the component unmounts, otherwise it keeps
      // talking after the user navigates away.
      window.speechSynthesis.cancel();
    };
  }, []);

  const hasLanguage = useCallback(
    (language: Language) => {
      const locale = LANGUAGES[language]?.speechLocale ?? 'en-IN';
      return voices.some((v) => matches(v, locale));
    },
    [voices],
  );

  const resolve = useCallback(
    (language: Language): ResolvedVoice => {
      const locale = LANGUAGES[language]?.speechLocale ?? 'en-IN';

      if (voices.length === 0 || voices.some((v) => matches(v, locale))) {
        // With no voice list yet we cannot know — assume the request holds
        // rather than warning about a fallback that may never happen.
        return { language, locale, fellBack: false };
      }

      // Hindi is a better fallback than English for the other Indian
      // languages: the scripts differ but the phoneme inventory overlaps far
      // more than English does, so numbers and place names stay recognisable.
      const hindi = LANGUAGES.hi.speechLocale;
      if (language !== 'en' && voices.some((v) => matches(v, hindi))) {
        return { language: 'hi', locale: hindi, fellBack: true };
      }

      return { language: 'en', locale: LANGUAGES.en.speechLocale, fellBack: language !== 'en' };
    },
    [voices],
  );

  const speak = useCallback(
    (text: string, language: Language = 'en') => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

      // Cancel first — queuing utterances leads to a backlog the user cannot stop.
      window.speechSynthesis.cancel();

      const { locale } = resolve(language);

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = locale;
      // Slightly slower than default: guidance is information-dense, and this
      // is often heard once, outdoors, over background noise.
      utterance.rate = 0.92;
      utterance.pitch = 1;

      const preferred =
        voices.find((v) => v.lang.toLowerCase().replace('_', '-') === locale.toLowerCase()) ??
        voices.find((v) => matches(v, locale));
      if (preferred) utterance.voice = preferred;

      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);

      window.speechSynthesis.speak(utterance);
    },
    [voices, resolve],
  );

  const stop = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  return useMemo(
    () => ({ supported, speaking, speak, stop, hasLanguage, resolve }),
    [supported, speaking, speak, stop, hasLanguage, resolve],
  );
}

/** Translator signature, matching `useTranslation()`. */
type Translate = (path: string, variables?: Record<string, string | number>) => string;

/**
 * Turn a dashboard payload into something worth listening to.
 *
 * Reading the screen verbatim would be unbearable — this composes a short
 * spoken briefing that leads with what needs acting on.
 *
 * The sentence frame comes from the translation file, so the briefing is spoken
 * in the farmer's language. Individual action titles come from the backend and
 * are passed through `tNarrative`, which localises the phrasings we have and
 * leaves the rest as-is — a briefing that is 80% Hindi is far more useful than
 * one that refuses to speak because one sentence is untranslated.
 */
export function buildSpokenBriefing(
  input: {
    farmName: string;
    actions: Array<{ title: string; action: string; priority: string }>;
    irrigation?: { headline?: string };
    weather?: { today?: { tempMaxC: number; rainMm: number } };
  },
  t: Translate,
  tNarrative: (text: string) => string = (text) => text,
): string {
  const parts: string[] = [];

  parts.push(t('voice.briefingIntro', { farm: input.farmName }));

  if (input.weather?.today) {
    const { tempMaxC, rainMm } = input.weather.today;
    parts.push(
      rainMm > 0
        ? t('voice.briefingWeatherRain', {
            temp: Math.round(tempMaxC),
            rain: Math.round(rainMm),
          })
        : t('voice.briefingWeatherDry', { temp: Math.round(tempMaxC) }),
    );
  }

  if (input.actions.length === 0) {
    parts.push(t('voice.briefingNothing'));
    return parts.join(' ');
  }

  const urgent = input.actions.filter((a) => a.priority === 'CRITICAL' || a.priority === 'HIGH');

  parts.push(
    urgent.length > 0
      ? t('voice.briefingUrgent', { count: urgent.length })
      : t('voice.briefingItems', { count: input.actions.length }),
  );

  // Three is about as much as anyone retains from audio.
  for (const action of input.actions.slice(0, 3)) {
    parts.push(`${tNarrative(action.title)}. ${tNarrative(action.action)}`);
  }

  if (input.actions.length > 3) {
    parts.push(t('voice.briefingMore', { count: input.actions.length - 3 }));
  }

  return parts.join(' ');
}

/**
 * Compose a spoken version of a crop-health diagnosis.
 *
 * Ordered the way a farmer needs it: what it probably is, how sure we are,
 * then what to do — the actions matter more than the name.
 */
export function buildSpokenDiagnosis(
  diagnosis: {
    summary: string;
    confidence: number;
    candidates: Array<{ name: string; confidence: number }>;
    nextSteps: string[];
  },
  t: Translate,
  tNarrative: (text: string) => string = (text) => text,
): string {
  const parts: string[] = [tNarrative(diagnosis.summary)];

  const top = diagnosis.candidates[0];
  if (top) {
    parts.push(
      t('voice.diagnosisTop', {
        name: top.name,
        percent: Math.round(top.confidence * 100),
      }),
    );
  }

  if (diagnosis.nextSteps.length > 0) {
    parts.push(t('voice.diagnosisSteps'));
    for (const step of diagnosis.nextSteps.slice(0, 3)) {
      parts.push(tNarrative(step));
    }
  }

  return parts.join(' ');
}
