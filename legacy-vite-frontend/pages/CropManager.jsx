import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import api from "../api/client";
import ErrorBanner, { extractErrorMessage } from "../components/ErrorBanner";

const STATUS_STYLES = {
  planning: "bg-blue-50 text-blue-700",
  active: "bg-green-50 text-green-700",
  harvested: "bg-gray-100 text-gray-500",
};

const SOIL_TYPES = ["Black soil", "Alluvial soil", "Red soil", "Laterite soil", "Sandy soil", "Not sure"];

const BLANK_FORM = {
  crop_name: "",
  land_allocated_acres: "",
  soil_type: "",
  status: "planning",
  notes: "",
};

export default function CropManager() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const farmId = searchParams.get("farm");

  const [farm, setFarm] = useState(null);
  const [crops, setCrops] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Add / edit form
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Delete
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    if (!farmId) return;
    async function load() {
      setLoading(true);
      try {
        const [{ data: f }, { data: c }] = await Promise.all([
          api.get(`/farms/${farmId}`),
          api.get(`/farms/${farmId}/crops`),
        ]);
        setFarm(f);
        setCrops(c);
      } catch (err) {
        setError(extractErrorMessage(err));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [farmId]);

  const allocatedAcres = crops
    .filter((c) => c.status !== "harvested")
    .reduce((sum, c) => sum + c.land_allocated_acres, 0);

  const availableAcres = farm ? Math.max(0, farm.land_size_acres - allocatedAcres) : 0;

  function openAdd() {
    setEditingId(null);
    setForm(BLANK_FORM);
    setFormError("");
    setShowForm(true);
  }

  function openEdit(crop) {
    setEditingId(crop.id);
    setForm({
      crop_name: crop.crop_name,
      land_allocated_acres: String(crop.land_allocated_acres),
      soil_type: crop.soil_type || "",
      status: crop.status,
      notes: crop.notes || "",
    });
    setFormError("");
    setShowForm(true);
  }

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setFormError("");
    const payload = {
      crop_name: form.crop_name,
      land_allocated_acres: parseFloat(form.land_allocated_acres),
      soil_type: form.soil_type || null,
      status: form.status,
      notes: form.notes || null,
    };
    try {
      if (editingId) {
        const { data } = await api.patch(`/farms/${farmId}/crops/${editingId}`, payload);
        setCrops((prev) => prev.map((c) => (c.id === editingId ? data : c)));
      } else {
        const { data } = await api.post(`/farms/${farmId}/crops`, payload);
        setCrops((prev) => [...prev, data]);
      }
      setShowForm(false);
    } catch (err) {
      setFormError(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(crop) {
    if (!window.confirm(`Remove ${crop.crop_name} from your farm?`)) return;
    setDeletingId(crop.id);
    try {
      await api.delete(`/farms/${farmId}/crops/${crop.id}`);
      setCrops((prev) => prev.filter((c) => c.id !== crop.id));
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setDeletingId(null);
    }
  }

  async function cycleStatus(crop) {
    const next = { planning: "active", active: "harvested", harvested: "planning" };
    try {
      const { data } = await api.patch(`/farms/${farmId}/crops/${crop.id}`, {
        status: next[crop.status],
      });
      setCrops((prev) => prev.map((c) => (c.id === crop.id ? data : c)));
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-gray-400">
        Loading crops…
      </div>
    );
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
        <div>
          <h1 className="text-base font-medium text-gray-900">Manage Crops</h1>
          {farm && <p className="text-xs text-gray-400">{farm.farm_name}</p>}
        </div>
        <button
          onClick={() => navigate(`/suggestions?farm=${farmId}`)}
          className="ml-auto text-xs text-green-700 border border-green-300 rounded-lg px-3 py-1.5 font-medium hover:bg-green-50"
        >
          🌱 Get suggestions
        </button>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <ErrorBanner message={error} />

        {/* Land usage bar */}
        {farm && (
          <section className="bg-white rounded-2xl shadow-sm p-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-medium text-gray-700">Land allocation</h2>
              <span className="text-xs text-gray-400">
                {allocatedAcres.toFixed(2)} / {farm.land_size_acres} acres used
              </span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-3">
              <div
                className={`h-3 rounded-full transition-all ${
                  allocatedAcres / farm.land_size_acres > 0.9 ? "bg-red-400" : "bg-green-500"
                }`}
                style={{
                  width: `${Math.min(100, (allocatedAcres / farm.land_size_acres) * 100)}%`,
                }}
              />
            </div>
            <p className="text-xs text-gray-400 mt-1">{availableAcres.toFixed(2)} acres available</p>
          </section>
        )}

        {/* Crop list */}
        {crops.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
            <p className="text-sm text-gray-500 mb-1">No crops added yet.</p>
            <p className="text-xs text-gray-400">Add one below or get AI suggestions.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {crops.map((crop) => (
              <div key={crop.id} className="bg-white rounded-2xl shadow-sm p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{crop.crop_name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {crop.land_allocated_acres} acres
                      {crop.soil_type ? ` · ${crop.soil_type}` : ""}
                    </p>
                    {crop.notes && (
                      <p className="text-xs text-gray-400 mt-1 italic">{crop.notes}</p>
                    )}
                  </div>
                  <button
                    onClick={() => cycleStatus(crop)}
                    className={`text-xs rounded-full px-2.5 py-1 font-medium ${STATUS_STYLES[crop.status]} cursor-pointer`}
                    title="Click to advance status"
                  >
                    {crop.status}
                  </button>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => openEdit(crop)}
                    className="text-xs text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(crop)}
                    disabled={deletingId === crop.id}
                    className="text-xs text-red-600 border border-red-200 rounded-lg px-3 py-1.5 hover:bg-red-50 disabled:opacity-50"
                  >
                    {deletingId === crop.id ? "Removing…" : "Remove"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={openAdd}
          disabled={availableAcres <= 0}
          className="w-full bg-green-600 text-white rounded-xl py-2.5 text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {availableAcres <= 0 ? "No land available — remove a crop first" : "+ Add crop"}
        </button>

        {/* Inline form */}
        {showForm && (
          <div className="bg-white rounded-2xl shadow-sm p-5 border border-green-200">
            <h3 className="text-sm font-medium text-gray-900 mb-4">
              {editingId ? "Edit crop" : "Add new crop"}
            </h3>
            <ErrorBanner message={formError} />
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Crop name</label>
                <input
                  required
                  value={form.crop_name}
                  onChange={(e) => update("crop_name", e.target.value)}
                  placeholder="e.g. Wheat, Rice, Tomato"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">
                  Land to allocate (acres)
                  {!editingId && (
                    <span className="text-gray-400 ml-1">— max {availableAcres.toFixed(2)}</span>
                  )}
                </label>
                <input
                  required
                  type="number"
                  step="0.1"
                  min="0.1"
                  max={editingId ? undefined : availableAcres}
                  value={form.land_allocated_acres}
                  onChange={(e) => update("land_allocated_acres", e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Soil type (optional)</label>
                <select
                  value={form.soil_type}
                  onChange={(e) => update("soil_type", e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="">Same as farm default</option>
                  {SOIL_TYPES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => update("status", e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="planning">Planning</option>
                  <option value="active">Active</option>
                  <option value="harvested">Harvested</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Notes (optional)</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => update("notes", e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 bg-green-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-60"
                >
                  {saving ? "Saving…" : editingId ? "Update" : "Add crop"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
