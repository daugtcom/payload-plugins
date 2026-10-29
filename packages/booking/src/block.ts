import type { Block } from 'payload'

export const bookableBlock: Block = {
  slug: 'bookable',
  labels: { singular: 'Terminbuchung', plural: 'Terminbuchungen' },
  fields: [{ name: 'product', type: 'relationship', relationTo: 'products' as never, required: true, admin: { description: 'Ein Produkt mit aktivierter Terminbuchung.' } }, { name: 'title', type: 'text' }, { name: 'description', type: 'textarea' }],
}
