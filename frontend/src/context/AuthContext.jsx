import { createContext, useContext, useState, useCallback } from "react";
import api from "../api/client";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem("user");
    return stored ? JSON.parse(stored) : null;
  });

  const persistSession = (data) => {
    localStorage.setItem("access_token", data.access_token);
    localStorage.setItem("user", JSON.stringify(data.user));
    setUser(data.user);
  };

  const signup = useCallback(async ({ email, password, fullName }) => {
    const { data } = await api.post("/auth/signup", {
      email,
      password,
      full_name: fullName || null,
    });
    persistSession(data);
  }, []);

  const login = useCallback(async ({ email, password }) => {
    const { data } = await api.post("/auth/login", { email, password });
    persistSession(data);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("user");
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, signup, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
