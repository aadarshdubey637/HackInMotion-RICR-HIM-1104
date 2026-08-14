'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Info,
  IndianRupee,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import { AppShell } from '@/components/app-shell';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api';
import type { PriceTrend, MarketLocation, MarketScope } from '@/lib/types';
import {
  Card,
  ErrorState,
  EmptyState,
  Notice,
  SkeletonCard,
  Badge,
  Stat,
} from '@/components/ui';
import { cn, formatRupees, formatDay } from '@/lib/utils';
import { useTranslation } from '@/lib/language-context';

export default function MarketPage() {
  return (
    <AppShell>
      <MarketContent />
    </AppShell>
  );
}

function MarketContent() {
  const { currentFarm } = useAuth();
  const { t } = useTranslation();
  const [trends, setTrends] = useState<PriceTrend[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Location hierarchy
  const [locations, setLocations] = useState<MarketLocation[]>([]);
  const [selectedState, setSelectedState] = useState('');
  const [selectedDistrict, setSelectedDistrict] = useState('');
  const [selectedMarket, setSelectedMarket] = useState('');

  // Derived options
  const states = Array.from(new Set(locations.map((l) => l.state))).sort();
  const districts = Array.from(
    new Set(
      locations
        .filter((l) => !selectedState || l.state === selectedState)
        .map((l) => l.district),
    ),
  ).sort();
  const markets = Array.from(
    new Set(
      locations
        .filter(
          (l) =>
            (!selectedState || l.state === selectedState) &&
            (!selectedDistrict || l.district === selectedDistrict),
        )
        .map((l) => l.marketName),
    ),
  ).sort();

  // Load location options once
  useEffect(() => {
    api.market.getLocations().then((res) => setLocations(res.locations)).catch(() => {});
  }, []);

  // Reset child selections when parent changes
  const handleStateChange = (val: string) => {
    setSelectedState(val);
    setSelectedDistrict('');
    setSelectedMarket('');
  };
  const handleDistrictChange = (val: string) => {
    setSelectedDistrict(val);
    setSelectedMarket('');
  };

  const load = useCallback(
    async (scope: MarketScope) => {
      if (!currentFarm) return;
      setError(null);
      setLoading(true);
      try {
        const result = await api.market.farmTrends(currentFarm.id, scope);
        setTrends(result.trends);
        setMessage(result.message);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not load market prices.');
      } finally {
        setLoading(false);
      }
    },
    [currentFarm],
  );

  // Every level of the filter narrows the query, not just the mandi — picking a
  // state alone aggregates that state's mandis.
  useEffect(() => {
    void load({
      state: selectedState || undefined,
      district: selectedDistrict || undefined,
      market: selectedMarket || undefined,
    });
  }, [load, selectedState, selectedDistrict, selectedMarket]);

  if (!currentFarm) return null;

  const currentScope: MarketScope = {
    state: selectedState || undefined,
    district: selectedDistrict || undefined,
    market: selectedMarket || undefined,
  };

  if (error && trends.length === 0) {
    return <ErrorState message={error} onRetry={() => void load(currentScope)} />;
  }

  const selectClass =
    'w-full rounded-xl border border-soil-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 outline-none shadow-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-200 transition-all cursor-pointer';

  return (
    <div className="space-y-5 animate-fade-up">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-900">{t('prices.title')}</h1>
        <p className="text-sm text-slate-600">{t('prices.subtitle')}</p>
      </div>

      {/* Location Filters */}
      {locations.length > 0 && (
        <div className="rounded-2xl border border-soil-200 bg-white p-4 shadow-sm">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            {t('prices.selectMandi')}
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {/* State */}
            <div className="flex flex-col gap-1">
              <label htmlFor="state-select" className="text-xs font-semibold text-slate-600">
                {t('prices.selectState')}
              </label>
              <select
                id="state-select"
                value={selectedState}
                onChange={(e) => handleStateChange(e.target.value)}
                className={selectClass}
              >
                <option value="">{t('prices.allStates')}</option>
                {states.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            {/* District */}
            <div className="flex flex-col gap-1">
              <label htmlFor="district-select" className="text-xs font-semibold text-slate-600">
                {t('prices.selectDistrict')}
              </label>
              <select
                id="district-select"
                value={selectedDistrict}
                onChange={(e) => handleDistrictChange(e.target.value)}
                className={selectClass}
                disabled={!selectedState}
              >
                <option value="">{t('prices.allDistricts')}</option>
                {districts.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            {/* Mandi */}
            <div className="flex flex-col gap-1">
              <label htmlFor="mandi-select" className="text-xs font-semibold text-slate-600">
                {t('prices.mandi')}
              </label>
              <select
                id="mandi-select"
                value={selectedMarket}
                onChange={(e) => setSelectedMarket(e.target.value)}
                className={selectClass}
                disabled={!selectedDistrict}
              >
                <option value="">{t('prices.allMandis')}</option>
                {markets.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Active filter badge */}
          {(selectedState || selectedDistrict || selectedMarket) && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {selectedState && (
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
                  {selectedState}
                </span>
              )}
              {selectedDistrict && (
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
                  {selectedDistrict}
                </span>
              )}
              {selectedMarket && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                  🏪 {selectedMarket}
                </span>
              )}
              <button
                onClick={() => {
                  setSelectedState('');
                  setSelectedDistrict('');
                  setSelectedMarket('');
                }}
                className="text-xs text-slate-400 underline hover:text-slate-600 transition-colors"
              >
                {t('common.cancel')}
              </button>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <>
          <SkeletonCard />
          <SkeletonCard />
        </>
      ) : trends.length === 0 ? (
        <EmptyState
          icon={IndianRupee}
          title={t('prices.emptyPrices')}
          message={message ?? 'Add a crop to your farm to see mandi prices for it.'}
        />
      ) : (
        <div className="space-y-5">
          {trends.map((trend) => (
            <TrendCard key={trend.commodity} trend={trend} />
          ))}
        </div>
      )}

      <Card className="text-xs text-slate-500">
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <p>
            Prices come from AGMARKNET (Government of India) via the data.gov.in open data API,
            aggregated across nearby mandis. Guidance compares today&apos;s price against the recent
            range — it is not a forecast. Always check your local mandi before selling.
          </p>
        </div>
      </Card>
    </div>
  );
}


function TrendCard({ trend }: { trend: PriceTrend }) {
  const { t, tCrop, tNarrative } = useTranslation();
  const { statistics: stats, advice } = trend;

  const TrendIcon =
    trend.direction === 'RISING' ? TrendingUp : trend.direction === 'FALLING' ? TrendingDown : Minus;

  const directionTone =
    trend.direction === 'RISING'
      ? 'text-emerald-700'
      : trend.direction === 'FALLING'
        ? 'text-red-700'
        : 'text-slate-500';

  const signalStyle = {
    SELL: { bg: 'bg-emerald-50', border: 'border-emerald-300', text: 'text-emerald-900' },
    HOLD: { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-900' },
    WATCH: { bg: 'bg-slate-50', border: 'border-slate-300', text: 'text-slate-700' },
  }[advice.signal];

  // Chart shows the last 30 points — enough to read a trend on a phone.
  const chartData = trend.series.slice(-30).map((point) => ({
    date: formatDay(point.date),
    price: point.modalPrice,
  }));

  // Commodity names carry spaces and brackets ("Bengal Gram(Gram)"), which make
  // an invalid SVG id — url(#…) then fails to resolve and the area loses its fill.
  const gradientId = `grad-${trend.commodity.replace(/[^a-zA-Z0-9]/g, '-')}`;

  return (
    <Card className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold text-slate-900">{tCrop(trend.commodity)}</h2>
            {trend.cropName ? (
              <span className="text-sm text-slate-500">({tCrop(trend.cropName)})</span>
            ) : null}
          </div>

          <div className="mt-1 flex items-end gap-2">
            <p className="text-2xl font-bold tabular-nums text-slate-900">
              {trend.current ? formatRupees(trend.current.price) : '—'}
            </p>
            {stats.change7DayPercent !== null ? (
              <p className={cn('flex items-center gap-0.5 pb-1 font-semibold', directionTone)}>
                <TrendIcon className="h-4 w-4" aria-hidden />
                {stats.change7DayPercent > 0 ? '+' : ''}
                {stats.change7DayPercent}%
                <span className="ml-0.5 text-xs font-normal text-slate-500">7d</span>
              </p>
            ) : null}
          </div>
          <p className="text-xs text-slate-500">
            {trend.unit}
            {trend.scope ? ` · ${trend.scope.label}` : ''}
          </p>
        </div>
      </div>

      {/* The chosen mandi had too little history, so this card covers a wider area. */}
      {trend.scope?.widened ? (
        <Notice tone="info">
          Not enough history for the mandi you picked, so these figures cover {trend.scope.label}.
        </Notice>
      ) : null}

      {/* Advice */}
      <div className={cn('rounded-xl border-l-4 p-3', signalStyle.bg, signalStyle.border)}>
        <div className="flex items-center gap-2">
          {advice.signal === 'SELL' ? (
            <ArrowUpRight className={cn('h-5 w-5', signalStyle.text)} aria-hidden />
          ) : advice.signal === 'HOLD' ? (
            <ArrowDownRight className={cn('h-5 w-5', signalStyle.text)} aria-hidden />
          ) : (
            <Minus className={cn('h-5 w-5', signalStyle.text)} aria-hidden />
          )}
          <p className={cn('font-bold', signalStyle.text)}>
            {advice.signal === 'SELL'
              ? t('prices.adviceSell')
              : advice.signal === 'HOLD'
                ? t('prices.adviceHold')
                : t('prices.adviceNeutral')}
          </p>
        </div>
        <p className="mt-1 text-sm text-slate-700">{tNarrative(advice.reasoning)}</p>
      </div>

      {/* Chart */}
      {chartData.length > 2 ? (
        <div className="h-44 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#16a34a" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="#16a34a" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e3d9c9" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: '#64748b' }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={28}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#64748b' }}
                axisLine={false}
                tickLine={false}
                width={58}
                domain={['dataMin - 100', 'dataMax + 100']}
                tickFormatter={(v: number) => `₹${Math.round(v)}`}
              />
              <Tooltip
                contentStyle={{ borderRadius: 12, border: '1px solid #e3d9c9', fontSize: 13 }}
                formatter={(value: number) => [formatRupees(value), 'Price']}
              />
              {stats.average30Day !== null ? (
                <ReferenceLine
                  y={stats.average30Day}
                  stroke="#94a3b8"
                  strokeDasharray="4 4"
                  label={{
                    value: '30d avg',
                    position: 'insideTopLeft',
                    fontSize: 10,
                    fill: '#64748b',
                  }}
                />
              ) : null}
              <Area
                type="monotone"
                dataKey="price"
                stroke="#16a34a"
                strokeWidth={2.5}
                fill={`url(#${gradientId})`}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <Notice tone="info">Not enough price history yet to draw a trend.</Notice>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 border-t border-soil-200 pt-3 sm:grid-cols-4">
        <Stat
          label="30-day high"
          value={stats.high30Day !== null ? formatRupees(stats.high30Day) : '—'}
        />
        <Stat
          label="30-day low"
          value={stats.low30Day !== null ? formatRupees(stats.low30Day) : '—'}
        />
        <Stat
          label="30-day avg"
          value={stats.average30Day !== null ? formatRupees(stats.average30Day) : '—'}
        />
        <Stat
          label="Volatility"
          value={stats.volatilityPercent !== null ? `${stats.volatilityPercent}%` : '—'}
          hint={
            stats.volatilityPercent !== null && stats.volatilityPercent > 12 ? 'Swinging a lot' : undefined
          }
        />
      </div>

      {/* Provenance — be honest about seeded data */}
      <div className="flex flex-wrap items-center gap-2 border-t border-soil-200 pt-3">
        <Badge tone={trend.isSeeded ? 'warn' : 'success'}>
          {trend.isSeeded ? 'Includes baseline data' : 'Live AGMARKNET data'}
        </Badge>
        <span className="text-xs text-slate-500">{trend.dataPoints} days</span>
        {trend.markets.length > 0 ? (
          <span className="text-xs text-slate-500">· {trend.markets.slice(0, 3).join(', ')}</span>
        ) : null}
      </div>
    </Card>
  );
}
