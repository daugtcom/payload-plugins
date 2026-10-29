import type { CollectionConfig } from 'payload'
import { CONSENT_SOURCES, SUBSCRIBER_STATUSES } from '../constants'
import type { ResolvedNewsletterOptions } from '../options'

/** People who signed up. Only staff read or change them in the admin; the public endpoints use the local API. */
export function subscribersCollection(o: ResolvedNewsletterOptions): CollectionConfig {
  const staff = ({ req }: { req: { user?: unknown } }) => Boolean(req.user && o.isStaff(req.user))
  return {
    slug: o.subscribersSlug,
    labels: { singular: 'Abonnent:in', plural: 'Abonnent:innen' },
    admin: {
      useAsTitle: 'email',
      defaultColumns: ['email', 'name', 'status', 'consentSource', 'confirmedAt', 'createdAt'],
      group: 'Newsletter',
      listSearchableFields: ['email', 'name'],
      components: { beforeListTable: ['@daugtcom/payload-newsletter/admin#ImportPanel'] },
    },
    access: { read: staff, create: staff, update: staff, delete: staff },
    timestamps: true,
    fields: [
      { name: 'email', type: 'email', required: true, unique: true, index: true, hooks: { beforeValidate: [({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)] } },
      { name: 'name', type: 'text', label: 'Name' },
      { name: 'status', type: 'select', defaultValue: 'pending', required: true, index: true, options: [
        { label: 'Wartet auf Bestätigung', value: 'pending' }, { label: 'Bestätigt', value: 'confirmed' }, { label: 'Abgemeldet', value: 'unsubscribed' }, { label: 'Unzustellbar', value: 'bounced' }, { label: 'Spam gemeldet', value: 'complained' },
      ].filter((s) => (SUBSCRIBER_STATUSES as readonly string[]).includes(s.value)), admin: { position: 'sidebar' } },
      { name: 'tags', type: 'text', hasMany: true, label: 'Listen / Schlagworte', admin: { position: 'sidebar', description: 'Optional, z. B. für spätere Empfängergruppen.' } },
      {
        type: 'collapsible',
        label: 'Einwilligung (Nachweis)',
        admin: { initCollapsed: false },
        fields: [
          { type: 'row', fields: [
            { name: 'consentAt', type: 'date', label: 'Angemeldet am', admin: { readOnly: true, date: { pickerAppearance: 'dayAndTime' } } },
            { name: 'confirmedAt', type: 'date', label: 'Bestätigt am', admin: { readOnly: true, date: { pickerAppearance: 'dayAndTime' } } },
            { name: 'unsubscribedAt', type: 'date', label: 'Abgemeldet am', admin: { readOnly: true, date: { pickerAppearance: 'dayAndTime' } } },
          ] },
          { type: 'row', fields: [
            { name: 'consentSource', type: 'select', label: 'Quelle', options: CONSENT_SOURCES.map((v) => ({ label: { form: 'Formular', import: 'Import', manual: 'Manuell' }[v], value: v })), admin: { readOnly: true } },
            { name: 'consentIp', type: 'text', label: 'IP-Adresse', admin: { readOnly: true } },
          ] },
          { name: 'consentNote', type: 'textarea', label: 'Notiz zum Nachweis', admin: { readOnly: true, description: 'Bei Import mit bestehender Einwilligung: die bestätigte Erklärung.' } },
          { name: 'optInSentAt', type: 'date', label: 'Bestätigungsmail gesendet', admin: { readOnly: true, date: { pickerAppearance: 'dayAndTime' } } },
        ],
      },
    ],
  }
}
