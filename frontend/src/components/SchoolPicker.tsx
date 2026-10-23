import { useEffect, useState } from "react";
import { fetchSchools } from "../api/client";
import { storeSchool, type SchoolInfo } from "../api/platform";
import { LoadingSpinner } from "./common/LoadingSpinner";

const PROD_HOST = "https://learneasy-worker.naveed-ks.workers.dev";

export function SchoolPicker({ onSelect }: { onSelect: (s: SchoolInfo) => void }) {
  const [schools, setSchools] = useState<SchoolInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSchools(PROD_HOST)
      .then(setSchools)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const pick = (s: SchoolInfo) => {
    storeSchool(s);
    onSelect(s);
  };

  return (
    <div className="shell">
      <div className="card" style={{ maxWidth: 440 }}>
        <div style={{ padding: "2rem 1.5rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: 4 }}>learnEasy.ai</h1>
          <p style={{ color: "var(--muted)", marginBottom: "1.5rem" }}>Choose your school to get started</p>

          {loading ? (
            <LoadingSpinner />
          ) : error ? (
            <p className="err-box">{error}</p>
          ) : schools.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>No schools available yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {schools.map((s) => (
                <button
                  key={s.tenantId}
                  type="button"
                  onClick={() => pick(s)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 16px",
                    background: "var(--soft)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-ctl)",
                    cursor: "pointer",
                    transition: "var(--t)",
                    textAlign: "left",
                    width: "100%",
                    color: "var(--text)",
                    fontSize: "1rem",
                  }}
                >
                  {s.logoUrl ? (
                    <img
                      src={s.logoUrl.startsWith("/") ? PROD_HOST + s.logoUrl : s.logoUrl}
                      alt=""
                      style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover" }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 8,
                        background: s.primaryColor,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#fff",
                        fontWeight: 700,
                        fontSize: 16,
                        flexShrink: 0,
                      }}
                    >
                      {s.name.charAt(0)}
                    </div>
                  )}
                  <div>
                    <div style={{ fontWeight: 600 }}>{s.name}</div>
                    <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{s.domain}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
