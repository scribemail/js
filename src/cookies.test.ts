// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { deleteCookie, detectTopDomain, readCookie, resolveCookieDomain, writeCookie } from "./cookies";

function clearCookies(): void {
  for (const part of document.cookie.split(";")) {
    const key = part.split("=")[0].trim();
    if (key) document.cookie = `${key}=; Path=/; Max-Age=0`;
  }
}

describe("cookies — read/write round-trip", () => {
  afterEach(clearCookies);

  it("writes and reads a value, url-encoding the payload", () => {
    writeCookie("scribe_mail_traits", JSON.stringify({ plan: "pro", name: "Ada" }));
    expect(readCookie("scribe_mail_traits")).toBe('{"plan":"pro","name":"Ada"}');
    // the raw header is encoded — no bare braces/quotes leak in (which would break cookie parsing)
    expect(document.cookie).not.toContain('"plan"');
  });

  it("returns undefined for an absent cookie and after delete", () => {
    expect(readCookie("scribe_mail_user_id")).toBeUndefined();
    writeCookie("scribe_mail_user_id", "user_42");
    expect(readCookie("scribe_mail_user_id")).toBe("user_42");
    deleteCookie("scribe_mail_user_id");
    expect(readCookie("scribe_mail_user_id")).toBeUndefined();
  });
});

describe("cookies — serialized attributes", () => {
  // Override document.cookie so we can inspect the raw Set-Cookie string the SDK produces.
  function captureWrites(): { writes: string[]; restore: () => void } {
    const writes: string[] = [];
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => "",
      set: (v: string) => void writes.push(String(v)),
    });
    // @ts-expect-error reveal the prototype accessor again on restore
    return { writes, restore: () => delete document.cookie };
  }

  it("includes Domain when given and omits it for a host-only cookie", () => {
    const { writes, restore } = captureWrites();
    writeCookie("scribe_mail_anonymous_id", "anon-1", "example.com");
    writeCookie("scribe_mail_anonymous_id", "anon-1");
    restore();
    expect(writes[0]).toContain("scribe_mail_anonymous_id=anon-1");
    expect(writes[0]).toContain("Domain=example.com");
    expect(writes[0]).toContain("Path=/");
    expect(writes[0]).toContain("SameSite=Lax");
    expect(writes[0]).toMatch(/Max-Age=\d+/);
    expect(writes[1]).not.toContain("Domain=");
  });

  it("deletes with Max-Age=0 on the same Domain", () => {
    const { writes, restore } = captureWrites();
    deleteCookie("scribe_mail_user_id", "example.com");
    restore();
    expect(writes[0]).toContain("Max-Age=0");
    expect(writes[0]).toContain("Domain=example.com");
  });
});

describe("detectTopDomain", () => {
  // Simulate a browser cookie jar that rejects Set-Cookie for the given public suffixes (as real
  // browsers do), so we can assert the selection logic deterministically without the PSL.
  function installJar(publicSuffixes: string[]): () => void {
    const jar = new Map<string, string>();
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
      set: (raw: string) => {
        const str = String(raw);
        const pair = str.split(";")[0];
        const eq = pair.indexOf("=");
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        const maxAge = /Max-Age=(-?\d+)/i.exec(str);
        if (maxAge && Number(maxAge[1]) <= 0) return void jar.delete(name);
        const domain = /Domain=([^;]+)/i.exec(str)?.[1].trim();
        if (domain && publicSuffixes.includes(domain)) return; // browser refuses a public-suffix cookie
        jar.set(name, value);
      },
    });
    // @ts-expect-error reveal the prototype accessor again
    return () => delete document.cookie;
  }

  it("returns the registrable domain (eTLD+1), skipping the bare TLD", () => {
    const restore = installJar(["com"]);
    expect(detectTopDomain("a.b.example.com")).toBe("example.com");
    restore();
  });

  it("handles multi-level public suffixes like co.uk", () => {
    const restore = installJar(["uk", "co.uk"]);
    expect(detectTopDomain("shop.example.co.uk")).toBe("example.co.uk");
    restore();
  });

  it("returns undefined for localhost, single-label hosts, and IPs", () => {
    expect(detectTopDomain("localhost")).toBeUndefined();
    expect(detectTopDomain("intranet")).toBeUndefined();
    expect(detectTopDomain("127.0.0.1")).toBeUndefined();
  });
});

describe("resolveCookieDomain", () => {
  afterEach(clearCookies);

  it("returns an explicit override verbatim without probing", () => {
    expect(resolveCookieDomain("example.com")).toBe("example.com");
    expect(resolveCookieDomain(".my.app")).toBe(".my.app");
  });

  it("falls back to a host-only cookie on localhost (no detectable top domain)", () => {
    // jsdom runs on http://localhost → no shareable parent domain.
    expect(resolveCookieDomain()).toBeUndefined();
  });
});
