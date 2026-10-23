import { isNative } from "../api/platform";

export function registerServiceWorker(): void {
  if (isNative() || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* PWA is optional; ignore registration failures */
    });
  });
}
