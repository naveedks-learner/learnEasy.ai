import { useState } from "react";
import { useTenant } from "./hooks/useTenant";
import { TenantThemeProvider } from "./theme/TenantThemeProvider";
import { Header } from "./components/common/Header";
import { ConsentBanner } from "./components/common/ConsentBanner";
import { LoadingSpinner } from "./components/common/LoadingSpinner";
import { ChatPage } from "./components/Chat/ChatPage";
import { ExplainerPage } from "./components/ConceptExplainer/ExplainerPage";

type Tab = "chat" | "explain";

export default function App() {
  const { tenant, loading, error } = useTenant();
  const [tab, setTab] = useState<Tab>("chat");

  const tabBtn = (id: Tab, label: string) => (
    <button
      onClick={() => setTab(id)}
      className={`flex-1 py-2 text-sm font-medium border-b-2 ${
        tab === id ? "border-[var(--color-primary)] text-[var(--color-primary)]" : "border-transparent text-slate-500"
      }`}
    >
      {label}
    </button>
  );

  return (
    <TenantThemeProvider tenant={tenant}>
      <div className="flex flex-col h-dvh">
        <Header tenant={tenant} />
        {loading ? (
          <div className="p-6 text-center"><LoadingSpinner /></div>
        ) : error ? (
          <p className="p-6 text-center text-red-700">{error}</p>
        ) : (
          <>
            <nav className="flex bg-white border-b border-slate-200">
              {tabBtn("chat", "Chat")}
              {tabBtn("explain", "Concept Explainer")}
            </nav>
            <main className="flex-1 min-h-0">{tab === "chat" ? <ChatPage /> : <ExplainerPage />}</main>
          </>
        )}
      </div>
      <ConsentBanner />
    </TenantThemeProvider>
  );
}
