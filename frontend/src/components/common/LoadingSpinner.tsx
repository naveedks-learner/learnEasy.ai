import { useEffect, useState } from "react";

export function LoadingSpinner({ label = "Loading" }: { label?: string }) {
  return (
    <span role="status" aria-label={label} className="dots">
      <i />
      <i />
      <i />
    </span>
  );
}

const PHRASES = [
  "Thinking it through…",
  "Searching your study material…",
  "Checking the textbook…",
  "Working out the maths…",
  "Putting it simply…",
];

/** Italic muted indicator that cycles through phrases. */
export function Thinking({ phrases = PHRASES, label = "Waiting for answer" }: { phrases?: string[]; label?: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % phrases.length), 2200);
    return () => clearInterval(id);
  }, [phrases.length]);
  return (
    <div className="thinking" role="status" aria-label={label}>
      <span className="dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span key={i} className="fade-phrase">
        {phrases[i]}
      </span>
    </div>
  );
}
