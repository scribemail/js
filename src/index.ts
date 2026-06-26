// npm entry point for @scribemail/js — the programmatic API for bundler/app code:
//
//   import scribe from '@scribemail/js';
//   scribe.init({ site: 'YOUR_EVENT_TRACKING_ID' });
//   scribe.track('signup', { value: 99, currency: 'USD' });
//
// (Named `init`/`track`/`flush` exports work too — same singleton.) Importing this module has no
// side effects (SSR-safe); nothing is sent until you call init(). For a plain <script> tag, use
// the CDN build instead (src/browser.ts → cdn-1.scribe-mail.com/v1/tracking.js).

import { createTracker, type Metadata, type Tracker, type Traits } from "./core";

export { buildEvent, uuid } from "./core";
export type { Metadata, ScribeEvent, Tracker, TrackerConfig, Traits } from "./core";

export interface InitOptions {
  /** Your Event Tracking ID (the workspace's event_tracking_uuid), from your Scribe dashboard. */
  site: string;
  /** Override the ingest host (advanced/testing). */
  endpoint?: string;
  /** Defaults to true. Set false to disable first-party storage of the visitor identity. */
  consent?: boolean;
  /** Supply a click id explicitly; otherwise it's captured from the landing URL. */
  clickId?: string;
  /**
   * Cookie domain for the persisted identity. Defaults to your registrable/top domain so every
   * subdomain shares one identity (e.g. app.example.com and www.example.com). Pass e.g.
   * "example.com" to set it explicitly, or a single host to scope identity to that subdomain only.
   */
  cookieDomain?: string;
}

export interface Scribe {
  init(options: InitOptions): Scribe;
  track(name: string, metadata?: Metadata): void;
  identify(userId?: string, traits?: Traits): void;
  reset(): void;
  flush(): void;
}

let tracker: Tracker | undefined;

export function init(options: InitOptions): Scribe {
  tracker = createTracker({
    site: options.site,
    endpoint: options.endpoint,
    consentDenied: options.consent === false,
    clickId: options.clickId,
    cookieDomain: options.cookieDomain,
  });
  if (typeof window !== "undefined") {
    (window as unknown as { scribe: Scribe }).scribe = scribe;
  }
  return scribe;
}

export function track(name: string, metadata?: Metadata): void {
  if (!tracker) {
    if (typeof console !== "undefined") console.warn("[scribe] call init({ site }) before track()");
    return;
  }
  tracker.track(name, metadata);
}

export function identify(userId?: string, traits?: Traits): void {
  if (!tracker) {
    if (typeof console !== "undefined") console.warn("[scribe] call init({ site }) before identify()");
    return;
  }
  tracker.identify(userId, traits);
}

export function reset(): void {
  if (!tracker) {
    if (typeof console !== "undefined") console.warn("[scribe] call init({ site }) before reset()");
    return;
  }
  tracker.reset();
}

export function flush(): void {
  tracker?.flush();
}

const scribe: Scribe = { init, track, identify, reset, flush };
export default scribe;
