'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Image from 'next/image';
import {
  Stethoscope,
  Camera,
  X,
  Plus,
  Users,
  ClipboardCheck,
  Info,
  ChevronDown,
} from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api';
import type { Crop, HealthLog, Diagnosis } from '@/lib/types';
import {
  Card,
  SectionHeading,
  ErrorState,
  EmptyState,
  Notice,
  Spinner,
  Badge,
  healthSeverityStyles,
} from '@/components/ui';
import { cn, cropLabel, timeAgo, humanise } from '@/lib/utils';

const OBSERVATION_TYPES = [
  { value: 'DISEASE', label: 'Disease' },
  { value: 'PEST', label: 'Pest' },
  { value: 'NUTRIENT', label: 'Nutrient' },
  { value: 'GROWTH', label: 'Growth' },
  { value: 'WEATHER_DAMAGE', label: 'Weather damage' },
  { value: 'OTHER', label: 'Not sure' },
] as const;

export default function HealthPage() {
  return (
    <AppShell>
      <HealthContent />
    </AppShell>
  );
}

function HealthContent() {
  const { currentFarm } = useAuth();
  const [crops, setCrops] = useState<Crop[]>([]);
  const [logs, setLogs] = useState<HealthLog[]>([]);
  const [nearby, setNearby] = useState<{
    reports: Array<{ name: string; crop: string; count: number }>;
    farmsInArea: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [result, setResult] = useState<{ diagnosis: Diagnosis; warning?: string } | null>(null);

  const load = useCallback(async () => {
    if (!currentFarm) return;
    setError(null);

    try {
      const [cropsRes, logsRes] = await Promise.all([
        api.farms.crops(currentFarm.id),
        api.health.list(currentFarm.id),
      ]);
      setCrops(cropsRes.crops);
      setLogs(logsRes.observations);

      // Community signal is a bonus — failure here must not break the page.
      api.health
        .nearby(currentFarm.id)
        .then(setNearby)
        .catch(() => setNearby(null));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your health records.');
    } finally {
      setLoading(false);
    }
  }, [currentFarm]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!currentFarm) return null;

  if (error && logs.length === 0 && !loading) {
    return <ErrorState message={error} onRetry={() => void load()} />;
  }

  return (
    <div className="space-y-5 animate-fade-up">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Crop health</h1>
          <p className="text-sm text-slate-600">
            Spotted something on your plants? Log it and get guidance on what to check.
          </p>
        </div>
      </div>

      {/* ── Diagnosis result ── */}
      {result ? (
        <DiagnosisResult
          diagnosis={result.diagnosis}
          warning={result.warning}
          onDismiss={() => setResult(null)}
        />
      ) : null}

      {/* ── Log form ── */}
      {showForm ? (
        <ObservationForm
          farmId={currentFarm.id}
          crops={crops}
          onCancel={() => setShowForm(false)}
          onSuccess={(diagnosis, warning) => {
            setShowForm(false);
            setResult({ diagnosis, warning });
            void load();
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setShowForm(true);
            setResult(null);
          }}
          disabled={crops.length === 0}
          className="btn-primary w-full"
        >
          <Camera className="h-5 w-5" aria-hidden />
          Check a plant
        </button>
      )}

      {crops.length === 0 && !loading ? (
        <Notice tone="warn">
          Add a crop to your farm first — health checks are specific to what you are growing.
        </Notice>
      ) : null}

      {/* ── Nearby outbreaks ── */}
      {nearby && nearby.reports.length > 0 ? (
        <section>
          <SectionHeading icon={Users} title="Reported nearby" />
          <Card className="border-amber-200 bg-amber-50">
            <p className="mb-2 text-sm text-amber-900">
              Farmers within 50 km have reported these recently. Worth checking your own crop.
            </p>
            <div className="space-y-1.5">
              {nearby.reports.slice(0, 4).map((report) => (
                <div key={`${report.name}-${report.crop}`} className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-amber-900">
                    {report.name} <span className="font-normal">on {cropLabel(report.crop)}</span>
                  </span>
                  <Badge tone="warn">
                    {report.count} report{report.count === 1 ? '' : 's'}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>
        </section>
      ) : null}

      {/* ── History ── */}
      <section>
        <SectionHeading icon={ClipboardCheck} title="Your records" />

        {loading ? (
          <Card>
            <div className="flex items-center gap-2 text-slate-500">
              <Spinner className="h-4 w-4" />
              <span className="text-sm">Loading…</span>
            </div>
          </Card>
        ) : logs.length === 0 ? (
          <EmptyState
            icon={Stethoscope}
            title="No records yet"
            message="When you notice spots, insects, wilting or anything unusual, log it here. You will get specific guidance and a record you can track over time."
          />
        ) : (
          <div className="space-y-3">
            {logs.map((log) => (
              <HealthLogCard
                key={log.id}
                log={log}
                farmId={currentFarm.id}
                onStatusChange={() => void load()}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ─────────────────────────── Form ───────────────────────────

function ObservationForm({
  farmId,
  crops,
  onCancel,
  onSuccess,
}: {
  farmId: string;
  crops: Crop[];
  onCancel: () => void;
  onSuccess: (diagnosis: Diagnosis, warning?: string) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [cropId, setCropId] = useState(crops[0]?.id ?? '');
  const [description, setDescription] = useState('');
  const [observationType, setObservationType] = useState<string>('OTHER');
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Object URLs must be revoked or they leak for the page's lifetime.
  useEffect(() => {
    if (!image) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  function pickImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 8 * 1024 * 1024) {
      setError('That photo is too large. Please choose one under 8 MB.');
      return;
    }
    setError(null);
    setImage(file);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!cropId) return;

    setError(null);
    setSubmitting(true);

    try {
      const response = await api.health.create(farmId, {
        cropId,
        description,
        observationType,
        image,
      });
      onSuccess(response.diagnosis, response.warning);
    } catch (err) {
      setSubmitting(false);
      setError(
        err instanceof ApiError ? err.message : 'Could not save your observation. Please try again.',
      );
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-slate-800">Check a plant</h2>
          <button type="button" onClick={onCancel} aria-label="Cancel" className="btn-ghost px-2">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {error ? <Notice tone="warn">{error}</Notice> : null}

        <div>
          <label htmlFor="crop" className="label">
            Which crop?
          </label>
          <div className="relative">
            <select
              id="crop"
              value={cropId}
              onChange={(e) => setCropId(e.target.value)}
              className="field appearance-none pr-10"
              required
            >
              {crops.map((crop) => (
                <option key={crop.id} value={crop.id}>
                  {cropLabel(crop.cropName)}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-3 top-3.5 h-5 w-5 text-slate-400"
              aria-hidden
            />
          </div>
        </div>

        <div>
          <span className="label">What kind of problem?</span>
          <div className="flex flex-wrap gap-2">
            {OBSERVATION_TYPES.map((type) => (
              <button
                key={type.value}
                type="button"
                onClick={() => setObservationType(type.value)}
                aria-pressed={observationType === type.value}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-sm font-semibold transition',
                  observationType === type.value
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-soil-300 bg-white text-slate-700',
                )}
              >
                {type.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="description" className="label">
            What do you see?
          </label>
          <textarea
            id="description"
            rows={4}
            required
            minLength={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="field py-3"
            placeholder="e.g. Brown spots with yellow edges on the lower leaves, starting to spread upward. Some leaves have dropped."
          />
          <p className="mt-1 text-xs text-slate-500">
            The more detail, the better the guidance. Mention colour, shape, which leaves, and
            whether it is spreading.
          </p>
        </div>

        <div>
          <span className="label">Photo (optional)</span>
          {preview ? (
            <div className="relative overflow-hidden rounded-xl border border-soil-300">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="Selected plant" className="h-48 w-full object-cover" />
              <button
                type="button"
                onClick={() => setImage(null)}
                aria-label="Remove photo"
                className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="flex min-h-[96px] w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-soil-300 bg-soil-50 text-slate-500 transition hover:border-brand-400 hover:bg-brand-50"
            >
              <Camera className="h-6 w-6" aria-hidden />
              <span className="text-sm font-semibold">Take or choose a photo</span>
              <span className="text-xs">Helps, but not required</span>
            </button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={pickImage}
            className="hidden"
          />
        </div>

        <div className="flex gap-3">
          <button type="button" onClick={onCancel} className="btn-secondary flex-1">
            Cancel
          </button>
          <button type="submit" disabled={submitting || !cropId} className="btn-primary flex-1">
            {submitting ? <Spinner className="h-5 w-5" /> : null}
            {submitting ? 'Checking…' : 'Get guidance'}
          </button>
        </div>
      </form>
    </Card>
  );
}

// ─────────────────────────── Result ───────────────────────────

function DiagnosisResult({
  diagnosis,
  warning,
  onDismiss,
}: {
  diagnosis: Diagnosis;
  warning?: string;
  onDismiss: () => void;
}) {
  const style = healthSeverityStyles[diagnosis.severity];

  return (
    <Card className={cn('border-l-4 border-brand-500')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className={cn('rounded-lg px-2 py-1 text-xs font-bold', style.bg, style.text)}>
              {style.label}
            </span>
            <Badge tone="neutral">{Math.round(diagnosis.confidence * 100)}% confident</Badge>
          </div>
          <h2 className="text-lg font-bold text-slate-900">{diagnosis.summary}</h2>
        </div>
        <button type="button" onClick={onDismiss} aria-label="Close" className="btn-ghost shrink-0 px-2">
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>

      {warning ? (
        <div className="mt-2">
          <Notice tone="warn">{warning}</Notice>
        </div>
      ) : null}

      {/* What to do */}
      <div className="mt-4">
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">
          What to do now
        </h3>
        <ol className="space-y-2">
          {diagnosis.nextSteps.map((step, i) => (
            <li key={i} className="flex gap-2.5 text-sm text-slate-700">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-800">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* Ranked differential */}
      {diagnosis.candidates.length > 0 ? (
        <div className="mt-4 border-t border-soil-200 pt-3">
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">
            What it might be
          </h3>
          <div className="space-y-2.5">
            {diagnosis.candidates.map((candidate) => (
              <div key={candidate.name} className="rounded-xl bg-soil-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-slate-800">
                    {candidate.name}
                    <span className="ml-1.5 text-xs font-normal capitalize text-slate-500">
                      {candidate.kind}
                    </span>
                  </p>
                  <span className="shrink-0 text-sm font-bold tabular-nums text-slate-600">
                    {Math.round(candidate.confidence * 100)}%
                  </span>
                </div>

                {/* Confidence bar */}
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-soil-200">
                  <div
                    className="h-full rounded-full bg-brand-500"
                    style={{ width: `${Math.round(candidate.confidence * 100)}%` }}
                  />
                </div>

                <ul className="mt-2 space-y-0.5">
                  {candidate.evidence.map((line, i) => (
                    <li key={i} className="text-xs text-slate-600">
                      · {line}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Honesty about limits */}
      <div className="mt-4 border-t border-soil-200 pt-3">
        <div className="flex items-start gap-2 text-xs text-slate-500">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <ul className="space-y-1">
            {diagnosis.limitations.map((limitation, i) => (
              <li key={i}>{limitation}</li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

// ─────────────────────────── History card ───────────────────────────

function HealthLogCard({
  log,
  farmId,
  onStatusChange,
}: {
  log: HealthLog;
  farmId: string;
  onStatusChange: () => void;
}) {
  const [updating, setUpdating] = useState(false);
  const style = healthSeverityStyles[log.severity];
  const problem = log.diseaseDetected ?? log.pestDetected;
  const resolved = log.status === 'RESOLVED' || log.status === 'TREATED';

  async function setStatus(status: string) {
    setUpdating(true);
    try {
      await api.health.updateStatus(farmId, log.id, status);
      onStatusChange();
    } catch {
      // Non-critical; the list will still show the previous state.
    } finally {
      setUpdating(false);
    }
  }

  return (
    <Card className={cn(resolved && 'opacity-70')}>
      <div className="flex gap-3">
        {log.imageUrl ? (
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-soil-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={log.imageUrl} alt="" className="h-full w-full object-cover" />
          </div>
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-bold', style.bg, style.text)}>
              {style.label}
            </span>
            {log.crop ? (
              <span className="text-sm font-semibold text-slate-800">
                {cropLabel(log.crop.cropName)}
              </span>
            ) : null}
            {resolved ? <Badge tone="success">{humanise(log.status)}</Badge> : null}
          </div>

          {problem ? <p className="mt-1 font-semibold text-slate-800">{problem}</p> : null}
          <p className="mt-0.5 line-clamp-2 text-sm text-slate-600">
            {log.analysisResult?.summary ?? log.description}
          </p>
          <p className="mt-1 text-xs text-slate-400">{timeAgo(log.observedAt)}</p>

          {!resolved ? (
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setStatus('TREATED')}
                disabled={updating}
                className="rounded-lg border border-soil-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-soil-100"
              >
                Mark treated
              </button>
              <button
                type="button"
                onClick={() => setStatus('RESOLVED')}
                disabled={updating}
                className="rounded-lg border border-soil-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-soil-100"
              >
                Resolved
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
