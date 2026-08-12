import { useEffect, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import ErrorBanner, { extractErrorMessage } from "../components/ErrorBanner";
import RiskBadge from "../components/RiskBadge";

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [farms, setFarms] = useState(null); // null = loading
  const [selectedFarmId, setSelectedFarmId] = useState(searchParams.get("farm"));
  const [irrigation, setIrrigation] = useState(null);
  const [irrigationError, setIrrigationError] = useState("");
  const [loadingFarms, setLoadingFarms] = useState(true);
  const [loadingIrrigation, setLoadingIrrigation] = useState(false);
  const [farmsError, setFarmsError] = useState("");

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

  if (loadingFarms) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading your farms…</div>;
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
          <Link to="/farm-setup" className="inline-block bg-green-600 text-white rounded-lg px-4 py-2 text-sm font-medium">
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
        <button onClick={() => { logout(); navigate("/login"); }} className="text-sm text-gray-500">
          Log out
        </button>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
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

        <section className="bg-white rounded-2xl shadow-sm p-5">
          <h2 className="text-base font-medium text-gray-900 mb-3">{selectedFarm?.farm_name}</h2>
          <div className="grid grid-cols-2 gap-y-2 text-sm text-gray-600">
            <span className="text-gray-400">Location</span>
            <span>{selectedFarm?.location_text}</span>
            <span className="text-gray-400">Land size</span>
            <span>{selectedFarm?.land_size_acres} acres</span>
            <span className="text-gray-400">Current crop</span>
            <span>{selectedFarm?.current_crop || "—"}</span>
            <span className="text-gray-400">Soil type</span>
            <span>{selectedFarm?.soil_type || "—"}</span>
          </div>
        </section>

        <section className="bg-white rounded-2xl shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-medium text-gray-900">Irrigation guidance</h2>
            {irrigation && <RiskBadge level={irrigation.risk_level} />}
          </div>

          {loadingIrrigation && <p className="text-sm text-gray-400">Checking today's forecast…</p>}
          {irrigationError && <ErrorBanner message={irrigationError} />}

          {irrigation && (
            <div className="space-y-3">
              <p className="text-sm text-gray-700">{irrigation.guidance_text}</p>
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

        <section className="bg-white rounded-2xl shadow-sm p-5">
          <h2 className="text-base font-medium text-gray-900 mb-2">Crop health</h2>
          <p className="text-sm text-gray-400">No observations logged yet.</p>
        </section>

        <section className="bg-white rounded-2xl shadow-sm p-5">
          <h2 className="text-base font-medium text-gray-900 mb-2">Market prices</h2>
          <p className="text-sm text-gray-400">No price data yet for this crop.</p>
        </section>
      </main>
    </div>
  );
}
