import type { CollectionConfig, CollectionSlug, Field } from 'payload'
import type { SeriesRelation } from '../types'

export interface SeriesFactoryOptions {
  /** Slug of the series collection (course), e.g. `courses`. */
  parent: string
  /** Slug of the items collection (lesson/post), e.g. `lessons`. */
  items: string
  /** Optional categories of the items (the old "course sections"). */
  categories?: string
  /** Media collection for images. Default `media`. */
  mediaSlug?: string
  parentFields?: Field[]
  itemFields?: Field[]
  categoryFields?: Field[]
  /** Items may belong to no course at all (stand-alone items, bought one by one). Default false: every item needs a course. */
  standalone?: boolean
  /** Admin labels of the items, e.g. `{ singular: 'Beitrag', plural: 'Beiträge' }`. */
  itemLabels?: { singular: string; plural: string }
  /** Admin group of the items (default: the courses' group). */
  itemGroup?: string
  /** Admin group label. */
  group?: string
}

/**
 * Course-style content: a series, its dated items and optional categories.
 * Returns the collections to add to the client config and the relation to hand to `payloadAccess({ series })`.
 */
/** The field the sections of a course are ordered by (drag and drop in the course editor): `_<sections collection>_sections_order`. */
export const sectionOrderField = (categoriesSlug: string): string => `_${categoriesSlug}_sections_order`

export function createSeries(o: SeriesFactoryOptions): { collections: CollectionConfig[]; series: SeriesRelation } {
  const media = o.mediaSlug ?? 'media'
  const admin = { group: o.group ?? 'Courses' }

  // categories (sections) live inside the course: a sortable list in the course editor, no collection of their own in the sidebar,
  // and duplicating a course duplicates its sections too (not its items)
  const inline = Boolean(o.categories)
  const categorySlug = o.categories as CollectionSlug

  const parent: CollectionConfig = {
    slug: o.parent,
    admin: { ...admin, useAsTitle: 'title' },
    versions: { drafts: true },
    hooks: inline
      ? {
          // "Duplicate" on a course: remember what it was copied from, so the sections can follow it (the items do not)
          beforeOperation: [({ args, operation, req }) => {
            const from = (args as { duplicateFromID?: string | number } | undefined)?.duplicateFromID
            if (operation === 'create' && from != null) req.context.duplicateSeriesFrom = from
          }],
          afterChange: [async ({ doc, operation, req }) => {
            const from = req.context.duplicateSeriesFrom as string | number | undefined
            if (operation !== 'create' || from == null || req.context.duplicatedSeriesFor === doc.id) return doc
            req.context.duplicatedSeriesFor = doc.id
            const sections = await req.payload.find({ collection: categorySlug, where: { series: { equals: from } } as never, sort: sectionOrderField(o.categories as string), limit: 0, pagination: false, depth: 0, overrideAccess: true, req })
            for (const sec of sections.docs as unknown as Record<string, any>[]) {
              const { id: _id, createdAt: _c, updatedAt: _u, ...copy } = sec
              await req.payload.create({ collection: categorySlug, data: { ...copy, series: doc.id } as never, overrideAccess: true, req })
            }
            return doc
          }],
        }
      : undefined,
    fields: [
      { name: 'title', type: 'text', required: true },
      { name: 'slug', type: 'text', required: true, unique: true, index: true },
      { name: 'summary', type: 'textarea' },
      { name: 'image', type: 'upload', relationTo: media as CollectionSlug },
      ...(inline ? [{ name: 'sections', type: 'join', collection: categorySlug, on: 'series', orderable: true, admin: { defaultColumns: ['title', 'slug', 'allowMemberPosts'], description: 'Die Abschnitte dieses Kurses. Neue hier anlegen; beim Duplizieren des Kurses werden sie mitkopiert (die Beiträge nicht).' } } as Field] : []),
      ...(o.parentFields ?? []),
    ],
  }

  const items: CollectionConfig = {
    slug: o.items,
    ...(o.itemLabels ? { labels: o.itemLabels } : {}),
    admin: { ...admin, ...(o.itemGroup ? { group: o.itemGroup } : {}), useAsTitle: 'title', defaultColumns: ['title', 'series', 'publishedAt'] },
    versions: { drafts: true },
    fields: [
      { name: 'title', type: 'text', required: true },
      { name: 'slug', type: 'text', required: true, unique: true, index: true },
      { name: 'series', type: 'relationship', relationTo: o.parent as CollectionSlug, hasMany: true, index: true, required: !o.standalone },
      ...(o.categories ? [{ name: 'categories', type: 'relationship', relationTo: o.categories as CollectionSlug, hasMany: true } as Field] : []),
      { name: 'publishedAt', type: 'date', index: true, admin: { date: { pickerAppearance: 'dayAndTime' }, description: 'Also decides which access window the item belongs to.' } },
      { name: 'body', type: 'richText' },
      ...(o.itemFields ?? []),
    ],
  }

  const collections = [parent, items]
  if (o.categories) {
    collections.push({
      slug: o.categories,
      admin: { ...admin, useAsTitle: 'title', ...(inline ? { hidden: true } : {}) },
      orderable: true,
      fields: [
        { name: 'title', type: 'text', required: true },
        { name: 'slug', type: 'text', required: true, index: true },
        { name: 'series', type: 'relationship', relationTo: o.parent as CollectionSlug },
        ...(o.categoryFields ?? []),
      ],
    })
  }

  return { collections, series: { parent: o.parent as CollectionSlug, items: o.items as CollectionSlug, field: 'series', dateField: 'publishedAt' } }
}
