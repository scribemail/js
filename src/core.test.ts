// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildEvent, createTracker, getAnonymousId, uuid, type ScribeEvent } from "./core";

describe("buildEvent", () => {
  it("maps value/currency to top level and the rest to properties", () => {
    const event = buildEvent("signup", { value: 99, currency: "USD", plan: "pro" });
    expect(event.name).toBe("signup");
    expect(event.value).toBe(99);
    expect(event.currency).toBe("USD");
    expect(event.properties).toEqual({ plan: "pro" });
    expect(event.event_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("merges an explicit properties object with flat extras", () => {
    const event = buildEvent("signup", { properties: { a: 1 }, b: 2 });
    expect(event.properties).toEqual({ a: 1, b: 2 });
  });

  it("honors a caller-supplied event_id and includes the click_id when present", () => {
    const event = buildEvent("signup", { event_id: "evt-1" }, "click-123");
    expect(event.event_id).toBe("evt-1");
    expect(event.click_id).toBe("click-123");
  });

  it("omits value/currency/click_id when not provided", () => {
    const event = buildEvent("signup");
    expect(event.value).toBeUndefined();
    expect(event.currency).toBeUndefined();
    expect(event.click_id).toBeUndefined();
  });

  it("attaches anonymous_id/user_id from the supplied identity, not from metadata", () => {
    const event = buildEvent("signup", { user_id: "spoofed", anonymous_id: "spoofed" }, undefined, "anon-1", "user-1");
    expect(event.anonymous_id).toBe("anon-1");
    expect(event.user_id).toBe("user-1");
    // a caller can't inject identity through metadata — it's stripped from properties too
    expect(event.properties).toEqual({});
  });
});

describe("uuid", () => {
  it("produces a v4-shaped uuid", () => {
    expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});

describe("getAnonymousId", () => {
  afterEach(() => localStorage.clear());

  it("mints once and is sticky across calls", () => {
    const first = getAnonymousId();
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(getAnonymousId()).toBe(first);
    expect(localStorage.getItem("scribe_anonymous_id")).toBe(first);
  });

  it("returns undefined and writes nothing when consent is denied", () => {
    expect(getAnonymousId(true)).toBeUndefined();
    expect(localStorage.getItem("scribe_anonymous_id")).toBeNull();
  });
});

describe("createTracker — sticky identity", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // Force the fetch fallback so we can read the JSON body off the request.
  function trackerWithCapture(opts: { consentDenied?: boolean } = {}) {
    const sent: ScribeEvent[] = [];
    Object.defineProperty(navigator, "sendBeacon", { value: vi.fn().mockReturnValue(false), configurable: true });
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: { body: string }) => {
        sent.push(...JSON.parse(init.body).events);
        return Promise.resolve(undefined);
      }),
    );
    const tracker = createTracker({ site: "ws-1", consentDenied: opts.consentDenied });
    return { tracker, events: () => sent };
  }

  it("mints an anonymous_id and attaches it to every event", () => {
    const { tracker, events } = trackerWithCapture();
    tracker.track("page_view");
    tracker.track("signup");
    tracker.flush();
    const anon = events()[0].anonymous_id;
    expect(anon).toMatch(/^[0-9a-f-]{36}$/);
    expect(events()[1].anonymous_id).toBe(anon);
    expect(events().every((e) => e.user_id === undefined)).toBe(true);
  });

  it("identify emits one $identify with traits TOP-LEVEL (not in properties)", () => {
    const { tracker, events } = trackerWithCapture();
    tracker.identify("user-42", { email: "a@b.com", name: "Ada" });
    tracker.flush();
    expect(events()).toHaveLength(1);
    const ev = events()[0];
    expect(ev.name).toBe("$identify");
    expect(ev.user_id).toBe("user-42");
    expect(ev.traits).toEqual({ email: "a@b.com", name: "Ada" });
    expect(ev.properties).toBeUndefined();
    expect(ev.event_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("stamps user_id on every subsequent track after identify", () => {
    const { tracker, events } = trackerWithCapture();
    tracker.identify("user-42");
    tracker.track("signup");
    tracker.flush();
    const signup = events().find((e) => e.name === "signup");
    expect(signup?.user_id).toBe("user-42");
    expect(signup?.anonymous_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("accumulates traits across two identify calls", () => {
    const { tracker, events } = trackerWithCapture();
    tracker.identify(undefined, { plan: "free" });
    tracker.identify("user-42", { plan: "pro", name: "Ada" });
    tracker.flush();
    const last = events()[1];
    expect(last.user_id).toBe("user-42");
    expect(last.traits).toEqual({ plan: "pro", name: "Ada" });
  });

  it("identify with no userId omits user_id but still carries traits", () => {
    const { tracker, events } = trackerWithCapture();
    tracker.identify(undefined, { plan: "free" });
    tracker.flush();
    const ev = events()[0];
    expect(ev.user_id).toBeUndefined();
    expect(ev.traits).toEqual({ plan: "free" });
    expect(ev.anonymous_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("is fully anonymous and identify is a no-op under consent denial", () => {
    const { tracker, events } = trackerWithCapture({ consentDenied: true });
    tracker.identify("user-42", { email: "a@b.com" });
    tracker.track("signup");
    tracker.flush();
    // no $identify emitted, and the lone track event carries no identity
    expect(events().some((e) => e.name === "$identify")).toBe(false);
    const signup = events().find((e) => e.name === "signup");
    expect(signup?.anonymous_id).toBeUndefined();
    expect(signup?.user_id).toBeUndefined();
    expect(localStorage.getItem("scribe_user_id")).toBeNull();
    expect(localStorage.getItem("scribe_anonymous_id")).toBeNull();
  });

  it("reset rotates the anonymous id and clears user_id/traits", () => {
    const { tracker, events } = trackerWithCapture();
    tracker.identify("user-42", { plan: "pro" });
    tracker.track("before");
    tracker.reset();
    tracker.track("after");
    tracker.flush();
    const before = events().find((e) => e.name === "before")!;
    const after = events().find((e) => e.name === "after")!;
    expect(after.user_id).toBeUndefined();
    expect(after.anonymous_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(after.anonymous_id).not.toBe(before.anonymous_id);
    expect(localStorage.getItem("scribe_user_id")).toBeNull();
    expect(localStorage.getItem("scribe_traits")).toBeNull();
  });

  it("seeds identity from storage so a returning visitor is identified without re-calling identify", () => {
    // First "session" persists identity.
    const first = trackerWithCapture();
    first.tracker.identify("user-42", { plan: "pro" });
    first.tracker.flush();

    // New tracker (a fresh session) reads it back from storage.
    const second = trackerWithCapture();
    second.tracker.track("returning");
    second.tracker.flush();
    const ev = second.events().find((e) => e.name === "returning")!;
    expect(ev.user_id).toBe("user-42");
  });
});
