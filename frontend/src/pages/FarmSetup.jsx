import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client";
import ErrorBanner, { extractErrorMessage } from "../components/ErrorBanner";

const SOIL_TYPES = ["Black soil", "Alluvial soil", "Red soil", "Laterite soil", "Sandy soil", "Not sure"];

export default function FarmSetup() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    farm_name: "",
    location_text: "",
    latitude: "",
    longitude: "",
    land_size_acres: "",
    soil_type: "",
    current_crop: "",
    planned_crop: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setError("Location isn't available in this browser — enter coordinates manually, or just fill in the location name.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        update("latitude", pos.coords.latitude.toFixed(4));
        update("longitude", pos.coords.longitude.toFixed(4));
      },
      () => setError("Couldn't get your location — enter it manually below.")
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const payload = {
        ...form,
        latitude: form.latitude ? parseFloat(form.latitude) : null,
        longitude: form.longitude ? parseFloat(form.longitude) : null,
        land_size_acres: parseFloat(form.land_size_acres),
      };
      const { data } = await api.post("/farms", payload);
      navigate(`/dashboard?farm=${data.id}`);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-green-50 px-4 py-10">
      <div className="max-w-xl mx-auto bg-white rounded-2xl shadow-sm p-8">
        <h1 className="text-xl font-medium text-gray-900 mb-1">Set up your farm</h1>
        <p className="text-sm text-gray-500 mb-6">
          This drives every recommendation you'll see — the more accurate, the better the guidance.
        </p>

        <ErrorBanner message={error} />

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-700 mb-1">Farm name</label>
            <input
              required
              value={form.farm_name}
              onChange={(e) => update("farm_name", e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-700 mb-1">Location</label>
            <input
              required
              placeholder="e.g. Bhopal, Madhya Pradesh"
              value={form.location_text}
              onChange={(e) => update("location_text", e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-700 mb-1">Latitude</label>
              <input
                value={form.latitude}
                onChange={(e) => update("latitude", e.target.value)}
                placeholder="23.2599"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-700 mb-1">Longitude</label>
              <input
                value={form.longitude}
                onChange={(e) => update("longitude", e.target.value)}
                placeholder="77.4126"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={useMyLocation}
            className="text-sm text-green-700 font-medium"
          >
            Use my current location
          </button>
          <p className="text-xs text-gray-400">
            Coordinates power the weather-based irrigation guidance — required for that feature to work.
          </p>

          <div>
            <label className="block text-sm text-gray-700 mb-1">Land size (acres)</label>
            <input
              required
              type="number"
              step="0.1"
              min="0.1"
              value={form.land_size_acres}
              onChange={(e) => update("land_size_acres", e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-700 mb-1">Soil type (if known)</label>
            <select
              value={form.soil_type}
              onChange={(e) => update("soil_type", e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="">Select soil type</option>
              {SOIL_TYPES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-700 mb-1">Current crop</label>
              <input
                value={form.current_crop}
                onChange={(e) => update("current_crop", e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-700 mb-1">Planned crop</label>
              <input
                value={form.planned_crop}
                onChange={(e) => update("planned_crop", e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-60"
          >
            {loading ? "Saving..." : "Save farm profile"}
          </button>
        </form>
      </div>
    </div>
  );
}
