'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlaskConical,
  Scale,
  Package,
  CalendarCheck,
  Info,
  Check,
  Lightbulb,
  LineChart as LineChartIcon,
  CheckCircle2,
  ChevronDown,
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import { AppShell } from '@/components/app-shell';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api';
import type {
  CropPlan,
  FertilizerPlan,
  YieldPrediction,
  StressFactor,
  YieldHistoryEntry,
} from '@/lib/types';
import {
  Card,
  SectionHeading,
  ErrorState,
  EmptyState,
  Notice,
  SkeletonCard,
  Badge,
  Stat,
  Spinner,
} from '@/components/ui';
import { cn, formatRupees, formatDay } from '@/lib/utils';
import { useTranslation } from '@/lib/language-context';

export default function PlanningPage() {
  return (
    <AppShell>
      <PlanningContent />
    </AppShell>
  );
}

/**
 * The engine returns factor names in English. Map them to translation keys so
 * the labels follow the chosen language; the `reason` sentence beneath each one
 * is generated server-side and stays English for now.
 */
const FACTOR_KEYS: Record<string, string> = {
  Water: 'planning.factorWater',
  Heat: 'planning.factorHeat',
  'Crop health': 'planning.factorHealth',
  Management: 'planning.factorManagement',
};

function PlanningContent() {
  const { currentFarm } = useAuth();
  const { t, tCrop } = useTranslation();
  const [plans, setPlans] = useState<CropPlan[]>([]);
  const [history, setHistory] = useState<YieldHistoryEntry[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [harvested, setHarvested] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentFarm) return;
    setError(null);
    try {
      // History is a nice-to-have; a failure there must not blank the page.
      const [result, historyResult] = await Promise.all([
        api.planning.farm(currentFarm.id),
        api.planning.yieldHistory(currentFarm.id).catch(() => ({ predictions: [] })),
      ]);
      setPlans(result.crops);
      setHistory(historyResult.predictions);
      setMessage(result.message);
      if (result.crops.length > 0) setSelected((s) => s || result.crops[0].cropId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('planning.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [currentFarm, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!currentFarm) return null;
  if (error && plans.length === 0 && !loading) {
    return <ErrorState message={error} onRetry={() => void load()} />;
  }

  const active = plans.find((p) => p.cropId === selected) ?? plans[0];

  return (
    <div className="space-y-5 animate-fade-up">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{t('planning.title')}</h1>
        <p className="text-sm text-slate-600">{t('planning.subtitle')}</p>
      </div>

      {harvested ? <Notice tone="success">{harvested}</Notice> : null}

      {loading ? (
        <>
          <SkeletonCard />
          <SkeletonCard />
        </>
      ) : plans.length === 0 ? (
        <EmptyState
          icon={FlaskConical}
          title={t('planning.empty')}
          message={message ?? t('planning.emptyMessage')}
        />
      ) : (
        <>
          {message ? <Notice tone="warn">{message}</Notice> : null}

          {/* Crop selector */}
          {plans.length > 1 ? (
            <div className="flex flex-wrap gap-2">
              {plans.map((plan) => (
                <button
                  key={plan.cropId}
                  type="button"
                  onClick={() => setSelected(plan.cropId)}
                  className={cn(
                    'rounded-full border px-3.5 py-1.5 text-sm font-semibold transition',
                    selected === plan.cropId
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-soil-300 bg-white text-slate-700',
                  )}
                >
                  {tCrop(plan.cropName)}
                </button>
              ))}
            </div>
          ) : null}

          {active ? (
            <>
              <YieldSection
                prediction={active.yieldPrediction}
                farmId={currentFarm.id}
                cropId={active.cropId}
                onHarvestRecorded={(notice) => {
                  setHarvested(notice);
                  void load();
                }}
              />
              <YieldHistorySection
                history={history.filter((h) => h.cropId === active.cropId)}
              />
              <FertilizerSection plan={active.fertilizer} />
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

// ─────────────────────────── Yield ───────────────────────────

function YieldSection({
  prediction,
  farmId,
  cropId,
  onHarvestRecorded,
}: {
  prediction: YieldPrediction;
  farmId: string;
  cropId: string;
  onHarvestRecorded: (notice: string) => void;
}) {
  const { t } = useTranslation();
  const [showHarvestForm, setShowHarvestForm] = useState(false);
  const lossPercent = Math.round((1 - prediction.predictedKgHa / prediction.attainableKgHa) * 100);

  return (
    <section>
      <SectionHeading icon={Scale} title={t('planning.yieldTitle')} />
      <Card className="space-y-4">
        {/* Headline */}
        <div>
          <div className="flex flex-wrap items-end gap-2">
            <p className="text-3xl font-bold tabular-nums text-slate-900">
              {prediction.predictedTotalKg.toLocaleString('en-IN')}
              <span className="ml-1 text-base font-semibold text-slate-500">kg</span>
            </p>
            <Badge tone={prediction.confidence >= 0.6 ? 'success' : 'warn'}>
              {t('planning.confident', { percent: Math.round(prediction.confidence * 100) })}
            </Badge>
          </div>
          <p className="mt-0.5 text-sm text-slate-600">
            {t('planning.rangeLine', {
              low: prediction.rangeTotalKg.low.toLocaleString('en-IN'),
              high: prediction.rangeTotalKg.high.toLocaleString('en-IN'),
              hectares: prediction.areaHectares,
            })}
            {prediction.estimatedIncome
              ? ` · ${t('planning.grossIncome', {
                  amount: formatRupees(prediction.estimatedIncome),
                })}`
              : ''}
          </p>
        </div>

        {/* Attainable vs predicted */}
        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-600">
            <span>
              {t('planning.kgHaExpected', {
                value: prediction.predictedKgHa.toLocaleString('en-IN'),
              })}
            </span>
            <span>
              {t('planning.kgHaPossible', {
                value: prediction.attainableKgHa.toLocaleString('en-IN'),
              })}
            </span>
          </div>
          <div className="relative h-3 overflow-hidden rounded-full bg-soil-200">
            <div
              className={cn(
                'h-full rounded-full',
                lossPercent > 25 ? 'bg-orange-500' : lossPercent > 10 ? 'bg-amber-500' : 'bg-brand-500',
              )}
              style={{ width: `${(prediction.predictedKgHa / prediction.attainableKgHa) * 100}%` }}
            />
          </div>
          {lossPercent > 0 ? (
            <p className="mt-1 text-xs text-slate-500">
              {t('planning.belowPotential', { percent: lossPercent })}
            </p>
          ) : (
            <p className="mt-1 text-xs text-emerald-700">{t('planning.noStress')}</p>
          )}
        </div>

        {/* Season progress */}
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-soil-200">
            <div
              className="h-full rounded-full bg-slate-400"
              style={{ width: `${prediction.seasonProgress * 100}%` }}
            />
          </div>
          <span>
            {t('planning.seasonProgress', { percent: Math.round(prediction.seasonProgress * 100) })}
          </span>
        </div>

        {/* Stress factors */}
        <div className="border-t border-soil-200 pt-3">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
            {t('planning.factorsTitle')}
          </p>
          <div className="space-y-2">
            {prediction.factors.map((factor) => (
              <FactorRow key={factor.name} factor={factor} />
            ))}
          </div>
        </div>

        {/* Improvements */}
        {prediction.improvements.length > 0 ? (
          <div className="rounded-xl bg-brand-50 p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-brand-800">
              <Lightbulb className="h-3.5 w-3.5" aria-hidden />
              {t('planning.improvementsTitle')}
            </p>
            <ul className="space-y-1">
              {prediction.improvements.map((imp, i) => (
                <li key={i} className="text-sm text-slate-700">
                  · {imp}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex items-start gap-2 border-t border-soil-200 pt-3 text-xs text-slate-500">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <ul className="space-y-1">
            {prediction.limitations.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>

        {/* Record the real harvest — closes the loop on the estimate */}
        <div className="border-t border-soil-200 pt-3">
          {showHarvestForm ? (
            <HarvestForm
              farmId={farmId}
              cropId={cropId}
              onDone={onHarvestRecorded}
              onCancel={() => setShowHarvestForm(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setShowHarvestForm(true)}
              className="flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:text-brand-800"
            >
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              {t('planning.recordHarvest')}
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>
      </Card>
    </section>
  );
}

function FactorRow({ factor }: { factor: StressFactor }) {
  const { t } = useTranslation();
  const tone = {
    none: { dot: 'bg-emerald-500', text: 'text-emerald-700' },
    mild: { dot: 'bg-amber-400', text: 'text-amber-700' },
    moderate: { dot: 'bg-orange-500', text: 'text-orange-700' },
    severe: { dot: 'bg-red-500', text: 'text-red-700' },
  }[factor.severity];

  const labelKey = FACTOR_KEYS[factor.name];

  return (
    <div className="flex items-start gap-2.5">
      <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', tone.dot)} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-slate-700">
            {labelKey ? t(labelKey) : factor.name}
          </span>
          <span className={cn('shrink-0 text-sm font-bold tabular-nums', tone.text)}>
            {factor.lossPercent === 0 ? t('planning.noLoss') : `−${factor.lossPercent}%`}
          </span>
        </div>
        <p className="text-xs leading-snug text-slate-600">{factor.reason}</p>
      </div>
    </div>
  );
}

// ─────────────────────── Harvest form ───────────────────────

function HarvestForm({
  farmId,
  cropId,
  onDone,
  onCancel,
}: {
  farmId: string;
  cropId: string;
  onDone: (notice: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const kg = Number(value);
    if (value.trim() === '' || !Number.isFinite(kg) || kg < 0) {
      setError(t('planning.invalidYield'));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const result = await api.planning.recordHarvest(farmId, cropId, kg);

      // Tell the farmer how the estimate did — that is the whole point of
      // asking them for the real number.
      const parts = [t('planning.harvestSaved', { kg: kg.toLocaleString('en-IN') })];
      if (result.errorPercent !== null) {
        parts.push(
          result.withinPredictedRange
            ? t('planning.withinRange', { percent: Math.abs(result.errorPercent) })
            : t('planning.outsideRange', { percent: Math.abs(result.errorPercent) }),
        );
      }
      onDone(parts.join(' '));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('planning.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <label htmlFor={`harvest-${cropId}`} className="label">
        {t('planning.actualYield')}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id={`harvest-${cropId}`}
          type="number"
          min={0}
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="0"
          className="field w-32"
        />
        <span className="self-center text-sm text-slate-500">kg</span>
        <button type="button" onClick={() => void submit()} disabled={saving} className="btn-primary">
          {saving ? <Spinner className="h-4 w-4" /> : null}
          {t('common.save')}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary">
          {t('common.cancel')}
        </button>
      </div>
      <p className="text-xs text-slate-500">{t('planning.harvestHint')}</p>
      {error ? <p className="text-xs font-semibold text-red-700">{error}</p> : null}
    </div>
  );
}

// ─────────────────────── Estimate history ───────────────────────

/**
 * How the estimate moved through the season.
 *
 * A single yield number invites disbelief. The same number seen climbing after
 * the farmer irrigated, or dropping the week a disease was logged, argues for
 * the advice far better than any explanation.
 */
function YieldHistorySection({ history }: { history: YieldHistoryEntry[] }) {
  const { t } = useTranslation();

  // Oldest first so the chart reads left to right.
  const chartData = useMemo(
    () =>
      [...history]
        .reverse()
        .map((entry) => ({
          date: formatDay(entry.predictedAt),
          kg: Math.round(entry.predictedTotalKg),
        })),
    [history],
  );

  const actual = history.find((h) => h.actualYieldKg != null)?.actualYieldKg ?? null;

  // Below three points a line says nothing that the headline number does not.
  if (chartData.length < 3) {
    return (
      <section>
        <SectionHeading icon={LineChartIcon} title={t('planning.historyTitle')} />
        <Card>
          <p className="text-sm text-slate-600">{t('planning.noHistory')}</p>
        </Card>
      </section>
    );
  }

  return (
    <section>
      <SectionHeading icon={LineChartIcon} title={t('planning.historyTitle')} />
      <Card className="space-y-3">
        <div className="h-40 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e3d9c9" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: '#64748b' }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={24}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#64748b' }}
                axisLine={false}
                tickLine={false}
                width={52}
                domain={['dataMin - 200', 'dataMax + 200']}
              />
              <Tooltip
                contentStyle={{ borderRadius: 12, border: '1px solid #e3d9c9', fontSize: 13 }}
                formatter={(v: number) => [
                  `${v.toLocaleString('en-IN')} kg`,
                  t('planning.estimateLabel'),
                ]}
              />
              {actual !== null ? (
                <ReferenceLine
                  y={actual}
                  stroke="#0f766e"
                  strokeDasharray="4 4"
                  label={{
                    value: t('planning.actualLabel'),
                    position: 'insideTopRight',
                    fontSize: 10,
                    fill: '#0f766e',
                  }}
                />
              ) : null}
              <Line type="monotone" dataKey="kg" stroke="#16a34a" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="text-xs text-slate-500">{t('planning.historyHint')}</p>
      </Card>
    </section>
  );
}

// ─────────────────────────── Fertiliser ───────────────────────────

function FertilizerSection({ plan }: { plan: FertilizerPlan }) {
  const { t } = useTranslation();

  return (
    <section>
      <SectionHeading icon={FlaskConical} title={t('planning.fertilizerTitle')} />
      <Card className="space-y-4">
        {/* Nutrient requirement */}
        <div className="grid grid-cols-3 gap-3">
          <Stat
            label={t('planning.nitrogen')}
            value={Math.round(plan.requirement.nitrogenKg)}
            unit="kg"
          />
          <Stat
            label={t('planning.phosphorus')}
            value={Math.round(plan.requirement.phosphorusKg)}
            unit="kg"
          />
          <Stat
            label={t('planning.potassium')}
            value={Math.round(plan.requirement.potassiumKg)}
            unit="kg"
          />
        </div>
        <p className="-mt-2 text-xs text-slate-500">
          {t('planning.totalFor', {
            hectares: plan.areaHectares,
            crop: plan.crop.label.toLowerCase(),
          })}
        </p>

        {/* What to buy */}
        <div className="border-t border-soil-200 pt-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
            <Package className="h-3.5 w-3.5" aria-hidden />
            {t('planning.whatToBuy')}
          </p>
          <div className="space-y-2">
            {plan.products.map((product) => (
              <div
                key={product.product}
                className="flex items-center justify-between gap-3 rounded-xl bg-soil-50 p-3"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800">{product.product}</p>
                  <p className="text-xs text-slate-500">
                    {t('planning.supplies', { what: product.supplies })}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-lg font-bold tabular-nums text-slate-900">
                    {product.bags}
                    <span className="ml-1 text-xs font-semibold text-slate-500">
                      {product.bags === 1 ? t('planning.bag') : t('planning.bags')}
                    </span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {t('planning.bagLine', {
                      total: product.totalKg,
                      size: product.bagSizeKg,
                    })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Schedule */}
        <div className="border-t border-soil-200 pt-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
            <CalendarCheck className="h-3.5 w-3.5" aria-hidden />
            {t('planning.whenToApply')}
          </p>
          <ol className="space-y-2">
            {plan.schedule.map((step, i) => (
              <li
                key={i}
                className={cn(
                  'flex gap-3 rounded-xl p-3',
                  step.passed ? 'bg-soil-50 opacity-60' : 'bg-brand-50',
                )}
              >
                <span
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                    step.passed ? 'bg-slate-300 text-slate-600' : 'bg-brand-600 text-white',
                  )}
                >
                  {step.passed ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-800">{step.timing}</p>
                  <p className="text-xs text-slate-600">
                    {[
                      step.ureaKg > 0 ? `Urea ${step.ureaKg} kg` : null,
                      step.dapKg > 0 ? `DAP ${step.dapKg} kg` : null,
                      step.mopKg > 0 ? `MOP ${step.mopKg} kg` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || t('planning.nothingDue')}
                  </p>
                  {step.passed ? (
                    <p className="mt-0.5 text-xs text-slate-400">{t('planning.stagePassed')}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* Soil adjustments */}
        {plan.adjustments.length > 0 ? (
          <div className="border-t border-soil-200 pt-3">
            <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
              {t('planning.soilAdjusted')}
            </p>
            <ul className="space-y-1">
              {plan.adjustments.map((a, i) => (
                <li key={i} className="text-sm text-slate-600">
                  · {a}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Crop notes */}
        {plan.notes.length > 0 ? (
          <div className="rounded-xl bg-amber-50 p-3">
            <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-amber-800">
              {t('planning.worthKnowing')}
            </p>
            <ul className="space-y-1">
              {plan.notes.map((n, i) => (
                <li key={i} className="text-sm text-slate-700">
                  · {n}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="border-t border-soil-200 pt-3 text-xs text-slate-500">{plan.basis}</p>
      </Card>
    </section>
  );
}
