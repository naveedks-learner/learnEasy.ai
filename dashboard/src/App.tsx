import { useState, type FormEvent } from "react";
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

function KeyGate({ onDone }: { onDone: () => void }) {
  const [key, setKey] = useState("");
  const submit = (e: FormEvent) => { e.preventDefault(); if (key.trim()) { setAdminKey(key.trim()); onDone(); } };
  return (
    <form onSubmit={submit} className="mx-auto mt-24 max-w-sm space-y-3 rounded-lg border bg-white p-6">
      <h1 className="text-lg font-semibold">Operator login</h1>
      <input type="password" className="w-full rounded border border-slate-300 px-2 py-1" placeholder="Admin API key" value={key} onChange={(e) => setKey(e.target.value)} />
      <button className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white">Continue</button>
    </form>
  );
}

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const { tenants, error, refresh } = useTenants();
  const { activeTenantId, setActiveTenantId } = useActiveTenant();
  const [tab, setTab] = useState<Tab>("Tenants");
  const [onboarding, setOnboarding] = useState(false);
  const [created, setCreated] = useState<TenantConfig | null>(null);

  const activeId = tenants.some((t) => t.tenantId === activeTenantId) ? activeTenantId : null;
  const needsTenant = (tab === "Documents" || tab === "Transactions" || tab === "Settings") && !activeId;

  return (
    <div className="mx-auto max-w-6xl p-4">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">learnEasy Operator</h1>
        <div className="flex items-center gap-4">
          <TenantSwitcher tenants={tenants} activeId={activeId} onChange={setActiveTenantId} />
          <button className="text-sm text-slate-500 underline" onClick={onLogout}>Sign out</button>
        </div>
      </header>
      <nav className="mb-4 flex gap-1 border-b">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm ${tab === t ? "border-b-2 border-blue-600 font-semibold" : "text-slate-500"}`}>{t}</button>
        ))}
      </nav>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {tab === "Tenants" && (
        <div className="space-y-4">
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
      {needsTenant && <p className="text-slate-500">Select a school to continue.</p>}
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
  if (!hasKey) return <KeyGate onDone={() => setHasKey(true)} />;
  return <Dashboard onLogout={() => { clearAdminKey(); setHasKey(false); }} />;
}
