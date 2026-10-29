import type { GlobalConfig } from 'payload'
import { isStaff } from '../access'

export const navigation: GlobalConfig = {
  slug: 'navigation',
  admin: { group: 'Content' },
  access: { read: () => true, update: ({ req }) => Boolean(req.user && isStaff(req.user)) },
  fields: [
    {
      name: 'menus',
      type: 'array',
      fields: [
        { name: 'name', type: 'text', required: true },
        { name: 'slug', type: 'text', required: true },
        {
          name: 'items',
          type: 'array',
          fields: [
            { name: 'label', type: 'text', required: true },
            { name: 'icon', type: 'text' },
            { name: 'url', type: 'text', admin: { description: 'External URL, or empty when an internal target is set.' } },
            { name: 'internal', type: 'relationship', relationTo: ['pages', 'blog', 'posts', 'lessons', 'products'] },
            { name: 'newTab', type: 'checkbox' },
          ],
        },
      ],
    },
  ],
}
