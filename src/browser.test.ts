// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

// The <script> path: boot() reads data-* off the snippet, exposes window.scribe, and sends.
describe("browser bundle — boot from a <script> tag", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    document.head.innerHTML = "";
    // @ts-expect-error reset the global between examples
    delete window.scribe;
  });

  it("captures scribe_click_id, exposes window.scribe, and flushes the batch", async () => {
    const beacon = vi.fn().mockReturnValue(false); // force fetch fallback to inspect the body
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
    const fetchMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", fetchMock);
    history.replaceState({}, "", "/landing?scribe_click_id=click-abc");

    const script = document.createElement("script");
    script.setAttribute("data-workspace", "ws-uuid-1");
    script.setAttribute("data-endpoint", "https://track.example.com");
    document.head.appendChild(script);
    Object.defineProperty(document, "currentScript", { value: script, configurable: true });

    const { boot } = await import("./browser");
    boot();

    // @ts-expect-error global set by boot
    window.scribe.track("signup", { value: 12.5, currency: "EUR", plan: "team" });
    // @ts-expect-error global set by boot
    window.scribe.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://track.example.com/tracking/events");
    const payload = JSON.parse(options.body as string);
    expect(payload.site).toBe("ws-uuid-1");
    expect(payload.events[0]).toMatchObject({
      name: "signup",
      value: 12.5,
      currency: "EUR",
      click_id: "click-abc",
      properties: { plan: "team" },
    });
  });

  it("exposes identify/reset and drains queued ['identify', …] / ['reset'] pre-load calls", async () => {
    Object.defineProperty(navigator, "sendBeacon", { value: vi.fn().mockReturnValue(false), configurable: true });
    const fetchMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", fetchMock);
    history.replaceState({}, "", "/landing");

    const script = document.createElement("script");
    script.setAttribute("data-workspace", "ws-uuid-1");
    document.head.appendChild(script);
    Object.defineProperty(document, "currentScript", { value: script, configurable: true });

    // Pre-load stub queue, as if the snippet buffered calls before the IIFE booted.
    (window as unknown as { scribe: { q: unknown[] } }).scribe = {
      q: [["identify", "user_99", { plan: "pro" }], ["track", "signup"]],
    };

    const { boot } = await import("./browser");
    boot();

    const w = window as unknown as { scribe: { identify: unknown; reset: unknown; flush: () => void } };
    expect(typeof w.scribe.identify).toBe("function");
    expect(typeof w.scribe.reset).toBe("function");
    w.scribe.flush();

    const events = JSON.parse(fetchMock.mock.calls[0][1].body as string).events;
    const identify = events.find((e: { name: string }) => e.name === "$identify");
    expect(identify).toMatchObject({ user_id: "user_99", traits: { plan: "pro" } });
    const signup = events.find((e: { name: string }) => e.name === "signup");
    expect(signup.user_id).toBe("user_99");
  });
});
