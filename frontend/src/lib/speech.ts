'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { LANGUAGES, type Language } from './translations';

/**
 * Speech *recognition* — the listening half of the voice interface.
 *
 * A note on what this can and cannot do, because it shapes the whole design:
 *
 * The Web Speech API has **no language auto-detection**. `recognition.lang`
 * must be set before listening starts, and the recogniser will force whatever
 * it hears into that language — speak Punjabi at an `en-IN` recogniser and you
 * get nonsense English words, not Punjabi.
 *
 * So "detect the farmer's language" is solved after the fact, not before:
 *
 *  1. We listen in the language the app is currently set to, which is right
 *     the overwhelming majority of the time.
 *  2. The transcript is then matched against the command vocabulary of *every*
 *     language at once (see voice-commands.ts) and against the script ranges
 *     below. A Gurmukhi transcript, or a phrase that only exists in the Punjabi
 *     vocabulary, is decisive evidence the farmer is speaking Punjabi — so the
 *     app switches to Punjabi and answers in it.
 *
 * Note there is deliberately **no** "retry in the other locales" loop. Speech
 * recognition cannot re-analyse audio it has already discarded, so retrying
 * means silently reopening the microphone at someone who has finished
 * speaking — up to a minute of dead air, and then a failure anyway. The
 * cross-vocabulary match above covers the real case instead: an `en-IN`
 * recogniser hearing Hindi returns romanised text ("mandi bhav batao"), and the
 * romanised forms are in the vocabulary precisely for that.
 *
 * Availability is Chrome/Edge and Safari 14.5+; Firefox has none. Everything
 * degrades to the typed input that was always there.
 */

// The API is still vendor-prefixed almost everywhere.
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<
    ArrayLike<{ transcript: string; confidence: number }> & { isFinal: boolean }
  >;
}

type RecognitionConstructor = new () => SpeechRecognitionLike;

function getRecognition(): RecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Why listening stopped, in terms the UI can turn into farmer-facing text. */
export type SpeechError = 'not-supported' | 'mic-blocked' | 'no-speech' | 'network' | 'failed';

export interface SpeechState {
  supported: boolean;
  listening: boolean;
  /** Finalised text from the last completed utterance. */
  transcript: string;
  /** Live partial text while the farmer is still speaking. */
  interim: string;
  error: SpeechError | null;
  /**
   * Listen once in the given language and resolve with the final transcript
   * (empty string if nothing was heard).
   */
  listen: (language: Language) => Promise<string>;
  stop: () => void;
  reset: () => void;
}

/** How long to wait for speech before giving up, in ms. */
const LISTEN_TIMEOUT_MS = 12_000;

export function useSpeechRecognition(): SpeechState {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<SpeechError | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  /** Guards against a stale onend resolving a newer listen(). */
  const sessionRef = useRef(0);

  useEffect(() => {
    setSupported(getRecognition() !== null);
    return () => {
      // Leaving the page while the mic is open keeps the browser's recording
      // indicator on, which is alarming and looks like a bug.
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const reset = useCallback(() => {
    setTranscript('');
    setInterim('');
    setError(null);
  }, []);

  const listen = useCallback((language: Language): Promise<string> => {
    const Recognition = getRecognition();
    if (!Recognition) {
      setError('not-supported');
      return Promise.resolve('');
    }

    // Abandon any session already running, otherwise Chrome throws
    // InvalidStateError on the second start().
    recognitionRef.current?.abort();

    const session = ++sessionRef.current;

    return new Promise<string>((resolve) => {
      const recognition = new Recognition();
      recognitionRef.current = recognition;

      recognition.lang = LANGUAGES[language]?.speechLocale ?? 'en-IN';
      // One utterance per press: a farmer taps, says one thing, and expects
      // the app to act. Continuous mode leaves the mic open and drains battery.
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      let finalText = '';
      let settled = false;

      const finish = (value: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (session === sessionRef.current) {
          setListening(false);
          setInterim('');
        }
        resolve(value.trim());
      };

      const timer = setTimeout(() => {
        recognition.abort();
        if (!finalText) setError('no-speech');
        finish(finalText);
      }, LISTEN_TIMEOUT_MS);

      recognition.onstart = () => {
        if (session !== sessionRef.current) return;
        setListening(true);
        setError(null);
        setInterim('');
      };

      recognition.onresult = (event) => {
        let partial = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          const text = result[0]?.transcript ?? '';
          if (result.isFinal) finalText += text;
          else partial += text;
        }
        if (session !== sessionRef.current) return;
        setInterim(partial);
        if (finalText) setTranscript(finalText.trim());
      };

      recognition.onerror = (event) => {
        if (session === sessionRef.current) {
          setError(
            event.error === 'not-allowed' || event.error === 'service-not-allowed'
              ? 'mic-blocked'
              : event.error === 'no-speech'
                ? 'no-speech'
                : event.error === 'network'
                  ? 'network'
                  : 'failed',
          );
        }
        finish(finalText);
      };

      recognition.onend = () => finish(finalText);

      try {
        recognition.start();
      } catch {
        setError('failed');
        finish('');
      }
    });
  }, []);

  return { supported, listening, transcript, interim, error, listen, stop, reset };
}

// ─────────────────────────── Language detection ───────────────────────────

/**
 * Script ranges, which are decisive where they apply: Gurmukhi text is
 * Punjabi, Bengali text is Bengali. Devanagari is shared by Hindi and Marathi,
 * so that pair is separated by vocabulary below.
 */
const SCRIPTS: Array<{ language: Language; pattern: RegExp }> = [
  { language: 'pa', pattern: /[਀-੿]/ },
  { language: 'bn', pattern: /[ঀ-৿]/ },
  { language: 'te', pattern: /[ఀ-౿]/ },
  { language: 'hi', pattern: /[ऀ-ॿ]/ },
];

/**
 * Marathi markers that do not occur in Hindi. Both use Devanagari, so the only
 * way to tell them apart is function words — these are the highest-frequency
 * ones that differ.
 */
const MARATHI_MARKERS = [
  'आहे',
  'आहेत',
  'नाही',
  'माझ्या',
  'तुमच्या',
  'करा',
  'दाखवा',
  'पिके',
  'मला',
  'काय',
];

/**
 * Best guess at which language a piece of text is written in.
 *
 * Returns null for Latin script: romanised Hindi and English are genuinely
 * ambiguous from characters alone ("mera khet" vs "my field"), and guessing
 * wrong would switch the farmer's whole interface on a false positive. The
 * command vocabulary handles that case instead, where a match is real evidence.
 */
export function detectLanguage(text: string): Language | null {
  if (!text) return null;

  const script = SCRIPTS.find((s) => s.pattern.test(text));
  if (!script) return null;

  if (script.language === 'hi' && MARATHI_MARKERS.some((marker) => text.includes(marker))) {
    return 'mr';
  }

  return script.language;
}
