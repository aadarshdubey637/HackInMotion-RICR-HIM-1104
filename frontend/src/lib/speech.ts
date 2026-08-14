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
 *  3. When the transcript comes back in Latin script — which is what happens
 *     whenever the recogniser was set to English, the common case on a phone
 *     nobody has configured — the romanised marker sets below decide. This is
 *     what lets a Telugu or Marathi speaker be recognised on their very first
 *     utterance, rather than only after they have found the language picker.
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
  results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }> & { isFinal: boolean }>;
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
      let lastHeardText = '';
      let settled = false;

      const finish = (value: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (session === sessionRef.current) {
          setListening(false);
          setInterim('');
        }
        resolve(value.trim() || lastHeardText);
      };

      const timer = setTimeout(() => {
        recognition.abort();
        if (!finalText && !lastHeardText) setError('no-speech');
        finish(finalText);
      }, LISTEN_TIMEOUT_MS);

      recognition.onstart = () => {
        if (session !== sessionRef.current) return;
        setListening(true);
        setError(null);
        setInterim('');
      };

      recognition.onresult = (event) => {
        let accumulatedFinal = '';
        let accumulatedInterim = '';
        for (let i = 0; i < event.results.length; i += 1) {
          const result = event.results[i];
          const text = result[0]?.transcript ?? '';
          if (result.isFinal) {
            accumulatedFinal += text;
          } else {
            accumulatedInterim += text;
          }
        }

        lastHeardText = (accumulatedFinal + accumulatedInterim).trim();

        if (session !== sessionRef.current) return;
        setInterim(accumulatedInterim);
        if (accumulatedFinal) {
          finalText = accumulatedFinal;
          setTranscript(accumulatedFinal.trim());
        }
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
 * Marker words as an `en-IN` recogniser renders them — the case that actually
 * matters in the field.
 *
 * A farmer opening the app for the first time gets whatever language the device
 * is set to, which across rural India is very often `en-IN`. They then speak
 * Hindi, or Marathi, or Telugu. The recogniser, told to expect English, returns
 * *Latin* text — so the script ranges above find nothing, and until this layer
 * existed only Hindi and Punjabi were identifiable, purely because those two
 * were the only ones with romanised entries in the command vocabulary.
 *
 * Two tiers, because these languages share a great deal of vocabulary once
 * romanised:
 *
 *  - `strong`: distinctive to this language. One is enough.
 *  - `weak`:   real but shared ("mandi", "bhav", "paani") or short. Two are
 *              needed, or one alongside a strong marker.
 *
 * Shared words are listed as `weak` under *every* language that uses them, not
 * just the first. Otherwise a Marathi speaker saying "bajar bhav sanga" would
 * lose to Hindi on the two shared words and win only on the one Marathi verb.
 *
 * Function words are what carry the signal, not farming nouns — "aahe", "kavali"
 * and "kothay" appear in almost any sentence in their language, whereas the
 * farmer may never say the word for "market" at all.
 *
 * English needs no markers: it scores zero, falls below the threshold, and the
 * interface is left alone. That is deliberate — a false positive rewrites the
 * whole screen into a script the farmer may not read, which is far worse than
 * failing to detect and leaving them on the picker.
 */
const ROMANISED: Array<{ language: Language; strong: string[]; weak: string[] }> = [
  {
    // Hindi first: it wins an exact tie, being the most widely understood.
    language: 'hi',
    strong: [
      'mera',
      'meri',
      'kya',
      'kitna',
      'kitne',
      'batao',
      'bataiye',
      'bataye',
      'chahiye',
      'dikhao',
      'kaise',
      'kaunsi',
      'faslein',
      'paidawar',
      'upaj',
      'daam',
      'barish',
      'mein',
      'hua',
    ],
    weak: [
      'hai',
      'aaj',
      'kal',
      'nahi',
      'bolo',
      'bajar',
      'bazar',
      'bhav',
      'mandi',
      'paani',
      'pani',
      'khet',
      'fasal',
      'khaad',
      'mausam',
      'sinchai',
      'bimari',
      'rog',
      'keet',
      'keede',
      'sunao',
      'keemat',
      'karna',
      'samasya',
      'mere',
      'tha',
      'thi',
    ],
  },
  {
    language: 'pa',
    strong: [
      'dasso',
      'kithe',
      'kadon',
      'kinna',
      'kinne',
      'jhaar',
      'meenh',
      'tuhanu',
      'saanu',
      'sanu',
      'changa',
      'bhaa',
      'ajj',
      'vekho',
      'pind',
      'ki karna',
    ],
    weak: [
      'hai',
      'mandi',
      'paani',
      'khet',
      'fasal',
      'khaad',
      'mausam',
      'sinchai',
      'bimari',
      'keede',
      'sunao',
      'keemat',
      'karna',
      'mera khet',
      'meri fasal',
    ],
  },
  {
    language: 'mr',
    strong: [
      'aahe',
      'aahet',
      'majhe',
      'maza',
      'majhya',
      'dakhva',
      'dakhava',
      'sanga',
      'pahije',
      'karaycha',
      'karayche',
      'kuthe',
      'kadhi',
      'kiti',
      'pik',
      'pike',
      'havaman',
      'paus',
      'sinchan',
      'utpadan',
      'khat',
      'kida',
      'kide',
      'aarogya',
      'mala',
    ],
    weak: ['kay', 'nahi', 'tumhi', 'ani', 'bhav', 'bajar', 'samasya', 'rog'],
  },
  {
    language: 'te',
    strong: [
      'cheppu',
      'cheppandi',
      'kavali',
      'ekkada',
      'eppudu',
      'emiti',
      'panta',
      'pantalu',
      'neeru',
      'neeti',
      'vatavaranam',
      'vaatavaranam',
      'varsham',
      'digubadi',
      'naaku',
      'ee roju',
      'teliyadu',
      'baagundi',
      'ledu',
      'vyadhi',
      'tegulu',
      'purugu',
      'aarogyam',
      'eruvu',
      'retu',
    ],
    weak: ['enti', 'emi', 'naa', 'undi', 'ela', 'dhara', 'roju'],
  },
  {
    language: 'bn',
    strong: [
      'amar',
      'kothay',
      'kobe',
      'dekhao',
      'dekhan',
      'abohawa',
      'abohaoya',
      'brishti',
      'folon',
      'jol',
      'sech',
      'koto',
      'tomar',
      'hocche',
      'bolun',
      'sasthya',
      'poka',
    ],
    weak: ['bolo', 'dam', 'bajar', 'sar', 'roga'],
  },
];

/** Points a match is worth, and the score a language must reach to be believed. */
const STRONG_POINTS = 2;
const WEAK_POINTS = 1;
const CONFIDENCE_THRESHOLD = 2;

/** Lowercase, drop punctuation, collapse spaces. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Count markers present in the transcript.
 *
 * Single words are matched as whole tokens, never substrings — "kal" must not
 * fire inside "calcium", and "sar" must not fire inside "sarson". Multi-word
 * markers are matched against the padded string, where the padding makes the
 * first and last token addressable by the same ` word ` test.
 */
function countMarkers(tokens: Set<string>, padded: string, markers: string[]): number {
  let hits = 0;
  for (const marker of markers) {
    if (marker.includes(' ')) {
      if (padded.includes(` ${marker} `)) hits += 1;
    } else if (tokens.has(marker)) {
      hits += 1;
    }
  }
  return hits;
}

/**
 * Identify a romanised Indian language, or null when the evidence is too thin
 * — which is the correct answer for plain English.
 */
export function detectRomanisedLanguage(text: string): Language | null {
  const normalised = normalise(text);
  if (!normalised) return null;

  const tokens = new Set(normalised.split(' '));
  const padded = ` ${normalised} `;

  let best: Language | null = null;
  let bestScore = 0;

  for (const entry of ROMANISED) {
    const score =
      countMarkers(tokens, padded, entry.strong) * STRONG_POINTS +
      countMarkers(tokens, padded, entry.weak) * WEAK_POINTS;

    // Strictly greater, so an exact tie keeps the earlier (more widely
    // understood) language rather than the last one checked.
    if (score > bestScore) {
      bestScore = score;
      best = entry.language;
    }
  }

  return bestScore >= CONFIDENCE_THRESHOLD ? best : null;
}

/**
 * The language of the text's *script*, or null when it is written in Latin.
 *
 * Kept separate from the romanised guess because callers need to weigh the two
 * differently: an Indian script is near-proof, whereas romanised markers are a
 * balance of probabilities. Null here is the signal "this came back in Latin,
 * so the recogniser was listening in English".
 */
export function detectScriptLanguage(text: string): Language | null {
  if (!text) return null;

  const script = SCRIPTS.find((s) => s.pattern.test(text));
  if (!script) return null;

  if (script.language === 'hi' && MARATHI_MARKERS.some((marker) => text.includes(marker))) {
    return 'mr';
  }

  return script.language;
}

/**
 * Best guess at which language a piece of text is written in.
 *
 * Script is decisive where it applies. Failing that — i.e. Latin text, which is
 * what an English recogniser returns no matter what it hears — fall back to the
 * romanised markers. English lands on null, leaving the interface untouched.
 */
export function detectLanguage(text: string): Language | null {
  if (!text) return null;
  return detectScriptLanguage(text) ?? detectRomanisedLanguage(text);
}
