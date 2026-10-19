import { useEffect, type ReactNode } from "react";
import type { TenantInfo } from "../api/client";

export function TenantThemeProvider({ tenant, children }: { tenant: TenantInfo | null; children: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    const theme = tenant?.theme;
    if (theme?.primaryColor) root.style.setProperty("--color-primary", theme.primaryColor);
    if (theme?.accentColor) root.style.setProperty("--color-accent", theme.accentColor);
  }, [tenant]);
  return <>{children}</>;
}
