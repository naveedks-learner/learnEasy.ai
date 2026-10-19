import { useState } from "react";

const KEY = "learneasy-consent-v1";

function hasConsent(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function ConsentBanner() {
  const [visible, setVisible] = useState(() => !hasConsent());
  if (!visible) return null;

  const accept = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* private browsing: dismiss for this session only */
    }
    setVisible(false);
  };

  return (
    <div
      role="region"
      aria-label="Privacy notice"
      className="fixed bottom-0 inset-x-0 z-50 bg-slate-800 text-white text-sm p-3 flex flex-col sm:flex-row items-center gap-3 justify-center"
    >
      <p className="max-w-2xl">
        This educational service records your questions to improve answers. No personal information is stored. By
        continuing, you agree to our{" "}
        <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline">
          Privacy Policy
        </a>
        .
      </p>
      <button onClick={accept} className="shrink-0 rounded bg-white text-slate-900 font-medium px-4 py-1.5">
        I Understand
      </button>
    </div>
  );
}
