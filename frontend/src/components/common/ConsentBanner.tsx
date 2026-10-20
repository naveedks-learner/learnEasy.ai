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
    <div role="region" aria-label="Privacy notice" className="consent">
      <p style={{ margin: 0 }}>
        This educational service records your questions to improve answers. No personal information is stored. By
        continuing, you agree to our{" "}
        <a href="/privacy" target="_blank" rel="noopener noreferrer">
          Privacy Policy
        </a>
        .
      </p>
      <button onClick={accept}>I Understand</button>
    </div>
  );
}
