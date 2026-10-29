import type { Config, Field, Plugin } from 'payload'

/** Pictures members upload (comments, avatars) are flagged `userUpload`; this is the filter that leaves them out. */
export const MEMBER_UPLOADS_FILTER = { userUpload: { not_equals: true } } as const

type AnyField = Field & { fields?: Field[]; tabs?: { fields?: Field[] }[]; blocks?: { fields?: Field[] }[]; relationTo?: unknown; filterOptions?: unknown; name?: string }

function walk(fields: Field[] | undefined, mediaSlug: string, skip: ReadonlySet<string>): void {
  for (const f of (fields ?? []) as AnyField[]) {
    if (f.type === 'upload' && f.relationTo === mediaSlug && !f.filterOptions && !(f.name && skip.has(f.name))) f.filterOptions = MEMBER_UPLOADS_FILTER as never
    walk(f.fields, mediaSlug, skip)
    for (const tab of f.tabs ?? []) walk(tab.fields, mediaSlug, skip)
    for (const block of f.blocks ?? []) walk(block.fields, mediaSlug, skip)
  }
}

/**
 * Keeps members' pictures out of the picture pickers of the admin (pages, products, settings …) while they stay visible in the
 * media list itself and on the comments they belong to. Add it after the plugins that define media fields.
 * Fields named in `except` (default: `avatar`) keep the full list, and fields that already have `filterOptions` are left alone.
 * Upload fields inside rich-text blocks are not part of the collection fields: give those `filterOptions: MEMBER_UPLOADS_FILTER` yourself.
 */
export function hideMemberUploads(o: { mediaSlug?: string; except?: string[] } = {}): Plugin {
  const mediaSlug = o.mediaSlug ?? 'media'
  const skip = new Set(o.except ?? ['avatar'])
  return (incoming: Config): Config => {
    for (const c of incoming.collections ?? []) if (c.slug !== mediaSlug) walk(c.fields, mediaSlug, skip)
    for (const g of incoming.globals ?? []) walk(g.fields, mediaSlug, skip)
    return incoming
  }
}
