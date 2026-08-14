/** Shared response shapes, mirroring the backend API contract. */

export type Severity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type ActionPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
export type HealthSeverity = 'MILD' | 'MODERATE' | 'SEVERE' | 'CRITICAL';
export type SoilType = 'SANDY' | 'LOAMY' | 'CLAY' | 'SILTY' | 'PEATY' | 'CHALKY' | 'MIXED';

export interface User {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  language: string;
  role: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface Farm {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  address: string | null;
  totalAreaHectares: number;
  soilTypePrimary: SoilType | null;
  status: string;
  crops?: Crop[];
  parcels?: Parcel[];
  _count?: { parcels: number; crops: number; healthLogs: number; alerts: number };
}

export interface Parcel {
  id: string;
  name: string;
  areaHectares: number;
  soilType: SoilType | null;
}

export interface Crop {
  id: string;
  cropName: string;
  status: string;
  growthStage: string | null;
  plantingDate: string | null;
  expectedHarvestDate: string | null;
  parcelId: string | null;
}

export interface ActionItem {
  id: string;
  priority: ActionPriority;
  category: 'IRRIGATION' | 'WEATHER' | 'HEALTH' | 'MARKET' | 'SETUP';
  title: string;
  detail: string;
  action: string;
  link?: string;
  cropName?: string;
}

export interface Dashboard {
  farm: {
    id: string;
    name: string;
    address: string | null;
    latitude: number;
    longitude: number;
    totalAreaHectares: number;
    soilTypePrimary: string | null;
    season: string;
  };
  actions: ActionItem[];
  crops: Array<{
    id: string;
    cropName: string;
    status: string;
    growthStage: string | null;
    plantingDate: string | null;
    expectedHarvestDate: string | null;
    isRecognised: boolean;
    daysToHarvest: number | null;
  }>;
  weather: {
    available: boolean;
    current?: { temperatureC: number; humidityPct: number; description: string };
    today?: { tempMaxC: number; tempMinC: number; rainMm: number; rainProbability: number | null };
    upcoming?: Array<{
      date: string;
      tempMaxC: number;
      tempMinC: number;
      rainMm: number;
      description: string;
    }>;
    warning?: string;
  };
  irrigation: {
    available: boolean;
    shouldIrrigate?: boolean;
    urgency?: string;
    headline?: string;
    reason?: string;
    depthMm?: number | null;
    depletionPercent?: number;
    cropName?: string;
    warning?: string;
  };
  health: {
    activeIssues: number;
    recent: Array<{
      id: string;
      cropName: string;
      severity: HealthSeverity;
      summary: string;
      observedAt: string;
      status: string;
    }>;
  };
  market: {
    available: boolean;
    trends: Array<{
      commodity: string;
      cropName: string;
      currentPrice: number | null;
      unit: string;
      direction: string;
      change7DayPercent: number | null;
      signal: string;
      headline: string;
      isSeeded: boolean;
    }>;
    message?: string;
  };
  alerts: {
    unread: number;
    items: Array<{
      id: string;
      alertType: string;
      severity: Severity;
      message: string;
      title: string | null;
      action: string | null;
      createdAt: string;
      isRead: boolean;
    }>;
  };
  generatedAt: string;
}

export interface DayProjection {
  date: string;
  isPast: boolean;
  etcMm: number;
  effectiveRainMm: number;
  rawRainMm: number;
  rainProbability: number | null;
  depletionMm: number;
  stressRatio: number;
  tempMaxC: number;
  tempMinC: number;
  description: string;
}

export interface IrrigationGuidance {
  shouldIrrigate: boolean;
  urgency: 'NONE' | 'PLAN' | 'SOON' | 'TODAY' | 'OVERDUE';
  headline: string;
  reason: string;
  recommendation: { depthMm: number; totalLitres: number; totalCubicMetres: number } | null;
  nextIrrigationDate: string | null;
  daysUntilIrrigation: number | null;
  confidence: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  waterBalance: {
    totalAvailableWaterMm: number;
    readilyAvailableWaterMm: number;
    currentDepletionMm: number;
    depletionPercent: number;
    rootDepthM: number;
    cropCoefficient: number;
    soilType: SoilType;
    initialisedFrom: string;
  };
  forecast: DayProjection[];
  alerts: Array<{
    type: string;
    severity: Severity;
    title: string;
    message: string;
    action: string;
    date?: string;
  }>;
  assumptions: string[];
  crop: { id: string | null; name: string; label: string; isKnown: boolean };
  stale: boolean;
  warning?: string;
}

export interface Forecast {
  location: { latitude: number; longitude: number; timezone: string; address: string | null };
  current: {
    temperatureC: number;
    apparentTemperatureC: number;
    humidityPct: number;
    precipitationMm: number;
    windSpeedKmh: number;
    description: string;
  };
  daily: Array<{
    date: string;
    description: string;
    tempMaxC: number;
    tempMinC: number;
    precipitationMm: number;
    precipitationProbability: number | null;
    et0Mm: number;
    humidityMeanPct: number;
    windSpeedMaxKmh: number;
  }>;
  stale: boolean;
  warning?: string;
  provider: string;
}

/** Extra material from Plant.id image analysis, shown alongside a candidate. */
export interface CandidateDetails {
  scientificName?: string;
  description?: string;
  cause?: string;
  /** e.g. ["Fungi"] — tells a pathogen apart from a deficiency. */
  classification?: string[];
  treatment?: { chemical: string[]; biological: string[]; prevention: string[] };
  /** Reference photos to compare the affected plant against. */
  similarImages?: string[];
}

export interface DiagnosisCandidate {
  kind: 'disease' | 'pest';
  name: string;
  confidence: number;
  severity: HealthSeverity;
  evidence: string[];
  actions: string[];
  explanation: string;
  /**
   * `image` means only the photo model proposed it — it is not in our curated
   * list for this crop, so the UI labels it as uncorroborated.
   */
  source: 'rules' | 'rules+image' | 'image';
  details?: CandidateDetails;
  signals?: {
    symptomScore: number;
    weatherScore: number;
    matchedKeywords: string[];
    weatherFavourable: boolean;
    imageProbability?: number;
  };
}

export interface Diagnosis {
  candidates: DiagnosisCandidate[];
  severity: HealthSeverity;
  summary: string;
  nextSteps: string[];
  confidence: number;
  method: 'rule-engine' | 'rule-engine+plant-id' | string;
  limitations: string[];
  /** Present only when a photo was actually analysed. */
  image?: {
    isPlant: boolean;
    looksHealthy: boolean;
    language: string;
    /** True when the farmer's language has no Plant.id content and English was used. */
    languageFellBack: boolean;
  };
}

export interface HealthLog {
  id: string;
  cropId: string;
  observedAt: string;
  observationType: string;
  description: string;
  imageUrl: string | null;
  diseaseDetected: string | null;
  pestDetected: string | null;
  severity: HealthSeverity;
  status: string;
  recommendedActions: string[] | null;
  analysisResult: { summary?: string; confidence?: number; method?: string } | null;
  crop?: { id: string; cropName: string };
}

export interface PriceTrend {
  commodity: string;
  cropName?: string;
  unit: string;
  series: Array<{ date: string; modalPrice: number; minPrice: number; maxPrice: number }>;
  current: { price: number; date: string; marketName: string | null } | null;
  statistics: {
    average7Day: number | null;
    average30Day: number | null;
    change7DayPercent: number | null;
    change30DayPercent: number | null;
    high30Day: number | null;
    low30Day: number | null;
    volatilityPercent: number | null;
  };
  direction: 'RISING' | 'FALLING' | 'STABLE';
  advice: { signal: 'SELL' | 'HOLD' | 'WATCH'; headline: string; reasoning: string };
  isSeeded: boolean;
  dataPoints: number;
  markets: string[];
  lastUpdated: string | null;
  scope: { level: MarketScopeLevel; label: string; widened: boolean };
}

export type MarketScopeLevel = 'market' | 'district' | 'state' | 'all';

/** Mandi filter sent with a price query. Any subset may be set. */
export interface MarketScope {
  state?: string;
  district?: string;
  market?: string;
}

export interface MarketLocation {
  state: string;
  district: string;
  marketName: string;
  dataPoints: number;
}

// ─────────────────── Crop recommendations ───────────────────

export interface DimensionScore {
  score: number;
  reason: string;
}

export interface CropRecommendation {
  cropKey: string;
  label: string;
  commodity: string;
  suitabilityScore: number;
  rating: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR';
  climate: DimensionScore;
  season: DimensionScore;
  soil: DimensionScore;
  water: DimensionScore;
  market: DimensionScore;
  summary: string;
  cautions: string[];
  agronomy: {
    growingDays: number;
    waterRequirementMm: number;
    expectedRainfallMm: number | null;
    irrigationNeedMm: number | null;
    seasons: string[];
  };
  economics: {
    currentPrice: number | null;
    unit: string;
    estimatedIncomePerHa: number | null;
    attainableYieldKgHa: number;
  };
}

export interface ClimateWindow {
  meanTempC: number;
  meanMinTempC: number;
  meanMaxTempC: number;
  totalRainfallMm: number;
  frostDays: number;
  yearsSampled: number;
  windowDays: number;
}

export interface RecommendationResult {
  farm: {
    id: string;
    name: string;
    soilType: string | null;
    areaHectares: number;
  };
  season: string;
  climate: ClimateWindow | null;
  recommendations: CropRecommendation[];
  warning?: string;
  generatedAt: string;
}

// ─────────────────── Planning ───────────────────

export interface FertilizerPlan {
  crop: { key: string; label: string; isKnown: boolean };
  areaHectares: number;
  requirement: { nitrogenKg: number; phosphorusKg: number; potassiumKg: number };
  products: Array<{
    product: string;
    totalKg: number;
    bags: number;
    bagSizeKg: number;
    supplies: string;
  }>;
  schedule: Array<{
    timing: string;
    stage: string;
    ureaKg: number;
    dapKg: number;
    mopKg: number;
    passed: boolean;
  }>;
  adjustments: string[];
  notes: string[];
  basis: string;
}

export interface StressFactor {
  name: string;
  factor: number;
  lossPercent: number;
  reason: string;
  severity: 'none' | 'mild' | 'moderate' | 'severe';
}

export interface YieldPrediction {
  crop: { key: string; label: string; isKnown: boolean };
  areaHectares: number;
  attainableKgHa: number;
  predictedKgHa: number;
  predictedTotalKg: number;
  rangeTotalKg: { low: number; high: number };
  unit: string;
  factors: StressFactor[];
  confidence: number;
  seasonProgress: number;
  estimatedIncome: number | null;
  improvements: string[];
  limitations: string[];
}

export interface CropPlan {
  cropId: string;
  cropName: string;
  status: string;
  fertilizer: FertilizerPlan;
  yieldPrediction: YieldPrediction;
}

/** One stored run of the yield engine, for the season-long trend. */
export interface YieldHistoryEntry {
  id: string;
  cropId: string;
  cropName: string;
  predictedAt: string;
  predictedTotalKg: number;
  predictedKgHa: number;
  rangeLowKg: number;
  rangeHighKg: number;
  confidence: number;
  seasonProgress: number;
  estimatedIncome: number | null;
  /** Set once the harvest has been recorded, so the estimate can be scored. */
  actualYieldKg: number | null;
}

export interface RecordHarvestResult {
  crop: {
    id: string;
    cropName: string;
    status: string;
    actualYieldKg: number | null;
    expectedYieldKg: number | null;
  };
  lastPrediction: { predictedTotalKg: number; predictedAt: string } | null;
  /** Signed percent the estimate was off by. Positive means it over-predicted. */
  errorPercent: number | null;
  withinPredictedRange: boolean | null;
}

export interface Outbreak {
  name: string;
  crop: string;
  count: number;
  latest: string;
  approxDistanceKm: number;
  severity: Severity;
  guidance: string[];
}

export interface NearbyOutbreaks {
  outbreaks: Outbreak[];
  farmsInArea: number;
  radiusKm: number;
}

export interface AlertItem {
  id: string;
  alertType: string;
  severity: Severity;
  title: string;
  message: string;
  action: string | null;
  /** Which engine raised it — "irrigation", "weather", "health". */
  source: string | null;
  crop: { id: string; cropName: string } | null;
  isRead: boolean;
  createdAt: string;
  /** Time-limited alerts (a frost warning) stop being shown after this. */
  expiresAt: string | null;
}

export interface AlertCounts {
  total: number;
  unread: number;
  critical: number;
  high: number;
}

export interface AlertFeed {
  alerts: AlertItem[];
  counts: AlertCounts;
}
