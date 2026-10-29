import type { CollectionSlug, Field } from 'payload'

/** Collections an internal link may point at. */
export const LINKABLE: CollectionSlug[] = ['pages', 'blog', 'posts', 'lessons', 'products'] as CollectionSlug[]

/**
 * A link as the old editor stored it: a label plus either an address or one of our own documents.
 * `internal` wins over `url`, so renaming a page does not break links to it.
 */
export const linkField = (name: string, label?: string): Field => ({
  name,
  type: 'group',
  label,
  fields: [
    { name: 'text', type: 'text' },
    { name: 'url', type: 'text', admin: { description: 'Address, or leave empty and pick a document below.' } },
    { name: 'internal', type: 'relationship', relationTo: LINKABLE },
    { name: 'newTab', type: 'checkbox' },
  ],
})

export const mediaField = (name: string, mediaSlug = 'media', label?: string): Field => ({ name, type: 'upload', relationTo: mediaSlug as CollectionSlug, label })

export const mediaManyField = (name: string, mediaSlug = 'media', max?: number): Field => ({
  name,
  type: 'upload',
  relationTo: mediaSlug as CollectionSlug,
  hasMany: true,
  ...(max ? { maxRows: max } : {}),
})

export const COLOR_OPTIONS = ['primary', 'secondary', 'light', 'dark'].map((v) => ({ label: v, value: v }))
