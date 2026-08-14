'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Info,
  Check,
  Megaphone,
  PlusCircle,
  Shield,
  FileImage,
  ChevronRight,
  ChevronDown,
  Sparkles,
} from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api';
import type { NearbyOutbreaks, Crop, HealthSeverity } from '@/lib/types';
import {
  Card,
  SectionHeading,
  ErrorState,
  EmptyState,
  Notice,
  SkeletonCard,
  Badge,
  Spinner,
} from '@/components/ui';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/language-context';

export default function CommunityPage() {
  return (
    <AppShell>
      <CommunityContent />
    </AppShell>
  );
}

function CommunityContent() {
  const { currentFarm } = useAuth();
  const { t, tCrop } = useTranslation();

  // Outbreaks state
  const [data, setData] = useState<NearbyOutbreaks | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [crops, setCrops] = useState<Crop[]>([]);
  const [selectedCropId, setSelectedCropId] = useState('');
  const [useCustomCrop, setUseCustomCrop] = useState(false);
  const [customCropName, setCustomCropName] = useState('');
  const [issueType, setIssueType] = useState<'DISEASE' | 'PEST'>('DISEASE');
  const [issueName, setIssueName] = useState('');
  const [severity, setSeverity] = useState<HealthSeverity>('MODERATE');
  const [description, setDescription] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);

  // Form UI states
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Load outbreaks data
  const loadOutbreaks = useCallback(async () => {
    if (!currentFarm) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.health.nearby(currentFarm.id);
      setData(res);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not load community outbreak alerts.'
      );
    } finally {
      setLoading(false);
    }
  }, [currentFarm]);

  // Load crops for form select
  useEffect(() => {
    if (!currentFarm) return;
    api.farms
      .crops(currentFarm.id)
      .then(({ crops: list }) => {
        setCrops(list);
        if (list.length > 0) setSelectedCropId(list[0].id);
      })
      .catch(() => setCrops([]));
    void loadOutbreaks();
  }, [currentFarm, loadOutbreaks]);

  // Handle report submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentFarm) return;
    if ((!selectedCropId && !customCropName.trim()) || !issueName || !description) {
      setFormError('Please fill out all required fields (crop, issue, and description).');
      return;
    }
    if (useCustomCrop && !customCropName.trim()) {
      setFormError('Please enter the crop name.');
      return;
    }

    setSubmitting(true);
    setFormError(null);
    setSubmitSuccess(false);

    try {
      await api.health.submitCommunityReport(currentFarm.id, {
        cropId: useCustomCrop ? undefined : selectedCropId,
        customCropName: useCustomCrop ? customCropName.trim() : undefined,
        issueName,
        issueType,
        severity,
        description,
        image: imageFile,
      });

      // Clear form
      setIssueName('');
      setDescription('');
      setCustomCropName('');
      setUseCustomCrop(false);
      setImageFile(null);
      setSubmitSuccess(true);
      setShowForm(false);
      // Reload outbreak alerts
      void loadOutbreaks();
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : 'Failed to submit report. Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  // UI mappings
  const severityTones = {
    MILD: 'neutral',
    MODERATE: 'warn',
    SEVERE: 'warn',
    CRITICAL: 'danger',
  } as const;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">
            Community Alerts
          </h1>
          <p className="text-sm text-slate-500">
            Monitor and report pest & disease outbreaks reported by nearby farmers.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowForm((prev) => !prev);
            setSubmitSuccess(false);
            setFormError(null);
          }}
          className={cn(
            'flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition',
            showForm
              ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              : 'bg-brand-600 text-white hover:bg-brand-700'
          )}
        >
          {showForm ? 'Cancel' : 'Report Outbreak'}
          {!showForm && <PlusCircle className="h-4 w-4" />}
        </button>
      </div>

      {/* Info notice about Privacy and Data Protection */}
      <Notice tone="info">
        <div className="flex gap-2">
          <Shield className="h-5 w-5 shrink-0 text-slate-600" />
          <div className="text-xs">
            <span className="font-bold">Anonymity Guaranteed:</span> To protect privacy, we never display names, phone numbers, or exact locations of other farms. Distances are rounded to ensure complete anonymity.
          </div>
        </div>
      </Notice>

      {/* Submit Report Form */}
      {showForm && (
        <Card className="border-brand-100 bg-brand-50/10">
          <form onSubmit={handleSubmit} className="space-y-4">
            <h3 className="text-base font-bold text-slate-800">New Community Crop-Health Report</h3>
            
            {formError && <div className="text-sm font-semibold text-red-600">{formError}</div>}

            <div className="grid gap-4 sm:grid-cols-2">
              {/* Crop Select with custom entry support */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Affected Crop
                </label>
                {!useCustomCrop ? (
                  <div className="mt-1 space-y-1.5">
                    <select
                      value={selectedCropId}
                      onChange={(e) => {
                        if (e.target.value === '__custom__') {
                          setUseCustomCrop(true);
                        } else {
                          setSelectedCropId(e.target.value);
                        }
                      }}
                      className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-brand-500"
                    >
                      {crops.map((crop) => (
                        <option key={crop.id} value={crop.id}>
                          {tCrop(crop.cropName)} ({crop.status.toLowerCase()})
                        </option>
                      ))}
                      <option value="__custom__">✏️ Other crop (type name)...</option>
                    </select>
                    <p className="text-[11px] text-slate-400">Not in list? Select "Other crop" above.</p>
                  </div>
                ) : (
                  <div className="mt-1 space-y-1.5">
                    <input
                      type="text"
                      value={customCropName}
                      onChange={(e) => setCustomCropName(e.target.value)}
                      placeholder="e.g. Wheat, Rice, Cotton, Mustard"
                      autoFocus
                      className="block w-full rounded-lg border border-brand-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-brand-500"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => { setUseCustomCrop(false); setCustomCropName(''); }}
                      className="text-[11px] text-brand-600 hover:underline"
                    >
                      ← Pick from my farm crops
                    </button>
                  </div>
                )}
              </div>

              {/* Issue Type Selector */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Issue Type
                </label>
                <div className="mt-1 flex gap-2">
                  {(['DISEASE', 'PEST'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setIssueType(type)}
                      className={cn(
                        'flex-1 rounded-lg border py-2 text-center text-sm font-semibold transition',
                        issueType === type
                          ? 'border-brand-500 bg-brand-50 text-brand-800'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      )}
                    >
                      {type === 'DISEASE' ? 'Disease / Infection' : 'Insect / Pest'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {/* Issue Name input */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Issue Name
                </label>
                <input
                  type="text"
                  value={issueName}
                  onChange={(e) => setIssueName(e.target.value)}
                  placeholder="e.g. Late Blight, Stem Borer"
                  className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-brand-500"
                  required
                />
              </div>

              {/* Severity selection */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Severity Level
                </label>
                <select
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value as HealthSeverity)}
                  className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-brand-500"
                >
                  <option value="MILD">Mild (Few leaves affected)</option>
                  <option value="MODERATE">Moderate (Partial plant affected)</option>
                  <option value="SEVERE">Severe (Whole plant affected)</option>
                  <option value="CRITICAL">Critical (Spreading rapidly)</option>
                </select>
              </div>
            </div>

            {/* Description textarea */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                Detailed Symptoms / Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What symptoms are you seeing? When did they start? How fast is it spreading?"
                rows={3}
                className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-brand-500"
                required
              />
            </div>

            {/* Optional Image Upload */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                Attach Photo (Optional)
              </label>
              <div className="mt-1 flex items-center gap-3">
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50">
                  <FileImage className="h-4 w-4 text-slate-500" />
                  <span>Choose Image</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        setImageFile(e.target.files[0]);
                      }
                    }}
                    className="hidden"
                  />
                </label>
                {imageFile && (
                  <span className="text-xs text-slate-500 truncate max-w-xs font-medium">
                    {imageFile.name}
                  </span>
                )}
              </div>
            </div>

            {/* Form Submit buttons */}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-500 transition hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
              >
                {submitting ? <Spinner className="h-4 w-4" /> : 'Submit Report'}
              </button>
            </div>
          </form>
        </Card>
      )}

      {/* Success Alert Banner */}
      {submitSuccess && (
        <Notice tone="success">
          <div className="flex gap-2">
            <Check className="h-5 w-5 shrink-0 text-emerald-600" />
            <div>
              <span className="font-bold">Report Submitted Successfully!</span> Your observation has been anonymized and added to help protect other farmers in your local community. Thank you!
            </div>
          </div>
        </Notice>
      )}

      {/* Outbreaks Alert Feed */}
      <div className="space-y-4">
        <SectionHeading icon={Megaphone} title="Nearby Potential Outbreaks" />

        {loading ? (
          <div className="space-y-4">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={loadOutbreaks} />
        ) : !data || data.outbreaks.length === 0 ? (
          <EmptyState
            title="All Clear!"
            message={`No disease or pest outbreaks detected within ${
              data?.radiusKm ?? 5
            } km in the last 7 days. Your crops are currently safe from spreading threats.`}
          />
        ) : (
          <div className="space-y-4">
            {data.outbreaks.map((outbreak, idx) => (
              <OutbreakCard key={idx} outbreak={outbreak} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Outbreak detailed presentation card
function OutbreakCard({
  outbreak,
}: {
  outbreak: NearbyOutbreaks['outbreaks'][0];
}) {
  const [expanded, setExpanded] = useState(false);
  const { tCrop } = useTranslation();

  const severityStyles = {
    CRITICAL: { border: 'border-red-200 bg-red-50/30', tone: 'danger' as const },
    SEVERE: { border: 'border-orange-200 bg-orange-50/20', tone: 'warn' as const },
    MODERATE: { border: 'border-amber-200 bg-amber-50/10', tone: 'warn' as const },
  };

  const style = severityStyles[outbreak.severity as keyof typeof severityStyles] || {
    border: 'border-slate-200 bg-white',
    tone: 'neutral' as const,
  };

  return (
    <Card className={cn('border transition hover:shadow-sm', style.border)}>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={style.tone}>
              🔴 Potential Outbreak
            </Badge>
            <span className="text-xs text-slate-500 font-medium">
              Last reported: {new Date(outbreak.latest).toLocaleDateString()}
            </span>
          </div>

          <h3 className="text-lg font-bold text-slate-800 mt-1">
            {outbreak.name} in {tCrop(outbreak.crop)}
          </h3>

          <p className="text-sm text-slate-600 font-semibold flex items-center gap-1.5">
            <span>📍 Reported within ~{outbreak.approxDistanceKm} km of your farm</span>
            <span className="text-slate-300">•</span>
            <span>👥 {outbreak.count} active reports</span>
          </p>
        </div>

        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
          aria-expanded={expanded}
          aria-label="Toggle details"
        >
          {expanded ? (
            <ChevronDown className="h-5 w-5" />
          ) : (
            <ChevronRight className="h-5 w-5" />
          )}
        </button>
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-slate-100 space-y-3 animate-fadeIn">
          {/* Action items list */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
              <Sparkles className="h-3.5 w-3.5 text-brand-600" />
              Recommended Next Actions
            </h4>
            <ul className="space-y-1.5">
              {outbreak.guidance.map((step, sIdx) => (
                <li key={sIdx} className="text-sm text-slate-700 flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                  <span>{step}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Disclaimer details */}
          <p className="text-[11px] text-slate-400 italic">
            This is an early alert based on reports from nearby farms. Please inspect your fields and consult local extensions before treating.
          </p>
        </div>
      )}
    </Card>
  );
}
