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
  Volume2,
  Square,
  Users,
} from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { READ_ALOUD_EVENT } from '@/components/voice-assistant';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api';
import { readCache, writeCache, describeAge } from '@/lib/offline';
import { useVoice, buildSpokenBriefing } from '@/lib/voice';
import { useTranslation } from '@/lib/language-context';
import { LANGUAGES } from '@/lib/translations';
import type { NearbyOutbreaks } from '@/lib/types';
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

function getCropThumbnail(cropName: string): string {
  const name = cropName.toLowerCase();
  if (['rice', 'wheat', 'maize', 'cotton', 'tomato'].includes(name)) {
    return `/images/crops/${name}.png`;
  }
  return '/images/crops/default_crop.png';
}

function DashboardContent() {
  const { currentFarm } = useAuth();
  const { t, tNarrative, language } = useTranslation();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<{ message: string; offline: boolean } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  /** Set when the view is being served from cache rather than the network. */
  const [cacheAge, setCacheAge] = useState<string | null>(null);
  const [nearby, setNearby] = useState<NearbyOutbreaks | null>(null);
  /** Set when read-aloud had to fall back to another language's voice. */
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);

  const voice = useVoice();

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!currentFarm) return;
      setError(null);
      const cacheKey = `dashboard:${currentFarm.id}`;

      try {
        const fresh = await api.dashboard.get(currentFarm.id, signal);
        setData(fresh);
        setCacheAge(null);
        writeCache(cacheKey, fresh);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;

        // Offline or server unreachable — fall back to the last good copy so
        // the farmer still sees today's guidance rather than an error page.
        const cached = readCache<Dashboard>(cacheKey);
        if (cached) {
          setData(cached.data);
          setCacheAge(describeAge(cached.ageMs));
          return;
        }

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

  // Community outbreak signal — supplementary, so failures stay silent.
  useEffect(() => {
    if (!currentFarm) return;
    api.health
      .nearby(currentFarm.id)
      .then(setNearby)
      .catch(() => setNearby(null));
  }, [currentFarm]);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  // "सुनाओ" spoken into the voice assistant narrates this page.
  useEffect(() => {
    const handler = () => readAloud();
    window.addEventListener(READ_ALOUD_EVENT, handler);
    return () => window.removeEventListener(READ_ALOUD_EVENT, handler);
  });

  function readAloud() {
    if (!data) return;
    if (voice.speaking) {
      voice.stop();
      return;
    }

    // The briefing is composed in whichever language the farmer is reading, so
    // switching the interface to Punjabi switches the narration too.
    const briefing = buildSpokenBriefing(
      {
        farmName: data.farm.name,
        actions: data.actions,
        irrigation: data.irrigation,
        weather: data.weather,
      },
      t,
      tNarrative,
    );

    // `speak` falls back on its own when the device has no voice for this
    // language; surfacing that is honest rather than silently reading the
    // wrong phonetics and leaving the farmer wondering what went wrong.
    const spoken = voice.resolve(language);
    setVoiceNotice(
      spoken.fellBack
        ? t('voice.noVoiceInstalled', { language: LANGUAGES[language].nativeLabel })
        : null,
    );

    voice.speak(briefing, language);
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
        <div className="flex shrink-0 items-center gap-1">
          {voice.supported ? (
            <button
              type="button"
              onClick={readAloud}
              aria-label={voice.speaking ? t('voice.stopReading') : t('voice.readAloud')}
              className={cn('btn-ghost px-2', voice.speaking && 'text-brand-700')}
            >
              {voice.speaking ? (
                <Square className="h-5 w-5 fill-current" aria-hidden />
              ) : (
                <Volume2 className="h-5 w-5" aria-hidden />
              )}
            </button>
          ) : null}
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            aria-label={t('common.refresh')}
            className="btn-ghost px-2"
          >
            <RefreshCw className={cn('h-5 w-5', refreshing && 'animate-spin')} aria-hidden />
          </button>
        </div>
      </div>

      {voiceNotice ? <Notice tone="warn">{voiceNotice}</Notice> : null}

      {cacheAge ? (
        <Notice tone="warn">
          Showing saved information from {cacheAge}. It will update when you are back online.
        </Notice>
      ) : null}
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

      {/* ── Community outbreak signal ── */}
      {nearby && nearby.reports.length > 0 ? (
        <section>
          <SectionHeading icon={Users} title="Reported near you" />
          <Card className="border-amber-200 bg-amber-50">
            <p className="text-sm text-amber-900">
              Farmers within {nearby.radiusKm} km have reported these in the last three weeks.
              Worth checking your own crop.
            </p>
            <div className="mt-2.5 space-y-1.5">
              {nearby.reports.slice(0, 3).map((report) => (
                <div
                  key={`${report.name}-${report.crop}`}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="min-w-0 truncate text-sm font-semibold text-amber-900">
                    {report.name}
                    <span className="font-normal"> on {cropLabel(report.crop)}</span>
                  </span>
                  <Badge tone="warn" className="shrink-0">
                    {report.count} farm{report.count === 1 ? '' : 's'}
                  </Badge>
                </div>
              ))}
            </div>
            <Link href="/health" className="btn-secondary mt-3 w-full sm:w-auto">
              Check my crop
            </Link>
          </Card>
        </section>
      ) : null}

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
            {data.crops.map((crop) => {
              const imageUrl = getCropThumbnail(crop.cropName);
              return (
                <Card key={crop.id} className="flex items-center justify-between gap-4 p-4 hover:shadow-md transition-shadow duration-300">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="relative w-12 h-12 shrink-0 rounded-xl overflow-hidden shadow-inner border border-soil-100 bg-soil-50">
                      <img 
                        src={imageUrl} 
                        alt={crop.cropName} 
                        className="w-full h-full object-cover" 
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-extrabold text-slate-800 text-sm">{cropLabel(crop.cropName)}</p>
                      <p className="text-xs text-slate-500 font-semibold mt-0.5">
                        {humanise(crop.growthStage) || humanise(crop.status)}
                        {crop.daysToHarvest !== null && crop.daysToHarvest > 0
                          ? ` · ${crop.daysToHarvest} days to harvest`
                          : ''}
                      </p>
                    </div>
                  </div>
                  {!crop.isRecognised ? (
                    <Badge tone="warn" className="shrink-0 text-[10px]">
                      Limited data
                    </Badge>
                  ) : null}
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Planning shortcuts ── */}
      <section>
        <SectionHeading title="Plan ahead" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Link href="/recommendations">
            <Card className="flex h-full items-start gap-3 transition hover:border-brand-300">
              <Sprout className="mt-0.5 h-6 w-6 shrink-0 text-brand-600" aria-hidden />
              <div className="min-w-0">
                <p className="font-bold text-slate-800">What to plant</p>
                <p className="text-sm text-slate-600">
                  Crops ranked for your soil, season and local climate.
                </p>
              </div>
              <ArrowRight className="mt-1 h-5 w-5 shrink-0 text-slate-400" aria-hidden />
            </Card>
          </Link>

          <Link href="/planning">
            <Card className="flex h-full items-start gap-3 transition hover:border-brand-300">
              <Droplets className="mt-0.5 h-6 w-6 shrink-0 text-brand-600" aria-hidden />
              <div className="min-w-0">
                <p className="font-bold text-slate-800">Plan &amp; predict</p>
                <p className="text-sm text-slate-600">
                  Fertiliser to buy, when to apply it, and expected yield.
                </p>
              </div>
              <ArrowRight className="mt-1 h-5 w-5 shrink-0 text-slate-400" aria-hidden />
            </Card>
          </Link>
        </div>
      </section>

      <p className="pb-2 text-center text-xs text-slate-400">
        {cacheAge ? `Saved ${cacheAge}` : `Updated ${timeAgo(data.generatedAt)}`} · Weather from
        Open-Meteo
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
      <Card 
        className={cn(
          'h-full transition-all duration-300 hover:shadow-md hover:border-brand-300 relative overflow-hidden', 
          urgent 
            ? 'border-red-200 bg-gradient-to-br from-orange-50 via-red-50/40 to-orange-50/30 shadow-sm shadow-red-50' 
            : 'border-blue-100 bg-gradient-to-br from-blue-50/40 via-sky-50/20 to-white shadow-sm shadow-blue-50'
        )}
      >
        {/* Subtle droplet shimmer overlay for urgent state */}
        {urgent && (
          <div className="absolute right-2 top-2 text-red-500/10 animate-bounce">
            <Droplets className="h-20 w-20" />
          </div>
        )}
        
        <SectionHeading icon={Droplets} title="Water" />

        <p className={cn('font-extrabold text-base', urgent ? 'text-red-950' : 'text-slate-800')}>
          {irrigation.headline}
        </p>
        <p className="mt-1 line-clamp-3 text-sm text-slate-600 leading-relaxed">{irrigation.reason}</p>

        {/* Soil moisture depletion bar — how much of the crop's comfortable
            water range has been used up. */}
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between text-xs font-semibold text-slate-600">
            <span>Soil water used</span>
            <span className="tabular-nums font-bold">{pct}%</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-soil-200/70 p-0.5 border border-soil-300/30">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                pct >= 100 ? 'bg-gradient-to-r from-red-500 to-rose-600' : pct >= 75 ? 'bg-gradient-to-r from-orange-500 to-amber-600' : 'bg-gradient-to-r from-blue-500 to-sky-600',
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {irrigation.depthMm ? (
          <div className="mt-3 inline-flex items-center gap-1 bg-orange-100/70 border border-orange-200/50 rounded-lg px-2.5 py-1 text-xs font-bold text-orange-950">
            <Droplets className="h-3.5 w-3.5 text-orange-700" />
            Apply about {irrigation.depthMm} mm
          </div>
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
  const todayUpcoming = weather.upcoming?.[0];
  const iconName = todayUpcoming ? weatherIcon(todayUpcoming.description || '') : 'cloud';
  
  const gradientClass = {
    sun: 'border-orange-200 bg-gradient-to-br from-amber-50/60 via-orange-50/35 to-white shadow-sm shadow-orange-50',
    cloud: 'border-slate-200 bg-gradient-to-br from-slate-50/80 via-slate-100/30 to-white shadow-sm shadow-slate-50',
    rain: 'border-blue-200 bg-gradient-to-br from-blue-50/60 via-sky-50/30 to-white shadow-sm shadow-blue-50',
    storm: 'border-purple-200 bg-gradient-to-br from-purple-50/40 via-slate-50/30 to-white shadow-sm shadow-purple-50',
    fog: 'border-zinc-200 bg-gradient-to-br from-zinc-100/40 via-slate-50/20 to-white shadow-sm shadow-zinc-50',
    snow: 'border-sky-200 bg-gradient-to-br from-sky-50/40 via-blue-50/20 to-white shadow-sm shadow-sky-50',
  }[iconName] || 'border-slate-200 bg-gradient-to-br from-slate-50/80 to-white shadow-sm shadow-slate-50';

  return (
    <Link href="/weather">
      <Card className={cn('h-full transition-all duration-300 hover:shadow-md hover:border-brand-300', gradientClass)}>
        <SectionHeading icon={CloudSun} title="Weather" />

        {today ? (
          <div className="mb-3 flex items-center gap-3">
            <Thermometer className="h-8 w-8 text-brand-600 animate-pulse" aria-hidden />
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

        <div className="grid grid-cols-5 gap-1.5 pt-2">
          {weather.upcoming.slice(0, 5).map((day) => {
            const Icon = WEATHER_ICONS[weatherIcon(day.description)];
            return (
              <div key={day.date} className="flex flex-col items-center gap-1 rounded-xl py-2 bg-white/40 border border-white/20 shadow-sm backdrop-blur-[1px]">
                <span className="text-[10px] font-bold text-slate-500">{formatDay(day.date)}</span>
                <Icon className="h-5 w-5 text-brand-600" aria-hidden />
                <span className="text-xs font-bold tabular-nums text-slate-800">
                  {Math.round(day.tempMaxC)}°
                </span>
                {day.rainMm > 0 ? (
                  <span className="text-[10px] font-semibold tabular-nums text-blue-600">
                    {day.rainMm.toFixed(0)}mm
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-400 font-medium">-</span>
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
