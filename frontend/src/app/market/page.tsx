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
import type { PriceTrend } from '@/lib/types';
import {
  Card,
  ErrorState,
  EmptyState,
  Notice,
  SkeletonCard,
  Badge,
  Stat,
} from '@/components/ui';
import { cn, formatRupees, cropLabel, formatDay } from '@/lib/utils';
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
  const [selectedMarket, setSelectedMarket] = useState<string>('');
  const [availableMarkets, setAvailableMarkets] = useState<string[]>([]);

  const load = useCallback(async (marketVal?: string) => {
    if (!currentFarm) return;
    setError(null);
    setLoading(true);

    try {
      const result = await api.market.farmTrends(currentFarm.id, marketVal || undefined);
      setTrends(result.trends);
      setMessage(result.message);

      if (!marketVal) {
        const uniqueMarkets = Array.from(new Set(result.trends.flatMap((t) => t.markets)));
        setAvailableMarkets(uniqueMarkets);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load market prices.');
    } finally {
      setLoading(false);
    }
  }, [currentFarm]);

  useEffect(() => {
    void load(selectedMarket);
  }, [load, selectedMarket]);

  if (!currentFarm) return null;

  if (error && trends.length === 0) {
    return <ErrorState message={error} onRetry={() => void load(selectedMarket)} />;
  }

  return (
    <div className="space-y-5 animate-fade-up">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{t('prices.title')}</h1>
          <p className="text-sm text-slate-600">
            {t('prices.subtitle')}
          </p>
        </div>

        {availableMarkets.length > 0 ? (
          <div className="flex items-center gap-2">
            <label htmlFor="market-select" className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              {t('prices.selectMandi')}:
            </label>
            <select
              id="market-select"
              value={selectedMarket}
              onChange={(e) => setSelectedMarket(e.target.value)}
              className="rounded-xl border border-soil-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none shadow-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-all cursor-pointer"
            >
              <option value="">{t('prices.allMandis')}</option>
              {availableMarkets.map((mkt) => (
                <option key={mkt} value={mkt}>
                  {mkt}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      {loading ? (
        <>
          <SkeletonCard />
          <SkeletonCard />
        </>
      ) : trends.length === 0 ? (
        <EmptyState
          icon={IndianRupee}
          title={t('prices.emptyPrices')}
          message="Market prices"
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
          <p className="text-xs text-slate-500">{trend.unit}</p>
        </div>
      </div>

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
                <linearGradient id={`grad-${trend.commodity}`} x1="0" y1="0" x2="0" y2="1">
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
                fill={`url(#grad-${trend.commodity})`}
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
