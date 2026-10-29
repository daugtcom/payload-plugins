# daugt Payload plugins

Reusable Payload CMS plugins for client sites.

| Path | What |
|---|---|
| `packages/access` | Entitlements, series/course rules, engagement, course/member-area UI (`@daugtcom/payload-access`, `/ui`) |
| `packages/commerce` | Shop on `@payloadcms/plugin-ecommerce`: embedded Stripe checkout, subscriptions, shipping, invoices, cart/checkout/orders UI (`/ui`) |
| `packages/live` | Live video calls on LiveKit: `liveCall` block for group calls inside posts, direct calls for named people, themable call UI, recordings via LiveKit Egress to S3 (`@daugtcom/payload-live`, `/ui`, `/admin`). Standalone, see its README |
| `packages/booking` | Appointment booking for the shop: bookable products, availability, ICS busy time, slot holds, Stripe checkout, slot picker UI (`@daugtcom/payload-booking`, `/ui`). Needs commerce, optionally live |
| `packages/newsletter` | Newsletter: double opt-in signup (no captcha), block editor rendered with react-email in the site's mail theme, batched idempotent sending via Resend and the job queue, CSV import, bounce webhooks (`@daugtcom/payload-newsletter`, `/ui`, `/admin`). Uses the mail theme of access |
| `packages/passwordless` | Emailed code + magic link login, captcha, registration guards, terms, impersonation, login UI (`/ui`) |
| `dev/` | Plugin test bench: a Payload + Next app that loads every plugin |

npm manages dependencies and workspace scripts; Payload/Next.js and Vitest use Node 24. Use `npm test` to run the existing Vitest suite.

## Setup

```sh
mise install                 # Node 24 (includes npm)
npm install
mise run db:up               # scratch Postgres on :54330 (own volume, does not touch other projects)
cp dev/.env.example dev/.env.local   # then fill the Stripe TEST keys (never commit; .env* is gitignored)
```

## Everyday commands

```sh
npm run test        # all unit + integration tests (integration needs db:up)
npm run typecheck
cd dev && npm run dev  # reference shop on http://localhost:3100  (log in at /admin: member@dev.test / dev-dev-dev-1)
cd dev && npm run payload -- run src/seed.ts
```

Stripe in the dev app (TEST mode only): `stripe listen --latest --forward-to localhost:3100/api/payments/stripe-checkout/webhook`, put the printed `whsec_…` into `dev/.env.local` as `STRIPE_WEBHOOK_SECRET`.

## The sites

The two client sites, the importer for the old `daugt-saas` dumps and the deployment files live in the sibling repo `daugt/clients`. For local development the `clients` symlink points to that optional sibling checkout and exposes its packages to npm as workspace paths: after cloning both next to each other, `npm install` here installs both, and a change in a plugin shows up in the sites at once. The sites depend on the plugins by version (`^0.1.0`), which the local workspace satisfies; once the plugins are published, a clone of `clients` alone installs them from the registry.
