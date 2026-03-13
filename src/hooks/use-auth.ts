"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface User {
  email: string;
  first_name: string;
  last_name: string;
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const checkedRef = useRef(false);

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/check");
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        return true;
      }

      // Try refresh before giving up
      const refreshRes = await fetch("/api/auth/directus-proxy-refresh", {
        method: "POST",
      });
      if (refreshRes.ok) {
        const retryRes = await fetch("/api/auth/check");
        if (retryRes.ok) {
          const data = await retryRes.json();
          setUser(data.user);
          return true;
        }
      }

      setUser(null);
      return false;
    } catch {
      setUser(null);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!checkedRef.current) {
      checkedRef.current = true;
      checkAuth();
    }
  }, [checkAuth]);

  const login = async (email: string, password: string) => {
    const res = await fetch("/api/auth/directus-proxy-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error("Login failed");
    await checkAuth();
  };

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
  }, []);

  return { user, loading, login, logout };
}
