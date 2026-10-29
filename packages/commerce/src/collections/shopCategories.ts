import type { CollectionConfig, Field } from 'payload'

export const SHOP_CATEGORIES_SLUG = 'shopCategories'

export const shopCategories = (isStaff: (u: unknown) => boolean, extraFields: Field[] = []): CollectionConfig => ({
  slug: SHOP_CATEGORIES_SLUG,
  admin: { group: 'Ecommerce', useAsTitle: 'title' },
  access: {
    read: () => true,
    create: ({ req }) => Boolean(req.user && isStaff(req.user)),
    update: ({ req }) => Boolean(req.user && isStaff(req.user)),
    delete: ({ req }) => Boolean(req.user && isStaff(req.user)),
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true, index: true },
    ...extraFields,
  ],
})
