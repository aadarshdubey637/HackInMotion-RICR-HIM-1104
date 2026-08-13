'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Voice output via the Web Speech API.
 *
 * Accessibility matters here beyond convenience: many farmers have limited
 * literacy or are reading a phone in bright sunlight with dirty hands. Being
 * able to press one button and *hear* today's guidance is a genuine
 * improvement, not a gimmick.
 *
 * Language handling: we prefer a Hindi voice when the user's profile is set to
 * Hindi and the browser actually ships one. Voice availability varies wildly
 * by platform, so everything degrades — no voices, no support, or a failed
 * utterance all leave the app fully usable and simply hide the button.
 *
 * We use SpeechSynthesis (output) only. Speech *recognition* is Chrome-only,
 * requires network round-trips, and handles Indian-accented regional languages
 * poorly — shipping it would promise more than it delivers.
 */

export interface VoiceState {
  /** Whether this browser can speak at all. */
  supported: boolean;
  speaking: boolean;
  /** Speak the given text, cancelling anything already in progress. */
  speak: (text: string, lang?: string) => void;
  stop: () => void;
  /** True when a voice for the requested language is actually installed. */
  hasLanguage: (lang: string) => boolean;
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
    (lang: string) => voices.some((v) => v.lang.toLowerCase().startsWith(lang.toLowerCase().slice(0, 2))),
    [voices],
  );

  const speak = useCallback(
    (text: string, lang = 'en-IN') => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

      // Cancel first — queuing utterances leads to a backlog the user cannot stop.
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      // Slightly slower than default: guidance is information-dense, and this
      // is often heard once, outdoors, over background noise.
      utterance.rate = 0.92;
      utterance.pitch = 1;

      const preferred =
        voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) ??
        voices.find((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
      if (preferred) utterance.voice = preferred;

      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);

      window.speechSynthesis.speak(utterance);
    },
    [voices],
  );

  const stop = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  return { supported, speaking, speak, stop, hasLanguage };
}

/**
 * Turn a dashboard payload into something worth listening to.
 *
 * Reading the screen verbatim would be unbearable — this composes a short
 * spoken briefing that leads with what needs acting on.
 */
export function buildSpokenBriefing(input: {
  farmName: string;
  actions: Array<{ title: string; action: string; priority: string }>;
  irrigation?: { headline?: string };
  weather?: { today?: { tempMaxC: number; rainMm: number } };
}): string {
  const parts: string[] = [];

  parts.push(`Update for ${input.farmName}.`);

  if (input.weather?.today) {
    const { tempMaxC, rainMm } = input.weather.today;
    parts.push(
      rainMm > 0
        ? `Today, up to ${Math.round(tempMaxC)} degrees, with about ${Math.round(rainMm)} millimetres of rain expected.`
        : `Today, up to ${Math.round(tempMaxC)} degrees, no rain expected.`,
    );
  }

  if (input.actions.length === 0) {
    parts.push('Nothing needs your attention today. Everything looks fine.');
    return parts.join(' ');
  }

  const urgent = input.actions.filter((a) => a.priority === 'CRITICAL' || a.priority === 'HIGH');

  parts.push(
    urgent.length > 0
      ? `You have ${urgent.length} urgent ${urgent.length === 1 ? 'item' : 'items'}.`
      : `You have ${input.actions.length} ${input.actions.length === 1 ? 'thing' : 'things'} to look at.`,
  );

  // Three is about as much as anyone retains from audio.
  for (const action of input.actions.slice(0, 3)) {
    parts.push(`${action.title}. ${action.action}`);
  }

  if (input.actions.length > 3) {
    parts.push(`And ${input.actions.length - 3} more on your screen.`);
  }

  return parts.join(' ');
}
