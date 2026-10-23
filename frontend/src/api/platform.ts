declare global {
  interface Window { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } }
}

export function isNative(): boolean {
  if (window.Capacitor?.isNativePlatform?.()) return true;
  const origin = window.location.origin;
  return origin === "https://localhost" || origin === "capacitor://localhost" || origin === "http://localhost";
}

export interface SchoolInfo {
  tenantId: string;
  name: string;
  domain: string;
  logoUrl: string;
  primaryColor: string;
}

const SCHOOL_KEY = "learneasy_school";

export function getStoredSchool(): SchoolInfo | null {
  try {
    const raw = localStorage.getItem(SCHOOL_KEY);
    return raw ? (JSON.parse(raw) as SchoolInfo) : null;
  } catch { return null; }
}

export function storeSchool(school: SchoolInfo): void {
  localStorage.setItem(SCHOOL_KEY, JSON.stringify(school));
}

export function clearSchool(): void {
  localStorage.removeItem(SCHOOL_KEY);
}

const NATIVE_API_HOST = "https://learneasy-worker.naveed-ks.workers.dev";

export function getApiBase(): string {
  if (!isNative()) return "";
  return getStoredSchool() ? NATIVE_API_HOST : "";
}

export function getNativeTenantId(): string | null {
  if (!isNative()) return null;
  return getStoredSchool()?.tenantId ?? null;
}
