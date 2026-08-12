import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import api from "../api/client";
import ErrorBanner, { extractErrorMessage } from "../components/ErrorBanner";

const SCORE_COLOR = (s) => {
  if (s >= 75) return "bg-green-500";
  if (s >= 50) return "bg-amber-400";
  return "bg-red-400";
};

const SCORE_LABEL = (s) => {
  if (s >= 75) return "Great fit";
  if (s >= 50) return "Decent fit";
  return "Marginal fit";
};

const WATER_BADGE = { low: "💧 Low water", moderate: "💧💧 Moderate", high: "💧💧💧 High water" };

export default function CropSuggestions() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const farmId = searchParams.get("farm");

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(null); // crop_name being added
  const [addError, setAddError] = useState("");
  const [addedCrops, setAddedCrops] = useState(new Set());

  // Try loading cached suggestions first; run fresh if none exist
  useEffect(() => {
    if (!farmId) return;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const { data: cached } = await api.get(`/farms/${farmId}/crops/suggestions/latest`);
        if (cached) {
          setData(cached);
        } else {
          await runFresh();
        }
      } catch (err) {
        setError(extractErrorMessage(err));
      } finally {
        setLoading(false);
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [farmId]);

  async function runFresh() {
    setLoading(true);
    setError("");
    try {
      const { data: fresh } = await api.get(`/farms/${farmId}/crops/suggestions/run`);
      setData(fresh);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function addCrop(suggestion) {
    setAdding(suggestion.crop_name);
    setAddError("");
    try {
      await api.post(`/farms/${farmId}/crops`, {
        crop_name: suggestion.crop_name,
        land_allocated_acres: suggestion.land_acres,
        status: "planning",
      });
      setAddedCrops((prev) => new Set([...prev, suggestion.crop_name]));
    } catch (err) {
      setAddError(extractErrorMessage(err));
    } finally {
      setAdding(null);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-4 flex items-center gap-3">
        <button
          onClick={() => navigate(`/dashboard?farm=${farmId}`)}
          className="text-sm text-gray-500 hover:text-gray-800"
        >
          ← Back
        </button>
        <h1 className="text-base font-medium text-gray-900">Crop Suggestions</h1>
        <button
          onClick={runFresh}
          disabled={loading}
          className="ml-auto text-sm text-green-700 font-medium disabled:opacity-50"
        >
          {loading ? "Analysing…" : "↻ Refresh"}
        </button>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <ErrorBanner message={error || addError} />

        {loading && !data && (
          <div className="bg-white rounded-2xl shadow-sm p-8 text-center text-sm text-gray-400">
            Analysing your farm's weather, soil and land…
          </div>
        )}

        {data && (
          <>
            {/* Based-on summary */}
            <section className="bg-white rounded-2xl shadow-sm p-5">
              <h2 className="text-sm font-medium text-gray-700 mb-3">Analysis based on</h2>
              <div className="grid grid-cols-2 gap-y-2 text-sm text-gray-600">
                <span className="text-gray-400">Avg temperature</span>
                <span>{data.based_on.avg_temp_c}°C</span>
                <span className="text-gray-400">Est. annual rain</span>
                <span>{data.based_on.estimated_annual_rain_mm} mm</span>
                <span className="text-gray-400">Soil type</span>
                <span>{data.based_on.soil_type}</span>
                <span className="text-gray-400">Available land</span>
                <span>{data.available_land_acres} acres</span>
              </div>
            </section>

            {/* Land division plan */}
            {data.land_plan.length > 0 && (
              <section className="bg-white rounded-2xl shadow-sm p-5">
                <h2 className="text-sm font-medium text-gray-700 mb-3">Suggested land division</h2>
                <div className="space-y-2">
                  {/* visual bar */}
                  <div className="flex h-6 rounded-full overflow-hidden gap-0.5">
                    {data.land_plan.map((p, i) => (
                      <div
                        key={p.crop_name}
                        style={{ width: `${p.pct}%` }}
                        className={`h-full ${BAR_COLORS[i % BAR_COLORS.length]}`}
                        title={`${p.crop_name}: ${p.acres} ac (${p.pct}%)`}
                      />
                    ))}
                  </div>
                  {/* legend */}
                  <div className="flex flex-wrap gap-3 pt-1">
                    {data.land_plan.map((p, i) => (
                      <div key={p.crop_name} className="flex items-center gap-1.5 text-xs text-gray-600">
                        <span
                          className={`inline-block w-3 h-3 rounded-sm ${BAR_COLORS[i % BAR_COLORS.length]}`}
                        />
                        {p.icon} {p.crop_name} — {p.acres} ac ({p.pct}%)
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* Crop cards */}
            <section className="space-y-3">
              <h2 className="text-sm font-medium text-gray-700">Top crop recommendations</h2>
              {data.suggestions.map((s) => (
                <div key={s.crop_name} className="bg-white rounded-2xl shadow-sm p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{s.icon}</span>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{s.crop_name}</p>
                        <p className="text-xs text-gray-400">{s.season}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex items-center gap-2">
                        {/* score bar */}
                        <div className="w-24 bg-gray-100 rounded-full h-2">
                          <div
                            className={`h-2 rounded-full ${SCORE_COLOR(s.score)}`}
                            style={{ width: `${s.score}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium text-gray-700">{s.score}/100</span>
                      </div>
                      <span className="text-xs text-gray-400">{SCORE_LABEL(s.score)}</span>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="text-xs bg-blue-50 text-blue-700 rounded-full px-2 py-0.5">
                      {WATER_BADGE[s.water] || s.water}
                    </span>
                    <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
                      📐 {s.land_acres} acres suggested
                    </span>
                  </div>

                  <p className="mt-3 text-xs text-gray-500 leading-relaxed">{s.reasoning}</p>

                  <div className="mt-4 flex gap-2">
                    {addedCrops.has(s.crop_name) ? (
                      <span className="text-xs text-green-700 font-medium">✓ Added to your farm</span>
                    ) : (
                      <button
                        onClick={() => addCrop(s)}
                        disabled={adding === s.crop_name}
                        className="text-xs bg-green-600 text-white rounded-lg px-3 py-1.5 font-medium hover:bg-green-700 disabled:opacity-50"
                      >
                        {adding === s.crop_name ? "Adding…" : `+ Add ${s.crop_name}`}
                      </button>
                    )}
                    <button
                      onClick={() => navigate(`/dashboard?farm=${farmId}`)}
                      className="text-xs text-gray-500 rounded-lg px-3 py-1.5 border border-gray-200 hover:bg-gray-50"
                    >
                      View farm
                    </button>
                  </div>
                </div>
              ))}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

const BAR_COLORS = [
  "bg-green-500",
  "bg-blue-400",
  "bg-amber-400",
  "bg-purple-400",
  "bg-rose-400",
  "bg-teal-400",
];
