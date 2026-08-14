'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { translations, LANGUAGES, type Language, type LanguageMeta } from './translations';

const STORAGE_KEY = 'sf_language';

interface LanguageContextType {
  language: Language;
  /** Label and speech locale for the active language. */
  languageMeta: LanguageMeta;
  setLanguage: (lang: Language) => void;
  /**
   * Adopt the language saved on the farmer's account, but only when this
   * device has no choice of its own. A picker tap is a deliberate act on the
   * phone in hand and must not be overwritten by a stale profile value.
   */
  syncFromProfile: (lang: string | null | undefined) => void;
  t: (path: string, variables?: Record<string, string | number>) => string;
  tCrop: (name: string) => string;
  tStage: (stage: string) => string;
  tNarrative: (text: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

/**
 * One node in the nested translation tree: a leaf string, or a subtree of them.
 *
 * Naming this shape is what lets `walk` narrow with `typeof` at each step. The
 * alternative — walking an `any` — silently permits indexing into a string,
 * which is exactly the mistake the walk has to avoid.
 */
type TranslationNode = string | { [key: string]: TranslationNode };

/**
 * Follow a key path through the translation tree.
 *
 * Returns the node found, or `null` if any segment is missing or the path runs
 * into a leaf before it is exhausted. Callers decide what a non-string result
 * means for them; nothing here throws on a bad key.
 */
function walk(root: unknown, keys: string[]): TranslationNode | null {
  let node = root as TranslationNode | undefined;

  for (const key of keys) {
    if (!node || typeof node !== 'object' || !(key in node)) return null;
    node = node[key];
  }

  return node ?? null;
}

/** Narrow an arbitrary string to a language the app actually ships. */
function asLanguage(value: string | null | undefined): Language | null {
  if (!value) return null;
  const base = value.toLowerCase().split(/[-_]/)[0];
  return base in translations ? (base as Language) : null;
}

/**
 * The language the device itself is set to, if we ship it.
 *
 * This is the bottom of the precedence chain — a starting guess for a farmer
 * who has never touched the picker, not a decision. `navigator.languages` is
 * ordered by preference and may list several ("mr-IN", "hi-IN", "en-IN"), so a
 * phone whose primary locale we do not ship still lands on a language the
 * farmer reads rather than defaulting to English.
 */
function detectFromDevice(): Language | null {
  if (typeof navigator === 'undefined') return null;
  const preferences = [...(navigator.languages ?? []), navigator.language];
  for (const preference of preferences) {
    const resolved = asLanguage(preference);
    if (resolved) return resolved;
  }
  return null;
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>('en');

  /**
   * Resolve the opening language: a saved choice on this device wins, then the
   * device locale. Rendering starts in English because the server has no access
   * to either, so this runs on mount.
   *
   * Nothing is written to localStorage here — that key means "the farmer chose
   * this", and a device guess must stay overridable by the language saved on
   * their account (see `syncFromProfile`).
   */
  useEffect(() => {
    const initial = asLanguage(localStorage.getItem(STORAGE_KEY)) ?? detectFromDevice();
    if (initial) {
      setLanguageState(initial);
      document.documentElement.lang = initial;
    }
  }, []);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem(STORAGE_KEY, lang);
    // Update HTML lang attribute dynamically
    document.documentElement.lang = lang;
  }, []);

  const syncFromProfile = useCallback((lang: string | null | undefined) => {
    if (localStorage.getItem(STORAGE_KEY)) return;
    const resolved = asLanguage(lang);
    if (!resolved) return;
    setLanguageState(resolved);
    document.documentElement.lang = resolved;
  }, []);

  const t = (path: string, variables?: Record<string, string | number>): string => {
    const keys = path.split('.');

    // Selected language first, English second. A path that resolves to a
    // subtree rather than a leaf is treated as missing, so a wrong key shows
    // the key itself instead of rendering "[object Object]" to the farmer.
    const result = walk(translations[language], keys) ?? walk(translations.en, keys);

    if (typeof result !== 'string') {
      return path;
    }

    if (variables) {
      let templated = result;
      for (const [key, value] of Object.entries(variables)) {
        templated = templated.replace(new RegExp(`{${key}}`, 'g'), String(value));
      }
      return templated;
    }

    return result;
  };

  const tCrop = (name: string): string => {
    if (!name) return '';
    const key = name.toLowerCase().trim();
    const localized = t(`cropNames.${key}`);
    return localized !== `cropNames.${key}` ? localized : name;
  };

  const tStage = (stage: string): string => {
    if (!stage) return '';
    const key = stage.toLowerCase().trim();
    const localized = t(`stages.${key}`);
    return localized !== `stages.${key}` ? localized : stage;
  };

  const tNarrative = (text: string): string => {
    if (!text) return '';
    if (language === 'en') return text;

    // 1. Normalize and extract crop names
    const cropRegex = /\b(rice|wheat|maize|cotton|soybean|chickpea|sugarcane|tomato|onion|mustard|groundnut|turmeric)\b/gi;
    let cropValue = '';
    const textWithCropPlaceholder = text.replace(cropRegex, (match) => {
      cropValue = match;
      return '{crop}';
    });

    // 2. Normalize and extract days
    const dayRegex = /\b(on\s+)?(today|tomorrow|in \d+ days|in the next few days|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi;
    let dayValue = '';
    const textWithDayPlaceholder = textWithCropPlaceholder.replace(dayRegex, (match) => {
      dayValue = match;
      return '{day}';
    });

    // 3. Normalize and extract percentages & numbers
    const percentRegex = /\b\d+(\.\d+)?%/g;
    const percents: string[] = [];
    const textWithPercentPlaceholder = textWithDayPlaceholder.replace(percentRegex, (match) => {
      percents.push(match);
      return '{percent}';
    });

    const numberRegex = /\b\d+(\.\d+)?\b/g;
    const numbers: string[] = [];
    const normalizedTemplate = textWithPercentPlaceholder.replace(numberRegex, (match) => {
      numbers.push(match);
      return '{number}';
    });

    // 4. Look up directly in narratives map (avoiding t() path dot-split bug).
    //    The key is a whole sentence and contains dots, so `t` cannot be used:
    //    it would split the sentence on them and walk into nothing.
    const localizedTemplate = walk(translations[language], ['narratives', normalizedTemplate]);
    if (typeof localizedTemplate !== 'string') {
      return text;
    }

    // 5. Re-inject translated variables
    let result = localizedTemplate;

    if (cropValue) {
      result = result.replace('{crop}', tCrop(cropValue));
    }

    if (dayValue) {
      // Translate relative day/date
      let translatedDay = dayValue;
      const lowerDay = dayValue.toLowerCase().replace(/^on\s+/, '').trim();
      if (lowerDay === 'today') translatedDay = t('dayNames.today');
      else if (lowerDay === 'tomorrow') translatedDay = t('dayNames.tomorrow');
      else if (lowerDay === 'in the next few days') translatedDay = t('dayNames.nextFewDays');
      else if (lowerDay.startsWith('in ')) {
        const match = lowerDay.match(/in (\d+) days/);
        if (match) translatedDay = t('dayNames.inDays', { count: match[1] });
      } else {
        translatedDay = t('dayNames.' + lowerDay);
      }
      result = result.replace('{day}', translatedDay);
    }

    // Re-inject percentages in order
    for (const percent of percents) {
      result = result.replace('{percent}', percent);
    }

    // Re-inject numbers in order
    for (const num of numbers) {
      result = result.replace('{number}', num);
    }

    return result;
  };

  return (
    <LanguageContext.Provider
      value={{
        language,
        languageMeta: LANGUAGES[language],
        setLanguage,
        syncFromProfile,
        t,
        tCrop,
        tStage,
        tNarrative,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

export function useTranslation() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useTranslation must be used within a LanguageProvider');
  }
  return context;
}
