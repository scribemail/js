// First-party cookie storage for the sticky visitor identity. Unlike localStorage (which is
// origin-bound — app.example.com and www.example.com never see each other's data), a cookie scoped
// to the registrable/top domain (".example.com") is shared by every subdomain, so a visitor
// identified on one subdomain is the same visitor on the next. SSR-safe: every entry point no-ops
// when there's no document. No side effects on import.

// Throwaway cookie used to probe which domain levels the browser accepts (see detectTopDomain).
const TLD_PROBE_KEY = "__scribe_mail_tld__";
// document.cookie writes are capped to 7 days by Safari ITP regardless of what we request; other
// browsers honor this, keeping the anonymous id stable across sessions for ~13 months.
const MAX_AGE_SECONDS = 60 * 60 * 24 * 400;

function serialize(name: string, value: string, domain: string | undefined, maxAgeSeconds: number): string {
  let cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Path=/; SameSite=Lax`;
  if (domain) cookie += `; Domain=${domain}`;
  cookie += `; Max-Age=${maxAgeSeconds}`;
  // Secure is required for cookies on https and is simply ignored on http (localhost dev).
  if (typeof location !== "undefined" && location.protocol === "https:") cookie += "; Secure";
  return cookie;
}

export function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const target = encodeURIComponent(name);
  for (const part of document.cookie ? document.cookie.split(";") : []) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== target) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

export function writeCookie(name: string, value: string, domain?: string): void {
  if (typeof document === "undefined") return;
  try {
    document.cookie = serialize(name, value, domain, MAX_AGE_SECONDS);
  } catch {
    // best-effort; identity stays in-memory for this session
  }
}

export function deleteCookie(name: string, domain?: string): void {
  if (typeof document === "undefined") return;
  try {
    // Same name/domain/path as the write, Max-Age 0 → the browser drops it immediately.
    document.cookie = serialize(name, "", domain, 0);
  } catch {
    // best-effort
  }
}

// Find the registrable ("top") domain by probing: set a throwaway cookie at each domain level from
// broadest to narrowest and keep the first one the browser accepts. Browsers refuse to set a cookie
// on a public suffix (".com", ".co.uk"), so the broadest that sticks is the eTLD+1 — no Public
// Suffix List needed (which keeps the <script> bundle tiny). Returns undefined for localhost / IPs /
// single-label hosts, where the caller falls back to a host-only cookie.
export function detectTopDomain(hostname: string): string | undefined {
  const parts = hostname.split(".");
  // No shareable parent domain: a bare host (localhost) or an IPv4 literal.
  if (parts.length < 2 || /^\d+$/.test(parts[parts.length - 1])) return undefined;
  for (let i = parts.length - 2; i >= 0; i--) {
    const candidate = parts.slice(i).join(".");
    writeCookie(TLD_PROBE_KEY, "1", candidate);
    if (readCookie(TLD_PROBE_KEY) === "1") {
      deleteCookie(TLD_PROBE_KEY, candidate);
      return candidate;
    }
  }
  return undefined;
}

// Resolve the Domain for the identity cookies: an explicit override wins; otherwise auto-detect the
// top domain so every subdomain shares one identity. undefined → a host-only cookie (when there's no
// DOM, or on localhost / an IP).
export function resolveCookieDomain(explicit?: string): string | undefined {
  if (explicit) return explicit;
  if (typeof location === "undefined") return undefined;
  try {
    return detectTopDomain(location.hostname);
  } catch {
    return undefined;
  }
}
