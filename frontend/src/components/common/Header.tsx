import { useEffect, useState } from "react";
import type { TenantInfo } from "../../api/client";
import { getApiBase } from "../../api/platform";

const KEY = "learneasy-theme";
type Mode = "light" | "dark";

function initialMode(): Mode {
  try {
    const s = localStorage.getItem(KEY);
    if (s === "light" || s === "dark") return s;
  } catch {
    /* ignore */
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function Header({ tenant, onSwitchSchool }: { tenant: TenantInfo | null; onSwitchSchool?: () => void }) {
  const [mode, setMode] = useState<Mode>(initialMode);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", mode);
  }, [mode]);

  const toggle = () => {
    const next: Mode = mode === "dark" ? "light" : "dark";
    setMode(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* ignore */
    }
  };

  return (
    <header className="hdr">
      {tenant?.logoUrl ? <img src={tenant.logoUrl.startsWith("/") ? getApiBase() + tenant.logoUrl : tenant.logoUrl} alt="" className="orb-img" /> : <div className="orb" aria-hidden="true" />}
      <div>
        <h1 className="hdr-title">{tenant?.name ?? "learnEasy.ai"}</h1>
        <p className="hdr-sub">Your science &amp; maths study buddy</p>
      </div>
      {onSwitchSchool && (
        <button type="button" className="icon-btn" onClick={onSwitchSchool} aria-label="Switch school" title="Switch school" style={{ marginLeft: "auto" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
          </svg>
        </button>
      )}
      <button
        type="button"
        className="icon-btn"
        onClick={toggle}
        aria-label={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        title={mode === "dark" ? "Light mode" : "Dark mode"}
      >
        {mode === "dark" ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
          </svg>
        )}
      </button>
    </header>
  );
}
