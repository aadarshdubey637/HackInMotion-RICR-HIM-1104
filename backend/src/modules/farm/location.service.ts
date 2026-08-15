import { logger } from '../../common/logger';

export interface LocationInfo {
  village: string | null;
  district: string | null;
  state: string | null;
  country: string | null;
  formattedAddress: string | null;
}

export interface SoilInfo {
  soilType: string | null;
  soilProperties: Record<string, unknown> | null;
  /**
   * The raw SoilGrids numbers reduced to the bands the fertiliser engine reads.
   *
   * Null when the lookup returned nothing usable. See `deriveSoilAnalysis` for
   * why phosphorus and potassium are deliberately absent.
   */
  soilAnalysis: SoilAnalysis | null;
}

/** Soil test bands, as reported by Indian soil health cards. */
export type NutrientLevel = 'low' | 'medium' | 'high';

/**
 * What the fertiliser engine is given about a farm's soil chemistry.
 *
 * `source` is load-bearing, not decoration: a modelled global raster and a
 * laboratory soil health card justify very different confidence, and the advice
 * shown to the farmer says which one it is standing on.
 */
export interface SoilAnalysis {
  nitrogen?: NutrientLevel;
  phosphorus?: NutrientLevel;
  potassium?: NutrientLevel;
  /** Soil pH in water. Drives availability, not the dose directly. */
  ph?: number;
  /** Organic carbon, g/kg. High carbon mineralises nitrogen through the season. */
  organicCarbonGKg?: number;
  source: 'soilgrids' | 'soil-health-card';
  /** Which horizon these figures describe. */
  depthCm?: string;
}

/**
 * Total soil nitrogen bands, g/kg.
 *
 * SoilGrids reports *total* nitrogen. A soil health card reports *available*
 * nitrogen in kg/ha, and the two are not interconvertible without a
 * mineralisation rate nobody has for an individual field. These thresholds
 * follow the conventional total-N interpretation (roughly <0.075%, 0.075-0.175%,
 * >0.175% by mass) so the band means something even though the unit differs.
 */
const NITROGEN_BANDS = { low: 0.75, high: 1.75 };

function bandNitrogen(totalNGKg: number): NutrientLevel {
  if (totalNGKg < NITROGEN_BANDS.low) return 'low';
  if (totalNGKg > NITROGEN_BANDS.high) return 'high';
  return 'medium';
}

/**
 * Reduce raw SoilGrids values to a `SoilAnalysis`.
 *
 * These numbers were already being fetched on every farm setup and thrown away:
 * `soilProperties` was stored as an opaque blob and only the texture class was
 * ever read from it. The consequence was that the fertiliser planner's
 * soil-test path never once executed in normal use — every farmer got the
 * textbook dose and the message "No soil test on file".
 *
 * Phosphorus and potassium are **not** derived. SoilGrids does not model plant-
 * available P or K at all, and a fabricated band there would silently scale the
 * DAP and MOP a farmer buys by ±25% on the strength of nothing. Their absence is
 * the honest answer, and the engine already treats a missing band as "apply the
 * standard dose".
 *
 * Values are in SoilGrids' mapped units and are converted here:
 * nitrogen cg/kg → g/kg, phh2o pH×10 → pH, ocd hg/m³ → kg/m³.
 */
export function deriveSoilAnalysis(
  soilProperties: Record<string, unknown> | null,
): SoilAnalysis | null {
  if (!soilProperties) return null;

  const read = (property: string): number | null => {
    for (const depth of ['0-5cm', '5-15cm']) {
      const value = soilProperties[`${property}_${depth}`];
      if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
    return null;
  };

  const analysis: SoilAnalysis = { source: 'soilgrids', depthCm: '0-15' };

  const nitrogenCgKg = read('nitrogen');
  if (nitrogenCgKg !== null && nitrogenCgKg > 0) {
    analysis.nitrogen = bandNitrogen(nitrogenCgKg / 100);
  }

  const phTimesTen = read('phh2o');
  if (phTimesTen !== null && phTimesTen > 0) {
    const ph = phTimesTen / 10;
    // Sanity bound: a raster artefact outside this range is not a soil pH, and
    // feeding one into a lime recommendation would be worse than having none.
    if (ph >= 3 && ph <= 11) analysis.ph = Math.round(ph * 10) / 10;
  }

  const ocdHgM3 = read('ocd');
  if (ocdHgM3 !== null && ocdHgM3 > 0) {
    analysis.organicCarbonGKg = Math.round((ocdHgM3 / 10) * 10) / 10;
  }

  // Nothing but the source tag means nothing was actually resolved.
  const hasAnyValue =
    analysis.nitrogen !== undefined ||
    analysis.ph !== undefined ||
    analysis.organicCarbonGKg !== undefined;

  return hasAnyValue ? analysis : null;
}

interface NominatimResponse {
  address?: Record<string, string>;
  display_name?: string;
}

interface SoilGridsResponse {
  properties?: {
    layers?: Array<{
      name: string;
      depths?: Array<{
        label: string;
        values?: { mean?: number };
      }>;
    }>;
  };
}

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/reverse';
const SOILGRIDS_BASE = 'https://rest.isric.org/soilgrids/v2.0/properties/query';

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 10000,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

export async function reverseGeocode(latitude: number, longitude: number): Promise<LocationInfo> {
  try {
    const params = new URLSearchParams({
      lat: latitude.toString(),
      lon: longitude.toString(),
      format: 'json',
      addressdetails: '1',
      'accept-language': 'en',
    });

    const response = await fetchWithTimeout(`${NOMINATIM_BASE}?${params}`, {
      headers: { 'User-Agent': 'SmartFarmDSS/1.0 (contact@smartfarm.example)' },
    });

    if (!response.ok) {
      logger.warn({ status: response.status }, 'Nominatim reverse geocoding failed');
      return emptyLocation();
    }

    const data = (await response.json()) as NominatimResponse;
    const address = data.address || {};

    return {
      village:
        address.neighbourhood ||
        address.suburb ||
        address.quarter ||
        address.village ||
        address.hamlet ||
        null,
      district:
        address.city ||
        address.town ||
        address.district ||
        address.county ||
        address.city_district ||
        null,
      state: address.state || address.province || null,
      country: address.country || null,
      formattedAddress: data.display_name || null,
    };
  } catch (error) {
    logger.warn({ error, latitude, longitude }, 'Reverse geocoding error');
    return emptyLocation();
  }
}

export async function getSoilType(latitude: number, longitude: number): Promise<SoilInfo> {
  try {
    const params = new URLSearchParams({
      lat: latitude.toString(),
      lon: longitude.toString(),
      properties: 'clay,sand,silt,phh2o,ocd,nitrogen',
      depths: '0-5cm,5-15cm',
      values: 'mean',
    });

    const response = await fetchWithTimeout(`${SOILGRIDS_BASE}?${params}`, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      logger.warn({ status: response.status }, 'SoilGrids query failed');
      return emptySoil();
    }

    const data = (await response.json()) as SoilGridsResponse;
    const properties = data.properties?.layers || [];

    const soilData: Record<string, number> = {};
    for (const layer of properties) {
      const depths = layer.depths || [];
      for (const depth of depths) {
        const values = depth.values?.mean;
        if (values !== undefined && values !== null) {
          soilData[`${layer.name}_${depth.label}`] = values;
        }
      }
    }

    const topClay = soilData['clay_0-5cm'] ?? soilData['clay_5-15cm'] ?? 0;
    const topSand = soilData['sand_0-5cm'] ?? soilData['sand_5-15cm'] ?? 0;
    const topSilt = soilData['silt_0-5cm'] ?? soilData['silt_5-15cm'] ?? 0;

    const soilType = classifySoilTexture(topSand, topSilt, topClay);
    const soilProperties = Object.keys(soilData).length > 0 ? soilData : null;

    return {
      soilType,
      soilProperties,
      soilAnalysis: deriveSoilAnalysis(soilProperties),
    };
  } catch (error) {
    logger.warn({ error, latitude, longitude }, 'Soil type lookup error');
    return emptySoil();
  }
}

function classifySoilTexture(sand: number, silt: number, clay: number): string {
  const total = sand + silt + clay;
  if (total === 0) return 'MIXED';

  const sPct = (sand / total) * 100;
  const siPct = (silt / total) * 100;
  const cPct = (clay / total) * 100;

  if (cPct >= 40) return 'CLAY';
  if (siPct >= 80) return 'SILTY';
  if (sPct >= 85 && cPct < 10) return 'SANDY';
  if (sPct >= 70 && cPct < 15) return 'LOAMY';
  if (cPct >= 27 && cPct < 40 && sPct <= 45) return 'CLAY';
  if (cPct >= 20 && cPct < 35 && siPct >= 28) return 'LOAMY';
  if (sPct >= 45 && cPct < 20) return 'LOAMY';
  if (cPct >= 35 && sPct >= 45) return 'CLAY';

  return 'MIXED';
}

export async function getLocationAndSoil(
  latitude: number,
  longitude: number,
): Promise<{
  location: LocationInfo;
  soil: SoilInfo;
}> {
  const [location, soil] = await Promise.all([
    reverseGeocode(latitude, longitude),
    getSoilType(latitude, longitude),
  ]);
  return { location, soil };
}

function emptyLocation(): LocationInfo {
  return { village: null, district: null, state: null, country: null, formattedAddress: null };
}

function emptySoil(): SoilInfo {
  return { soilType: null, soilProperties: null, soilAnalysis: null };
}
