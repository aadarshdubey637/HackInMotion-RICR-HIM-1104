'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Stethoscope,
  Camera,
  X,
  Users,
  ClipboardCheck,
  Info,
  ChevronDown,
  Volume2,
  Square,
  Mic,
} from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api';
import { useVoice, buildSpokenDiagnosis } from '@/lib/voice';
import { useSpeechRecognition, detectLanguage } from '@/lib/speech';
import type { Crop, HealthLog, Diagnosis, DiagnosisCandidate, NearbyOutbreaks } from '@/lib/types';
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
import { cn, timeAgo } from '@/lib/utils';
import { useTranslation } from '@/lib/language-context';

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
  const { t, tCrop } = useTranslation();
  const [crops, setCrops] = useState<Crop[]>([]);
  const [logs, setLogs] = useState<HealthLog[]>([]);
  const [nearby, setNearby] = useState<NearbyOutbreaks | null>(null);
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
          <h1 className="text-xl font-bold text-slate-900">{t('health.title')}</h1>
          <p className="text-sm text-slate-600">
            {t('health.subtitle')}
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
          {t('health.logObservation')}
        </button>
      )}

      {crops.length === 0 && !loading ? (
        <Notice tone="warn">
          {t('health.cropSelect')} — {t('health.subtitle')}
        </Notice>
      ) : null}

      {/* ── Nearby outbreaks ── */}
      {nearby && nearby.outbreaks.length > 0 ? (
        <section>
          <SectionHeading icon={Users} title={t('health.nearbyTitle')} />
          <Card className="border-amber-200 bg-amber-50">
            <p className="mb-2 text-sm text-amber-900">
              {t('health.nearbySubtitle', { count: nearby.farmsInArea })}
            </p>
            <div className="space-y-1.5">
              {nearby.outbreaks.slice(0, 4).map((outbreak) => (
                <div key={`${outbreak.name}-${outbreak.crop}`} className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-amber-900">
                    {outbreak.name}{' '}
                    <span className="font-normal">
                      {t('health.onCrop')} {tCrop(outbreak.crop)}
                    </span>
                  </span>
                  <Badge tone="warn">{t('health.reports', { count: outbreak.count })}</Badge>
                </div>
              ))}
            </div>
          </Card>
        </section>
      ) : null}

      {/* ── History ── */}
      <section>
        <SectionHeading icon={ClipboardCheck} title={t('health.observationHistory')} />

        {loading ? (
          <Card>
            <div className="flex items-center gap-2 text-slate-500">
              <Spinner className="h-4 w-4" />
              <span className="text-sm">{t('common.loading')}</span>
            </div>
          </Card>
        ) : logs.length === 0 ? (
          <EmptyState
            icon={Stethoscope}
            title={t('health.emptyLogs')}
            message="Observe crop issues, diagnose pests, and log actions."
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
  const { t, tCrop, language } = useTranslation();
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
        // Plant.id localises its disease descriptions and treatment advice,
        // but only for the language actually asked for.
        language,
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
          <h2 className="font-bold text-slate-800">{t('health.formTitle')}</h2>
          <button type="button" onClick={onCancel} aria-label="Cancel" className="btn-ghost px-2">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {error ? <Notice tone="warn">{error}</Notice> : null}

        <div>
          <label htmlFor="crop" className="label">
            {t('health.cropSelect')}
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
                  {tCrop(crop.cropName)}
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
          <span className="label">{t('health.issueType')}</span>
          <div className="flex flex-wrap gap-2">
            {OBSERVATION_TYPES.map((type) => {
              const translatedLabel = {
                DISEASE: t('health.diseaseLabel'),
                PEST: t('health.pestLabel'),
                NUTRIENT: t('health.nutrientLabel'),
                GROWTH: t('health.growthLabel'),
                WEATHER_DAMAGE: t('health.weatherLabel'),
                OTHER: t('health.otherLabel'),
              }[type.value];
              return (
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
                  {translatedLabel}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label htmlFor="description" className="label">
            {t('health.description')}
          </label>
          <textarea
            id="description"
            rows={4}
            required
            minLength={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="field py-3"
            placeholder={t('health.description')}
          />

          {/* Dictation. The diagnosis engine maps regional symptom words onto
              its English vocabulary, so "पत्तों पर पीले धब्बे" scores exactly
              like "yellow patches on leaves" — speaking is a first-class way
              to describe a problem here, not a convenience wrapper. */}
          <DictateButton
            onText={(text) =>
              setDescription((prev) => (prev ? `${prev.trim()} ${text}` : text))
            }
          />
        </div>

        <div>
          <span className="label">{t('health.photo')}</span>
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
              <span className="text-sm font-semibold">{t('health.photo')}</span>
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
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={submitting || !cropId} className="btn-primary flex-1">
            {submitting ? <Spinner className="h-5 w-5" /> : null}
            {submitting ? t('common.loading') : t('health.submit')}
          </button>
        </div>
      </form>
    </Card>
  );
}

/**
 * Dictate the symptom description.
 *
 * Listens in the farmer's language and appends what it hears. If the speech
 * comes back in a different script than expected, the interface follows it —
 * a farmer who starts speaking Punjabi into a Hindi app meant to be using
 * Punjabi, and should not have to say so twice.
 */
function DictateButton({ onText }: { onText: (text: string) => void }) {
  const { t, language, setLanguage } = useTranslation();
  const speech = useSpeechRecognition();

  if (!speech.supported) return null;

  async function dictate() {
    if (speech.listening) {
      speech.stop();
      return;
    }

    const heard = await speech.listen(language);
    if (!heard) return;

    const spoken = detectLanguage(heard);
    if (spoken && spoken !== language) setLanguage(spoken);

    onText(heard);
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => void dictate()}
        aria-pressed={speech.listening}
        className={cn(
          'flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition',
          speech.listening
            ? 'border-red-300 bg-red-50 text-red-700'
            : 'border-soil-300 bg-white text-slate-700 hover:bg-soil-50',
        )}
      >
        <Mic className={cn('h-4 w-4', speech.listening && 'animate-pulse')} aria-hidden />
        {speech.listening ? t('voice.dictateStop') : t('voice.dictate')}
      </button>

      <p className="mt-1 text-xs text-slate-500">
        {speech.error === 'mic-blocked'
          ? t('voice.micBlocked')
          : speech.error === 'no-speech'
            ? t('voice.didNotCatch')
            : t('voice.dictateHint')}
      </p>

      {speech.interim ? (
        <p className="mt-1 text-xs italic text-slate-400">{speech.interim}</p>
      ) : null}
    </div>
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
  const { t, tNarrative, language } = useTranslation();
  const voice = useVoice();
  const style = healthSeverityStyles[diagnosis.severity];

  function readAloud() {
    if (voice.speaking) {
      voice.stop();
      return;
    }
    voice.speak(buildSpokenDiagnosis(diagnosis, t, tNarrative), language);
  }

  return (
    <Card className={cn('border-l-4 border-brand-500')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className={cn('rounded-lg px-2 py-1 text-xs font-bold', style.bg, style.text)}>
              {style.label}
            </span>
            <Badge tone="neutral">
              {t('health.confidence', { percent: Math.round(diagnosis.confidence * 100) })}
            </Badge>
            {diagnosis.method === 'rule-engine+plant-id' ? (
              <Badge tone="brand">
                <Camera className="h-3 w-3" aria-hidden />
                {t('health.fromPhoto')}
              </Badge>
            ) : null}
          </div>
          <h2 className="text-lg font-bold text-slate-900">{tNarrative(diagnosis.summary)}</h2>
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
            onClick={onDismiss}
            aria-label={t('voice.close')}
            className="btn-ghost shrink-0 px-2"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
      </div>

      {warning ? (
        <div className="mt-2">
          <Notice tone="warn">{warning}</Notice>
        </div>
      ) : null}

      {/* A photo that is not of a plant is the single most common bad input —
          say so plainly rather than reporting a confident nonsense diagnosis. */}
      {diagnosis.image && !diagnosis.image.isPlant ? (
        <div className="mt-2">
          <Notice tone="warn">{t('health.notAPlant')}</Notice>
        </div>
      ) : null}

      {/* Plant.id has no localised content for most Indian languages; when the
          text below came back in English, say why rather than looking broken. */}
      {diagnosis.image?.languageFellBack ? (
        <div className="mt-2">
          <Notice tone="info">{t('health.detailsInEnglish')}</Notice>
        </div>
      ) : null}

      {/* What to do */}
      <div className="mt-4">
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">
          {t('health.whatToDo')}
        </h3>
        <ol className="space-y-2">
          {diagnosis.nextSteps.map((step, i) => (
            <li key={i} className="flex gap-2.5 text-sm text-slate-700">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-800">
                {i + 1}
              </span>
              <span>{tNarrative(step)}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* Ranked differential */}
      {diagnosis.candidates.length > 0 ? (
        <div className="mt-4 border-t border-soil-200 pt-3">
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">
            {t('health.whatItMightBe')}
          </h3>
          <div className="space-y-2.5">
            {diagnosis.candidates.map((candidate) => (
              <CandidateCard key={candidate.name} candidate={candidate} />
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

/**
 * One candidate in the differential.
 *
 * The detail block below the confidence bar is everything Plant.id returned —
 * what the problem is, what causes it, how to treat it, and reference photos.
 * It is collapsed by default: the farmer's first question is "what is it and
 * what do I do", and four paragraphs of pathology in between those two answers
 * buries the part that matters.
 */
function CandidateCard({ candidate }: { candidate: DiagnosisCandidate }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const details = candidate.details;
  const treatment = details?.treatment;
  const hasTreatment =
    treatment !== undefined &&
    treatment.chemical.length + treatment.biological.length + treatment.prevention.length > 0;
  const hasDetails = Boolean(
    details?.description || details?.cause || hasTreatment || details?.similarImages?.length,
  );

  return (
    <div className="rounded-xl bg-soil-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 font-semibold text-slate-800">
          {candidate.name}
          <span className="ml-1.5 text-xs font-normal capitalize text-slate-500">
            {candidate.kind}
          </span>
        </p>
        <span className="shrink-0 text-sm font-bold tabular-nums text-slate-600">
          {Math.round(candidate.confidence * 100)}%
        </span>
      </div>

      {details?.scientificName && details.scientificName !== candidate.name ? (
        <p className="text-xs italic text-slate-500">{details.scientificName}</p>
      ) : null}

      {/* Confidence bar */}
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-soil-200">
        <div
          className="h-full rounded-full bg-brand-500"
          style={{ width: `${Math.round(candidate.confidence * 100)}%` }}
        />
      </div>

      {/* Where it came from. A candidate the photo model proposed on its own
          has no symptom or weather corroboration behind it, and saying so is
          the difference between a ranked differential and a black box. */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {candidate.source !== 'rules' ? (
          <Badge tone="brand">
            <Camera className="h-3 w-3" aria-hidden />
            {t('health.fromPhoto')}
          </Badge>
        ) : null}
        {candidate.source === 'image' ? <Badge tone="warn">{t('health.notInOurList')}</Badge> : null}
        {details?.classification?.length ? (
          <Badge tone="neutral">{details.classification[0]}</Badge>
        ) : null}
      </div>

      <ul className="mt-2 space-y-0.5">
        {candidate.evidence.map((line, i) => (
          <li key={i} className="text-xs text-slate-600">
            · {line}
          </li>
        ))}
      </ul>

      {hasDetails ? (
        <>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="mt-2 flex min-h-[36px] items-center gap-1 text-xs font-semibold text-brand-700"
          >
            {t('health.aboutThis')}
            <ChevronDown
              className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')}
              aria-hidden
            />
          </button>

          {expanded ? (
            <div className="mt-2 space-y-3 border-t border-soil-200 pt-2.5">
              {details?.description ? (
                <p className="text-xs leading-relaxed text-slate-700">{details.description}</p>
              ) : null}

              {details?.cause ? (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    {t('health.cause')}
                  </p>
                  <p className="text-xs leading-relaxed text-slate-700">{details.cause}</p>
                </div>
              ) : null}

              {hasTreatment ? (
                <div className="space-y-2">
                  <TreatmentList
                    title={t('health.treatmentChemical')}
                    items={treatment.chemical}
                  />
                  <TreatmentList
                    title={t('health.treatmentBiological')}
                    items={treatment.biological}
                  />
                  <TreatmentList
                    title={t('health.treatmentPrevention')}
                    items={treatment.prevention}
                  />
                </div>
              ) : null}

              {/* Reference photos are often more convincing than a percentage:
                  the farmer can hold the phone next to the plant and compare. */}
              {details?.similarImages?.length ? (
                <div>
                  <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    {t('health.referencePhotos')}
                  </p>
                  <div className="flex gap-2">
                    {details.similarImages.slice(0, 3).map((url) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={url}
                        src={url}
                        alt={`${candidate.name} reference`}
                        loading="lazy"
                        className="h-20 w-20 rounded-lg border border-soil-200 object-cover"
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function TreatmentList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;

  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{title}</p>
      <ul className="mt-0.5 space-y-0.5">
        {items.map((item, i) => (
          <li key={i} className="text-xs leading-relaxed text-slate-700">
            · {item}
          </li>
        ))}
      </ul>
    </div>
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
  const { t, tCrop } = useTranslation();
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
                {tCrop(log.crop.cropName)}
              </span>
            ) : null}
            {resolved ? <Badge tone="success">{t('common.success')}</Badge> : null}
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
                {t('health.markTreated')}
              </button>
              <button
                type="button"
                onClick={() => setStatus('RESOLVED')}
                disabled={updating}
                className="rounded-lg border border-soil-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-soil-100"
              >
                {t('health.markResolved')}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
