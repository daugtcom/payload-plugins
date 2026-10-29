import type { CollectionConfig } from 'payload'
import { DELIVERY_STATUSES } from '../constants'
import type { ResolvedNewsletterOptions } from '../options'

/** One row per recipient and newsletter: what makes sending idempotent (a rerun only touches `queued` rows). */
export function deliveriesCollection(o: ResolvedNewsletterOptions): CollectionConfig {
  const staff = ({ req }: { req: { user?: unknown } }) => Boolean(req.user && o.isStaff(req.user))
  return {
    slug: o.deliveriesSlug,
    labels: { singular: 'Zustellung', plural: 'Zustellungen' },
    admin: { useAsTitle: 'email', defaultColumns: ['email', 'newsletter', 'status', 'sentAt', 'error'], group: 'Newsletter' },
    access: { read: staff, create: () => false, update: () => false, delete: staff },
    timestamps: true,
    fields: [
      { name: 'newsletter', type: 'relationship', relationTo: o.newslettersSlug as never, required: true, index: true },
      { name: 'subscriber', type: 'relationship', relationTo: o.subscribersSlug as never, required: true, index: true },
      { name: 'email', type: 'text', required: true, index: true },
      { name: 'status', type: 'select', defaultValue: 'queued', required: true, index: true, options: DELIVERY_STATUSES.map((v) => ({ label: { queued: 'Wartet', sending: 'Wird gesendet', sent: 'Gesendet', failed: 'Fehlgeschlagen' }[v], value: v })) },
      { name: 'sentAt', type: 'date', admin: { date: { pickerAppearance: 'dayAndTime' } } },
      { name: 'error', type: 'text' },
    ],
  }
}
