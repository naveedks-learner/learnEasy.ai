import { useEffect, useState } from "react";
import { fetchTenant, type TenantInfo } from "../api/client";

export function useTenant() {
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
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
  }, []);

  return { tenant, loading, error };
}
