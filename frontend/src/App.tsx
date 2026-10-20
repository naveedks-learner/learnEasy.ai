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

  const pill = (id: Tab, label: string) => (
    <button type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className="pill">
      {label}
    </button>
  );

  return (
    <TenantThemeProvider tenant={tenant}>
      <div className="shell">
        <div className="card">
          <Header tenant={tenant} />
          {loading ? (
            <div className="p-6 text-center">
              <LoadingSpinner />
            </div>
          ) : error ? (
            <p className="err-box" style={{ margin: 16 }}>{error}</p>
          ) : (
            <>
              <nav className="pills" role="tablist" data-active={tab} aria-label="Mode">
                {pill("chat", "Chat")}
                {pill("explain", "Concept Explainer")}
              </nav>
              <main className="main">{tab === "chat" ? <ChatPage /> : <ExplainerPage />}</main>
            </>
          )}
        </div>
      </div>
      <ConsentBanner />
    </TenantThemeProvider>
  );
}
