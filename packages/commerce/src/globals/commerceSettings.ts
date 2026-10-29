import type { GlobalConfig } from 'payload'
import type { ShippingSettings } from '../shipping/calculator'

export const COMMERCE_SETTINGS_SLUG = 'commerceSettings'

export const commerceSettings = (isStaff: (u: unknown) => boolean, defaults: Partial<ShippingSettings> = {}): GlobalConfig => ({
  slug: COMMERCE_SETTINGS_SLUG,
  admin: { group: 'Ecommerce' },
  access: { read: ({ req }) => Boolean(req.user && isStaff(req.user)), update: ({ req }) => Boolean(req.user && isStaff(req.user)) },
  fields: [
    { name: 'nextOrderNumber', type: 'number', admin: { description: 'Only raise this to skip numbers. Imported orders are always respected.' } },
    {
      name: 'shipping',
      type: 'group',
      fields: [
        { name: 'mode', type: 'select', defaultValue: defaults.mode ?? 'dynamic', options: [{ label: 'Per size and country', value: 'dynamic' }, { label: 'One flat rate', value: 'flat' }] },
        { name: 'flatRate', type: 'number', min: 0, defaultValue: defaults.flatRate ?? undefined, admin: { description: 'Euros, tax inclusive. Also the last resort for missing rates.' } },
        { name: 'method', type: 'select', defaultValue: defaults.method ?? 'sum', options: [{ label: 'Add up all items', value: 'sum' }, { label: 'Only the most expensive item', value: 'max' }] },
        { name: 'allowedCountries', type: 'text', hasMany: true, defaultValue: defaults.allowedCountries ?? [], admin: { description: 'ISO-2 codes. Empty = anywhere.' } },
      ],
    },
  ],
})
