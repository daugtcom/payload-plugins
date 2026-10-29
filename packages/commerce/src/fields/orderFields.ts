import type { Field } from 'payload'

/** Order fields on top of the ecommerce plugin's `orders` (its own `status` stays the fulfilment status). */
export const orderFields: Field[] = [
  {
    type: 'row',
    admin: { position: 'sidebar' },
    fields: [
      { name: 'orderNumber', type: 'number', unique: true, index: true, admin: { readOnly: true, description: 'Assigned automatically. Imported orders keep their old number.' } },
      {
        name: 'paymentStatus',
        type: 'select',
        defaultValue: 'paid',
        index: true,
        options: [
          { label: 'Pending', value: 'pending' },
          { label: 'Paid', value: 'paid' },
          { label: 'Failed', value: 'failed' },
        ],
      },
    ],
  },
  { name: 'paidAt', type: 'date', admin: { position: 'sidebar', date: { pickerAppearance: 'dayAndTime' } } },
  {
    name: 'stripe',
    type: 'group',
    admin: { position: 'sidebar' },
    fields: [
      { name: 'checkoutSessionID', type: 'text', unique: true, index: true },
      { name: 'customerID', type: 'text' },
    ],
  },
  { name: 'billingAddress', type: 'json' },
]

/** Fields added to every order line. */
export const orderItemFields: Field[] = [
  {
    name: 'shippingStatus',
    type: 'select',
    options: [
      { label: 'Pending', value: 'pending' },
      { label: 'Processing', value: 'processing' },
      { label: 'Shipped', value: 'shipped' },
    ],
  },
  { name: 'stripeSubscriptionID', type: 'text', index: true },
]
