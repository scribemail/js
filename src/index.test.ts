// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

function clearCookies(): void {
  for (const part of document.cookie.split(";")) {
    const key = part.split("=")[0].trim();
    if (key) document.cookie = `${key}=; Path=/; Max-Age=0`;
  }
}

// Each test re-imports a fresh module so the init() singleton state doesn't leak between examples.
describe("npm module — init / track", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
    clearCookies();
    // @ts-expect-error reset the global between examples
    delete window.scribe;
  });

  it("init() then track() captures the click id and sends the event to the endpoint", async () => {
    const beacon = vi.fn().mockReturnValue(false); // force the fetch fallback so we can read the body
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
    const fetchMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", fetchMock);
    history.replaceState({}, "", "/landing?scribe_click_id=click-abc");

    const { init } = await import("./index");
    const scribe = init({ id: "ws-uuid-1" });
    scribe.track("signup", { value: 12.5, currency: "EUR", plan: "team" });
    scribe.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://t.scribe-mail.com/tracking/events");
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

  it("exposes window.scribe and honors a custom endpoint", async () => {
    Object.defineProperty(navigator, "sendBeacon", { value: vi.fn().mockReturnValue(false), configurable: true });
    const fetchMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", fetchMock);
    history.replaceState({}, "", "/landing");

    const { init } = await import("./index");
    init({ id: "ws-2", endpoint: "https://track.example.com" });
    // @ts-expect-error global set by init
    window.scribe.track("page_view");
    // @ts-expect-error global set by init
    window.scribe.flush();

    expect(fetchMock.mock.calls[0][0]).toBe("https://track.example.com/tracking/events");
  });

  it("track() before init() is a no-op and warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", fetchMock);

    const { track, flush } = await import("./index");
    track("signup");
    flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it("identify() proxies to the tracker and stamps user_id on later track events", async () => {
    Object.defineProperty(navigator, "sendBeacon", { value: vi.fn().mockReturnValue(false), configurable: true });
    const fetchMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", fetchMock);
    history.replaceState({}, "", "/landing");

    const { init } = await import("./index");
    const scribe = init({ id: "ws-id" });
    scribe.identify("user_42", { email: "a@b.com" });
    scribe.track("signup");
    scribe.flush();

    const events = JSON.parse(fetchMock.mock.calls[0][1].body as string).events;
    const identify = events.find((e: { name: string }) => e.name === "$identify");
    expect(identify).toMatchObject({ user_id: "user_42", traits: { email: "a@b.com" } });
    const signup = events.find((e: { name: string }) => e.name === "signup");
    expect(signup.user_id).toBe("user_42");
    expect(signup.anonymous_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("identify() / reset() before init() are no-ops and warn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { identify, reset } = await import("./index");
    identify("user_42");
    reset();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
