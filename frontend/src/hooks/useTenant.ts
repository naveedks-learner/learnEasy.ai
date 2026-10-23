import { useEffect, useState } from "react";
import { fetchTenant, type TenantInfo } from "../api/client";

export function useTenant(enabled = true) {
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    fetchTenant()
      .then((t) => {
        if (cancelled) return;
        setTenant(t);
        document.title = t.name;
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { tenant, loading, error };
}
