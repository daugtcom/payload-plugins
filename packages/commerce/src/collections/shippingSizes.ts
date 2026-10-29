import type { CollectionConfig } from 'payload'

export const SHIPPING_SIZES_SLUG = 'shippingSizes'

export const shippingSizes = (isStaff: (u: unknown) => boolean): CollectionConfig => ({
  slug: SHIPPING_SIZES_SLUG,
  admin: { group: 'Ecommerce', useAsTitle: 'name' },
  access: {
    read: () => true,
    create: ({ req }) => Boolean(req.user && isStaff(req.user)),
    update: ({ req }) => Boolean(req.user && isStaff(req.user)),
    delete: ({ req }) => Boolean(req.user && isStaff(req.user)),
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    {
      name: 'rates',
      type: 'array',
      fields: [
        { type: 'row', fields: [
          { name: 'country', type: 'text', required: true, admin: { description: 'ISO-2 code, e.g. AT' } },
          { name: 'amount', type: 'number', required: true, min: 0, admin: { description: 'In euros, tax inclusive.' } },
        ] },
      ],
    },
    { name: 'fallbackRate', type: 'number', min: 0, admin: { description: 'Used for countries without a rate above.' } },
  ],
})
