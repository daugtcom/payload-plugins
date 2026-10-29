import type { Payload } from 'payload'
import type { MailTheme } from '@daugtcom/payload-mail'

export type Id = string | number

export interface MailContent {
  preheader?: string
  eyebrow?: string
  heading: string
  paragraphs?: string[]
  facts?: { label: string; value: string }[]
  button?: { label: string; href: string }
  note?: string[]
  signoff?: string
}
export type MailLayout = (c: MailContent) => { html: string; text: string } | Promise<{ html: string; text: string }>

export interface NewsletterPluginOptions {
  enabled?: boolean
  /** The site's mail theme (logo, colours, fonts). Used for the newsletter body and footer. */
  theme: MailTheme
  /** Public base URL of the site, for links in mails. Default: the Payload `serverURL`. */
  serverURL?: string
  /** Layout for the system mails (double opt-in). Pass `mailLayout(theme)` from `@daugtcom/payload-mail`. Defaults to the shared React Email template. */
  mailLayout?: MailLayout
  /** Postal address / imprint line in every newsletter footer (required by law in DE/AT). */
  postalAddress?: string[]
  /** Name in the double opt-in mail and as "reply" sign-off. Default: the theme's site name. */
  senderName?: string
  /** `From` of newsletters, e.g. `Margaretha Brunner <newsletter@margarethabrunner.com>`. Default: the email adapter's default. */
  from?: string
  /** Optional reply-to address. */
  replyTo?: string
  /** `mailto:` address for the List-Unsubscribe header (besides the one-click URL). Optional. */
  unsubscribeMailto?: string
  usersSlug?: string
  subscribersSlug?: string
  newslettersSlug?: string
  deliveriesSlug?: string
  mediaSlug?: string
  /** Collections whose documents can be picked in a "post teaser" block, e.g. `['lessons', 'blog']`. Default none (block hidden). */
  teaserCollections?: string[]
  /** Address of a document for teasers. Default `/<slug>`. */
  hrefFor?: (collection: string, doc: Record<string, any>) => string
  /** Excerpt of a teaser document (plain text). Default: `summary` / `excerpt`, else the first words of `body`. */
  excerptFor?: (collection: string, doc: Record<string, any>) => string | undefined
  /** Absolute image address for a media document (mails need public URLs). Default: `sizes.optimized.url` / `url`, made absolute with `serverURL`. */
  imageUrl?: (media: Record<string, any>) => string | undefined
  isStaff?: (user: unknown) => boolean
  /** Where the confirm / unsubscribe links lead afterwards. */
  pages?: { confirmed?: string; unsubscribed?: string; invalid?: string }
  /** Pending subscribers older than this many days are deleted. Default 14. */
  pendingDays?: number
  /** Recipients per batch of the send job. Default 50. */
  batchSize?: number
  /** Pause between two sent mails (ms): Resend allows about 2 per second. Default 600. */
  sendDelayMs?: number
  /** Time one run of the send job may take (ms). Default 50 000. */
  sendBudgetMs?: number
  /** Signup rate limit per IP: `max` requests in `windowMinutes`. Default 8 / 60. In-memory, per process. */
  rateLimit?: { max?: number; windowMinutes?: number }
  /** Minimum seconds between loading the form and submitting it (bots submit instantly). Default 3. */
  minFillSeconds?: number
  /** Who gets a newsletter. Default: every confirmed subscriber. Return subscriber ids or emails (they must be confirmed subscribers). */
  audience?: (payload: Payload, newsletter: Record<string, any>) => Promise<Id[] | string[]>
  /** Resend webhook signing secret (`whsec_…`). Default `process.env.RESEND_WEBHOOK_SECRET`. */
  webhookSecret?: string
}

export interface ResolvedNewsletterOptions {
  theme: MailTheme
  serverURL?: string
  mailLayout?: MailLayout
  postalAddress: string[]
  senderName: string
  from?: string
  replyTo?: string
  unsubscribeMailto?: string
  usersSlug: string
  subscribersSlug: string
  newslettersSlug: string
  deliveriesSlug: string
  mediaSlug: string
  teaserCollections: string[]
  hrefFor: (collection: string, doc: Record<string, any>) => string
  excerptFor: NonNullable<NewsletterPluginOptions['excerptFor']>
  imageUrl?: NewsletterPluginOptions['imageUrl']
  isStaff: (user: unknown) => boolean
  pages: { confirmed: string; unsubscribed: string; invalid: string }
  pendingDays: number
  batchSize: number
  sendDelayMs: number
  sendBudgetMs: number
  rateLimit: { max: number; windowMinutes: number }
  minFillSeconds: number
  audience?: NewsletterPluginOptions['audience']
  webhookSecret?: string
}
