import type { CollectionConfig, Config } from 'payload'
import { describe, expect, it } from 'vitest'
import { hideMemberUploads, MEMBER_UPLOADS_FILTER } from '../src'

/** The `filterOptions` of the first field with that name, searched through rows, arrays, blocks and tabs. */
const find = (fields: any[] | undefined, name: string): any => {
  for (const f of fields ?? []) {
    if (f.name === name) return f
    const nested = find(f.fields, name) ?? (f.blocks ?? []).map((b: any) => find(b.fields, name)).find(Boolean) ?? (f.tabs ?? []).map((t: any) => find(t.fields, name)).find(Boolean)
    if (nested) return nested
  }
  return undefined
}
const filterOf = (cfg: Config, collection: string, name: string) => find((cfg.collections!.find((c) => c.slug === collection) as CollectionConfig).fields, name)?.filterOptions

describe('hideMemberUploads', () => {
  const build = (): Config => ({
    collections: [
      { slug: 'media', upload: true, fields: [{ name: 'self', type: 'upload', relationTo: 'media' }] },
      { slug: 'pages', fields: [
        { name: 'hero', type: 'upload', relationTo: 'media' },
        { name: 'other', type: 'upload', relationTo: 'documents' },
        { name: 'own', type: 'upload', relationTo: 'media', filterOptions: { alt: { exists: true } } },
        { name: 'avatar', type: 'upload', relationTo: 'media' },
        { name: 'gallery', type: 'array', fields: [{ name: 'image', type: 'upload', relationTo: 'media' }] },
        { type: 'row', fields: [{ name: 'inRow', type: 'upload', relationTo: 'media' }] },
        { name: 'layout', type: 'blocks', blocks: [{ slug: 'b', fields: [{ name: 'pic', type: 'upload', relationTo: 'media' }] }] },
        { type: 'tabs', tabs: [{ label: 'T', fields: [{ name: 'inTab', type: 'upload', relationTo: 'media' }] }] },
      ] },
    ],
    globals: [{ slug: 'settings', fields: [{ name: 'logo', type: 'upload', relationTo: 'media' }] }],
  } as never)

  it('adds the filter to picture fields everywhere, but not to other collections\' uploads, existing filters, the avatar or the media collection itself', () => {
    const cfg = hideMemberUploads()(build()) as Config
    expect(filterOf(cfg, 'pages', 'hero')).toEqual(MEMBER_UPLOADS_FILTER)
    expect(filterOf(cfg, 'pages', 'image')).toEqual(MEMBER_UPLOADS_FILTER)
    expect(filterOf(cfg, 'pages', 'inRow')).toEqual(MEMBER_UPLOADS_FILTER)
    expect(filterOf(cfg, 'pages', 'pic')).toEqual(MEMBER_UPLOADS_FILTER)
    expect(filterOf(cfg, 'pages', 'inTab')).toEqual(MEMBER_UPLOADS_FILTER)
    expect((cfg.globals![0]!.fields[0] as any).filterOptions).toEqual(MEMBER_UPLOADS_FILTER)
    expect(filterOf(cfg, 'pages', 'other')).toBeUndefined()
    expect(filterOf(cfg, 'pages', 'own')).toEqual({ alt: { exists: true } })
    expect(filterOf(cfg, 'pages', 'avatar')).toBeUndefined()
    expect(filterOf(cfg, 'media', 'self')).toBeUndefined()
  })

  it('honours a custom media slug and exceptions', () => {
    const cfg = hideMemberUploads({ mediaSlug: 'documents', except: ['hero'] })(build()) as Config
    expect(filterOf(cfg, 'pages', 'other')).toEqual(MEMBER_UPLOADS_FILTER)
    expect(filterOf(cfg, 'pages', 'hero')).toBeUndefined()
  })
})
