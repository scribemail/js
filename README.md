# @scribemail/js

The [Scribe](https://scribe-mail.com) **event tracking** SDK — record conversions (signups,
purchases, demos booked…) from your website and tie them to the visitors who triggered them. Use it
as an npm package or as a single `<script>` tag; both share the same `scribe.track(...)` API.

When a visitor arrives from a [Scribe email-signature](https://scribe-mail.com) link, the SDK
automatically attributes their events to that click — no extra setup needed.

## Install (npm / yarn)

```bash
npm install @scribemail/js
# or: yarn add @scribemail/js
```

```js
import scribe from '@scribemail/js';

scribe.init({ site: 'YOUR_EVENT_TRACKING_ID' }); // once, at app startup
scribe.track('signup', { value: 99.0, currency: 'USD' });
```

Named imports work too (`import { init, track, identify } from '@scribemail/js'`). Ships ESM + CJS +
TypeScript types, and is SSR-safe — importing has no side effects, and nothing is sent until you
call `init()`.

## Or via `<script>`

```html
<!-- Scribe event tracking -->
<script src="https://cdn-1.scribe-mail.com/v1/tracking.js"
        data-workspace="YOUR_EVENT_TRACKING_ID" async></script>
<script>
  scribe.track('signup', { value: 99.00, currency: 'USD' });
</script>
```

- `data-workspace` — your **Event Tracking ID**, a public (non-secret) site id from your
  [Scribe dashboard](https://scribe-mail.com).
- `data-consent="denied"` — start with tracking storage disabled (see [Consent & privacy](#consent--privacy)).
- `data-cookie-domain="example.com"` — set the identity cookie's domain explicitly (see
  [Cross-subdomain identity](#cross-subdomain-identity)). Optional; defaults to your top domain.

The snippet auto-initializes and exposes a global `scribe`.

## API

```js
scribe.init({ site, consent?, cookieDomain? }); // npm only; the snippet auto-inits from data-* attributes
scribe.track(name, metadata?);     // record an event
scribe.identify(userId?, traits?); // associate this visitor's events with one of your users
scribe.reset();                    // clear the identity (call on logout)
scribe.flush();                    // force-send the current batch now
```

`track(name, metadata)`:

- `name` — the event, e.g. `'signup'`, `'demo_booked'`, `'purchase'`.
- `metadata` *(optional)* — `value` and `currency` are recognized; any other keys become the event's
  `properties`. Don't put `user_id` / `anonymous_id` here — identity is managed for you (see below).

Events are batched and sent automatically (after a short delay, and when the page is hidden), so you
rarely need `flush()`.

## Identifying visitors

The SDK keeps a **sticky identity** so you set it once and forget it. On first load it creates a
first-party anonymous id (stored in a cookie on your top domain — see
[Cross-subdomain identity](#cross-subdomain-identity)) and attaches it to **every** event. Call
`identify` once you know who the visitor is — typically right after login or signup:

```js
scribe.identify('user_42', { email: 'ada@example.com', name: 'Ada', plan: 'pro' });
scribe.track('signup'); // automatically carries user_42 + the anonymous id
```

- **It's a memo, not a per-call argument.** After `identify`, every later `track` call automatically
  includes the user id and anonymous id. You never pass them yourself.
- **It persists across sessions.** A returning visitor stays identified on their next visit without
  calling `identify` again.
- **`traits`** are a flat bag of scalars (`string` / `number` / `boolean` / `null`) — e.g. name,
  email, plan. Send identity attributes through `traits`, not through `track` properties. Calling
  `identify` again merges new traits over the existing ones.
- **`reset()` on logout** (or on a shared device) clears the stored identity and starts a fresh,
  unlinked anonymous visitor.

## Cross-subdomain identity

Identity (anonymous id, user id, click id, and traits) is persisted in **first-party cookies**. By
default the SDK detects your **registrable/top domain** and scopes the cookies there (e.g.
`example.com`), so a visitor is the **same identity** across every subdomain — `www.example.com`,
`app.example.com`, `shop.example.com`. No configuration needed.

Override the domain when the default isn't what you want:

```js
// npm
scribe.init({ site: 'YOUR_EVENT_TRACKING_ID', cookieDomain: 'example.com' });
```

```html
<!-- script tag -->
<script src="https://cdn-1.scribe-mail.com/v1/tracking.js"
        data-workspace="YOUR_EVENT_TRACKING_ID"
        data-cookie-domain="example.com" async></script>
```

- Pass your apex domain (e.g. `example.com`) to share identity across all its subdomains — this is
  also the auto-detected default.
- Pass a single host (e.g. `app.example.com`) to scope identity to that subdomain only.
- On `localhost` or a bare IP there's no shareable parent domain, so a host-only cookie is used
  (handy for local development).

Cookies are set with `Path=/; SameSite=Lax` (and `Secure` on HTTPS). Note that Safari (ITP) caps
JavaScript-set cookies to 7 days.

## Consent & privacy

With `consent: false` (npm) or `data-consent="denied"` (snippet), the SDK stores nothing, mints no
anonymous id, and `identify()` is a no-op — events are sent fully anonymously. Switch consent on
once the visitor agrees, and tracking begins from that point.

## Content Security Policy

If your site uses a Content Security Policy, allowlist the Scribe domains:

```
script-src  https://cdn-1.scribe-mail.com;   # only needed for the <script> snippet
connect-src https://t.scribe-mail.com;        # where events are sent
```

## About Scribe

This SDK is built and maintained by **[Scribe](https://scribe-mail.com)** — email signatures,
finally **simple and measurable**. Deploy consistent, branded signatures across your whole company
in under a day (no per-employee install, zero IT tickets), then turn every email your team sends
into a measurable channel — signature banners see a **12% average click-through rate**, ~6× typical
email marketing.

This `track()` SDK closes the loop: it ties those signature clicks all the way through to
**[conversion tracking from click to revenue](https://scribe-mail.com)** on your own site.

- 🌐 Website: **[scribe-mail.com](https://scribe-mail.com)**
- ✍️ [Email signature management for teams](https://scribe-mail.com) — built for teams & AI agents
- 📈 [Conversion tracking & attribution](https://scribe-mail.com) — from click to revenue
- 🔌 Composable, with a built-in [API and MCP tools](https://scribe-mail.com)

[Start a free 14-day trial →](https://scribe-mail.com) — no card required, all features, unlimited users.

## License

MIT
