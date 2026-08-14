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

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 10000): Promise<Response> {
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
      village: address.neighbourhood || address.suburb || address.quarter || address.village || address.hamlet || null,
      district: address.city || address.town || address.district || address.county || address.city_district || null,
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

    return {
      soilType,
      soilProperties: Object.keys(soilData).length > 0 ? soilData : null,
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

export async function getLocationAndSoil(latitude: number, longitude: number): Promise<{
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
  return { soilType: null, soilProperties: null };
}