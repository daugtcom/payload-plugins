import type { Field, GlobalConfig } from 'payload'
import { isStaff } from '../access'

const hero = (extra: Field[] = []): Field[] => [{ name: 'title', type: 'text' }, { name: 'subtitle', type: 'text' }, { name: 'backgroundImage', type: 'upload', relationTo: 'media' }, ...extra]

/**
 * Everything the old app kept in "block defaults" (logo, menus, banner, headers of the shop and blog index,
 * member area and login backgrounds), as one editable settings page.
 */
export const siteSettings: GlobalConfig = {
  slug: 'siteSettings',
  label: 'Site settings',
  admin: { group: 'Content' },
  access: { read: () => true, update: ({ req }) => Boolean(req.user && isStaff(req.user)) },
  fields: [
    { name: 'siteName', type: 'text' },
    { name: 'logo', type: 'upload', relationTo: 'media' },
    { name: 'transparentNavigation', type: 'checkbox', defaultValue: false, admin: { description: 'Navigation floats over the first image. Single pages can override this.' } },
    {
      type: 'row',
      fields: [
        { name: 'mainMenu', type: 'text', admin: { description: 'Slug of a menu in Navigation.' } },
        { name: 'footerMenu', type: 'text' },
        { name: 'socialMenu', type: 'text' },
      ],
    },
    {
      name: 'announcement',
      type: 'group',
      admin: { description: 'A notice shown to every visitor (for example an upcoming event).' },
      fields: [{ name: 'title', type: 'text' }, { name: 'description', type: 'textarea' }, { name: 'link', type: 'group', fields: [{ name: 'text', type: 'text' }, { name: 'url', type: 'text' }, { name: 'internal', type: 'relationship', relationTo: ['pages', 'blog', 'posts', 'lessons', 'products'] }] }],
    },
    { name: 'shop', type: 'group', fields: hero() },
    { name: 'blog', type: 'group', fields: hero() },
    { name: 'memberArea', type: 'group', fields: [{ name: 'logo', type: 'upload', relationTo: 'media' }, { name: 'background', type: 'upload', relationTo: 'media' }, { name: 'contentBackground', type: 'upload', relationTo: 'media' }] },
    { name: 'login', type: 'group', fields: [{ name: 'logo', type: 'upload', relationTo: 'media' }, { name: 'background', type: 'upload', relationTo: 'media' }] },
    { name: 'defaultPostImage', type: 'upload', relationTo: 'media', admin: { description: 'Picture for lessons and posts that have none.' } },
  ],
}
