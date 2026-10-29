import { afterAll, beforeAll, expect, it } from 'vitest'
import { autoSlug } from '../../slug/src/index'
import { boot, type Booted } from './support/harness'

let b: Booted
beforeAll(async () => {
  b = await boot({ collections: [{ slug: 'articles', fields: [{ name: 'title', type: 'text', required: true }, { name: 'slug', type: 'text', required: true, unique: true }] }], plugins: [autoSlug(['articles'])] })
}, 90000)
afterAll(async () => { await b?.close() })

it('creates a slug and keeps it through title changes and explicit imports', async () => {
  const created = await b.payload.create({ collection: 'articles' as never, data: { title: 'Über Größe' } as never }) as any
  expect(created.slug).toBe('ueber-groesse')
  const edited = await b.payload.update({ collection: 'articles' as never, id: created.id, data: { title: 'Ein neuer Titel' } as never }) as any
  expect(edited.slug).toBe('ueber-groesse')
  const imported = await b.payload.create({ collection: 'articles' as never, data: { title: 'Import', slug: 'alte-url' } as never }) as any
  expect(imported.slug).toBe('alte-url')
})
