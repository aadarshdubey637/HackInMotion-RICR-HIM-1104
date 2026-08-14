/**
 * Regional symptom vocabulary.
 *
 * The diagnostic engine matches the farmer's description against an English
 * symptom vocabulary (see `keywords` on each profile in domain/crops.ts). That
 * works fine when the farmer types English, and not at all when they speak
 * Hindi or Punjabi into the microphone — "पत्तों पर पीले धब्बे" shares no
 * substring with "yellow patches", so the description scores zero and the
 * engine reports "no specific problem identified".
 *
 * Rather than translating 193 keywords across six languages inside every crop
 * profile, this module maps regional symptom terms *onto* the canonical
 * English keywords the engine already knows. The description is expanded
 * before scoring, so the rules, weights and explanations stay in one place.
 *
 * Coverage is deliberately weighted toward Hindi and Punjabi (the two the
 * farmer-facing voice input targets first) plus romanised spellings, which is
 * what browser speech recognition returns when it is running an English
 * locale and hears an Indian language. Marathi, Bengali and Telugu carry the
 * highest-frequency terms.
 *
 * Adding a term is safe: the worst case is a symptom that was already being
 * missed now matches.
 */

/**
 * Each entry maps one or more canonical English keywords to the regional
 * terms that mean the same thing to a farmer.
 *
 * `canonical` values MUST appear in some profile's `keywords` array, otherwise
 * the expansion is inert. Kept lowercase to match the engine's normalisation.
 */
interface SymptomEntry {
  canonical: string[];
  /** Devanagari / Gurmukhi / Bengali / Telugu script forms. */
  script: string[];
  /** Romanised forms, matched on word boundaries to avoid false positives. */
  roman: string[];
}

const SYMPTOMS: SymptomEntry[] = [
  // ── Colour changes ──
  {
    canonical: ['yellowing', 'yellow patches'],
    script: ['पीला', 'पीली', 'पीले', 'पीलापन', 'पिवळ', 'ਪੀਲਾ', 'ਪੀਲੀ', 'ਪੀਲੇ', 'হলুদ', 'పసుపు'],
    roman: ['peela', 'pila', 'peeli', 'pili', 'peele', 'pilapan', 'peelapan', 'halad', 'pivla'],
  },
  {
    canonical: ['yellowing between veins'],
    script: ['नसों के बीच', 'ਨਾੜੀਆਂ ਵਿਚਕਾਰ'],
    roman: ['naso ke beech', 'nason ke bich'],
  },
  {
    canonical: ['yellow stripe', 'stripes on leaf'],
    script: ['पीली धारी', 'धारियाँ', 'ਧਾਰੀਆਂ'],
    roman: ['peeli dhari', 'dhariyan'],
  },
  {
    canonical: ['brown spot', 'reddish brown'],
    script: ['भूरे धब्बे', 'भूरा धब्बा', 'भूरे', 'ਭੂਰੇ ਧੱਬੇ', 'ਭੂਰਾ'],
    roman: ['bhure dhabbe', 'bhura dhabba', 'bhure', 'bhura'],
  },
  {
    canonical: ['dark spot', 'dark spots on leaf'],
    script: ['काले धब्बे', 'काला धब्बा', 'ਕਾਲੇ ਧੱਬੇ', 'কালো দাগ'],
    roman: ['kale dhabbe', 'kala dhabba', 'kale dhabe'],
  },
  {
    canonical: ['leaf spot', 'brown spot'],
    script: ['धब्बा', 'धब्बे', 'चित्ती', 'ठिपके', 'ਧੱਬਾ', 'ਧੱਬੇ', 'দাগ', 'మచ్చ'],
    roman: ['dhabba', 'dhabbe', 'dhabe', 'chitti', 'thipke', 'daag'],
  },
  {
    canonical: ['purple', 'purple lesion'],
    script: ['बैंगनी', 'ਜਾਮਨੀ'],
    roman: ['baingani', 'jamuni'],
  },
  {
    canonical: ['mosaic', 'mottled'],
    script: ['चितकबरा', 'चितकबरे', 'मोज़ेक', 'ਚਿਤਕਬਰਾ'],
    roman: ['chitkabra', 'chitkabre', 'mosaic'],
  },

  // ── Wilting, drying, death ──
  {
    canonical: ['wilt', 'wilting seedling'],
    script: ['मुरझा', 'मुरझान', 'कुम्हला', 'कोमेज', 'ਮੁਰਝਾ', 'ਕੁਮਲਾ', 'নেতিয়ে'],
    roman: ['murjha', 'murjhana', 'kumhla', 'komej'],
  },
  {
    canonical: ['drooping', 'collapsing leaves'],
    script: ['झुक', 'लटक', 'ਝੁਕ', 'ਲਟਕ'],
    roman: ['jhuk', 'jhukna', 'latak', 'latakna'],
  },
  {
    canonical: ['drying leaves', 'drying from tip', 'drying tips'],
    script: ['सूख', 'सुख', 'ਸੁੱਕ', 'ਸੁਕ', 'শুকিয়ে', 'ఎండి'],
    roman: ['sookh', 'sukh', 'sukhna', 'sookhna', 'sukk'],
  },
  {
    canonical: ['sudden death', 'dying plants'],
    script: ['मर रह', 'मर गय', 'सूखकर मर', 'ਮਰ ਰਹ', 'ਮਰ ਗਏ'],
    roman: ['mar rahe', 'mar gaye', 'marr'],
  },
  {
    canonical: ['stunted', 'small leaves'],
    script: ['बौना', 'छोटा रह', 'बढ़वार रुक', 'बढ़ नहीं', 'ਬੌਣਾ', 'ਵਾਧਾ ਰੁਕ'],
    roman: ['bauna', 'chota reh', 'badhwar ruk', 'badh nahi'],
  },
  {
    canonical: ['defoliation', 'falling leaves'],
    script: ['पत्ते गिर', 'पत्तियाँ गिर', 'ਪੱਤੇ ਡਿੱਗ', 'ਪੱਤੇ ਝੜ'],
    roman: ['patte gir', 'pattiyan gir', 'patte jhad'],
  },

  // ── Leaf deformation ──
  {
    canonical: ['curl', 'curling', 'curled leaf', 'curling leaves'],
    script: ['मुड़', 'मुड़ी', 'सिकुड़', 'ਮੁੜ', 'ਸੁੰਗੜ', 'কুঁকড়ে'],
    roman: ['mud rahi', 'mudna', 'mudi', 'sikud', 'sikudan', 'murna'],
  },
  {
    canonical: ['upward curling'],
    script: ['ऊपर की ओर मुड़', 'ਉੱਪਰ ਵੱਲ ਮੁੜ'],
    roman: ['upar ki or mud', 'upar mud'],
  },
  {
    canonical: ['crinkled', 'distorted leaves', 'deformed flower'],
    script: ['सिकुड़न', 'टेढ़ा', 'विकृत', 'ਟੇਢਾ', 'ਵਿਗੜ'],
    roman: ['sikudan', 'tedha', 'vikrat', 'vigad'],
  },
  {
    canonical: ['rolled leaf', 'folded leaf'],
    script: ['लिपटी पत्ती', 'मुड़ी हुई पत्ती', 'ਲਪੇਟ'],
    roman: ['lipti patti', 'lapet'],
  },

  // ── Fungal growth ──
  {
    canonical: ['powdery', 'white powder', 'powder on leaf underside'],
    script: [
      'सफेद पाउडर',
      'सफ़ेद पाउडर',
      'सफेद चूर्ण',
      'भुक्खी',
      'पाउडर जैसा',
      'ਸਫੈਦ ਪਾਊਡਰ',
      'ਚਿੱਟਾ ਪਾਊਡਰ',
      'ਭੁੱਖੀ',
    ],
    roman: [
      'safed powder',
      'safed churn',
      'safaid powder',
      'bhukkhi',
      'powder jaisa',
      'chitta powder',
    ],
  },
  {
    canonical: ['rust', 'orange powder', 'brown pustule'],
    script: ['रतुआ', 'गेरुआ', 'जंग', 'ਕੁੰਗੀ', 'ਰਤੂਆ'],
    roman: ['ratua', 'gerua', 'kungi', 'jang'],
  },
  {
    canonical: ['blight', 'blast'],
    script: ['झुलसा', 'झुलस', 'अंगमारी', 'ਝੁਲਸ', 'ਝੁਲਸਾ'],
    roman: ['jhulsa', 'jhulas', 'angmari', 'jhulsa rog'],
  },
  {
    canonical: ['downy', 'fuzzy growth', 'white fuzz'],
    script: ['फफूंद', 'फफूँद', 'रोएँदार', 'उल्ली', 'ਉੱਲੀ', 'ਫਫੂੰਦ', 'ছত্রাক'],
    roman: ['fafund', 'fafoond', 'phaphund', 'ulli', 'roendar', 'fungus'],
  },
  {
    canonical: ['sooty mould', 'black stem'],
    script: ['काली फफूंद', 'कालिख', 'ਕਾਲੀ ਉੱਲੀ'],
    roman: ['kali fafund', 'kalikh', 'kali ulli'],
  },
  {
    canonical: ['white coating', 'white patches', 'greyish white'],
    script: ['सफेद परत', 'सफेद धब्बे', 'ਚਿੱਟੀ ਪਰਤ'],
    roman: ['safed parat', 'safed dhabbe', 'chitti parat'],
  },

  // ── Rot and wetness ──
  {
    canonical: ['water soaked'],
    script: ['पानी जैसे धब्बे', 'पानी भरे', 'जलसिक्त', 'ਪਾਣੀ ਵਰਗੇ'],
    roman: ['pani jaise dhabbe', 'pani bhare', 'pani wale dhabbe'],
  },
  {
    canonical: ['red rot', 'rot at base of fruit', 'neck rot'],
    script: ['सड़न', 'सड़ रह', 'गल रह', 'गलन', 'ਸੜ', 'ਗਲ', 'পচে'],
    roman: ['sadan', 'sad rahi', 'sad gaya', 'gal rahi', 'galan', 'sadna'],
  },
  {
    canonical: ['rotting fruit', 'rotting tuber'],
    script: ['फल सड़', 'कंद सड़', 'ਫਲ ਸੜ'],
    roman: ['phal sad', 'fal sad', 'kand sad'],
  },
  {
    canonical: ['foul smell', 'sour smell'],
    script: ['बदबू', 'दुर्गंध', 'ਬਦਬੂ', 'ਮੁਸ਼ਕ'],
    roman: ['badbu', 'durgandh', 'mushk', 'badboo'],
  },
  {
    canonical: ['ooze', 'sticky', 'sticky leaves', 'honeydew'],
    script: ['चिपचिपा', 'चिपचिपी', 'रिसाव', 'ਚਿਪਚਿਪਾ'],
    roman: ['chipchipa', 'chipchipi', 'risav'],
  },

  // ── Insect damage ──
  {
    canonical: ['worm', 'caterpillar', 'larvae in tuber'],
    script: ['कीड़ा', 'कीड़े', 'इल्ली', 'सुंडी', 'ਸੁੰਡੀ', 'ਕੀੜਾ', 'ਕੀੜੇ', 'পোকা', 'పురుగు'],
    roman: ['keeda', 'keede', 'kida', 'kide', 'illi', 'sundi', 'sundhi'],
  },
  {
    canonical: ['tiny insects', 'small green insects'],
    script: ['छोटे कीट', 'बारीक कीड़े', 'ਛੋਟੇ ਕੀੜੇ'],
    roman: ['chote keet', 'barik keede', 'chote kide'],
  },
  {
    canonical: ['aphid', 'small green insects'],
    script: ['माहू', 'चेपा', 'तेला', 'ਚੇਪਾ', 'ਤੇਲਾ'],
    roman: ['mahu', 'mahoo', 'chepa', 'tela'],
  },
  {
    canonical: ['whitefly', 'white fly', 'tiny white insects', 'flying white'],
    script: ['सफेद मक्खी', 'सफ़ेद मक्खी', 'ਚਿੱਟੀ ਮੱਖੀ', 'ਸਫੈਦ ਮੱਖੀ'],
    roman: ['safed makkhi', 'safaid makhi', 'chitti makkhi', 'white makkhi'],
  },
  {
    canonical: ['thrips', 'silver streaks'],
    script: ['थ्रिप्स', 'रस चूसक', 'ਥਰਿਪਸ'],
    roman: ['thrips', 'ras chusak'],
  },
  {
    canonical: ['termite', 'white ant'],
    script: ['दीमक', 'ਸਿਉਂਕ', 'ਦੀਮਕ'],
    roman: ['deemak', 'dimak', 'siunk', 'siuk'],
  },
  {
    canonical: ['borer', 'boring', 'holes in stem'],
    script: ['तना छेदक', 'छेदक', 'गड़ूँआ', 'ਗੜੂੰਆਂ', 'ਛੇਦਕ'],
    roman: ['tana chedak', 'chedak', 'gadua', 'borer'],
  },
  {
    canonical: ['dead heart', 'deadheart'],
    script: ['गोभ सूख', 'सूखा गोभ', 'ਗੋਭ ਸੁੱਕ'],
    roman: ['gobh sukh', 'sukha gobh', 'dead heart'],
  },
  {
    canonical: ['hole in fruit', 'hole in pod', 'holes in boll'],
    script: ['छेद', 'सुराख', 'ਛੇਕ', 'ਮੋਰੀ', 'ছিদ্র'],
    roman: ['ched', 'chhed', 'surakh', 'chek'],
  },
  {
    canonical: ['scraped leaf', 'ragged leaf'],
    script: ['पत्ती खुरच', 'कटी पत्ती', 'ਪੱਤਾ ਖੁਰਚ'],
    roman: ['patti khurach', 'kati patti'],
  },
  {
    canonical: ['frass', 'sawdust in whorl'],
    script: ['बुरादा', 'लीद', 'ਬੁਰਾਦਾ'],
    roman: ['burada', 'burrada', 'leed'],
  },
  {
    canonical: ['pink worm'],
    script: ['गुलाबी सुंडी', 'ਗੁਲਾਬੀ ਸੁੰਡੀ'],
    roman: ['gulabi sundi', 'gulabi illi'],
  },
  {
    canonical: ['armyworm'],
    script: ['फॉल आर्मीवर्म', 'सैनिक कीट', 'ਫਾਲ ਆਰਮੀਵਰਮ'],
    roman: ['army worm', 'armyworm', 'sainik keet', 'fall army'],
  },
];

/**
 * Plant parts, used only to decide whether a symptom is on the leaf. Several
 * canonical keywords are leaf-specific ("dark spots on leaf") and the regional
 * symptom term alone cannot distinguish them.
 */
const LEAF_TERMS = [
  'पत्ती',
  'पत्ते',
  'पत्तियाँ',
  'पत्तों',
  'ਪੱਤਾ',
  'ਪੱਤੇ',
  'ਪੱਤਿਆਂ',
  'পাতা',
  'ఆకు',
  'पान',
];
const LEAF_ROMAN = ['patti', 'patta', 'patte', 'pattiyan', 'patto', 'paan'];

/** Scripts we can recognise, used to report what the farmer wrote in. */
const SCRIPT_RANGES: Array<{ language: string; pattern: RegExp }> = [
  { language: 'hi', pattern: /[ऀ-ॿ]/ },
  { language: 'pa', pattern: /[਀-੿]/ },
  { language: 'bn', pattern: /[ঀ-৿]/ },
  { language: 'te', pattern: /[ఀ-౿]/ },
];

export interface ExpansionResult {
  /** Original description with matched canonical English keywords appended. */
  expanded: string;
  /** Canonical keywords the regional terms resolved to. */
  matchedCanonical: string[];
  /** The regional words that triggered them, for the evidence trail. */
  matchedTerms: string[];
  /**
   * Script detected in the description, if it was not Latin. Devanagari is
   * reported as 'hi' — Hindi and Marathi share it, and the distinction does
   * not change the diagnosis.
   */
  detectedScript: string | null;
}

/** Lowercase and collapse whitespace without destroying non-Latin characters. */
function soften(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Word-boundary match, so "sad" does not fire inside "sadly". */
function containsWord(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`).test(haystack);
}

/**
 * Rewrite a description written in an Indian language into one the English
 * rule engine can score, by appending the canonical keywords it implies.
 *
 * The original text is preserved at the front: an English or mixed-script
 * description still matches directly, and this only ever adds signal.
 */
export function expandRegionalSymptoms(description: string): ExpansionResult {
  const text = soften(description);

  if (!text) {
    return { expanded: description, matchedCanonical: [], matchedTerms: [], detectedScript: null };
  }

  const detectedScript = SCRIPT_RANGES.find((s) => s.pattern.test(text))?.language ?? null;

  const mentionsLeaf =
    LEAF_TERMS.some((term) => text.includes(term.toLowerCase())) ||
    LEAF_ROMAN.some((term) => containsWord(text, term));

  const matchedCanonical = new Set<string>();
  const matchedTerms: string[] = [];

  for (const entry of SYMPTOMS) {
    const hit =
      entry.script.find((term) => text.includes(term.toLowerCase())) ??
      entry.roman.find((term) => containsWord(text, term));

    if (!hit) continue;

    matchedTerms.push(hit);
    for (const canonical of entry.canonical) {
      // Only claim a leaf-specific symptom when a leaf was actually mentioned.
      if (canonical.includes('leaf') && !mentionsLeaf && !canonical.startsWith('leaf')) continue;
      matchedCanonical.add(canonical);
    }
  }

  if (matchedCanonical.size === 0) {
    return { expanded: description, matchedCanonical: [], matchedTerms: [], detectedScript };
  }

  return {
    expanded: `${description} ${[...matchedCanonical].join(' ')}`,
    matchedCanonical: [...matchedCanonical],
    matchedTerms,
    detectedScript,
  };
}
