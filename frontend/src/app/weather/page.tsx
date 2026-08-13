'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Droplets,
  CloudSun,
  AlertTriangle,
  Info,
  Check,
  Beaker,
  CloudRain,
  Wind,
} from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid,
} from 'recharts';
import { AppShell } from '@/components/app-shell';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api';
import type { IrrigationGuidance, Crop } from '@/lib/types';
import {
  Card,
  SectionHeading,
  ErrorState,
  Notice,
  SkeletonCard,
  Stat,
  Badge,
  Spinner,
  severityStyles,
} from '@/components/ui';
import { cn, formatDay, cropLabel, humanise } from '@/lib/utils';

export default function WeatherPage() {
  return (
    <AppShell>
      <WeatherContent />
    </AppShell>
  );
}

function WeatherContent() {
  const { currentFarm } = useAuth();
  const [guidance, setGuidance] = useState<IrrigationGuidance | null>(null);
  const [crops, setCrops] = useState<Crop[]>([]);
  const [selectedCropId, setSelectedCropId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);
  const [logged, setLogged] = useState(false);

  const load = useCallback(
    async (cropId?: string) => {
      if (!currentFarm) return;
      setError(null);
      setGuidance(null);

      try {
        const result = await api.weather.irrigation(currentFarm.id, cropId);
        setGuidance(result);
        if (result.crop.id) setSelectedCropId(result.crop.id);
      } catch (err) {
        setError(
          err instanceof ApiError ? err.message : 'Could not load irrigation guidance.',
        );
      }
    },
    [currentFarm],
  );

  useEffect(() => {
    if (!currentFarm) return;
    api.farms
      .crops(currentFarm.id)
      .then(({ crops: list }) => setCrops(list))
      .catch(() => setCrops([]));
    void load();
  }, [currentFarm, load]);

  async function logIrrigation() {
    if (!currentFarm || !guidance?.crop.id || !guidance.recommendation) return;

    setLogging(true);
    try {
      await api.weather.logIrrigation(currentFarm.id, {
        cropId: guidance.crop.id,
        waterAmountMm: guidance.recommendation.depthMm,
        irrigationMethod: 'MANUAL',
      });
      setLogged(true);
      // Re-run the balance so it reflects the water just applied.
      await load(selectedCropId || undefined);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your irrigation record.');
    } finally {
      setLogging(false);
    }
  }

  if (!currentFarm) return null;

  if (error && !guidance) {
    return <ErrorState message={error} onRetry={() => void load(selectedCropId || undefined)} />;
  }

  if (!guidance) {
    return (
      <div className="space-y-4">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  const wb = guidance.waterBalance;
  const urgencyStyle =
    guidance.urgency === 'OVERDUE'
      ? severityStyles.CRITICAL
      : guidance.urgency === 'TODAY'
        ? severityStyles.HIGH
        : guidance.urgency === 'SOON'
          ? severityStyles.MEDIUM
          : severityStyles.INFO;

  // Chart data: forecast days only, with depletion against the trigger line.
  const chartData = guidance.forecast
    .filter((d) => !d.isPast)
    .map((d) => ({
      day: formatDay(d.date),
      depletion: d.depletionMm,
      rain: d.rawRainMm,
      water: d.etcMm,
      tempMax: d.tempMaxC,
    }));

  return (
    <div className="space-y-5 animate-fade-up">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Water &amp; weather</h1>
        <p className="text-sm text-slate-600">
          Irrigation guidance from a soil water balance for your crop and soil.
        </p>
      </div>

      {guidance.stale && guidance.warning ? <Notice tone="warn">{guidance.warning}</Notice> : null}
      {error ? <Notice tone="warn">{error}</Notice> : null}

      {/* ── Crop selector ── */}
      {crops.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {crops.map((crop) => (
            <button
              key={crop.id}
              type="button"
              onClick={() => {
                setSelectedCropId(crop.id);
                setLogged(false);
                void load(crop.id);
              }}
              className={cn(
                'rounded-full border px-3.5 py-1.5 text-sm font-semibold transition',
                selectedCropId === crop.id
                  ? 'border-brand-600 bg-brand-600 text-white'
                  : 'border-soil-300 bg-white text-slate-700',
              )}
            >
              {cropLabel(crop.cropName)}
            </button>
          ))}
        </div>
      ) : null}

      {/* ── The recommendation ── */}
      <Card className={cn('border-l-4', urgencyStyle.bg, urgencyStyle.border)}>
        <div className="flex items-start gap-3">
          <Droplets className={cn('mt-0.5 h-7 w-7 shrink-0', urgencyStyle.text)} aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 className={cn('text-lg font-bold', urgencyStyle.text)}>{guidance.headline}</h2>
            <p className="mt-1 text-sm text-slate-700">{guidance.reason}</p>

            {guidance.recommendation ? (
              <div className="mt-3 grid grid-cols-2 gap-3 rounded-xl bg-white/70 p-3 sm:grid-cols-3">
                <Stat label="Apply" value={guidance.recommendation.depthMm} unit="mm" />
                <Stat
                  label="Total water"
                  value={guidance.recommendation.totalCubicMetres.toLocaleString('en-IN')}
                  unit="m³"
                />
                <Stat
                  label="Confidence"
                  value={`${Math.round(guidance.confidence * 100)}%`}
                  hint={guidance.crop.isKnown ? undefined : 'Crop not in database'}
                />
              </div>
            ) : null}

            {guidance.recommendation && guidance.crop.id ? (
              logged ? (
                <div className="mt-3">
                  <Notice tone="success">
                    Irrigation recorded. The water balance has been updated.
                  </Notice>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={logIrrigation}
                  disabled={logging}
                  className="btn-primary mt-3 w-full sm:w-auto"
                >
                  {logging ? <Spinner className="h-5 w-5" /> : <Check className="h-5 w-5" />}
                  {logging ? 'Saving…' : 'I have irrigated'}
                </button>
              )
            ) : null}
          </div>
        </div>
      </Card>

      {/* ── Risk alerts ── */}
      {guidance.alerts.length > 0 ? (
        <section>
          <SectionHeading icon={AlertTriangle} title="Weather risks" />
          <div className="space-y-2">
            {guidance.alerts.map((alert, i) => {
              const style = severityStyles[alert.severity];
              return (
                <Card key={`${alert.type}-${i}`} className={cn('border-l-4', style.bg, style.border)}>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className={cn('font-bold', style.text)}>{alert.title}</h3>
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase text-white',
                        style.dot,
                      )}
                    >
                      {style.label}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-700">{alert.message}</p>
                  <p className={cn('mt-2 text-sm font-semibold', style.text)}>{alert.action}</p>
                </Card>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* ── Water balance chart ── */}
      <section>
        <SectionHeading icon={Beaker} title="Soil water over the next week" />
        <Card>
          <p className="mb-3 text-xs text-slate-500">
            The line shows how much water the soil has lost. When it crosses the dashed line, your
            crop starts to feel stress and needs irrigating. Bars show expected rain.
          </p>

          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: -22, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e3d9c9" vertical={false} />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                  unit="mm"
                  width={52}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    border: '1px solid #e3d9c9',
                    fontSize: 13,
                  }}
                  formatter={(value: number, name: string) => [
                    `${value} mm`,
                    name === 'depletion'
                      ? 'Soil water used'
                      : name === 'rain'
                        ? 'Rain'
                        : 'Crop water use',
                  ]}
                />
                <ReferenceLine
                  y={wb.readilyAvailableWaterMm}
                  stroke="#ea580c"
                  strokeDasharray="5 4"
                  label={{
                    value: 'Irrigate',
                    position: 'insideTopRight',
                    fontSize: 10,
                    fill: '#ea580c',
                  }}
                />
                <Bar dataKey="rain" fill="#93c5fd" radius={[4, 4, 0, 0]} maxBarSize={26} />
                <Area
                  type="monotone"
                  dataKey="depletion"
                  stroke="#16a34a"
                  strokeWidth={2.5}
                  fill="#16a34a"
                  fillOpacity={0.12}
                />
                <Line type="monotone" dataKey="water" stroke="#d97706" strokeWidth={1.5} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 border-t border-soil-200 pt-3 sm:grid-cols-4">
            <Stat
              label="Water used"
              value={wb.currentDepletionMm}
              unit="mm"
              tone={wb.depletionPercent >= 100 ? 'danger' : 'default'}
            />
            <Stat label="Irrigate at" value={wb.readilyAvailableWaterMm} unit="mm" />
            <Stat label="Soil can hold" value={wb.totalAvailableWaterMm} unit="mm" />
            <Stat label="Root depth" value={wb.rootDepthM} unit="m" />
          </div>
        </Card>
      </section>

      {/* ── Forecast detail ── */}
      <section>
        <SectionHeading icon={CloudSun} title="7-day forecast" />
        <Card className="divide-y divide-soil-200 p-0">
          {guidance.forecast
            .filter((d) => !d.isPast)
            .map((day) => (
              <div key={day.date} className="flex items-center gap-3 px-4 py-3">
                <span className="w-16 shrink-0 text-sm font-semibold text-slate-700">
                  {formatDay(day.date)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-slate-600">
                  {day.description}
                </span>
                {day.rawRainMm > 0 ? (
                  <span className="flex shrink-0 items-center gap-1 text-xs font-medium tabular-nums text-blue-600">
                    <CloudRain className="h-3.5 w-3.5" aria-hidden />
                    {day.rawRainMm.toFixed(0)}mm
                  </span>
                ) : null}
                <span className="shrink-0 text-sm font-bold tabular-nums text-slate-800">
                  {Math.round(day.tempMaxC)}°
                  <span className="ml-1 font-medium text-slate-400">
                    {Math.round(day.tempMinC)}°
                  </span>
                </span>
              </div>
            ))}
        </Card>
      </section>

      {/* ── How this was calculated ── */}
      <section>
        <SectionHeading icon={Info} title="How this was worked out" />
        <Card className="space-y-3 text-sm text-slate-600">
          <p>
            We track a running water budget for your soil. Each day the crop uses water
            (evaporation plus transpiration, scaled by growth stage) and rain puts some back. When
            the shortfall reaches the point where your crop starts to struggle, we tell you to
            irrigate.
          </p>

          <div className="flex flex-wrap gap-2">
            <Badge tone="neutral">Crop: {guidance.crop.label}</Badge>
            <Badge tone="neutral">Soil: {humanise(wb.soilType)}</Badge>
            <Badge tone="neutral">Crop coefficient: {wb.cropCoefficient}</Badge>
            <Badge tone={guidance.crop.isKnown ? 'success' : 'warn'}>
              {guidance.crop.isKnown ? 'Full crop data' : 'Generic crop data'}
            </Badge>
          </div>

          {guidance.assumptions.length > 0 ? (
            <div>
              <p className="mb-1 font-semibold text-slate-700">What we assumed:</p>
              <ul className="list-inside list-disc space-y-1">
                {guidance.assumptions.map((assumption, i) => (
                  <li key={i}>{assumption}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="border-t border-soil-200 pt-2 text-xs text-slate-500">
            Method: FAO-56 soil water balance (Allen et al., 1998). Weather and reference
            evapotranspiration from Open-Meteo.
          </p>
        </Card>
      </section>
    </div>
  );
}
