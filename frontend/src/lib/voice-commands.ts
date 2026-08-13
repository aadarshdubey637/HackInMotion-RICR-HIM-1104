import type { Language } from './translations';

/**
 * Spoken command vocabulary.
 *
 * The design point that makes language detection work: a transcript is matched
 * against *every* language's phrases at once, not just the active one. If the
 * farmer says "ਮੰਡੀ ਭਾਅ", only the Punjabi list contains it — so matching it
 * both identifies the intent (open prices) and proves the farmer is speaking
 * Punjabi. The app can then switch language and answer in it, without the
 * browser offering any language detection of its own.
 *
 * Romanised forms are listed alongside the native script because that is what
 * an `en-IN` recogniser returns when it hears an Indian language, and because
 * plenty of farmers code-switch mid-sentence.
 *
 * Phrases are matched as substrings of the normalised transcript, so they must
 * be distinctive: "do" or "kar" would fire on half of everything said.
 */

export type VoiceIntent =
  | { kind: 'navigate'; href: string; pageKey: string }
  | { kind: 'language'; language: Language }
  | { kind: 'read-aloud' }
  | { kind: 'log-issue' }
  | { kind: 'refresh' };

interface CommandSpec {
  intent: VoiceIntent;
  /**
   * How specific this command's vocabulary is, 1-3. Longest-match alone gets
   * this wrong: "मेरी फसल में बीमारी है" ("my crop has a disease") contains the
   * generic possessive "मेरी फसल" (crop list) *and* the specific "बीमारी"
   * (disease). The longer phrase is the less informative one, so specificity
   * has to outrank length — the farmer asking about a disease wants the health
   * page, not a list of what they planted.
   */
  specificity: 1 | 2 | 3;
  /** Phrases per language. The matching language is taken as the spoken one. */
  phrases: Partial<Record<Language, string[]>>;
}

const COMMANDS: CommandSpec[] = [
  // ── Navigation ──
  {
    intent: { kind: 'navigate', href: '/dashboard', pageKey: 'nav.today' },
    specificity: 1,
    phrases: {
      en: ['dashboard', 'today', 'home', 'what to do'],
      hi: ['आज', 'डैशबोर्ड', 'क्या करना', 'मुख्य', 'aaj', 'dashboard', 'kya karna'],
      pa: ['ਅੱਜ', 'ਡੈਸ਼ਬੋਰਡ', 'ਕੀ ਕਰਨਾ', 'ajj', 'ki karna'],
      te: ['ఈరోజు', 'డాష్‌బోర్డ్', 'ee roju'],
      mr: ['आज', 'डॅशबोर्ड', 'काय करायचे'],
      bn: ['আজ', 'ড্যাশবোর্ড', 'কি করতে'],
    },
  },
  {
    intent: { kind: 'navigate', href: '/weather', pageKey: 'nav.water' },
    specificity: 2,
    phrases: {
      en: ['weather', 'water', 'irrigation', 'rain', 'should i irrigate'],
      hi: ['मौसम', 'पानी', 'सिंचाई', 'बारिश', 'mausam', 'paani', 'pani', 'sinchai', 'barish'],
      pa: ['ਮੌਸਮ', 'ਪਾਣੀ', 'ਸਿੰਚਾਈ', 'ਮੀਂਹ', 'mausam', 'paani', 'sinchai', 'meenh'],
      te: ['వాతావరణం', 'నీరు', 'నీటి', 'వర్షం'],
      mr: ['हवामान', 'पाणी', 'सिंचन', 'पाऊस'],
      bn: ['আবহাওয়া', 'জল', 'সেচ', 'বৃষ্টি'],
    },
  },
  {
    intent: { kind: 'navigate', href: '/health', pageKey: 'nav.health' },
    specificity: 3,
    phrases: {
      en: ['health', 'disease', 'pest', 'insect', 'my crop is sick'],
      hi: ['बीमारी', 'रोग', 'कीट', 'कीड़े', 'सेहत', 'बीमार', 'bimari', 'rog', 'keet', 'keede'],
      pa: ['ਬਿਮਾਰੀ', 'ਰੋਗ', 'ਕੀੜੇ', 'ਸਿਹਤ', 'bimari', 'keede'],
      te: ['వ్యాధి', 'తెగులు', 'పురుగు', 'ఆరోగ్యం'],
      mr: ['रोग', 'कीड', 'आरोग्य', 'किडे'],
      bn: ['রোগ', 'পোকা', 'স্বাস্থ্য'],
    },
  },
  {
    intent: { kind: 'navigate', href: '/market', pageKey: 'nav.prices' },
    specificity: 2,
    phrases: {
      en: ['price', 'prices', 'market', 'mandi', 'rate', 'sell'],
      hi: ['भाव', 'दाम', 'मंडी', 'कीमत', 'बाज़ार', 'बाजार', 'bhav', 'daam', 'mandi', 'keemat'],
      pa: ['ਭਾਅ', 'ਮੰਡੀ', 'ਕੀਮਤ', 'ਰੇਟ', 'bhaa', 'mandi', 'keemat'],
      te: ['ధర', 'మార్కెట్', 'రేటు'],
      mr: ['भाव', 'बाजार', 'दर'],
      bn: ['দাম', 'বাজার', 'দর'],
    },
  },
  {
    intent: { kind: 'navigate', href: '/crops', pageKey: 'nav.farm' },
    specificity: 1,
    phrases: {
      en: ['my farm', 'my crops', 'crop list', 'profile'],
      hi: ['मेरा खेत', 'मेरी फसल', 'फसलें', 'खेत', 'mera khet', 'meri fasal', 'faslein'],
      pa: ['ਮੇਰਾ ਖੇਤ', 'ਮੇਰੀ ਫ਼ਸਲ', 'ਫ਼ਸਲਾਂ', 'mera khet', 'meri fasal'],
      te: ['నా పొలం', 'నా పంట', 'పంటలు'],
      mr: ['माझे शेत', 'माझे पीक', 'पिके'],
      bn: ['আমার খেত', 'আমার ফসল', 'ফসল'],
    },
  },
  {
    intent: { kind: 'navigate', href: '/recommendations', pageKey: 'nav.recommendations' },
    specificity: 2,
    phrases: {
      en: ['what to plant', 'what should i grow', 'recommend', 'suggestion'],
      hi: ['क्या बोऊं', 'क्या लगाऊं', 'कौन सी फसल', 'सुझाव', 'kya boun', 'kaun si fasal'],
      pa: ['ਕੀ ਬੀਜਾਂ', 'ਕਿਹੜੀ ਫ਼ਸਲ', 'ਸੁਝਾਅ'],
      te: ['ఏమి నాటాలి', 'ఏ పంట', 'సూచన'],
      mr: ['काय पेरावे', 'कोणते पीक', 'सूचना'],
      bn: ['কী লাগাব', 'কোন ফসল', 'পরামর্শ'],
    },
  },
  {
    intent: { kind: 'navigate', href: '/planning', pageKey: 'nav.planning' },
    specificity: 2,
    phrases: {
      en: ['fertiliser', 'fertilizer', 'urea', 'yield', 'plan'],
      hi: ['खाद', 'उर्वरक', 'यूरिया', 'पैदावार', 'उपज', 'khaad', 'urea', 'paidawar'],
      pa: ['ਖਾਦ', 'ਯੂਰੀਆ', 'ਝਾੜ', 'khaad', 'jhaar'],
      te: ['ఎరువు', 'యూరియా', 'దిగుబడి'],
      mr: ['खत', 'युरिया', 'उत्पादन'],
      bn: ['সার', 'ইউরিয়া', 'ফলন'],
    },
  },

  // ── Actions ──
  {
    intent: { kind: 'read-aloud' },
    // Deliberately the lowest: "tell me", "बताओ", "ਦੱਸੋ" and "सांगा" are polite
    // carrier verbs, not requests to narrate. "ਮੰਡੀ ਭਾਅ ਦੱਸੋ" is someone asking
    // for prices, so any concrete topic in the sentence has to win. Said on
    // their own, with no topic to beat them, they still mean read-aloud.
    specificity: 1,
    phrases: {
      en: ['read aloud', 'read it', 'speak', 'tell me'],
      hi: ['पढ़कर सुनाओ', 'सुनाओ', 'बोलो', 'बताओ', 'sunao', 'bolo', 'batao'],
      pa: ['ਸੁਣਾਓ', 'ਬੋਲੋ', 'ਦੱਸੋ', 'sunao', 'bolo', 'dasso'],
      te: ['చదివి వినిపించు', 'చెప్పు'],
      mr: ['वाचून दाखवा', 'सांगा'],
      bn: ['পড়ে শোনাও', 'বলো'],
    },
  },
  {
    intent: { kind: 'log-issue' },
    specificity: 3,
    phrases: {
      en: ['log an issue', 'report a problem', 'check my plant'],
      hi: ['समस्या दर्ज', 'शिकायत', 'पौधा जांच', 'samasya darj'],
      pa: ['ਸਮੱਸਿਆ ਦਰਜ', 'ਸ਼ਿਕਾਇਤ'],
      te: ['సమస్య నమోదు'],
      mr: ['समस्या नोंदवा'],
      bn: ['সমস্যা জানাও'],
    },
  },
  {
    intent: { kind: 'refresh' },
    specificity: 3,
    phrases: {
      en: ['refresh', 'update', 'reload'],
      hi: ['ताज़ा', 'रिफ्रेश', 'अपडेट', 'taaza', 'refresh'],
      pa: ['ਤਾਜ਼ਾ', 'ਰਿਫ੍ਰੈਸ਼'],
      te: ['రిఫ్రెష్'],
      mr: ['रिफ्रेश'],
      bn: ['রিফ্রেশ'],
    },
  },
];

/**
 * "Speak to me in Punjabi" said in any language.
 *
 * Listed separately because the *target* language is the payload, and it is
 * independent of the language the request was made in — a farmer may well ask
 * for Punjabi while speaking Hindi.
 */
const LANGUAGE_REQUESTS: Array<{ language: Language; phrases: string[] }> = [
  { language: 'en', phrases: ['english', 'अंग्रेज़ी', 'अंग्रेजी', 'ਅੰਗਰੇਜ਼ੀ', 'ইংরেজি', 'ఇంగ్లీష్', 'angrezi'] },
  { language: 'hi', phrases: ['hindi', 'हिंदी', 'हिन्दी', 'ਹਿੰਦੀ', 'হিন্দি', 'హిందీ'] },
  { language: 'pa', phrases: ['punjabi', 'panjabi', 'पंजाबी', 'ਪੰਜਾਬੀ', 'পাঞ্জাবি', 'పంజాబీ'] },
  { language: 'te', phrases: ['telugu', 'तेलुगु', 'ਤੇਲਗੂ', 'তেলুগু', 'తెలుగు'] },
  { language: 'mr', phrases: ['marathi', 'मराठी', 'ਮਰਾਠੀ', 'মারাঠি', 'మరాఠీ'] },
  { language: 'bn', phrases: ['bengali', 'bangla', 'बंगाली', 'ਬੰਗਾਲੀ', 'বাংলা', 'బెంగాలీ'] },
];

/** Lowercase, strip punctuation, collapse spaces — without killing non-Latin text. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface CommandMatch {
  intent: VoiceIntent;
  /** The language whose vocabulary matched — i.e. what the farmer spoke. */
  language: Language;
  /** The phrase that matched, for the "you said" trail. */
  phrase: string;
}

/**
 * Interpret a transcript.
 *
 * Every language's vocabulary is tried, and the longest matching phrase wins —
 * so "मंडी भाव" beats a stray one-word match elsewhere, and a specific command
 * beats a generic one.
 */
export function matchCommand(transcript: string): CommandMatch | null {
  const text = normalise(transcript);
  if (!text) return null;

  let best: CommandMatch | null = null;
  let bestLength = 0;

  // Language requests are checked first and win ties: "show me prices in
  // Punjabi" should switch language rather than just navigate.
  for (const request of LANGUAGE_REQUESTS) {
    for (const phrase of request.phrases) {
      const needle = normalise(phrase);
      if (needle && text.includes(needle) && needle.length > bestLength) {
        best = {
          intent: { kind: 'language', language: request.language },
          language: request.language,
          phrase,
        };
        bestLength = needle.length;
      }
    }
  }

  if (best) return best;

  let bestSpecificity = 0;

  for (const command of COMMANDS) {
    for (const [language, phrases] of Object.entries(command.phrases)) {
      for (const phrase of phrases ?? []) {
        const needle = normalise(phrase);
        if (!needle || !text.includes(needle)) continue;

        // Specificity first, length only as the tie-break. See CommandSpec.
        if (command.specificity < bestSpecificity) continue;
        if (command.specificity === bestSpecificity && needle.length <= bestLength) continue;

        best = { intent: command.intent, language: language as Language, phrase };
        bestLength = needle.length;
        bestSpecificity = command.specificity;
      }
    }
  }

  return best;
}

/** A few examples to show the farmer, in their own language. */
export function commandExamples(language: Language): string[] {
  const pick = (href: string) =>
    COMMANDS.find((c) => c.intent.kind === 'navigate' && c.intent.href === href)?.phrases[
      language
    ]?.[0];

  return [pick('/weather'), pick('/market'), pick('/health')].filter(
    (phrase): phrase is string => Boolean(phrase),
  );
}
