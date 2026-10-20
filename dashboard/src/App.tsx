import { useEffect, useState, type FormEvent } from "react";
import { getAdminKey, setAdminKey, clearAdminKey, type TenantConfig } from "./api/client";
import { useActiveTenant, useTenants } from "./hooks/useTenants";
import TenantSwitcher from "./components/TenantSwitcher/TenantSwitcher";
import TenantList from "./components/TenantOnboarding/TenantList";
import OnboardingForm from "./components/TenantOnboarding/OnboardingForm";
import DnsInstructions from "./components/TenantOnboarding/DnsInstructions";
import DocumentsTab from "./components/Documents/DocumentsTab";
import TransactionsTab from "./components/Transactions/TransactionsTab";
import SettingsTab from "./components/Settings/SettingsTab";
import CostingTab from "./components/Costing/CostingTab";
import ObservabilityTab from "./components/Observability/ObservabilityTab";

const TABS = ["Tenants", "Documents", "Transactions", "Settings", "Costing", "Observability"] as const;
type Tab = (typeof TABS)[number];

const THEME_KEY = "learneasy.dashboard.theme";
type Theme = "light" | "dark";

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* ignore */ }
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function useTheme() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  }, [theme]);
  return { theme, toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")) };
}

function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  return (
    <button type="button" className="btn btn-secondary btn-sm" onClick={onToggle}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === "dark" ? "Light mode" : "Dark mode"} style={{ width: 36, height: 36, padding: 0 }}>
      {theme === "dark" ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
      )}
    </button>
  );
}

function KeyGate({ onDone, theme, onToggle }: { onDone: () => void; theme: Theme; onToggle: () => void }) {
  const [key, setKey] = useState("");
  const submit = (e: FormEvent) => { e.preventDefault(); if (key.trim()) { setAdminKey(key.trim()); onDone(); } };
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="fixed right-4 top-4"><ThemeToggle theme={theme} onToggle={onToggle} /></div>
      <form onSubmit={submit} className="card w-full max-w-sm text-center" style={{ padding: 32, boxShadow: "var(--shadow-md)" }}>
        <div className="orb mx-auto mb-5" style={{ width: 64, height: 64 }} />
        <h1 className="brand text-2xl">learnEasy</h1>
        <p className="muted mb-6 mt-1 text-sm">Operator dashboard sign in</p>
        <input type="password" className="input mb-4" placeholder="Admin API key" autoFocus value={key} onChange={(e) => setKey(e.target.value)} />
        <button className="btn btn-primary w-full" disabled={!key.trim()}>Continue</button>
      </form>
    </div>
  );
}

function NeedsTenant() {
  return (
    <div className="card empty">
      <div className="empty-icon">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6" /></svg>
      </div>
      <h3 className="font-semibold">Select a school to continue</h3>
      <p className="muted text-sm">Pick a school from the dropdown above, or choose one on the Tenants tab.</p>
    </div>
  );
}

function Dashboard({ onLogout, theme, onToggle }: { onLogout: () => void; theme: Theme; onToggle: () => void }) {
  const { tenants, error, refresh } = useTenants();
  const { activeTenantId, setActiveTenantId } = useActiveTenant();
  const [tab, setTab] = useState<Tab>("Tenants");
  const [onboarding, setOnboarding] = useState(false);
  const [created, setCreated] = useState<TenantConfig | null>(null);

  const activeId = tenants.some((t) => t.tenantId === activeTenantId) ? activeTenantId : null;
  const needsTenant = (tab === "Documents" || tab === "Transactions" || tab === "Settings") && !activeId;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-12 pt-5">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="orb" style={{ width: 34, height: 34 }} />
          <h1 className="brand text-xl">learnEasy</h1>
          <span className="badge badge-neutral">Operator</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <TenantSwitcher tenants={tenants} activeId={activeId} onChange={setActiveTenantId} />
          <ThemeToggle theme={theme} onToggle={onToggle} />
          <button className="btn btn-secondary btn-sm" onClick={onLogout}>Sign out</button>
        </div>
      </header>
      <nav className="mb-6 flex gap-1 overflow-x-auto rounded-full border p-1" style={{ background: "var(--card)", borderColor: "var(--border)", boxShadow: "var(--shadow-sm)" }}>
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`tab ${tab === t ? "tab-active" : ""}`}>{t}</button>
        ))}
      </nav>
      {error && <p className="alert alert-error mb-4">{error}</p>}
      {tab === "Tenants" && (
        <div className="space-y-5">
          {created && <DnsInstructions domain={created.domain} onDismiss={() => setCreated(null)} />}
          {onboarding && (
            <OnboardingForm
              onCancel={() => setOnboarding(false)}
              onCreated={(t) => { setOnboarding(false); setCreated(t); setActiveTenantId(t.tenantId); void refresh(); }}
            />
          )}
          <TenantList tenants={tenants} activeId={activeId} onSelect={setActiveTenantId} onOnboard={() => setOnboarding(true)} />
        </div>
      )}
      {needsTenant && <NeedsTenant />}
      {activeId && tab === "Documents" && <DocumentsTab tenantId={activeId} />}
      {activeId && tab === "Transactions" && <TransactionsTab tenantId={activeId} />}
      {activeId && tab === "Settings" && <SettingsTab tenantId={activeId} />}
      {tab === "Costing" && <CostingTab />}
      {tab === "Observability" && <ObservabilityTab />}
    </div>
  );
}

export default function App() {
  const [hasKey, setHasKey] = useState(!!getAdminKey());
  const { theme, toggle } = useTheme();
  if (!hasKey) return <KeyGate onDone={() => setHasKey(true)} theme={theme} onToggle={toggle} />;
  return <Dashboard onLogout={() => { clearAdminKey(); setHasKey(false); }} theme={theme} onToggle={toggle} />;
}
