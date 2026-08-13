'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  FlaskConical,
  Scale,
  Package,
  CalendarCheck,
  TrendingUp,
  Info,
  Check,
  Lightbulb,
} from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api';
import type { CropPlan, FertilizerPlan, YieldPrediction, StressFactor } from '@/lib/types';
import {
  Card,
  SectionHeading,
  ErrorState,
  EmptyState,
  Notice,
  SkeletonCard,
  Badge,
  Stat,
} from '@/components/ui';
import { cn, cropLabel, formatRupees } from '@/lib/utils';

export default function PlanningPage() {
  return (
    <AppShell>
      <PlanningContent />
    </AppShell>
  );
}

function PlanningContent() {
  const { currentFarm } = useAuth();
  const [plans, setPlans] = useState<CropPlan[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentFarm) return;
    setError(null);
    try {
      const result = await api.planning.farm(currentFarm.id);
      setPlans(result.crops);
      setMessage(result.message);
      if (result.crops.length > 0) setSelected((s) => s || result.crops[0].cropId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your plan.');
    } finally {
      setLoading(false);
    }
  }, [currentFarm]);

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
        <h1 className="text-xl font-bold text-slate-900">Plan &amp; predict</h1>
        <p className="text-sm text-slate-600">
          What fertiliser to buy and when to apply it, plus what yield to expect.
        </p>
      </div>

      {loading ? (
        <>
          <SkeletonCard />
          <SkeletonCard />
        </>
      ) : plans.length === 0 ? (
        <EmptyState
          icon={FlaskConical}
          title="No crops to plan for"
          message={message ?? 'Add a crop to your farm to get a fertiliser schedule and yield estimate.'}
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
                  {cropLabel(plan.cropName)}
                </button>
              ))}
            </div>
          ) : null}

          {active ? (
            <>
              <YieldSection prediction={active.yieldPrediction} />
              <FertilizerSection plan={active.fertilizer} />
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

// ─────────────────────────── Yield ───────────────────────────

function YieldSection({ prediction }: { prediction: YieldPrediction }) {
  const lossPercent = Math.round((1 - prediction.predictedKgHa / prediction.attainableKgHa) * 100);

  return (
    <section>
      <SectionHeading icon={Scale} title="Expected yield" />
      <Card className="space-y-4">
        {/* Headline */}
        <div>
          <div className="flex flex-wrap items-end gap-2">
            <p className="text-3xl font-bold tabular-nums text-slate-900">
              {prediction.predictedTotalKg.toLocaleString('en-IN')}
              <span className="ml-1 text-base font-semibold text-slate-500">kg</span>
            </p>
            <Badge tone={prediction.confidence >= 0.6 ? 'success' : 'warn'}>
              {Math.round(prediction.confidence * 100)}% confident
            </Badge>
          </div>
          <p className="mt-0.5 text-sm text-slate-600">
            Likely between {prediction.rangeTotalKg.low.toLocaleString('en-IN')} and{' '}
            {prediction.rangeTotalKg.high.toLocaleString('en-IN')} kg across{' '}
            {prediction.areaHectares} ha
            {prediction.estimatedIncome
              ? ` · about ${formatRupees(prediction.estimatedIncome)} gross`
              : ''}
            .
          </p>
        </div>

        {/* Attainable vs predicted */}
        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-600">
            <span>{prediction.predictedKgHa.toLocaleString('en-IN')} kg/ha expected</span>
            <span>{prediction.attainableKgHa.toLocaleString('en-IN')} kg/ha possible</span>
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
              {lossPercent}% below what this crop could achieve — the reasons are below.
            </p>
          ) : (
            <p className="mt-1 text-xs text-emerald-700">
              No significant stress detected. On track for a full crop.
            </p>
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
          <span>{Math.round(prediction.seasonProgress * 100)}% through the season</span>
        </div>

        {/* Stress factors */}
        <div className="border-t border-soil-200 pt-3">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
            What is affecting the yield
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
              What would help most
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
      </Card>
    </section>
  );
}

function FactorRow({ factor }: { factor: StressFactor }) {
  const tone = {
    none: { dot: 'bg-emerald-500', text: 'text-emerald-700' },
    mild: { dot: 'bg-amber-400', text: 'text-amber-700' },
    moderate: { dot: 'bg-orange-500', text: 'text-orange-700' },
    severe: { dot: 'bg-red-500', text: 'text-red-700' },
  }[factor.severity];

  return (
    <div className="flex items-start gap-2.5">
      <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', tone.dot)} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-slate-700">{factor.name}</span>
          <span className={cn('shrink-0 text-sm font-bold tabular-nums', tone.text)}>
            {factor.lossPercent === 0 ? 'no loss' : `−${factor.lossPercent}%`}
          </span>
        </div>
        <p className="text-xs leading-snug text-slate-600">{factor.reason}</p>
      </div>
    </div>
  );
}

// ─────────────────────────── Fertiliser ───────────────────────────

function FertilizerSection({ plan }: { plan: FertilizerPlan }) {
  return (
    <section>
      <SectionHeading icon={FlaskConical} title="Fertiliser plan" />
      <Card className="space-y-4">
        {/* Nutrient requirement */}
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Nitrogen" value={Math.round(plan.requirement.nitrogenKg)} unit="kg" />
          <Stat label="Phosphorus" value={Math.round(plan.requirement.phosphorusKg)} unit="kg" />
          <Stat label="Potassium" value={Math.round(plan.requirement.potassiumKg)} unit="kg" />
        </div>
        <p className="-mt-2 text-xs text-slate-500">
          Total for {plan.areaHectares} ha of {plan.crop.label.toLowerCase()}.
        </p>

        {/* What to buy */}
        <div className="border-t border-soil-200 pt-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
            <Package className="h-3.5 w-3.5" aria-hidden />
            What to buy
          </p>
          <div className="space-y-2">
            {plan.products.map((product) => (
              <div
                key={product.product}
                className="flex items-center justify-between gap-3 rounded-xl bg-soil-50 p-3"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800">{product.product}</p>
                  <p className="text-xs text-slate-500">Supplies {product.supplies}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-lg font-bold tabular-nums text-slate-900">
                    {product.bags}
                    <span className="ml-1 text-xs font-semibold text-slate-500">
                      bag{product.bags === 1 ? '' : 's'}
                    </span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {product.totalKg} kg · {product.bagSizeKg} kg bags
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
            When to apply
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
                      .join(' · ') || 'Nothing due at this stage'}
                  </p>
                  {step.passed ? (
                    <p className="mt-0.5 text-xs text-slate-400">This stage has passed</p>
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
              Adjusted for your soil
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
              Worth knowing
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
