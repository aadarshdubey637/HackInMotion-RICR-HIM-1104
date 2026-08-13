import { useEffect, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import ErrorBanner, { extractErrorMessage } from "../components/ErrorBanner";
import RiskBadge from "../components/RiskBadge";

const STATUS_STYLES = {
  planning: "bg-blue-50 text-blue-700",
  active: "bg-green-50 text-green-700",
  harvested: "bg-gray-100 text-gray-500",
};

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [farms, setFarms] = useState(null);
  const [selectedFarmId, setSelectedFarmId] = useState(searchParams.get("farm"));
  const [crops, setCrops] = useState([]);
  const [selectedCropId, setSelectedCropId] = useState(null);
  const [irrigation, setIrrigation] = useState(null);
  const [irrigationError, setIrrigationError] = useState("");
  const [loadingFarms, setLoadingFarms] = useState(true);
  const [loadingIrrigation, setLoadingIrrigation] = useState(false);
  const [farmsError, setFarmsError] = useState("");

  // Load farms
  useEffect(() => {
    async function loadFarms() {
      try {
        const { data } = await api.get("/farms");
        setFarms(data);
        if (!selectedFarmId && data.length > 0) {
          setSelectedFarmId(data[0].id);
        }
      } catch (err) {
        setFarmsError(extractErrorMessage(err));
      } finally {
        setLoadingFarms(false);
      }
    }
    loadFarms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load crops when farm changes
  useEffect(() => {
    if (!selectedFarmId) return;
    async function loadCrops() {
      try {
        const { data } = await api.get(`/farms/${selectedFarmId}/crops`);
        setCrops(data);
        // Default to first active/planning crop
        const active = data.find((c) => c.status === "active") || data[0];
        setSelectedCropId(active?.id || null);
      } catch {
        setCrops([]);
        setSelectedCropId(null);
      }
    }
    loadCrops();
    setIrrigation(null);
    setIrrigationError("");
  }, [selectedFarmId]);

  // Load irrigation guidance
  useEffect(() => {
    if (!selectedFarmId) return;
    async function loadIrrigation() {
      setLoadingIrrigation(true);
      setIrrigationError("");
      setIrrigation(null);
      try {
        const { data } = await api.get(`/farms/${selectedFarmId}/irrigation`);
        setIrrigation(data);
      } catch (err) {
        setIrrigationError(extractErrorMessage(err));
      } finally {
        setLoadingIrrigation(false);
      }
    }
    loadIrrigation();
  }, [selectedFarmId]);

  const selectedFarm = farms?.find((f) => f.id === selectedFarmId);
  const selectedCrop = crops.find((c) => c.id === selectedCropId);

  const allocatedAcres = crops
    .filter((c) => c.status !== "harvested")
    .reduce((s, c) => s + c.land_allocated_acres, 0);

  if (loadingFarms) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500 text-sm">
        Loading your farms…
      </div>
    );
  }

  if (farmsError) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-sm w-full">
          <ErrorBanner message={farmsError} />
        </div>
      </div>
    );
  }

  if (farms.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-sm w-full text-center">
          <h1 className="text-lg font-medium text-gray-900 mb-2">No farm profile yet</h1>
          <p className="text-sm text-gray-500 mb-4">Set one up to start getting guidance.</p>
          <Link
            to="/farm-setup"
            className="inline-block bg-green-600 text-white rounded-lg px-4 py-2 text-sm font-medium"
          >
            Set up a farm
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-400">Welcome</p>
          <p className="text-sm font-medium text-gray-900">{user?.full_name || user?.email}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/farm-setup"
            className="text-xs text-green-700 border border-green-300 rounded-lg px-2.5 py-1.5 font-medium hover:bg-green-50"
          >
            + Farm
          </Link>
          <button
            onClick={() => { logout(); navigate("/login"); }}
            className="text-sm text-gray-500"
          >
            Log out
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {/* Farm selector */}
        {farms.length > 1 && (
          <select
            value={selectedFarmId}
            onChange={(e) => setSelectedFarmId(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            {farms.map((f) => (
              <option key={f.id} value={f.id}>{f.farm_name}</option>
            ))}
          </select>
        )}

        {/* Farm info card */}
        <section className="bg-white rounded-2xl shadow-sm p-5">
          <div className="flex items-start justify-between mb-3">
            <h2 className="text-base font-medium text-gray-900">{selectedFarm?.farm_name}</h2>
            <Link
              to={`/farm-setup`}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Edit
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-y-2 text-sm text-gray-600">
            <span className="text-gray-400">Location</span>
            <span>{selectedFarm?.location_text}</span>
            <span className="text-gray-400">Total land</span>
            <span>{selectedFarm?.land_size_acres} acres</span>
            <span className="text-gray-400">Land in use</span>
            <span>
              {allocatedAcres.toFixed(2)} / {selectedFarm?.land_size_acres} acres
              {selectedFarm && allocatedAcres < selectedFarm.land_size_acres && (
                <span className="text-green-600 ml-1">
                  ({(selectedFarm.land_size_acres - allocatedAcres).toFixed(2)} free)
                </span>
              )}
            </span>
            <span className="text-gray-400">Soil type</span>
            <span>{selectedFarm?.soil_type || "—"}</span>
          </div>
        </section>

        {/* ── Crop tabs ───────────────────────────────────────────────── */}
        <section className="bg-white rounded-2xl shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-medium text-gray-900">Crops</h2>
            <div className="flex gap-2">
              <button
                onClick={() => navigate(`/suggestions?farm=${selectedFarmId}`)}
                className="text-xs text-green-700 border border-green-300 rounded-lg px-2.5 py-1 font-medium hover:bg-green-50"
              >
                🌱 Suggest
              </button>
              <button
                onClick={() => navigate(`/crops?farm=${selectedFarmId}`)}
                className="text-xs text-gray-600 border border-gray-200 rounded-lg px-2.5 py-1 hover:bg-gray-50"
              >
                Manage
              </button>
            </div>
          </div>

          {crops.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-sm text-gray-400">No crops added yet.</p>
              <button
                onClick={() => navigate(`/suggestions?farm=${selectedFarmId}`)}
                className="mt-2 text-xs text-green-700 font-medium"
              >
                Get crop suggestions →
              </button>
            </div>
          ) : (
            <>
              {/* Tab strip */}
              <div className="flex gap-2 overflow-x-auto pb-1 mb-3">
                {crops.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedCropId(c.id)}
                    className={`whitespace-nowrap text-xs rounded-full px-3 py-1.5 font-medium border transition-colors ${
                      selectedCropId === c.id
                        ? "bg-green-600 text-white border-green-600"
                        : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    {c.crop_name}
                    <span
                      className={`ml-1.5 inline-block w-1.5 h-1.5 rounded-full ${
                        c.status === "active"
                          ? "bg-green-400"
                          : c.status === "planning"
                          ? "bg-blue-400"
                          : "bg-gray-300"
                      }`}
                    />
                  </button>
                ))}
                <button
                  onClick={() => navigate(`/crops?farm=${selectedFarmId}`)}
                  className="whitespace-nowrap text-xs rounded-full px-3 py-1.5 border border-dashed border-gray-300 text-gray-400 hover:border-green-400 hover:text-green-600"
                >
                  + Add
                </button>
              </div>

              {/* Selected crop details */}
              {selectedCrop && (
                <div className="border border-gray-100 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-900">{selectedCrop.crop_name}</p>
                    <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${STATUS_STYLES[selectedCrop.status]}`}>
                      {selectedCrop.status}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-y-1 text-xs text-gray-500">
                    <span className="text-gray-400">Land allocated</span>
                    <span>{selectedCrop.land_allocated_acres} acres</span>
                    {selectedCrop.soil_type && (
                      <>
                        <span className="text-gray-400">Soil</span>
                        <span>{selectedCrop.soil_type}</span>
                      </>
                    )}
                    {selectedCrop.notes && (
                      <>
                        <span className="text-gray-400">Notes</span>
                        <span className="italic">{selectedCrop.notes}</span>
                      </>
                    )}
                  </div>

                  {/* Land division mini-bar for all crops */}
                  {crops.length > 1 && (
                    <div className="pt-1">
                      <p className="text-xs text-gray-400 mb-1">Land division across all crops</p>
                      <div className="flex h-2 rounded-full overflow-hidden gap-0.5">
                        {crops.filter((c) => c.status !== "harvested").map((c, i) => (
                          <div
                            key={c.id}
                            style={{
                              width: `${(c.land_allocated_acres / (selectedFarm?.land_size_acres || 1)) * 100}%`,
                            }}
                            className={`h-full ${BAR_COLORS[i % BAR_COLORS.length]}`}
                            title={`${c.crop_name}: ${c.land_allocated_acres} ac`}
                          />
                        ))}
                        {/* free land */}
                        {selectedFarm && allocatedAcres < selectedFarm.land_size_acres && (
                          <div
                            style={{
                              width: `${((selectedFarm.land_size_acres - allocatedAcres) / selectedFarm.land_size_acres) * 100}%`,
                            }}
                            className="h-full bg-gray-100"
                            title="Unallocated"
                          />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </section>

        {/* Irrigation guidance */}
        <section className="bg-white rounded-2xl shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-medium text-gray-900">Irrigation guidance</h2>
            {irrigation && <RiskBadge level={irrigation.risk_level} />}
          </div>

          {loadingIrrigation && (
            <p className="text-sm text-gray-400">Checking today's forecast…</p>
          )}
          {irrigationError && <ErrorBanner message={irrigationError} />}

          {irrigation && (
            <div className="space-y-3">
              <p className="text-sm text-gray-700">{irrigation.guidance_text}</p>
              {selectedCrop && (
                <p className="text-xs text-gray-400">
                  For <span className="font-medium text-gray-600">{selectedCrop.crop_name}</span>
                  {" "}({selectedCrop.land_allocated_acres} acres)
                </p>
              )}
              {irrigation.alerts?.length > 0 && (
                <ul className="space-y-1">
                  {irrigation.alerts.map((alert, i) => (
                    <li key={i} className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
                      {alert}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        {/* Crop health stub */}
        <section className="bg-white rounded-2xl shadow-sm p-5">
          <h2 className="text-base font-medium text-gray-900 mb-2">Crop health</h2>
          <p className="text-sm text-gray-400">No observations logged yet.</p>
        </section>

        {/* Market prices stub */}
        <section className="bg-white rounded-2xl shadow-sm p-5">
          <h2 className="text-base font-medium text-gray-900 mb-2">Market prices</h2>
          <p className="text-sm text-gray-400">
            {selectedCrop
              ? `No price data yet for ${selectedCrop.crop_name}.`
              : "Add a crop to see market prices."}
          </p>
        </section>
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
