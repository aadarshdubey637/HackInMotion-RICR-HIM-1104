'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Sprout, Plus, X, Trash2, MapPin, Ruler, Layers } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api';
import type { Crop } from '@/lib/types';
import {
  Card,
  SectionHeading,
  ErrorState,
  EmptyState,
  Notice,
  Spinner,
  Badge,
  SkeletonCard,
} from '@/components/ui';
import { cn, cropLabel, humanise, formatDate } from '@/lib/utils';
import { useTranslation } from '@/lib/language-context';

const CROP_STATUSES = [
  { value: 'PLANNED', label: 'Planned' },
  { value: 'GROWING', label: 'Growing' },
  { value: 'FLOWERING', label: 'Flowering' },
  { value: 'FRUITING', label: 'Fruiting' },
  { value: 'HARVESTED', label: 'Harvested' },
] as const;

export default function CropsPage() {
  return (
    <AppShell>
      <CropsContent />
    </AppShell>
  );
}

function CropsContent() {
  const { currentFarm } = useAuth();
  const { t, tCrop, tStage } = useTranslation();
  const [crops, setCrops] = useState<Crop[]>([]);
  const [supported, setSupported] = useState<Array<{ key: string; label: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    if (!currentFarm) return;
    setError(null);

    try {
      const [cropsRes, supportedRes] = await Promise.all([
        api.farms.crops(currentFarm.id),
        api.farms.supportedCrops(),
      ]);
      setCrops(cropsRes.crops);
      setSupported(supportedRes.crops);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your crops.');
    } finally {
      setLoading(false);
    }
  }, [currentFarm]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!currentFarm) return null;

  if (error && crops.length === 0 && !loading) {
    return <ErrorState message={error} onRetry={() => void load()} />;
  }

  const supportedKeys = new Set(supported.map((s) => s.key));

  return (
    <div className="space-y-5 animate-fade-up">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{t('crops.title')}</h1>
        <p className="text-sm text-slate-600">
          {t('crops.subtitle')}
        </p>
      </div>

      {/* ── Farm summary ── */}
      <Card>
        <SectionHeading icon={Sprout} title={currentFarm.name} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="flex items-start gap-2">
            <Ruler className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
            <div>
              <p className="text-xs text-slate-500">Land size</p>
              <p className="text-sm font-semibold text-slate-800">
                {currentFarm.totalAreaHectares} ha
              </p>
              <p className="text-xs text-slate-400">
                {(currentFarm.totalAreaHectares * 2.47105).toFixed(1)} acres
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <Layers className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
            <div>
              <p className="text-xs text-slate-500">Soil</p>
              <p className="text-sm font-semibold text-slate-800">
                {currentFarm.soilTypePrimary ? humanise(currentFarm.soilTypePrimary) : 'Not set'}
              </p>
              {!currentFarm.soilTypePrimary ? (
                <p className="text-xs text-amber-700">Improves water advice</p>
              ) : null}
            </div>
          </div>

          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
            <div className="min-w-0">
              <p className="text-xs text-slate-500">Location</p>
              <p className="truncate text-sm font-semibold text-slate-800">
                {currentFarm.address ?? 'Set'}
              </p>
              <p className="text-xs tabular-nums text-slate-400">
                {currentFarm.latitude.toFixed(3)}, {currentFarm.longitude.toFixed(3)}
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* ── Add crop ── */}
      {showForm ? (
        <AddCropForm
          farmId={currentFarm.id}
          supported={supported}
          onCancel={() => setShowForm(false)}
          onSuccess={() => {
            setShowForm(false);
            void load();
          }}
        />
      ) : (
        <button type="button" onClick={() => setShowForm(true)} className="btn-primary w-full">
          <Plus className="h-5 w-5" aria-hidden />
          {t('crops.addCrop')}
        </button>
      )}

      {/* ── Crop list ── */}
      <section>
        <SectionHeading title={`Crops (${crops.length})`} />

        {loading ? (
          <SkeletonCard />
        ) : crops.length === 0 ? (
          <EmptyState
            icon={Sprout}
            title={t('crops.emptyCrops')}
            message="Your crops"
          />
        ) : (
          <div className="space-y-3">
            {crops.map((crop) => (
              <CropCard
                key={crop.id}
                crop={crop}
                farmId={currentFarm.id}
                recognised={supportedKeys.has(crop.cropName.toLowerCase())}
                onDeleted={() => void load()}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function AddCropForm({
  farmId,
  supported,
  onCancel,
  onSuccess,
}: {
  farmId: string;
  supported: Array<{ key: string; label: string }>;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const { t, tCrop } = useTranslation();
  const [cropName, setCropName] = useState('');
  const [customName, setCustomName] = useState('');
  const [status, setStatus] = useState<string>('GROWING');
  const [plantingDate, setPlantingDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usingCustom = cropName === '__other__';
  const finalName = usingCustom ? customName.trim() : cropName;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!finalName) return;

    setError(null);
    setSubmitting(true);

    try {
      await api.farms.addCrop(farmId, {
        cropName: finalName,
        status,
        plantingDate: plantingDate || undefined,
      });
      onSuccess();
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof ApiError ? err.message : 'Could not add the crop. Please try again.');
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-slate-800">{t('crops.addCrop')}</h2>
          <button type="button" onClick={onCancel} aria-label="Cancel" className="btn-ghost px-2">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {error ? <Notice tone="warn">{error}</Notice> : null}

        <div>
          <span className="label">{t('crops.cropSelect')}</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {supported.map((crop) => (
              <button
                key={crop.key}
                type="button"
                onClick={() => setCropName(crop.key)}
                aria-pressed={cropName === crop.key}
                className={cn(
                  'rounded-xl border p-2.5 text-sm font-semibold transition',
                  cropName === crop.key
                    ? 'border-brand-600 bg-brand-50 text-brand-800 ring-1 ring-brand-600'
                    : 'border-soil-300 bg-white text-slate-700 hover:bg-soil-50',
                )}
              >
                {tCrop(crop.label)}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setCropName('__other__')}
              aria-pressed={usingCustom}
              className={cn(
                'rounded-xl border p-2.5 text-sm font-semibold transition',
                usingCustom
                  ? 'border-brand-600 bg-brand-50 text-brand-800 ring-1 ring-brand-600'
                  : 'border-soil-300 bg-white text-slate-700 hover:bg-soil-50',
              )}
            >
              Something else
            </button>
          </div>
        </div>

        {usingCustom ? (
          <div>
            <label htmlFor="custom-crop" className="label">
              Crop name
            </label>
            <input
              id="custom-crop"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              className="field"
              placeholder="e.g. Bajra"
              required
            />
            <p className="mt-1 text-xs text-amber-700">
              We do not have detailed agronomy data for crops outside the list, so guidance will be
              more general.
            </p>
          </div>
        ) : null}

        <div>
          <span className="label">{t('crops.statusSelect')}</span>
          <div className="flex flex-wrap gap-2">
            {CROP_STATUSES.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setStatus(option.value)}
                aria-pressed={status === option.value}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-sm font-semibold transition',
                  status === option.value
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-soil-300 bg-white text-slate-700',
                )}
              >
                {t(`stages.${option.value.toLowerCase()}`)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="planting-date" className="label">
            Planting date (optional)
          </label>
          <input
            id="planting-date"
            type="date"
            max={new Date().toISOString().slice(0, 10)}
            value={plantingDate}
            onChange={(e) => setPlantingDate(e.target.value)}
            className="field"
          />
          <p className="mt-1 text-xs text-slate-500">
            Lets us work out the growth stage, which changes how much water the crop needs.
          </p>
        </div>

        <div className="flex gap-3">
          <button type="button" onClick={onCancel} className="btn-secondary flex-1">
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={submitting || !finalName} className="btn-primary flex-1">
            {submitting ? <Spinner className="h-5 w-5" /> : null}
            {submitting ? t('common.loading') : t('crops.addCrop')}
          </button>
        </div>
      </form>
    </Card>
  );
}
function getCropThumbnail(cropName: string): string {
  const name = cropName.toLowerCase();
  if (['rice', 'wheat', 'maize', 'cotton', 'tomato'].includes(name)) {
    return `/images/crops/${name}.png`;
  }
  return '/images/crops/default_crop.png';
}

function CropCard({
  crop,
  farmId,
  recognised,
  onDeleted,
}: {
  crop: Crop;
  farmId: string;
  recognised: boolean;
  onDeleted: () => void;
}) {
  const { t, tCrop, tStage } = useTranslation();
  const [deleting, setDeleting] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function remove() {
    setDeleting(true);
    try {
      await api.farms.deleteCrop(farmId, crop.id);
      onDeleted();
    } catch {
      setDeleting(false);
      setConfirming(false);
    }
  }

  const imageUrl = getCropThumbnail(crop.cropName);

  return (
    <Card className="flex items-center justify-between gap-4 p-4 hover:shadow-md transition-shadow duration-300">
      <div className="flex items-center gap-4 min-w-0 flex-1">
        {/* Left Thumbnail with glassmorphism overlay for stage */}
        <div className="relative w-20 h-20 shrink-0 rounded-2xl overflow-hidden shadow-inner border border-soil-100 bg-soil-50">
          <img 
            src={imageUrl} 
            alt={crop.cropName} 
            className="w-full h-full object-cover transition-transform duration-300 hover:scale-110" 
          />
          {/* Glassmorphism badge overlay at the bottom */}
          <div className="absolute inset-x-0 bottom-0 bg-slate-900/60 backdrop-blur-[2px] py-0.5 px-1 text-center">
            <span className="text-[9px] font-extrabold text-white uppercase tracking-wider truncate block">
              {tStage(crop.growthStage || crop.status)}
            </span>
          </div>
        </div>

        {/* Details in the middle */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-extrabold text-base text-slate-800 truncate">{tCrop(crop.cropName)}</h3>
            <Badge tone={crop.status === 'HARVESTED' ? 'neutral' : 'brand'} className="text-[10px] px-2 py-0.5 font-bold">
              {tStage(crop.status)}
            </Badge>
            {!recognised ? <Badge tone="warn" className="text-[10px] px-2 py-0.5 font-bold">Limited data</Badge> : null}
          </div>

          <div className="mt-1 space-y-0.5 text-xs text-slate-500 font-medium">
            {crop.growthStage ? <p>Stage: <span className="text-slate-700 font-semibold">{tStage(crop.growthStage)}</span></p> : null}
            {crop.plantingDate ? <p>Planted <span className="text-slate-700 font-semibold">{formatDate(crop.plantingDate)}</span></p> : null}
            {crop.expectedHarvestDate ? (
              <p>Expected harvest <span className="text-slate-700 font-semibold">{formatDate(crop.expectedHarvestDate)}</span></p>
            ) : null}
          </div>
        </div>
      </div>

      {confirming ? (
        <div className="flex shrink-0 flex-col gap-1.5">
          <button
            type="button"
            onClick={remove}
            disabled={deleting}
            className="rounded-xl bg-red-600 hover:bg-red-500 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition"
          >
            {deleting ? t('common.loading') : t('common.success')}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-xl border border-soil-300 px-3 py-1.5 text-xs font-bold text-slate-650 hover:bg-slate-50 transition"
          >
            {t('common.cancel')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label={`Remove ${crop.cropName}`}
          className="btn-ghost shrink-0 px-2.5 py-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors duration-200"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      )}
    </Card>
  );
}
