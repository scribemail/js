// Framework-agnostic event-tracking core, shared by the browser <script> bundle (src/browser.ts)
// and the npm module (src/index.ts). No side effects on import — the DOM/network is only touched
// when you call createTracker() / captureClickId(), so it is safe to import in SSR/Node.

import { deleteCookie, readCookie, resolveCookieDomain, writeCookie } from "./cookies";

export const INGEST_BASE = "https://t.scribe-mail.com";
export const ENDPOINT_PATH = "/tracking/events";
const CLICK_ID_PARAM = "scribe_click_id"; // inbound URL param set by the signature-click redirect
const CLICK_ID_STORAGE_KEY = "scribe_mail_click_id";
const FLUSH_DELAY_MS = 2000;

// The reserved event name the backend routes to identity resolution (not the event store).
export const IDENTIFY_EVENT = "$identify";
// First-party cookie keys for the sticky visitor identity (mirror CLICK_ID_STORAGE_KEY).
const ANON_ID_KEY = "scribe_mail_anonymous_id";
const USER_ID_KEY = "scribe_mail_user_id";
const TRAITS_KEY = "scribe_mail_traits";

// Keys recognized at the top level of track() metadata. user_id/anonymous_id/traits are listed so
// they're stripped from the properties bag — identity is owned by identify()/reset() and must never
// be injected (or overridden) through a track() call.
const RESERVED_KEYS = new Set(["value", "currency", "event_id", "properties", "user_id", "anonymous_id", "traits"]);

export interface Metadata {
  value?: number;
  currency?: string;
  event_id?: string;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

// A flat bag of scalar identity attributes (name, email, plan…). The backend bounds it server-side
// and drops anything non-scalar/oversized, so keep values to string/number/boolean/null.
export interface Traits {
  [key: string]: string | number | boolean | null;
}

export interface ScribeEvent {
  name: string;
  event_id: string;
  properties?: Record<string, unknown>;
  value?: number;
  currency?: string;
  click_id?: string;
  anonymous_id?: string;
  user_id?: string;
  traits?: Traits;
}

export interface Tracker {
  track(name: string, metadata?: Metadata): void;
  flush(): void;
  /** Associate the current visitor with a customer user id and/or traits; persists + emits $identify. */
  identify(userId?: string, traits?: Traits): void;
  /** Clear the stored identity and rotate the anonymous id (call on logout / shared device). */
  reset(): void;
}

export interface TrackerConfig {
  /** The workspace's Event Tracking ID (event_tracking_uuid). */
  site: string;
  /** Override the ingest base host (advanced/testing). Defaults to INGEST_BASE. */
  endpoint?: string;
  /** When true, don't read/write any identity from first-party cookies. */
  consentDenied?: boolean;
  /** Supply the click id explicitly; otherwise it's captured from the URL/cookie. */
  clickId?: string;
  /**
   * Cookie Domain for the persisted identity (anonymous id, user id, click id, traits). Defaults to
   * the detected registrable/top domain (e.g. "example.com") so every subdomain shares one identity.
   * Pass e.g. "app.example.com" to scope identity to a single subdomain instead.
   */
  cookieDomain?: string;
}

export function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Map the public track(name, metadata) call to the wire event. `value`/`currency`/`event_id`
// are recognized top-level fields; everything else (plus an explicit `properties`) becomes the
// properties bag, matching `track('signup', { value: 99, currency: 'USD', plan: 'pro' })`.
// `anonymousId`/`userId` are supplied by the tracker from its sticky identity (never from metadata).
export function buildEvent(
  name: string,
  metadata: Metadata = {},
  clickId?: string,
  anonymousId?: string,
  userId?: string,
): ScribeEvent {
  const properties: Record<string, unknown> = { ...(metadata.properties ?? {}) };
  for (const key of Object.keys(metadata)) {
    if (!RESERVED_KEYS.has(key)) properties[key] = metadata[key];
  }

  const event: ScribeEvent = {
    name,
    properties,
    event_id: typeof metadata.event_id === "string" && metadata.event_id ? metadata.event_id : uuid(),
  };
  if (typeof metadata.value === "number") event.value = metadata.value;
  if (typeof metadata.currency === "string") event.currency = metadata.currency;
  if (clickId) event.click_id = clickId;
  if (anonymousId) event.anonymous_id = anonymousId;
  if (userId) event.user_id = userId;
  return event;
}

function send(url: string, body: string): void {
  try {
    const blob = new Blob([body], { type: "text/plain" });
    if (typeof navigator !== "undefined" && navigator.sendBeacon && navigator.sendBeacon(url, blob)) return;
  } catch {
    // fall through to fetch
  }
  try {
    void fetch(url, { method: "POST", body, headers: { "Content-Type": "text/plain" }, keepalive: true }).catch(() => {});
  } catch {
    // best-effort; never throw from a tracking call
  }
}

// Read ?scribe_click_id from the landing URL (set by the signature click redirect) and persist it in
// a first-party cookie so it survives later navigations — and, scoped to the top domain, subdomain
// hops too. SSR-safe: a no-op when there's no DOM.
export function captureClickId(consentDenied = false, cookieDomain?: string): string | undefined {
  if (typeof location === "undefined") return undefined;
  try {
    const fromUrl = new URLSearchParams(location.search).get(CLICK_ID_PARAM);
    if (fromUrl) {
      if (!consentDenied) writeCookie(CLICK_ID_STORAGE_KEY, fromUrl, cookieDomain);
      return fromUrl;
    }
    if (!consentDenied) return readCookie(CLICK_ID_STORAGE_KEY);
  } catch {
    // storage / URL unavailable — proceed unattributed
  }
  return undefined;
}

// Read (or mint-and-persist) the first-party anonymous visitor id from a cookie scoped to
// `cookieDomain` (the top domain by default → shared across subdomains). Mirrors captureClickId:
// minted once, sticky across navigations and sessions. Consent denied → undefined (no id minted or
// sent; a fresh id per call would explode the backend's user table). SSR-safe.
export function getAnonymousId(consentDenied = false, cookieDomain?: string): string | undefined {
  if (consentDenied) return undefined;
  const existing = readCookie(ANON_ID_KEY);
  if (existing) return existing;
  const minted = uuid();
  writeCookie(ANON_ID_KEY, minted, cookieDomain);
  return minted;
}

// Seed traits from the cookie so a returning visitor keeps their attributes and a later identify()
// merges over them rather than starting blank.
function readStoredTraits(): Traits {
  const raw = readCookie(TRAITS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Traits) : {};
  } catch {
    return {};
  }
}

// Build a tracker: captures the click id, batches events, and flushes them debounced + on page
// hide via sendBeacon (text/plain → CORS simple, no preflight) with a fetch keepalive fallback.
export function createTracker(config: TrackerConfig): Tracker {
  const endpoint = (config.endpoint || INGEST_BASE) + ENDPOINT_PATH;
  // The Domain every identity cookie is scoped to. Resolved once (the auto-detect probes a throwaway
  // cookie), and skipped entirely under consent denial so we never touch the cookie jar.
  const cookieDomain = config.consentDenied ? undefined : resolveCookieDomain(config.cookieDomain);
  const clickId = config.clickId ?? captureClickId(config.consentDenied, cookieDomain);
  const buffer: ScribeEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Sticky visitor identity: minted/seeded once, then auto-attached to every event. `anonymousId` is
  // mutable so reset() can rotate it; `userId`/`traits` are seeded from the cookie so a returning
  // visitor — including one arriving from another subdomain — is identified without re-calling
  // identify().
  let anonymousId = getAnonymousId(config.consentDenied, cookieDomain);
  let userId = config.consentDenied ? undefined : readCookie(USER_ID_KEY);
  let traits: Traits = config.consentDenied ? {} : readStoredTraits();

  const flush = (): void => {
    if (buffer.length === 0) return;
    const events = buffer.splice(0, buffer.length);
    send(endpoint, JSON.stringify({ site: config.site, events }));
  };

  const enqueue = (event: ScribeEvent): void => {
    buffer.push(event);
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, FLUSH_DELAY_MS);
  };

  const track = (name: string, metadata?: Metadata): void => {
    if (!name) return;
    enqueue(buildEvent(name, metadata, clickId, anonymousId, userId));
  };

  const identify = (uid?: string, newTraits?: Traits): void => {
    if (config.consentDenied) return; // no PII / no durable identity without consent
    if (newTraits) {
      traits = { ...traits, ...newTraits };
      writeCookie(TRAITS_KEY, JSON.stringify(traits), cookieDomain);
    }
    if (uid) {
      userId = uid;
      writeCookie(USER_ID_KEY, uid, cookieDomain);
    }
    // Emit one $identify carrying the accumulated identity. user_id is omitted until known — the
    // backend treats a no-user-id $identify as anonymous, and the traits ride along regardless.
    enqueue({
      name: IDENTIFY_EVENT,
      event_id: uuid(),
      traits,
      ...(anonymousId ? { anonymous_id: anonymousId } : {}),
      ...(userId ? { user_id: userId } : {}),
      ...(clickId ? { click_id: clickId } : {}),
    });
  };

  const reset = (): void => {
    userId = undefined;
    traits = {};
    deleteCookie(USER_ID_KEY, cookieDomain);
    deleteCookie(TRAITS_KEY, cookieDomain);
    if (!config.consentDenied) {
      const fresh = uuid();
      writeCookie(ANON_ID_KEY, fresh, cookieDomain);
      anonymousId = fresh; // subsequent events use the rotated id
    }
  };

  if (typeof addEventListener === "function") {
    addEventListener("visibilitychange", () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") flush();
    });
    addEventListener("pagehide", flush);
  }

  return { track, flush, identify, reset };
}
