/**
 * Safe UUID v4 generator that works in both secure contexts (HTTPS / localhost)
 * and non-secure contexts (e.g. mobile devices accessing local network IP over HTTP).
 *
 * In non-secure contexts (http://172.20.10.2:5174), mobile browsers disable
 * `crypto.randomUUID`, which otherwise causes a blank white screen crash.
 */
export function safeRandomUUID(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    try {
      return crypto.randomUUID();
    } catch {
      // Fall through to fallback
    }
  }

  // RFC 4122 v4 UUID fallback
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function safeStorageGet(key: string): string | null {
  try {
    if (typeof sessionStorage !== "undefined") {
      return sessionStorage.getItem(key);
    }
  } catch {
    // Ignore storage errors in private browsing
  }
  return null;
}

export function safeStorageSet(key: string, value: string): void {
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(key, value);
    }
  } catch {
    // Ignore storage errors in private browsing
  }
}
