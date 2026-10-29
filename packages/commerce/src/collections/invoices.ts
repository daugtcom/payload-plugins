import type { CollectionConfig, CollectionSlug, Field } from 'payload'

export const INVOICES_SLUG = 'invoices'

/**
 * Invoices of an order. Two kinds live here:
 *  - Stripe invoices (`stripeInvoiceID` = `in_…`), the PDF comes from Stripe;
 *  - uploaded PDFs of the old system (`file` set), served from storage. Most legacy invoices are this kind.
 */
export const invoices = (o: { usersSlug: CollectionSlug; ordersSlug: CollectionSlug; isStaff: (u: unknown) => boolean; extraFields?: Field[] }): CollectionConfig => ({
  slug: INVOICES_SLUG,
  admin: { group: 'Ecommerce', defaultColumns: ['order', 'customer', 'status', 'createdAt'] },
  access: {
    read: ({ req }) => (req.user ? (o.isStaff(req.user) ? true : { customer: { equals: (req.user as { id: string | number }).id } }) : false),
    create: ({ req }) => Boolean(req.user && o.isStaff(req.user)),
    update: ({ req }) => Boolean(req.user && o.isStaff(req.user)),
    delete: ({ req }) => Boolean(req.user && o.isStaff(req.user)),
  },
  fields: [
    { name: 'order', type: 'relationship', relationTo: o.ordersSlug, required: true, index: true },
    { name: 'customer', type: 'relationship', relationTo: o.usersSlug, index: true },
    { name: 'stripeInvoiceID', type: 'text', unique: true, index: true },
    { name: 'stripePaymentIntentID', type: 'text' },
    { name: 'status', type: 'select', defaultValue: 'paid', options: ['draft', 'open', 'paid', 'pending', 'void', 'uncollectible'].map((v) => ({ label: v, value: v })) },
    { name: 'file', type: 'text', admin: { description: 'Storage key of an uploaded PDF (legacy invoices).' } },
    ...(o.extraFields ?? []),
  ],
})
