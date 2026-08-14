import { z } from 'zod';
import { objectId, boolParam } from '../../common/http';

export const locationQuery = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export type LocationQueryInput = z.infer<typeof locationQuery>;

const SOIL_TYPES = ['SANDY', 'LOAMY', 'CLAY', 'SILTY', 'PEATY', 'CHALKY', 'MIXED'] as const;
const CROP_STATUSES = [
  'PLANNED',
  'PLANTED',
  'GROWING',
  'FLOWERING',
  'FRUITING',
  'HARVESTED',
  'FAILED',
  'FALLOW',
] as const;
const GROWTH_STAGES = [
  'SEED',
  'GERMINATION',
  'VEGETATIVE',
  'FLOWERING',
  'FRUIT_SET',
  'RIPENING',
  'HARVEST_READY',
] as const;

/** Optional GeoJSON outline for map display. Never queried spatially. */
const boundarySchema = z
  .object({
    type: z.literal('Polygon'),
    coordinates: z.array(z.array(z.array(z.number()))),
  })
  .optional();

const latitude = z
  .number()
  .min(-90, 'Latitude must be between -90 and 90')
  .max(90, 'Latitude must be between -90 and 90');

const longitude = z
  .number()
  .min(-180, 'Longitude must be between -180 and 180')
  .max(180, 'Longitude must be between -180 and 180');

// ─────────────────────────── Farm ───────────────────────────

export const createFarmBody = z.object({
  name: z.string().trim().min(1, 'Please give your farm a name').max(100),
  latitude,
  longitude,
  totalAreaHectares: z
    .number()
    .positive('Land size must be greater than zero')
    .max(100_000, 'That land size looks too large — please check'),
  soilTypePrimary: z.enum(SOIL_TYPES).optional(),
  soilAnalysis: z.record(z.unknown()).optional(),
  address: z.string().trim().max(300).optional(),
  boundary: boundarySchema,
});

export const updateFarmBody = createFarmBody
  .partial()
  .extend({ status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional() });

export const farmIdParams = z.object({ farmId: objectId });

// ─────────────────────────── Parcel ───────────────────────────

export const createParcelBody = z.object({
  name: z.string().trim().min(1, 'Please name this plot').max(100),
  areaHectares: z.number().positive('Area must be greater than zero'),
  soilType: z.enum(SOIL_TYPES).optional(),
  soilProperties: z.record(z.unknown()).optional(),
  irrigationZone: z.string().trim().max(100).optional(),
  displayOrder: z.number().int().nonnegative().optional(),
  boundary: boundarySchema,
});

export const updateParcelBody = createParcelBody.partial();

export const parcelIdParams = z.object({ farmId: objectId, parcelId: objectId });

// ─────────────────────────── Crop ───────────────────────────

/** Accepts either a full ISO datetime or a plain YYYY-MM-DD from a date input. */
const dateInput = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Not a valid date');

export const createCropBody = z.object({
  cropName: z.string().trim().min(1, 'Please choose a crop').max(100),
  parcelId: objectId.optional(),
  varietyId: objectId.optional(),
  plantingDate: dateInput.optional(),
  expectedHarvestDate: dateInput.optional(),
  growthStage: z.enum(GROWTH_STAGES).optional(),
  status: z.enum(CROP_STATUSES).optional(),
  managementPlan: z.record(z.unknown()).optional(),
  expectedYieldKg: z.number().positive().optional(),
});

export const updateCropBody = createCropBody.partial().extend({
  parcelId: objectId.nullable().optional(),
  plantingDate: dateInput.nullable().optional(),
  expectedHarvestDate: dateInput.nullable().optional(),
  growthStage: z.enum(GROWTH_STAGES).nullable().optional(),
  actualYieldKg: z.number().nonnegative().optional(),
});

export const cropIdParams = z.object({ farmId: objectId, cropId: objectId });

export const cropDashboardQuery = z.object({
  includeWeather: boolParam(true),
  includeHealth: boolParam(true),
  includeMarket: boolParam(true),
  includeIrrigation: boolParam(true),
});

// ─────────────────────────── Types ───────────────────────────

export type CreateFarmInput = z.infer<typeof createFarmBody>;
export type UpdateFarmInput = z.infer<typeof updateFarmBody>;
export type CreateParcelInput = z.infer<typeof createParcelBody>;
export type UpdateParcelInput = z.infer<typeof updateParcelBody>;
export type CreateCropInput = z.infer<typeof createCropBody>;
export type UpdateCropInput = z.infer<typeof updateCropBody>;
export type CropDashboardQuery = z.infer<typeof cropDashboardQuery>;
