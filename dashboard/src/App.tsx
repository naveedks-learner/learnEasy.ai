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

const SECTIONS = [
  {
    label: "Content",
    items: [
      { id: "Tenants" as const, icon: "M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6", label: "Tenants" },
      { id: "Documents" as const, icon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6", label: "Documents" },
    ],
  },
  {
    label: "Analytics",
    items: [
      { id: "Transactions" as const, icon: "M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6", label: "Transactions" },
      { id: "Costing" as const, icon: "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6", label: "Costing" },
      { id: "Observability" as const, icon: "M3 3v18h18M7 15l4-4 3 3 5-6", label: "Observability" },
    ],
  },
  {
    label: "Config",
    items: [
      { id: "Settings" as const, icon: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", label: "Settings" },
    ],
  },
] as const;

type Tab = (typeof SECTIONS)[number]["items"][number]["id"];

const THEME_KEY = "learneasy.dashboard.theme";
const SIDEBAR_KEY = "learneasy.dashboard.sidebar";
type Theme = "light" | "dark";

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* ignore */ }
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function initialSidebar(): boolean {
  try {
    const saved = localStorage.getItem(SIDEBAR_KEY);
    if (saved === "false") return false;
  } catch { /* ignore */ }
  return true;
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

function SidebarIcon({ d }: { d: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      {d.split(" M").map((seg, i) => <path key={i} d={i === 0 ? seg : `M${seg}`} />)}
    </svg>
  );
}

function Dashboard({ onLogout, theme, onToggle }: { onLogout: () => void; theme: Theme; onToggle: () => void }) {
  const { tenants, error, refresh } = useTenants();
  const { activeTenantId, setActiveTenantId } = useActiveTenant();
  const [tab, setTab] = useState<Tab>("Tenants");
  const [onboarding, setOnboarding] = useState(false);
  const [created, setCreated] = useState<TenantConfig | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(initialSidebar);

  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_KEY, String(sidebarOpen)); } catch { /* ignore */ }
  }, [sidebarOpen]);

  const activeId = tenants.some((t) => t.tenantId === activeTenantId) ? activeTenantId : null;
  const needsTenant = tab !== "Tenants" && !activeId;

  return (
    <div className="dashboard-shell">
      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : "sidebar-collapsed"}`}>
        <div className="sidebar-header">
          <div className="flex items-center gap-3" style={{ overflow: "hidden" }}>
            <div className="orb" style={{ width: 30, height: 30, flexShrink: 0 }} />
            {sidebarOpen && <span className="brand text-lg">learnEasy</span>}
          </div>
          <button type="button" className="sidebar-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}
            title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {sidebarOpen
                ? <><path d="M15 18l-6-6 6-6" /></>
                : <><path d="M9 18l6-6-6-6" /></>}
            </svg>
          </button>
        </div>

        <nav className="sidebar-nav">
          {SECTIONS.map((section) => (
            <div key={section.label} className="sidebar-section">
              {sidebarOpen && <div className="sidebar-section-label">{section.label}</div>}
              {section.items.map((item) => (
                <button key={item.id} onClick={() => setTab(item.id)}
                  className={`sidebar-item ${tab === item.id ? "sidebar-item-active" : ""}`}
                  title={sidebarOpen ? undefined : item.label}>
                  <SidebarIcon d={item.icon} />
                  {sidebarOpen && <span>{item.label}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          {sidebarOpen && (
            <button className="btn btn-secondary btn-sm w-full" onClick={onLogout}>Sign out</button>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className="main-content">
        <header className="main-header">
          <div className="flex items-center gap-3">
            <TenantSwitcher tenants={tenants} activeId={activeId} onChange={setActiveTenantId} />
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle theme={theme} onToggle={onToggle} />
            {!sidebarOpen && (
              <button className="btn btn-secondary btn-sm" onClick={onLogout}>Sign out</button>
            )}
          </div>
        </header>

        <div className="main-body">
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
          {activeId && tab === "Costing" && <CostingTab tenantId={activeId} />}
          {activeId && tab === "Observability" && <ObservabilityTab tenantId={activeId} />}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  const [hasKey, setHasKey] = useState(!!getAdminKey());
  const { theme, toggle } = useTheme();
  if (!hasKey) return <KeyGate onDone={() => setHasKey(true)} theme={theme} onToggle={toggle} />;
  return <Dashboard onLogout={() => { clearAdminKey(); setHasKey(false); }} theme={theme} onToggle={toggle} />;
}
