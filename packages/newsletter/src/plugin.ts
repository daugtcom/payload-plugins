import type { Config, Plugin } from 'payload'
import { NEWSLETTER_CUSTOM_KEY } from './constants'
import { deliveriesCollection } from './collections/deliveries'
import { newslettersCollection } from './collections/newsletters'
import { subscribersCollection } from './collections/subscribers'
import { newsletterEndpoints } from './endpoints'
import type { NewsletterPluginOptions, ResolvedNewsletterOptions } from './options'
import { deleteStalePending } from './subscribe'
import { tick } from './send'

const defaultIsStaff = (user: unknown): boolean => {
  const u = user as { roles?: string[]; role?: string } | null
  return Boolean(u && (u.role === 'admin' || (Array.isArray(u.roles) && u.roles.includes('admin'))))
}

export const resolveOptions = (o: NewsletterPluginOptions): ResolvedNewsletterOptions => ({
  theme: o.theme,
  serverURL: o.serverURL,
  mailLayout: o.mailLayout,
  postalAddress: o.postalAddress ?? [],
  senderName: o.senderName ?? o.theme.siteName,
  from: o.from,
  replyTo: o.replyTo,
  unsubscribeMailto: o.unsubscribeMailto,
  usersSlug: o.usersSlug ?? 'users',
  subscribersSlug: o.subscribersSlug ?? 'newsletterSubscribers',
  newslettersSlug: o.newslettersSlug ?? 'newsletters',
  deliveriesSlug: o.deliveriesSlug ?? 'newsletterDeliveries',
  mediaSlug: o.mediaSlug ?? 'media',
  teaserCollections: o.teaserCollections ?? [],
  hrefFor: o.hrefFor ?? ((_c, doc) => `/${doc.slug ?? ''}`),
  excerptFor: o.excerptFor ?? (() => undefined),
  imageUrl: o.imageUrl,
  isStaff: o.isStaff ?? defaultIsStaff,
  pages: { confirmed: '/newsletter/bestaetigt', unsubscribed: '/newsletter/abgemeldet', invalid: '/newsletter/ungueltig', ...o.pages },
  pendingDays: o.pendingDays ?? 14,
  batchSize: o.batchSize ?? 50,
  sendDelayMs: o.sendDelayMs ?? 600,
  sendBudgetMs: o.sendBudgetMs ?? 50_000,
  rateLimit: { max: o.rateLimit?.max ?? 8, windowMinutes: o.rateLimit?.windowMinutes ?? 60 },
  minFillSeconds: o.minFillSeconds ?? 3,
  audience: o.audience,
  webhookSecret: o.webhookSecret,
})

/**
 * Newsletter: double opt-in signup, a block editor rendered with react-email in the site's mail theme, batched idempotent sending through the
 * Payload job queue, CSV import and Resend bounce webhooks. Two jobs: `newsletterTick` (every minute: start scheduled newsletters, send batches)
 * and `newsletterCleanup` (daily: delete signups nobody confirmed). Something has to run the queue: `jobs.autoRun` on a long-running server,
 * or a cron calling `GET /api/payload-jobs/run` on serverless.
 */
export const payloadNewsletter =
  (options: NewsletterPluginOptions): Plugin =>
  (incoming: Config): Config => {
    if (options.enabled === false) return incoming
    const o = resolveOptions(options)
    return {
      ...incoming,
      collections: [...(incoming.collections ?? []), subscribersCollection(o), newslettersCollection(o), deliveriesCollection(o)],
      endpoints: [...(incoming.endpoints ?? []), ...newsletterEndpoints(o)],
      jobs: {
        ...incoming.jobs,
        tasks: [
          ...(incoming.jobs?.tasks ?? []),
          { slug: 'newsletterTick', schedule: [{ cron: '* * * * *', queue: 'default' }], handler: async ({ req }) => ({ output: { ...(await tick(req.payload, o)) } }) },
          { slug: 'newsletterCleanup', schedule: [{ cron: '17 3 * * *', queue: 'default' }], handler: async ({ req }) => ({ output: { deleted: await deleteStalePending(req.payload, o) } }) },
        ],
      },
      custom: { ...incoming.custom, [NEWSLETTER_CUSTOM_KEY]: { options: o } },
    }
  }

export { NEWSLETTER_CUSTOM_KEY }
