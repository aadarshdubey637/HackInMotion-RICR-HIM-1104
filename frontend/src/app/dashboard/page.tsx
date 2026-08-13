'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Droplets,
  CloudSun,
  CloudRain,
  Cloud,
  Sun,
  CloudLightning,
  CloudFog,
  Snowflake,
  Stethoscope,
  TrendingUp,
  TrendingDown,
  Minus,
  Sprout,
  ArrowRight,
  CheckCircle2,
  Thermometer,
  RefreshCw,
} from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api';
import type { Dashboard, ActionItem } from '@/lib/types';
import {
  Card,
  SectionHeading,
  Badge,
  ErrorState,
  Notice,
  SkeletonCard,
  severityStyles,
  healthSeverityStyles,
} from '@/components/ui';
import { cn, formatDay, formatRupees, cropLabel, humanise, weatherIcon, timeAgo } from '@/lib/utils';

export default function DashboardPage() {
  return (
    <AppShell>
      <DashboardContent />
    </AppShell>
  );
}

const WEATHER_ICONS = {
  sun: Sun,
  cloud: Cloud,
  rain: CloudRain,
  storm: CloudLightning,
  fog: CloudFog,
  snow: Snowflake,
} as const;

function DashboardContent() {
  const { currentFarm } = useAuth();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<{ message: string; offline: boolean } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!currentFarm) return;
      setError(null);

      try {
        setData(await api.dashboard.get(currentFarm.id, signal));
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError({
          message:
            err instanceof ApiError
              ? err.message
              : 'Could not load your dashboard. Please try again.',
          offline: err instanceof ApiError && err.code === 'NETWORK_ERROR',
        });
      }
    },
    [currentFarm],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (!currentFarm) return null;

  if (error && !data) {
    return (
      <ErrorState
        title={error.offline ? 'No connection' : 'Could not load your dashboard'}
        message={error.message}
        offline={error.offline}
        onRetry={() => void load()}
      />
    );
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  const greeting = getGreeting();

  return (
    <div className="space-y-5 animate-fade-up">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">{greeting}</p>
          <h1 className="text-xl font-bold text-slate-900">
            {data.actions.length === 0
              ? 'Nothing needs your attention today'
              : `${data.actions.length} thing${data.actions.length === 1 ? '' : 's'} to look at`}
          </h1>
          <p className="mt-0.5 text-xs capitalize text-slate-500">
            {data.farm.season} season · {data.farm.totalAreaHectares} ha
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          aria-label="Refresh"
          className="btn-ghost shrink-0 px-2"
        >
          <RefreshCw className={cn('h-5 w-5', refreshing && 'animate-spin')} aria-hidden />
        </button>
      </div>

      {error ? <Notice tone="warn">{error.message}</Notice> : null}
      {data.weather.warning ? <Notice tone="warn">{data.weather.warning}</Notice> : null}

      {/* ── Action list: the answer to "what do I do today?" ── */}
      {data.actions.length > 0 ? (
        <section>
          <SectionHeading title="What to do today" />
          <div className="space-y-3">
            {data.actions.map((action) => (
              <ActionCard key={action.id} action={action} />
            ))}
          </div>
        </section>
      ) : (
        <Card className="flex items-center gap-3 border-emerald-200 bg-emerald-50">
          <CheckCircle2 className="h-8 w-8 shrink-0 text-emerald-600" aria-hidden />
          <div>
            <p className="font-bold text-emerald-900">All good for now</p>
            <p className="text-sm text-emerald-800">
              No irrigation due, no weather risks and no crop health flags. Check back tomorrow.
            </p>
          </div>
        </Card>
      )}

      {/* ── Water + weather ── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <IrrigationCard data={data} />
        <WeatherCard data={data} />
      </div>

      {/* ── Crop health ── */}
      <section>
        <SectionHeading
          icon={Stethoscope}
          title="Crop health"
          action={
            <Link href="/health" className="text-sm font-semibold text-brand-700">
              Log an issue
            </Link>
          }
        />
        {data.health.recent.length === 0 ? (
          <Card>
            <p className="text-sm text-slate-600">
              No health issues logged. If you spot something on your plants, take a photo and log it —
              you will get guidance on what to check.
            </p>
            <Link href="/health" className="btn-secondary mt-3 w-full sm:w-auto">
              Check a plant
            </Link>
          </Card>
        ) : (
          <div className="space-y-2">
            {data.health.recent.slice(0, 3).map((issue) => {
              const style = healthSeverityStyles[issue.severity];
              return (
                <Link key={issue.id} href="/health">
                  <Card className="flex items-start gap-3 transition hover:border-brand-300">
                    <span className={cn('mt-0.5 rounded-lg px-2 py-1 text-xs font-bold', style.bg, style.text)}>
                      {style.label}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-800">
                        {cropLabel(issue.cropName)}
                      </p>
                      <p className="line-clamp-2 text-sm text-slate-600">{issue.summary}</p>
                      <p className="mt-0.5 text-xs text-slate-400">{timeAgo(issue.observedAt)}</p>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Market ── */}
      <section>
        <SectionHeading
          icon={TrendingUp}
          title="Market prices"
          action={
            <Link href="/market" className="text-sm font-semibold text-brand-700">
              See trends
            </Link>
          }
        />
        {data.market.trends.length === 0 ? (
          <Card>
            <p className="text-sm text-slate-600">
              {data.market.message ?? 'No price data for your crops yet.'}
            </p>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {data.market.trends.map((trend) => (
              <PriceCard key={trend.commodity} trend={trend} />
            ))}
          </div>
        )}
      </section>

      {/* ── Crops ── */}
      <section>
        <SectionHeading
          icon={Sprout}
          title="Your crops"
          action={
            <Link href="/crops" className="text-sm font-semibold text-brand-700">
              Manage
            </Link>
          }
        />
        {data.crops.length === 0 ? (
          <Card>
            <p className="text-sm text-slate-600">No crops added yet.</p>
            <Link href="/crops" className="btn-primary mt-3 w-full sm:w-auto">
              Add your crop
            </Link>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {data.crops.map((crop) => (
              <Card key={crop.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-bold text-slate-800">{cropLabel(crop.cropName)}</p>
                  <p className="text-xs text-slate-500">
                    {humanise(crop.growthStage) || humanise(crop.status)}
                    {crop.daysToHarvest !== null && crop.daysToHarvest > 0
                      ? ` · ${crop.daysToHarvest} days to harvest`
                      : ''}
                  </p>
                </div>
                {!crop.isRecognised ? (
                  <Badge tone="warn" className="shrink-0">
                    Limited data
                  </Badge>
                ) : null}
              </Card>
            ))}
          </div>
        )}
      </section>

      <p className="pb-2 text-center text-xs text-slate-400">
        Updated {timeAgo(data.generatedAt)} · Weather from Open-Meteo
      </p>
    </div>
  );
}

// ─────────────────────────── Cards ───────────────────────────

function ActionCard({ action }: { action: ActionItem }) {
  const style = severityStyles[action.priority];

  const CategoryIcon = {
    IRRIGATION: Droplets,
    WEATHER: CloudSun,
    HEALTH: Stethoscope,
    MARKET: TrendingUp,
    SETUP: Sprout,
  }[action.category];

  const body = (
    <Card className={cn('border-l-4 transition', style.bg, style.border)}>
      <div className="flex items-start gap-3">
        <div className={cn('mt-0.5 shrink-0 rounded-lg p-2', style.dot, 'bg-opacity-15')}>
          <CategoryIcon className={cn('h-5 w-5', style.text)} aria-hidden />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={cn('font-bold', style.text)}>{action.title}</h3>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white',
                style.dot,
              )}
            >
              {style.label}
            </span>
          </div>

          <p className="mt-1 text-sm text-slate-700">{action.detail}</p>

          <p className={cn('mt-2 text-sm font-semibold', style.text)}>{action.action}</p>

          {action.cropName ? (
            <p className="mt-1.5 text-xs text-slate-500">{cropLabel(action.cropName)}</p>
          ) : null}
        </div>

        {action.link ? (
          <ArrowRight className={cn('mt-1 h-5 w-5 shrink-0', style.text)} aria-hidden />
        ) : null}
      </div>
    </Card>
  );

  // Map backend deep-links onto the app's actual routes.
  const href = action.link ? mapLink(action.category) : null;
  return href ? <Link href={href}>{body}</Link> : body;
}

function mapLink(category: ActionItem['category']): string {
  switch (category) {
    case 'IRRIGATION':
    case 'WEATHER':
      return '/weather';
    case 'HEALTH':
      return '/health';
    case 'MARKET':
      return '/market';
    case 'SETUP':
      return '/crops';
  }
}

function IrrigationCard({ data }: { data: Dashboard }) {
  const { irrigation } = data;

  if (!irrigation.available) {
    return (
      <Card>
        <SectionHeading icon={Droplets} title="Water" />
        <p className="text-sm text-slate-600">
          {irrigation.warning ?? 'Irrigation guidance is unavailable right now.'}
        </p>
      </Card>
    );
  }

  const urgent = irrigation.shouldIrrigate;
  const pct = Math.min(100, irrigation.depletionPercent ?? 0);

  return (
    <Link href="/weather">
      <Card className={cn('h-full transition hover:border-brand-300', urgent && 'border-orange-300 bg-orange-50')}>
        <SectionHeading icon={Droplets} title="Water" />

        <p className={cn('font-bold', urgent ? 'text-orange-900' : 'text-slate-800')}>
          {irrigation.headline}
        </p>
        <p className="mt-1 line-clamp-3 text-sm text-slate-600">{irrigation.reason}</p>

        {/* Soil moisture depletion bar — how much of the crop's comfortable
            water range has been used up. */}
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-xs font-medium text-slate-600">
            <span>Soil water used</span>
            <span className="tabular-nums">{pct}%</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-soil-200">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                pct >= 100 ? 'bg-red-500' : pct >= 75 ? 'bg-orange-500' : 'bg-brand-500',
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {irrigation.depthMm ? (
          <p className="mt-2 text-sm font-semibold text-orange-900">
            Apply about {irrigation.depthMm} mm
          </p>
        ) : null}
      </Card>
    </Link>
  );
}

function WeatherCard({ data }: { data: Dashboard }) {
  const { weather } = data;

  if (!weather.available || !weather.upcoming?.length) {
    return (
      <Card>
        <SectionHeading icon={CloudSun} title="Weather" />
        <p className="text-sm text-slate-600">
          {weather.warning ?? 'Weather data is unavailable right now.'}
        </p>
      </Card>
    );
  }

  const today = weather.today;

  return (
    <Link href="/weather">
      <Card className="h-full transition hover:border-brand-300">
        <SectionHeading icon={CloudSun} title="Weather" />

        {today ? (
          <div className="mb-3 flex items-center gap-3">
            <Thermometer className="h-8 w-8 text-brand-600" aria-hidden />
            <div>
              <p className="text-2xl font-bold tabular-nums text-slate-900">
                {Math.round(today.tempMaxC)}°
                <span className="ml-1 text-base font-semibold text-slate-500">
                  / {Math.round(today.tempMinC)}°
                </span>
              </p>
              <p className="text-xs text-slate-500">
                {today.rainMm > 0
                  ? `${today.rainMm.toFixed(0)} mm rain expected`
                  : today.rainProbability !== null
                    ? `${today.rainProbability}% chance of rain`
                    : 'No rain expected'}
              </p>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-5 gap-1">
          {weather.upcoming.slice(0, 5).map((day) => {
            const Icon = WEATHER_ICONS[weatherIcon(day.description)];
            return (
              <div key={day.date} className="flex flex-col items-center gap-1 rounded-lg py-1.5">
                <span className="text-[10px] font-semibold text-slate-500">{formatDay(day.date)}</span>
                <Icon className="h-5 w-5 text-brand-600" aria-hidden />
                <span className="text-xs font-bold tabular-nums text-slate-800">
                  {Math.round(day.tempMaxC)}°
                </span>
                {day.rainMm > 0 ? (
                  <span className="text-[10px] font-medium tabular-nums text-blue-600">
                    {day.rainMm.toFixed(0)}mm
                  </span>
                ) : (
                  <span className="text-[10px] text-transparent">-</span>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </Link>
  );
}

function PriceCard({ trend }: { trend: Dashboard['market']['trends'][number] }) {
  const TrendIcon =
    trend.direction === 'RISING' ? TrendingUp : trend.direction === 'FALLING' ? TrendingDown : Minus;

  const tone =
    trend.direction === 'RISING'
      ? 'text-emerald-700'
      : trend.direction === 'FALLING'
        ? 'text-red-700'
        : 'text-slate-500';

  const signalTone =
    trend.signal === 'SELL' ? 'success' : trend.signal === 'HOLD' ? 'warn' : 'neutral';

  return (
    <Link href="/market">
      <Card className="h-full transition hover:border-brand-300">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-bold text-slate-800">{trend.commodity}</p>
            <p className="text-xs text-slate-500">{cropLabel(trend.cropName)}</p>
          </div>
          <Badge tone={signalTone as 'success' | 'warn' | 'neutral'}>{trend.signal}</Badge>
        </div>

        <div className="mt-2 flex items-end gap-2">
          <p className="text-xl font-bold tabular-nums text-slate-900">
            {trend.currentPrice !== null ? formatRupees(trend.currentPrice) : '—'}
          </p>
          {trend.change7DayPercent !== null ? (
            <p className={cn('flex items-center gap-0.5 pb-1 text-sm font-semibold', tone)}>
              <TrendIcon className="h-4 w-4" aria-hidden />
              {Math.abs(trend.change7DayPercent)}%
            </p>
          ) : null}
        </div>
        <p className="text-xs text-slate-500">{trend.unit}</p>
        <p className="mt-1.5 text-sm text-slate-600">{trend.headline}</p>
      </Card>
    </Link>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
