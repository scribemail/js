// Framework-agnostic event-tracking core, shared by the browser <script> bundle (src/browser.ts)
// and the npm module (src/index.ts). No side effects on import — the DOM/network is only touched
// when you call createTracker() / captureClickId(), so it is safe to import in SSR/Node.

export const INGEST_BASE = "https://t.scribe-mail.com";
export const ENDPOINT_PATH = "/tracking/events";
const CLICK_ID_PARAM = "scribe_click_id";
const CLICK_ID_STORAGE_KEY = "scribe_click_id";
const FLUSH_DELAY_MS = 2000;

// The reserved event name the backend routes to identity resolution (not the event store).
export const IDENTIFY_EVENT = "$identify";
// First-party storage keys for the sticky visitor identity (mirror CLICK_ID_STORAGE_KEY).
const ANON_ID_KEY = "scribe_anonymous_id";
const USER_ID_KEY = "scribe_user_id";
const TRAITS_KEY = "scribe_traits";

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
  /** When true, don't read/write the click id from first-party storage. */
  consentDenied?: boolean;
  /** Supply the click id explicitly; otherwise it's captured from the URL/storage. */
  clickId?: string;
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

// Read ?scribe_click_id from the landing URL (set by the signature click redirect) and persist it
// first-party so it survives subsequent navigations. SSR-safe: a no-op when there's no DOM.
export function captureClickId(consentDenied = false): string | undefined {
  if (typeof location === "undefined") return undefined;
  try {
    const fromUrl = new URLSearchParams(location.search).get(CLICK_ID_PARAM);
    if (fromUrl) {
      if (!consentDenied) localStorage.setItem(CLICK_ID_STORAGE_KEY, fromUrl);
      return fromUrl;
    }
    if (!consentDenied) return localStorage.getItem(CLICK_ID_STORAGE_KEY) ?? undefined;
  } catch {
    // storage / URL unavailable — proceed unattributed
  }
  return undefined;
}

// Read (or mint-and-persist) the first-party anonymous visitor id. Mirrors captureClickId: minted
// once, sticky across navigations and sessions. Consent denied → undefined (no id minted or sent;
// a fresh id per call would explode the backend's user table). SSR-safe via try/catch.
export function getAnonymousId(consentDenied = false): string | undefined {
  if (consentDenied) return undefined;
  try {
    const existing = localStorage.getItem(ANON_ID_KEY);
    if (existing) return existing;
    const minted = uuid();
    localStorage.setItem(ANON_ID_KEY, minted);
    return minted;
  } catch {
    // storage unavailable (SSR / blocked) — proceed without an anonymous id
    return undefined;
  }
}

function readStored(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function readStoredTraits(): Traits {
  try {
    const raw = localStorage.getItem(TRAITS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Traits) : {};
  } catch {
    return {};
  }
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // best-effort; identity stays in-memory for this session
  }
}

function removeStored(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // best-effort
  }
}

// Build a tracker: captures the click id, batches events, and flushes them debounced + on page
// hide via sendBeacon (text/plain → CORS simple, no preflight) with a fetch keepalive fallback.
export function createTracker(config: TrackerConfig): Tracker {
  const endpoint = (config.endpoint || INGEST_BASE) + ENDPOINT_PATH;
  const clickId = config.clickId ?? captureClickId(config.consentDenied);
  const buffer: ScribeEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Sticky visitor identity: minted/seeded once, then auto-attached to every event. `anonymousId` is
  // mutable so reset() can rotate it; `userId`/`traits` are seeded from storage so a returning visitor
  // is identified on this session without re-calling identify().
  let anonymousId = getAnonymousId(config.consentDenied);
  let userId = config.consentDenied ? undefined : readStored(USER_ID_KEY);
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
      persist(TRAITS_KEY, JSON.stringify(traits));
    }
    if (uid) {
      userId = uid;
      persist(USER_ID_KEY, uid);
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
    removeStored(USER_ID_KEY);
    removeStored(TRAITS_KEY);
    if (!config.consentDenied) {
      const fresh = uuid();
      persist(ANON_ID_KEY, fresh);
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
