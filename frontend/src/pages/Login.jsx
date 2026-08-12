import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import ErrorBanner, { extractErrorMessage } from "../components/ErrorBanner";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login({ email, password });
      navigate("/dashboard");
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-green-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm p-8">
        <h1 className="text-xl font-medium text-gray-900 mb-1">Welcome back</h1>
        <p className="text-sm text-gray-500 mb-6">Log in to your farm dashboard</p>

        <ErrorBanner message={error} />

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-700 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-700 mb-1">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-60"
          >
            {loading ? "Logging in..." : "Log in"}
          </button>
        </form>

        <p className="text-sm text-gray-500 mt-6 text-center">
          New here?{" "}
          <Link to="/signup" className="text-green-700 font-medium">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
