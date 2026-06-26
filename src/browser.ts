// Browser <script> entry point — bundled to the auto-booting IIFE served at
// cdn-1.scribe-mail.com/v1/tracking.js. Reads configuration from the snippet's data-* attributes,
// exposes window.scribe, and drains any pre-load queue. (For bundler/app code, import the npm
// module from src/index.ts instead.)

import { createTracker, type Metadata, type Tracker, type Traits } from "./core";

const VERSION = "0.2.0";

interface ScribeGlobal extends Tracker {
  version: string;
}

export function boot(): void {
  const w = window as unknown as { scribe?: { track?: unknown; q?: unknown[] } };
  if (w.scribe && typeof w.scribe.track === "function") return; // already booted

  const script =
    (document.currentScript as HTMLScriptElement | null) ??
    document.querySelector<HTMLScriptElement>("script[data-workspace]");
  const site = script?.getAttribute("data-workspace") ?? "";
  if (!site) return;

  const queued = Array.isArray(w.scribe?.q) ? (w.scribe as { q: unknown[] }).q : [];

  const tracker = createTracker({
    site,
    endpoint: script?.getAttribute("data-endpoint") || undefined,
    consentDenied: script?.getAttribute("data-consent") === "denied",
  });

  const api: ScribeGlobal = {
    track: tracker.track,
    identify: tracker.identify,
    reset: tracker.reset,
    flush: tracker.flush,
    version: VERSION,
  };
  (w as unknown as { scribe: ScribeGlobal }).scribe = api;

  // Drain pre-load calls made via the optional function stub, e.g. scribe('track', name, meta) /
  // scribe('identify', userId, traits) / scribe('reset'), dispatched on the verb.
  for (const args of queued) {
    if (!Array.isArray(args)) continue;
    if (args[0] === "track") tracker.track(args[1] as string, args[2] as Metadata);
    else if (args[0] === "identify") tracker.identify(args[1] as string | undefined, args[2] as Traits | undefined);
    else if (args[0] === "reset") tracker.reset();
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined") boot();
