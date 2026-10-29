import type { CollectionConfig, Field } from 'payload'

const content: Field[] = [
  { name: 'title', type: 'text', required: true },
  { name: 'slug', type: 'text', required: true, index: true },
  { name: 'template', type: 'text' },
  { name: 'publishedAt', type: 'date', index: true },
  { name: 'body', type: 'richText' },
]

export const pages = (legacy: Field[]): CollectionConfig => ({
  slug: 'pages',
  admin: { useAsTitle: 'title', group: 'Content' },
  versions: { drafts: true },
  fields: [...content, { name: 'transparentNavigation', type: 'checkbox', admin: { description: 'Navigation floats over the first image on this page.' } }, ...legacy],
})

export const blog = (legacy: Field[]): CollectionConfig => ({
  slug: 'blog',
  admin: { useAsTitle: 'title', group: 'Content' },
  versions: { drafts: true },
  fields: [...content, { name: 'categories', type: 'relationship', relationTo: 'blogCategories', hasMany: true }, { name: 'image', type: 'upload', relationTo: 'media' }, ...legacy],
})

export const blogCategories = (legacy: Field[]): CollectionConfig => ({
  slug: 'blogCategories',
  admin: { useAsTitle: 'title', group: 'Content' },
  fields: [{ name: 'title', type: 'text', required: true }, { name: 'slug', type: 'text', required: true }, ...legacy],
})
