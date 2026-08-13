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

/** Narrow an arbitrary string to a language the app actually ships. */
function asLanguage(value: string | null | undefined): Language | null {
  if (!value) return null;
  const base = value.toLowerCase().split(/[-_]/)[0];
  return base in translations ? (base as Language) : null;
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>('en');

  // Load language from localStorage if available
  useEffect(() => {
    const saved = asLanguage(localStorage.getItem(STORAGE_KEY));
    if (saved) {
      setLanguageState(saved);
      document.documentElement.lang = saved;
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
    let result: any = translations[language];

    for (const key of keys) {
      if (result && key in result) {
        result = result[key];
      } else {
        // Fallback to English translation if available
        let englishFallback: any = translations['en'];
        for (const fallbackKey of keys) {
          if (englishFallback && fallbackKey in englishFallback) {
            englishFallback = englishFallback[fallbackKey];
          } else {
            englishFallback = null;
            break;
          }
        }
        return englishFallback || path;
      }
    }

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

    // 4. Look up directly in narratives map (avoiding t() path dot-split bug)
    const dict = (translations[language] as any)?.narratives;
    const localizedTemplate = dict?.[normalizedTemplate];
    if (!localizedTemplate) {
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
