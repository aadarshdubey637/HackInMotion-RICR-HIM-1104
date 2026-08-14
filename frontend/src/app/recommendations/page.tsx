'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Thermometer,
  CalendarDays,
  Layers,
  Droplets,
  TrendingUp,
  ChevronDown,
  Info,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api';
import type { RecommendationResult, CropRecommendation, DimensionScore } from '@/lib/types';
import { Card, ErrorState, Notice, SkeletonCard, Badge } from '@/components/ui';
import { cn, formatRupees } from '@/lib/utils';

export default function RecommendationsPage() {
  return (
    <AppShell>
      <RecommendationsContent />
    </AppShell>
  );
}

const RATING_STYLE = {
  EXCELLENT: { bg: 'bg-emerald-50', border: 'border-emerald-300', text: 'text-emerald-800', bar: 'bg-emerald-500' },
  GOOD: { bg: 'bg-brand-50', border: 'border-brand-300', text: 'text-brand-800', bar: 'bg-brand-500' },
  FAIR: { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-900', bar: 'bg-amber-500' },
  POOR: { bg: 'bg-slate-50', border: 'border-slate-300', text: 'text-slate-600', bar: 'bg-slate-400' },
} as const;

function RecommendationsContent() {
  const { currentFarm } = useAuth();
  const [data, setData] = useState<RecommendationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentFarm) return;
    setError(null);
    try {
      setData(await api.recommendations.get(currentFarm.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load crop suggestions.');
    }
  }, [currentFarm]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!currentFarm) return null;
  if (error && !data) return <ErrorState message={error} onRetry={() => void load()} />;

  if (!data) {
    return (
      <div className="space-y-4">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  const existing = new Set(
    (currentFarm.crops ?? []).map((c) => c.cropName.toLowerCase()),
  );

  return (
    <div className="space-y-5 animate-fade-up">
      <div>
        <h1 className="text-xl font-bold text-slate-900">What to plant</h1>
        <p className="text-sm text-slate-600">
          Crops ranked for your land, this season — scored on climate, timing, soil, water and price.
        </p>
      </div>

      {data.warning ? <Notice tone="warn">{data.warning}</Notice> : null}

      {/* ── What the scoring is based on ── */}
      <Card className="bg-soil-100/60">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="brand" className="capitalize">
            {data.season} season
          </Badge>
          {data.farm.soilType ? (
            <Badge tone="neutral">{data.farm.soilType.toLowerCase()} soil</Badge>
          ) : (
            <Badge tone="warn">soil type not set</Badge>
          )}
          <Badge tone="neutral">{data.farm.areaHectares} ha</Badge>
        </div>

        {data.climate ? (
          <p className="mt-2.5 text-sm text-slate-600">
            Based on what your location actually did over the last {data.climate.yearsSampled} years
            in this window: averaging{' '}
            <strong className="text-slate-800">{data.climate.meanTempC}°C</strong> with about{' '}
            <strong className="text-slate-800">{data.climate.totalRainfallMm} mm</strong> of rain
            across {data.climate.windowDays} days
            {data.climate.frostDays > 0 ? `, and ${data.climate.frostDays} frost days` : ''}.
          </p>
        ) : null}
      </Card>

      {/* ── Ranked crops ── */}
      <div className="space-y-3">
        {data.recommendations.map((crop, index) => (
          <CropCard
            key={crop.cropKey}
            crop={crop}
            rank={index + 1}
            alreadyGrowing={existing.has(crop.cropKey)}
          />
        ))}
      </div>

      <Card className="text-xs text-slate-500">
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <p>
            Climate figures come from Open-Meteo&apos;s historical archive for your exact
            coordinates, not a regional average. Income estimates are gross at typical yield and do
            not subtract input costs — a high-value vegetable usually costs far more to grow than a
            cereal. Treat this as a starting point for a conversation with your extension officer.
          </p>
        </div>
      </Card>
    </div>
  );
}

function CropCard({
  crop,
  rank,
  alreadyGrowing,
}: {
  crop: CropRecommendation;
  rank: number;
  alreadyGrowing: boolean;
}) {
  const [open, setOpen] = useState(rank === 1);
  const style = RATING_STYLE[crop.rating];

  return (
    <Card className={cn('border-l-4 transition', style.bg, style.border)}>
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 text-left"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/80 text-sm font-bold text-slate-600">
          {rank}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold text-slate-900">{crop.label}</h2>
            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase', style.text, 'bg-white/70')}>
              {crop.rating}
            </span>
            {alreadyGrowing ? <Badge tone="brand">Growing now</Badge> : null}
          </div>

          <p className="mt-1 text-sm text-slate-700">{crop.summary}</p>

          {/* Score bar */}
          <div className="mt-2 flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/70">
              <div
                className={cn('h-full rounded-full transition-all', style.bar)}
                style={{ width: `${crop.suitabilityScore}%` }}
              />
            </div>
            <span className="shrink-0 text-sm font-bold tabular-nums text-slate-700">
              {crop.suitabilityScore}
              <span className="text-xs font-medium text-slate-400">/100</span>
            </span>
          </div>
        </div>

        <ChevronDown
          className={cn('mt-1 h-5 w-5 shrink-0 text-slate-400 transition', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      {open ? (
        <div className="mt-4 space-y-3 border-t border-white/70 pt-3">
          {/* Dimension breakdown */}
          <div className="space-y-2">
            <Dimension icon={Thermometer} label="Climate" dim={crop.climate} weight="30%" />
            <Dimension icon={CalendarDays} label="Season" dim={crop.season} weight="25%" />
            <Dimension icon={Layers} label="Soil" dim={crop.soil} weight="20%" />
            <Dimension icon={Droplets} label="Water" dim={crop.water} weight="15%" />
            <Dimension icon={TrendingUp} label="Market" dim={crop.market} weight="10%" />
          </div>

          {/* Practical numbers */}
          <div className="grid grid-cols-2 gap-3 rounded-xl bg-white/70 p-3 sm:grid-cols-4">
            <Fact label="Season length" value={`${crop.agronomy.growingDays} days`} />
            <Fact label="Water need" value={`${crop.agronomy.waterRequirementMm} mm`} />
            <Fact
              label="Typical yield"
              value={`${(crop.economics.attainableYieldKgHa / 1000).toFixed(1)} t/ha`}
            />
            <Fact
              label="Gross income"
              value={
                crop.economics.estimatedIncomePerHa
                  ? `${formatRupees(crop.economics.estimatedIncomePerHa)}/ha`
                  : '—'
              }
            />
          </div>

          {/* Cautions */}
          {crop.cautions.length > 0 ? (
            <div className="rounded-xl bg-white/70 p-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                Before you commit
              </p>
              <ul className="space-y-1">
                {crop.cautions.map((caution, i) => (
                  <li key={i} className="text-sm text-slate-700">
                    · {caution}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-xl bg-white/70 p-3 text-sm text-emerald-800">
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
              No significant concerns for this crop on your farm.
            </div>
          )}
        </div>
      ) : null}
    </Card>
  );
}

function Dimension({
  icon: Icon,
  label,
  dim,
  weight,
}: {
  icon: typeof Thermometer;
  label: string;
  dim: DimensionScore;
  weight: string;
}) {
  const tone =
    dim.score >= 80 ? 'bg-emerald-500' : dim.score >= 60 ? 'bg-brand-500' : dim.score >= 40 ? 'bg-amber-500' : 'bg-red-400';

  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-slate-700">
            {label}
            <span className="ml-1.5 text-xs font-normal text-slate-400">{weight}</span>
          </span>
          <span className="shrink-0 text-sm font-bold tabular-nums text-slate-600">{dim.score}</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/80">
          <div className={cn('h-full rounded-full', tone)} style={{ width: `${dim.score}%` }} />
        </div>
        <p className="mt-1 text-xs leading-snug text-slate-600">{dim.reason}</p>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-sm font-bold text-slate-800">{value}</p>
    </div>
  );
}
