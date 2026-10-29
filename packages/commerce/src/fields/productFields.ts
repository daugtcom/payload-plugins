import type { CollectionSlug, Field } from 'payload'

/** Everything the legacy shop had on a product beyond what the ecommerce plugin provides. */
/** URL-safe slug from a title (German umlauts transliterated). */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Name, slug, description and images: the ecommerce plugin's product only has prices and inventory. */
export function baseProductFields(o: { mediaSlug: string; categoriesSlug: string }): Field[] {
  return [
    { name: 'title', type: 'text', required: true },
    {
      name: 'slug',
      type: 'text',
      unique: true,
      index: true,
      admin: { position: 'sidebar', description: 'Filled from the title when empty.' },
      hooks: { beforeValidate: [({ value, siblingData }) => value || (siblingData?.title ? slugify(String(siblingData.title)) : value)] },
    },
    { name: 'description', type: 'richText' },
    { name: 'gallery', type: 'upload', relationTo: o.mediaSlug as CollectionSlug, hasMany: true },
    { name: 'categories', type: 'relationship', relationTo: o.categoriesSlug as CollectionSlug, hasMany: true, admin: { position: 'sidebar' } },
  ]
}

export function productFields(o: { accessTargets: CollectionSlug[]; shippingSizesSlug: string }): Field[] {
  const access: Field[] = o.accessTargets.length
    ? [
        {
          name: 'accessItems',
          type: 'array',
          admin: { description: 'What buying this product unlocks.' },
          fields: [
            { name: 'enabled', type: 'checkbox', defaultValue: true },
            { name: 'target', type: 'relationship', relationTo: o.accessTargets as string[], required: true },
            {
              name: 'mode',
              type: 'select',
              required: true,
              defaultValue: 'permanent',
              options: [
                { label: 'Permanent', value: 'permanent' },
                { label: 'For a duration after purchase', value: 'duration' },
                { label: 'Fixed dates', value: 'dates' },
              ],
            },
            { name: 'permanentFromPaymentDate', type: 'checkbox', admin: { condition: (_, s) => s?.mode === 'permanent' } },
            {
              type: 'row',
              admin: { condition: (_, s) => s?.mode === 'duration' },
              fields: [
                { name: 'duration', type: 'number', min: 1 },
                {
                  name: 'durationUnit',
                  type: 'select',
                  options: ['hour', 'day', 'week', 'month', 'year'].map((v) => ({ label: v, value: v })),
                },
              ],
            },
            {
              type: 'row',
              admin: { condition: (_, s) => s?.mode === 'dates' },
              fields: [
                { name: 'start', type: 'date', admin: { date: { pickerAppearance: 'dayAndTime' } } },
                { name: 'end', type: 'date', admin: { date: { pickerAppearance: 'dayAndTime' }, description: 'The end instant itself is no longer included.' } },
              ],
            },
            { name: 'keepAccessibleAfterExpiry', type: 'checkbox', defaultValue: false },
            { name: 'keepUnlockedWhenActive', type: 'checkbox', defaultValue: false },
          ],
        } as Field,
      ]
    : []

  return [
    {
      name: 'commerce',
      type: 'group',
      label: 'Shop settings',
      fields: [
        {
          type: 'row',
          fields: [
            {
              name: 'billingType',
              type: 'select',
              required: true,
              defaultValue: 'one_time',
              options: [
                { label: 'One time', value: 'one_time' },
                { label: 'Recurring (subscription)', value: 'recurring' },
              ],
            },
            { name: 'intervalCount', type: 'number', min: 1, defaultValue: 1, admin: { condition: (_, s) => s?.billingType === 'recurring' } },
            {
              name: 'intervalUnit',
              type: 'select',
              defaultValue: 'month',
              options: ['day', 'week', 'month', 'year'].map((v) => ({ label: v, value: v })),
              admin: { condition: (_, s) => s?.billingType === 'recurring' },
            },
          ],
        },
        {
          type: 'row',
          admin: { condition: (_, s) => s?.billingType === 'recurring' },
          fields: [
            {
              name: 'durationType',
              type: 'select',
              defaultValue: 'permanent',
              options: [
                { label: 'Until cancelled', value: 'permanent' },
                { label: 'Limited number of payments', value: 'limited' },
              ],
            },
            { name: 'iterations', type: 'number', min: 1, admin: { condition: (_, s) => s?.durationType === 'limited' } },
          ],
        },
        {
          type: 'row',
          fields: [
            { name: 'requiresShipping', type: 'checkbox', defaultValue: false },
            { name: 'shippingSize', type: 'relationship', relationTo: o.shippingSizesSlug as CollectionSlug, admin: { condition: (_, s) => Boolean(s?.requiresShipping) } },
            { name: 'multi', type: 'checkbox', defaultValue: false, admin: { description: 'The same product may be bought more than once at a time.' } },
          ],
        },
        { name: 'externalUrl', type: 'text', admin: { description: 'If set, "buy" leads here instead of the cart.' } },
        { name: 'taxCode', type: 'text', admin: { description: 'Stripe tax code, e.g. txcd_10000000. Empty = shop default.' } },
        ...access,
      ],
    },
  ]
}
