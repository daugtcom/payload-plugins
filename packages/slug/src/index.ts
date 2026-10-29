import type { Field, Plugin } from 'payload'

export function slugify(title: string): string {
  return title.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** Generate a URL on creation and keep existing URLs stable when titles change. */
export const autoSlug = (collections: string[]): Plugin => (config) => ({
  ...config,
  collections: config.collections?.map((collection) => {
    if (!collections.includes(collection.slug)) return collection
    return {
      ...collection,
      fields: collection.fields.map((field): Field => {
        if (!('name' in field) || field.name !== 'slug' || field.type !== 'text') return field
        return {
          ...field,
          admin: { ...field.admin, readOnly: true, hidden: true, description: { de: 'Wird automatisch aus dem Titel erstellt und bleibt danach unverändert.', en: 'Generated from the title and kept stable afterwards.' } },
          hooks: { ...field.hooks, beforeValidate: [({ value, siblingData, originalDoc }) => value || originalDoc?.slug || (siblingData?.title ? slugify(String(siblingData.title)) : value), ...(field.hooks?.beforeValidate ?? [])] },
        }
      }),
    }
  }),
})
