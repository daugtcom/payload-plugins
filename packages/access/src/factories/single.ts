import type { CollectionConfig, Field } from 'payload'

/** A stand-alone unlockable document (e.g. a digital download or a single recording). */
export function createSingle(o: { slug: string; fields?: Field[]; group?: string }): CollectionConfig {
  return {
    slug: o.slug,
    admin: { group: o.group ?? 'Content', useAsTitle: 'title' },
    versions: { drafts: true },
    fields: [
      { name: 'title', type: 'text', required: true },
      { name: 'slug', type: 'text', required: true, unique: true, index: true },
      { name: 'publishedAt', type: 'date', index: true },
      { name: 'body', type: 'richText' },
      ...(o.fields ?? []),
    ],
  }
}
