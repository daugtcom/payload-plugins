# @daugtcom/payload-newsletter

Newsletter for Payload sites: double opt-in signup, a block editor rendered with react-email in the site's mail theme, batched and idempotent sending through the Payload job queue, CSV import and Resend bounce webhooks. German UI.

```ts
import { payloadNewsletter } from '@daugtcom/payload-newsletter'
import { mailFor } from './site/mail' // { theme, layout } from @daugtcom/payload-mail

payloadNewsletter({
  theme: mail.theme,            // logo, colours, fonts (the same theme as booking and login mails)
  mailLayout: mail.layout,      // for the double opt-in mail
  serverURL,
  postalAddress: ['Margaretha Brunner', 'Musterweg 1', '1010 Wien'], // footer of every newsletter (required by law)
  teaserCollections: ['lessons', 'blog'],                            // pickable in a "Beitrags-Teaser" block
  hrefFor: (collection, doc) => hrefFor(collection, doc),
  imageUrl: (media) => publicBucketUrl(media),                       // mails need public picture addresses
})
```

Also add the component source to Tailwind (`@source ".../payload-newsletter/src/ui"`), `transpilePackages`, and run `payload generate:importmap` once.

The plugin also exports `newsletterSignupBlock` for a site’s page builder and `NewsletterSignupBlock` from `/ui`. Pass site-specific classes and privacy text to theme the block. Its `newsletter` slug and `title` / `description` fields preserve imported content. Email editor blocks are included in the newsletter collection.

## What it adds
- **Collections** (group "Newsletter"): `newsletterSubscribers`, `newsletters`, `newsletterDeliveries`.
- **Signup** `POST /api/newsletter/subscribe` `{ email, name?, website, ts }`: pending subscriber + confirmation mail. The answer is always `{ ok: true }` (no account enumeration); confirmed addresses are left alone. No captcha: a hidden honeypot field (`website`), a minimum fill time (`ts`, default 3 s) and rate limits (per IP: 8 per hour, in memory per process; per address: 3 per hour). `<NewsletterSignup />` from `/ui` is the form.
- **Confirm / unsubscribe** `GET /api/newsletter/confirm?token=…`, `GET|POST /api/newsletter/unsubscribe?token=…` (POST = RFC 8058 one-click; every newsletter carries `List-Unsubscribe` and `List-Unsubscribe-Post`). Tokens are HMACs of the Payload secret, nothing stored. Links redirect to `/newsletter/bestaetigt`, `/newsletter/abgemeldet`, `/newsletter/ungueltig` (option `pages`). Mail scanners that open links can confirm or unsubscribe by accident, as with every one-click link.
- **Editor**: blocks heading, text (bold, italic, links, lists), image, button, divider, image + text, post teaser. Under the blocks: a live preview (iframe, updates while you type), "Testmail an mich", and the send panel (recipient count, "Jetzt senden" with a confirmation step, "Planen").
- **Sending**: job `newsletterTick` every minute (starts scheduled newsletters, sends batches of 50, one mail every 600 ms, about 90 per minute for Resend's 2 requests/s) and `newsletterCleanup` daily (deletes pending signups older than 14 days). Something must run the queue: `jobs.autoRun` on a long-running server, or a cron calling `GET /api/payload-jobs/run`. Delivery is at most once per recipient: a delivery is claimed (queued → sending) before the mail goes out, so a crash leaves it "sending" for staff to look at instead of mailing twice. `audience(payload, newsletter)` can narrow who gets it (default: all confirmed).
- **Import** (staff): admin button above the subscribers list, `POST /api/newsletter/import` (JSON `{ csv, mode, attest, dryRun }`, `text/csv` or multipart). Dry run first (new / existing / invalid / duplicates / unsubscribed). Mode `reconfirm` (default) imports as pending and sends the opt-in mail; `already-consented` needs an explicit attestation text that is stored on every row. People the file marks unsubscribed or bounced are added as such and never mailed. Headers like ActiveCampaign's (`Email`, `First Name`, `Last Name`, `Status`), `;` or `,`, BOM and quotes are understood.
- **Webhook** `POST /api/newsletter/webhook/resend` (Svix signature, secret `RESEND_WEBHOOK_SECRET`): `email.bounced` (permanent) and `email.complained` mark the subscriber, who is never mailed again.

## Environment
`RESEND_API_KEY`, `EMAIL_FROM`, `NEWSLETTER_FROM`, `NEWSLETTER_POSTAL_ADDRESS`, `RESEND_WEBHOOK_SECRET`. Without a mail adapter (development) mails are only logged; the double opt-in mail with its link is printed to the server log.

## Tests
`npm test -w @daugtcom/payload-newsletter` (needs `mise run db:up`): signup, honeypot and rate limits, confirm / unsubscribe, cleanup, rendering, batch idempotency, schedule tick, CSV, staff access, webhook signature.
