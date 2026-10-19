import { useCallback, useEffect, useState } from "react";
import { api, type TenantConfig } from "../api/client";

export function useTenants() {
  const [tenants, setTenants] = useState<TenantConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setTenants(await api.listTenants());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { tenants, loading, error, refresh };
}

const ACTIVE_KEY = "learneasy.activeTenant";
export function useActiveTenant() {
  const [activeTenantId, setId] = useState<string | null>(() => {
    try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; }
  });
  const setActiveTenantId = useCallback((id: string | null) => {
    setId(id);
    try { if (id) localStorage.setItem(ACTIVE_KEY, id); else localStorage.removeItem(ACTIVE_KEY); } catch { /* ignore */ }
  }, []);
  return { activeTenantId, setActiveTenantId };
}
