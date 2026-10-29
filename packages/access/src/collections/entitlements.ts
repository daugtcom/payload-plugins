import type { CollectionConfig, CollectionSlug } from 'payload'
import type { AccessPluginOptions } from '../types'

export const DEFAULT_ENTITLEMENTS_SLUG = 'entitlements'

const hasDates = (data: Record<string, unknown>) => Boolean(data?.validityStart || data?.validityEnd)

/** `entitlements`: one row = one user may reach one target, optionally only within a time window. */
export function entitlementsCollection(o: Required<Pick<AccessPluginOptions, 'usersSlug' | 'targetCollections' | 'isStaff'>> & Pick<AccessPluginOptions, 'slug' | 'extraFields'>): CollectionConfig {
  const staff = (req: { user?: unknown }) => Boolean(req.user && o.isStaff(req.user))
  return {
    slug: o.slug ?? DEFAULT_ENTITLEMENTS_SLUG,
    admin: { group: 'Access', defaultColumns: ['user', 'target', 'validityStart', 'validityEnd'], useAsTitle: 'id' },
    access: {
      // members see only their own entitlements; everything else is staff-only
      read: ({ req }) => (staff(req) ? true : req.user ? { user: { equals: (req.user as { id: string | number }).id } } : false),
      create: ({ req }) => staff(req),
      update: ({ req }) => staff(req),
      delete: ({ req }) => staff(req),
    },
    fields: [
      { name: 'user', type: 'relationship', relationTo: o.usersSlug, required: true, index: true },
      { name: 'target', type: 'relationship', relationTo: o.targetCollections as CollectionSlug[], required: true },
      {
        type: 'row',
        fields: [
          { name: 'validityStart', type: 'date', admin: { date: { pickerAppearance: 'dayAndTime' }, description: 'Empty = from the beginning.' } },
          { name: 'validityEnd', type: 'date', admin: { date: { pickerAppearance: 'dayAndTime' }, description: 'Empty = never ends. The end instant itself is no longer included.' } },
        ],
      },
      {
        name: 'keepAccessibleAfterExpiry',
        type: 'checkbox',
        defaultValue: false,
        admin: { condition: hasDates, description: 'Stay reachable after the end date (content from inside the window only, for series).' },
      },
      {
        name: 'keepUnlockedWhenActive',
        type: 'checkbox',
        defaultValue: false,
        admin: { condition: hasDates, description: 'While the window is active, unlock the whole series regardless of item dates.' },
      },
      ...(o.extraFields ?? []),
    ],
    timestamps: true,
  }
}
