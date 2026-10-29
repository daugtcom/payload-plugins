import type { CollectionConfig } from 'payload'
import { newsletterBlocks } from '../blocks'
import { NEWSLETTER_STATUSES } from '../constants'
import type { ResolvedNewsletterOptions } from '../options'

/** A newsletter: subject, blocks, and where it stands. Sending goes through the staff endpoints (`/api/newsletter/send`), not through the status field. */
export function newslettersCollection(o: ResolvedNewsletterOptions): CollectionConfig {
  const staff = ({ req }: { req: { user?: unknown } }) => Boolean(req.user && o.isStaff(req.user))
  return {
    slug: o.newslettersSlug,
    labels: { singular: 'Newsletter', plural: 'Newsletter' },
    admin: { livePreview: { url: ({ req }) => `${(o.serverURL ?? req.payload.config.serverURL).replace(/\/$/, '')}${req.payload.config.routes.api}/newsletter/live-preview` }, useAsTitle: 'subject', defaultColumns: ['subject', 'status', 'scheduledAt', 'sentAt', 'updatedAt'], group: 'Newsletter' },
    access: { read: staff, create: staff, update: staff, delete: staff },
    timestamps: true,
    fields: [
      { name: 'subject', type: 'text', label: 'Betreff', required: true },
      { name: 'preheader', type: 'text', label: 'Vorschautext', admin: { description: 'Die graue Zeile hinter dem Betreff im Posteingang.' } },
      { name: 'blocks', type: 'blocks', label: 'Inhalt', required: true, minRows: 1, blocks: newsletterBlocks(o), admin: { initCollapsed: false } },
      { name: 'tools', type: 'ui', admin: { components: { Field: '@daugtcom/payload-newsletter/admin#NewsletterTools' } } },
      { name: 'status', type: 'select', defaultValue: 'draft', required: true, index: true, options: NEWSLETTER_STATUSES.map((v) => ({ label: { draft: 'Entwurf', scheduled: 'Geplant', sending: 'Wird gesendet', sent: 'Gesendet' }[v], value: v })), admin: { position: 'sidebar', readOnly: true, description: 'Senden und Planen über den Bereich „Senden“ im Editor.' } },
      { name: 'scheduledAt', type: 'date', label: 'Geplant für', admin: { position: 'sidebar', readOnly: true, date: { pickerAppearance: 'dayAndTime' } } },
      { name: 'sentAt', type: 'date', label: 'Gesendet am', admin: { position: 'sidebar', readOnly: true, date: { pickerAppearance: 'dayAndTime' } } },
      { name: 'stats', type: 'group', label: 'Zahlen', admin: { position: 'sidebar' }, fields: [
        { name: 'recipients', type: 'number', label: 'Empfänger:innen', admin: { readOnly: true } },
        { name: 'sent', type: 'number', label: 'Gesendet', admin: { readOnly: true } },
        { name: 'failed', type: 'number', label: 'Fehlgeschlagen', admin: { readOnly: true } },
      ] },
    ],
  }
}
