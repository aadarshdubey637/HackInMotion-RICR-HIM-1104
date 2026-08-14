'use client';

import { useState, useEffect, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Sprout, MapPin, Loader2, Check } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError, activeFarm } from '@/lib/api';
import { Spinner, Notice, Card } from '@/components/ui';
import { cn } from '@/lib/utils';

const SOIL_TYPES = [
  { value: 'LOAMY', label: 'Loamy', hint: 'Dark, crumbly, holds water well' },
  { value: 'CLAY', label: 'Clay', hint: 'Sticky when wet, hard when dry' },
  { value: 'SANDY', label: 'Sandy', hint: 'Gritty, drains fast' },
  { value: 'SILTY', label: 'Silty', hint: 'Smooth, soapy feel' },
  { value: 'CHALKY', label: 'Chalky', hint: 'Stony, pale' },
  { value: 'PEATY', label: 'Peaty', hint: 'Dark, spongy, rich' },
] as const;

/** Land can be entered in acres — the unit most Indian farmers actually use. */
const ACRES_PER_HECTARE = 2.47105;

export default function OnboardingPage() {
  const router = useRouter();
  const { user, loading, refreshFarms } = useAuth();

  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [areaValue, setAreaValue] = useState('');
  const [areaUnit, setAreaUnit] = useState<'acre' | 'hectare'>('acre');
  const [soilType, setSoilType] = useState<string>('');

  const [cropOptions, setCropOptions] = useState<Array<{ key: string; label: string }>>([]);
  const [selectedCrop, setSelectedCrop] = useState('');
  const [plantingDate, setPlantingDate] = useState('');

  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [locationDetecting, setLocationDetecting] = useState(false);
  const [soilDetecting, setSoilDetecting] = useState(false);
  const [detectedLocation, setDetectedLocation] = useState<string | null>(null);
  const [detectedSoilType, setDetectedSoilType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  // Crop list drives step 2; fetched up front so the step transition is instant.
  useEffect(() => {
    api.farms
      .supportedCrops()
      .then(({ crops }) => setCropOptions(crops))
      .catch(() => setCropOptions([]));
  }, []);

  // Fetch location info when coordinates change (from manual input or geolocation)
  useEffect(() => {
    if (coords && (coords.lat !== 0 || coords.lon !== 0)) {
      fetchLocationInfo(coords.lat, coords.lon);
    }
  }, [coords]);

  async function fetchLocationInfo(lat: number, lon: number) {
    setLocationDetecting(true);
    setSoilDetecting(true);
    setLocationNote('Finding village and district…');
    setDetectedLocation(null);
    setDetectedSoilType(null);

    try {
      const { location, soil } = await api.farms.getLocationInfo(lat, lon);

      if (location) {
        const parts = [location.village, location.district, location.state, location.country]
          .filter(Boolean)
          .join(', ');
        if (parts) {
          setAddress(parts);
          setDetectedLocation(parts);
        }
      }

      if (soil.soilType && SOIL_TYPES.some((s) => s.value === soil.soilType)) {
        setSoilType(soil.soilType);
        setDetectedSoilType(soil.soilType);
      }
    } catch {
      // Silently fail - user can still manually enter
    } finally {
      setLocationDetecting(false);
      setSoilDetecting(false);
      if (!locationDetecting && !soilDetecting) {
        setLocationNote(null);
      }
    }
  }

  function detectLocation() {
    if (!('geolocation' in navigator)) {
      setLocationNote('Your browser cannot detect location. Please enter coordinates manually.');
      return;
    }

    setLocating(true);
    setLocationNote(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = Number(position.coords.latitude.toFixed(5));
        const lon = Number(position.coords.longitude.toFixed(5));
        setCoords({ lat, lon });
        setLocating(false);
        setLocationNote(null);
        fetchLocationInfo(lat, lon);
      },
      (err) => {
        setLocating(false);
        setLocationNote(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission was denied. Enter your coordinates below, or allow location and try again.'
            : 'Could not detect your location. Please enter your coordinates below.',
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  const areaHectares =
    areaValue === ''
      ? 0
      : areaUnit === 'acre'
        ? Number(areaValue) / ACRES_PER_HECTARE
        : Number(areaValue);

  const step1Valid = name.trim().length > 0 && coords !== null && areaHectares > 0;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!coords) return;

    setError(null);
    setSubmitting(true);

    try {
      const { farm } = await api.farms.create({
        name: name.trim(),
        latitude: coords.lat,
        longitude: coords.lon,
        totalAreaHectares: Number(areaHectares.toFixed(4)),
        soilTypePrimary: soilType || undefined,
        address: address.trim() || undefined,
      });

      // A crop is optional here — the farmer can add one later — but adding it
      // now means the dashboard has real guidance on first load.
      if (selectedCrop) {
        try {
          await api.farms.addCrop(farm.id, {
            cropName: selectedCrop,
            status: plantingDate ? 'GROWING' : 'PLANNED',
            plantingDate: plantingDate || undefined,
          });
        } catch {
          // Farm was created; a failed crop add should not block onboarding.
        }
      }

      activeFarm.set(farm.id);
      await refreshFarms();
      router.push('/dashboard');
    } catch (err) {
      setSubmitting(false);
      setError(
        err instanceof ApiError ? err.message : 'Could not save your farm. Please try again.',
      );
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="h-8 w-8 text-brand-600" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-gradient-to-b from-brand-50 to-soil-50 px-4 py-8">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600">
            <Sprout className="h-7 w-7 text-white" aria-hidden />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Set up your farm</h1>
          <p className="mt-1 text-sm text-slate-600">
            Everything the app tells you is based on this — so it is worth getting right.
          </p>
        </div>

        {/* Step indicator */}
        <div className="mb-5 flex items-center justify-center gap-2">
          {[1, 2].map((n) => (
            <div key={n} className="flex items-center gap-2">
              <div
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold',
                  step >= n ? 'bg-brand-600 text-white' : 'bg-soil-200 text-slate-500',
                )}
              >
                {step > n ? <Check className="h-4 w-4" /> : n}
              </div>
              {n === 1 ? <div className="h-0.5 w-10 bg-soil-200" /> : null}
            </div>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          {error ? (
            <div className="mb-4">
              <Notice tone="warn">{error}</Notice>
            </div>
          ) : null}

          {step === 1 ? (
            <Card className="space-y-5">
              <div>
                <label htmlFor="farm-name" className="label">
                  Farm name
                </label>
                <input
                  id="farm-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="field"
                  placeholder="e.g. Kumar Farm"
                  required
                />
              </div>

              {/* ── Location ── */}
              <div>
                <span className="label">Where is your farm?</span>
                <p className="-mt-1 mb-2 text-xs text-slate-500">
                  We use this to get weather for your exact location.
                </p>

                <button
                  type="button"
                  onClick={detectLocation}
                  disabled={locating}
                  className="btn-secondary w-full"
                >
                  {locating ? (
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                  ) : (
                    <MapPin className="h-5 w-5" aria-hidden />
                  )}
                  {locating ? 'Finding you…' : 'Use my current location'}
                </button>

                {locationNote ? (
                  <div className="mt-2">
                    <Notice tone="warn">{locationNote}</Notice>
                  </div>
                ) : null}

                {coords ? (
                  <div className="mt-2">
                    <Notice tone="success">
                      Location set: {coords.lat}, {coords.lon}
                    </Notice>
                    {(locationDetecting || soilDetecting) && (
                      <div className="mt-2 flex gap-2 text-xs text-slate-600">
                        {locationDetecting && <span className="animate-pulse">Finding village/district…</span>}
                        {soilDetecting && <span className="animate-pulse">Determining soil type…</span>}
                      </div>
                    )}
                    {detectedLocation && !locationDetecting && !soilDetecting && (
                      <p className="mt-1 text-xs text-brand-600">��� Location detected: {coords.lat}, {coords.lon}</p>
                    )}
                  </div>
                ) : null}

                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="lat" className="label text-xs">
                      Latitude
                    </label>
                    <input
                      id="lat"
                      type="number"
                      step="any"
                      inputMode="decimal"
                      value={coords?.lat ?? ''}
                      onChange={(e) =>
                        setCoords({ lat: Number(e.target.value), lon: coords?.lon ?? 0 })
                      }
                      className="field"
                      placeholder="26.8467"
                    />
                  </div>
                  <div>
                    <label htmlFor="lon" className="label text-xs">
                      Longitude
                    </label>
                    <input
                      id="lon"
                      type="number"
                      step="any"
                      inputMode="decimal"
                      value={coords?.lon ?? ''}
                      onChange={(e) =>
                        setCoords({ lat: coords?.lat ?? 0, lon: Number(e.target.value) })
                      }
                      className="field"
                      placeholder="80.9462"
                    />
                  </div>
                </div>

                <div className="mt-3">
                  <label htmlFor="address" className="label text-xs">
                    Village / district
                    {detectedLocation && (
                      <span className="ml-1.5 text-xs text-brand-600 font-normal">
                        Detected automatically
                      </span>
                    )}
                  </label>
                  <input
                    id="address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="field"
                    placeholder="Mohanlalganj, Lucknow"
                  />
                  {locationDetecting && (
                    <p className="mt-1 text-xs text-slate-500 animate-pulse">Finding village and district…</p>
                  )}
                  {detectedLocation && !locationDetecting && (
                    <p className="mt-1 text-xs text-brand-600">��� Location detected: {coords?.lat}, {coords?.lon}</p>
                  )}
                </div>
              </div>

              {/* ── Land size ── */}
              <div>
                <label htmlFor="area" className="label">
                  Land size
                </label>
                <div className="flex gap-2">
                  <input
                    id="area"
                    type="number"
                    step="any"
                    min="0"
                    inputMode="decimal"
                    value={areaValue}
                    onChange={(e) => setAreaValue(e.target.value)}
                    className="field flex-1"
                    placeholder="5"
                    required
                  />
                  <div className="flex shrink-0 rounded-xl border border-soil-300 bg-white p-1">
                    {(['acre', 'hectare'] as const).map((unit) => (
                      <button
                        key={unit}
                        type="button"
                        onClick={() => setAreaUnit(unit)}
                        className={cn(
                          'rounded-lg px-3 text-sm font-semibold transition',
                          areaUnit === unit ? 'bg-brand-600 text-white' : 'text-slate-600',
                        )}
                      >
                        {unit === 'acre' ? 'Acres' : 'Hectares'}
                      </button>
                    ))}
                  </div>
                </div>
                {areaHectares > 0 ? (
                  <p className="mt-1 text-xs text-slate-500">
                    = {areaHectares.toFixed(2)} hectares
                    {areaUnit === 'hectare'
                      ? ` (${(areaHectares * ACRES_PER_HECTARE).toFixed(2)} acres)`
                      : ''}
                  </p>
                ) : null}
              </div>

              {/* ── Soil ── */}
              <div>
                <label className="label flex items-center gap-2">
                  Soil type (optional)
                  {detectedSoilType && (
                    <span className="text-xs text-brand-600 font-normal">Detected automatically</span>
                  )}
                </label>
                <p className="-mt-1 mb-2 text-xs text-slate-500">
                  This makes irrigation advice noticeably more accurate. Not sure? Skip it.
                </p>
                {soilDetecting && (
                  <p className="mb-2 text-xs text-slate-500 animate-pulse">Determining soil type…</p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {SOIL_TYPES.map((soil) => (
                    <button
                      key={soil.value}
                      type="button"
                      onClick={() => setSoilType(soilType === soil.value ? '' : soil.value)}
                      aria-pressed={soilType === soil.value}
                      className={cn(
                        'rounded-xl border p-3 text-left transition',
                        soilType === soil.value
                          ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600'
                          : 'border-soil-300 bg-white hover:bg-soil-50',
                      )}
                    >
                      <p className="text-sm font-semibold text-slate-800">{soil.label}</p>
                      <p className="text-xs leading-tight text-slate-500">{soil.hint}</p>
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={!step1Valid}
                className="btn-primary w-full"
              >
                Continue
              </button>
              {!step1Valid ? (
                <p className="text-center text-xs text-slate-500">
                  Add a name, location and land size to continue.
                </p>
              ) : null}
            </Card>
          ) : (
            <Card className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-slate-800">What are you growing?</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Pick your main crop. You can add more later.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {cropOptions.map((crop) => (
                  <button
                    key={crop.key}
                    type="button"
                    onClick={() => setSelectedCrop(selectedCrop === crop.key ? '' : crop.key)}
                    aria-pressed={selectedCrop === crop.key}
                    className={cn(
                      'rounded-xl border p-3 text-sm font-semibold transition',
                      selectedCrop === crop.key
                        ? 'border-brand-600 bg-brand-50 text-brand-800 ring-1 ring-brand-600'
                        : 'border-soil-300 bg-white text-slate-700 hover:bg-soil-50',
                    )}
                  >
                    {crop.label}
                  </button>
                ))}
              </div>

              {selectedCrop ? (
                <div>
                  <label htmlFor="planting" className="label">
                    When did you plant it? (optional)
                  </label>
                  <input
                    id="planting"
                    type="date"
                    max={new Date().toISOString().slice(0, 10)}
                    value={plantingDate}
                    onChange={(e) => setPlantingDate(e.target.value)}
                    className="field"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Helps us work out the growth stage and water needs. Leave blank if not planted yet.
                  </p>
                </div>
              ) : null}

              <div className="flex gap-3">
                <button type="button" onClick={() => setStep(1)} className="btn-secondary flex-1">
                  Back
                </button>
                <button type="submit" disabled={submitting} className="btn-primary flex-1">
                  {submitting ? <Spinner className="h-5 w-5" /> : null}
                  {submitting ? 'Saving…' : 'Finish'}
                </button>
              </div>

              {!selectedCrop ? (
                <p className="text-center text-xs text-slate-500">
                  No crop selected — you can add one from the Crops tab any time.
                </p>
              ) : null}
            </Card>
          )}
        </form>
      </div>
    </div>
  );
}
