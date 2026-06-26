# @scribe-sas/js

The Scribe **event tracking** SDK — the bottom of the signature funnel (views → clicks → events).
Use it two ways, with the same `scribe.track(...)` API:

- **npm/yarn package** — `import` it into your app/bundler (recommended for SPAs and frameworks).
- **`<script>` snippet** — a single tag, no build step (served from the CDN).

## Option A — npm / yarn

```bash
npm install @scribe-sas/js
# or: yarn add @scribe-sas/js
```

```js
import scribe from '@scribe-sas/js';

scribe.init({ site: 'YOUR_EVENT_TRACKING_ID' }); // once, at app startup
scribe.track('signup', { value: 99.0, currency: 'USD' });
```

Named imports work too: `import { init, track, flush } from '@scribe-sas/js'`. Ships ESM + CJS +
TypeScript types; importing the module has no side effects (SSR-safe) — nothing is sent until you
call `init()`.

## Option B — `<script>` snippet

```html
<!-- Scribe event tracking -->
<script src="https://cdn-1.scribe-mail.com/v1/tracking.js"
        data-workspace="YOUR_EVENT_TRACKING_ID" async></script>
<script>
  scribe.track('signup', { value: 99.00, currency: 'USD' });
</script>
```

- `data-workspace` is your **Event Tracking ID** (the workspace's `event_tracking_uuid`, a public,
  non-secret site id — find it in the dashboard). It routes; it does not authenticate.
- `data-endpoint` (optional) overrides the ingest base host.
- `data-consent="denied"` disables first-party storage (click id **and** visitor identity — see
  "Identifying visitors").

## API

```js
scribe.init({ site, endpoint?, consent?, clickId? }); // npm only; the snippet auto-inits from data-*
scribe.track(name, metadata);
// name      — the event, e.g. 'signup' | 'demo_booked' | 'purchase'
// metadata  — { value?, currency?, event_id?, ...anyOtherKeys }
//             value/currency are recognized; everything else becomes the `properties` bag.
//             Do NOT put user_id/anonymous_id in metadata — they're stripped (see "Identifying visitors").
scribe.identify(userId?, traits?); // tie events to one of your users; persists + auto-stamps later events
scribe.reset();                    // clear the identity + rotate the anonymous id (call on logout)
scribe.flush(); // force-send the current batch (also auto-flushes on page hide)
```

On load the SDK reads `?scribe_click_id` from the landing URL (set by the signature click
redirect), stores it first-party (unless consent is denied), and echoes it on every event so the
backend attributes the event to the originating click. Events batch and flush on
`visibilitychange`/`pagehide` via `navigator.sendBeacon` (`text/plain` → CORS simple request, no
preflight), falling back to `fetch(…, { keepalive: true })`.

## Identifying visitors

The SDK keeps a **sticky identity** so you set it once and forget it. On first load it mints a
first-party `anonymous_id` (persisted in `localStorage`) and stamps it on **every** event. Call
`identify` when you learn who the visitor is — typically right after login or signup:

```js
scribe.identify('user_42', { email: 'ada@example.com', name: 'Ada', plan: 'pro' });
scribe.track('signup'); // automatically carries user_id: 'user_42' + the anonymous_id
```

- **It's a memo, not a per-call argument.** Once identified, every later `track` call auto-attaches
  `user_id` and `anonymous_id`. You never pass them yourself — and you shouldn't: `user_id` /
  `anonymous_id` keys in `track` metadata are **stripped** so a stray field can't override the
  managed identity.
- **It persists across sessions.** Both the `anonymous_id` and the identified `user_id` are stored
  first-party, so a returning visitor is still identified on their next visit without re-calling
  `identify`.
- **`traits` are a flat bag of scalars** (`string` / `number` / `boolean` / `null`) — e.g. name,
  email, plan. They ride the reserved `$identify` event as a dedicated PII channel; calling
  `identify` again merges new traits over the old ones. (Don't send identity data via `track`
  `properties` — the backend strips PII from `properties`.)
- **`reset()` on logout** (or on a shared device) clears the stored `user_id` + traits and rotates
  the `anonymous_id`, so the next visitor starts as a fresh, unlinked anonymous user.

**Consent:** with `consent: false` (npm) or `data-consent="denied"` (snippet), no `anonymous_id` is
minted or sent, `identify()` is a no-op (no `$identify`, no stored PII), and events stay fully
anonymous.

## Ingest host

Events are sent to `POST https://t.scribe-mail.com/tracking/events`. Override the base host per
init (`endpoint`) or per snippet (`data-endpoint`) — mainly useful for testing.

## Develop

```bash
pnpm install
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
pnpm build       # → dist/v1/tracking.js (IIFE) + dist/index.{mjs,cjs} + dist/index.d.ts
```

`pnpm build` produces both distributions: the auto-booting IIFE for the CDN snippet
(`dist/v1/tracking.js`, minified, ~1.5KB gzipped) and the npm module (ESM `dist/index.mjs`, CJS
`dist/index.cjs`, types `dist/index.d.ts`).

## Releasing

Releases are automated by [`.github/workflows/release.yml`](.github/workflows/release.yml), which
fires on a pushed version tag (`vX.Y.Z`). To cut a release:

```bash
npm version patch   # or minor / major — bumps package.json and creates the matching git tag
git push --follow-tags
```

The workflow then verifies the tag matches `package.json`, runs typecheck + tests + build, and:

1. **npm** — publishes `@scribe-sas/js` (public, with build provenance).
2. **CDN** — uploads `dist/v1/tracking.js` (+ sourcemap) to the Cloudflare R2 bucket behind
   `cdn-1.scribe-mail.com`, under the **major-versioned** path the snippet URL uses
   (`v1/tracking.js`). Patch/minor releases overwrite within a major; a breaking change ships under
   `v2/*` (bump the major), so each `v<major>` URL stays stable for embedders.
3. **Cache** — purges the Cloudflare edge cache for those URLs so the new build is live immediately.
4. **GitHub Release** — published with auto-generated notes and the built IIFE attached.

Required repository secrets: `NPM_TOKEN`, `CLOUDFLARE_API_TOKEN` (R2 write + cache purge),
`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`. The R2 bucket name and CDN base host are set as
`env:` at the top of the release workflow.
