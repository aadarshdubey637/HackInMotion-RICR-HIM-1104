import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import RequireAuth from "./components/RequireAuth";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import FarmSetup from "./pages/FarmSetup";
import Dashboard from "./pages/Dashboard";
import CropManager from "./pages/CropManager";
import CropSuggestions from "./pages/CropSuggestions";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route
            path="/farm-setup"
            element={
              <RequireAuth>
                <FarmSetup />
              </RequireAuth>
            }
          />
          <Route
            path="/dashboard"
            element={
              <RequireAuth>
                <Dashboard />
              </RequireAuth>
            }
          />
          <Route
            path="/crops"
            element={
              <RequireAuth>
                <CropManager />
              </RequireAuth>
            }
          />
          <Route
            path="/suggestions"
            element={
              <RequireAuth>
                <CropSuggestions />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
