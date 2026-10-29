import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSeries, getAccess, memberSingles, payloadAccess, sectionOrderField } from '../src'
import { createCoursePolicy } from '../recipes/course-policy-payload'
import { boot, type Booted } from './support/harness'

const DAY = 86_400_000
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString()

describe('sections inside the course (ordered, duplicated with it), stand-alone items', () => {
  let b: Booted
  const ids: Record<string, number | string> = {}

  beforeAll(async () => {
    const { collections, series } = createSeries({
      parent: 'courses', items: 'lessons', categories: 'sections', standalone: true,
      categoryFields: [{ name: 'allowMemberPosts', type: 'checkbox', defaultValue: false }],
    })
    b = await boot({
      collections,
      plugins: [payloadAccess({ targetCollections: ['courses', 'lessons'], series: [series], policies: createCoursePolicy() })],
    })
    const p = b.payload
    const mk = async (collection: string, key: string, data: Record<string, unknown>) => { ids[key] = (await p.create({ collection: collection as never, data: { _status: 'published', ...data } as never })).id }
    ids.buyer = (await p.create({ collection: 'users', data: { email: 'buyer@example.com', password: 'pw-pw-pw-1' } as never })).id
    await mk('courses', 'course', { title: 'Kurs', slug: 'kurs' })
    await mk('sections', 'secA', { title: 'Modul A', slug: 'modul-a', series: ids.course, allowMemberPosts: true })
    await mk('sections', 'secB', { title: 'Modul B', slug: 'modul-b', series: ids.course })
    await mk('lessons', 'inA', { title: 'In A', slug: 'in-a', series: [ids.course], categories: [ids.secA], publishedAt: ago(5) })
    await mk('lessons', 'inB', { title: 'In B', slug: 'in-b', series: [ids.course], categories: [ids.secB], publishedAt: ago(5) })
    await mk('lessons', 'alone', { title: 'Allein', slug: 'allein', publishedAt: ago(5) }) // no course: a stand-alone item
  }, 90_000)

  afterAll(async () => { await b?.close() })

  it('duplicating a course copies its sections, not its items', async () => {
    const copy = await b.payload.duplicate({ collection: 'courses', id: ids.course!, overrideAccess: true })
    const secs = (await b.payload.find({ collection: 'sections', where: { series: { equals: copy.id } } as never, sort: sectionOrderField('sections'), depth: 0, overrideAccess: true })).docs as any[]
    expect(secs.map((s) => s.title)).toEqual(['Modul A', 'Modul B'])
    expect(secs[0].allowMemberPosts).toBe(true)
    expect(secs.every((s) => s.id !== ids.secA && s.id !== ids.secB)).toBe(true)
    expect((await b.payload.count({ collection: 'lessons', where: { series: { equals: copy.id } } as never, overrideAccess: true })).totalDocs).toBe(0)
    // the original keeps its own two
    expect((await b.payload.count({ collection: 'sections', where: { series: { equals: ids.course } } as never, overrideAccess: true })).totalDocs).toBe(2)
    // a normal create does not copy anything
    const fresh = await b.payload.create({ collection: 'courses', data: { title: 'Neu', slug: 'neu', _status: 'published' } as never })
    expect((await b.payload.count({ collection: 'sections', where: { series: { equals: fresh.id } } as never, overrideAccess: true })).totalDocs).toBe(0)
  })

  it('sections keep their order, also in the copy', async () => {
    const order = sectionOrderField('sections')
    const titles = async (course: unknown) => ((await b.payload.find({ collection: 'sections', where: { series: { equals: course } } as never, sort: order, depth: 0, overrideAccess: true })).docs as any[]).map((s) => s.title)
    expect(await titles(ids.course)).toEqual(['Modul A', 'Modul B'])
    const copy = (await b.payload.find({ collection: 'courses', where: { title: { contains: 'Kurs' } } as never, sort: '-createdAt', depth: 0, overrideAccess: true })).docs.find((c) => c.id !== ids.course)!
    expect(await titles(copy.id)).toEqual(['Modul A', 'Modul B'])
  })

  it('an item without a course is a stand-alone one: bought directly it opens and shows up as the member\'s own', async () => {
    const access = getAccess(b.payload)
    await access.grant({ user: ids.buyer!, target: { relationTo: 'lessons', value: ids.alone! }, start: new Date(ago(1)), end: null })
    expect(await access.can('view', { id: ids.buyer! } as never, { relationTo: 'lessons', value: ids.alone! })).toBe(true)
    const mine = await memberSingles(b.payload, access, { userId: ids.buyer!, singlesSlug: 'lessons', })
    expect(mine.map((d) => d.title)).toEqual(['Allein'])
  })
})
