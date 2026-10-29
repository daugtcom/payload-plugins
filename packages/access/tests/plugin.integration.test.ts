import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEngagement, createSeries, getAccess, payloadAccess, setReaction, reactionSummary } from '../src'
import { boot, type Booted } from './support/harness'

const d = (iso: string) => new Date(iso)
const NOW = d('2026-03-01T12:00:00Z')

describe('payloadAccess on a real Payload + Postgres', () => {
  let b: Booted
  let ids: { member: number | string; other: number | string; admin: number | string; course: number | string; lesson1: number | string; lesson2: number | string; lesson3: number | string }
  const granted: unknown[] = []
  const revoked: unknown[] = []

  beforeAll(async () => {
    const { collections, series } = createSeries({ parent: 'courses', items: 'lessons', categories: 'sections' })
    const engagement = createEngagement({ targets: ['lessons'] })
    b = await boot({
      collections: [...collections, ...engagement.collections],
      plugins: [payloadAccess({ targetCollections: ['courses', 'lessons'], series: [series], onGranted: (e) => void granted.push(e), onRevoked: (e) => void revoked.push(e) })],
    })
    const p = b.payload
    const mk = (email: string, roles: ('admin' | 'member')[]) => p.create({ collection: 'users', data: { email, password: 'pw-pw-pw-1', roles } as never, overrideAccess: true })
    const member = await mk('m@example.com', ['member'])
    const other = await mk('o@example.com', ['member'])
    const admin = await mk('a@example.com', ['admin'])
    const course = await p.create({ collection: 'courses', data: { title: 'C', slug: 'c', _status: 'published' } as never })
    const lesson = (n: number, at: string) => p.create({ collection: 'lessons', data: { title: `L${n}`, slug: `l${n}`, series: [course.id], publishedAt: at, _status: 'published' } as never })
    const l1 = await lesson(1, '2026-01-10T00:00:00Z')
    const l2 = await lesson(2, '2026-02-10T00:00:00Z')
    const l3 = await lesson(3, '2026-02-25T00:00:00Z')
    ids = { member: member.id, other: other.id, admin: admin.id, course: course.id, lesson1: l1.id, lesson2: l2.id, lesson3: l3.id }
  }, 60_000)

  afterAll(async () => {
    await b?.close()
  })

  it('grants an entitlement, answers canAccess by window and fires events', async () => {
    const access = getAccess(b.payload)
    const ref = { relationTo: 'courses', value: ids.course }
    expect(await access.canAccess(ids.member, ref, NOW)).toBe(false)

    const e = await access.grant({ user: ids.member, target: ref, start: d('2026-02-01T00:00:00Z'), end: d('2026-04-01T00:00:00Z') })
    expect(granted).toHaveLength(1)
    expect(await access.canAccess(ids.member, ref, NOW)).toBe(true)
    expect(await access.canAccess(ids.member, ref, d('2026-05-01T00:00:00Z'))).toBe(false)
    expect(await access.canAccess(ids.other, ref, NOW)).toBe(false)

    await access.revoke(e.id)
    expect(revoked).toHaveLength(1)
    expect(await access.canAccess(ids.member, ref, NOW)).toBe(false)
  })

  it('keepAccessibleAfterExpiry keeps the target reachable after the end', async () => {
    const access = getAccess(b.payload)
    const ref = { relationTo: 'courses', value: ids.course }
    const e = await access.grant({ user: ids.other, target: ref, start: d('2026-01-01T00:00:00Z'), end: d('2026-02-01T00:00:00Z'), keepAccessibleAfterExpiry: true })
    expect(await access.canAccess(ids.other, ref, NOW)).toBe(true)
    await access.revoke(e.id)
  })

  it('a draft target is never accessible', async () => {
    const access = getAccess(b.payload)
    const draft = await b.payload.create({ collection: 'courses', data: { title: 'D', slug: 'd', _status: 'draft' } as never, draft: true })
    const ref = { relationTo: 'courses', value: draft.id }
    const e = await access.grant({ user: ids.member, target: ref })
    expect(await access.canAccess(ids.member, ref, NOW)).toBe(false)
    await access.revoke(e.id)
  })

  it('series drip: only items dated inside the access window', async () => {
    const access = getAccess(b.payload)
    const ref = { relationTo: 'courses', value: ids.course }
    // joined on Feb 5: lesson1 (Jan 10) and lesson2 (Feb 10) -> only lesson2 and lesson3 fall into the window
    const e = await access.grant({ user: ids.member, target: ref, start: d('2026-02-05T00:00:00Z'), end: d('2027-02-05T00:00:00Z') })
    const items = await access.accessibleSeriesItems(ids.member, ref, { at: NOW })
    expect(items.map((i) => i.slug).sort()).toEqual(['l2', 'l3'])
    await access.revoke(e.id)

    // unrestricted entitlement: everything published up to now
    const open = await access.grant({ user: ids.member, target: ref })
    const all = await access.accessibleSeriesItems(ids.member, ref, { at: NOW })
    expect(all.map((i) => i.slug).sort()).toEqual(['l1', 'l2', 'l3'])
    await access.revoke(open.id)
  })

  it('keepUnlockedWhenActive unlocks items dated before the window while it is active', async () => {
    const access = getAccess(b.payload)
    const ref = { relationTo: 'courses', value: ids.course }
    const e = await access.grant({ user: ids.member, target: ref, start: d('2026-02-20T00:00:00Z'), end: d('2027-01-01T00:00:00Z'), keepUnlockedWhenActive: true })
    const items = await access.accessibleSeriesItems(ids.member, ref, { at: NOW })
    expect(items.map((i) => i.slug).sort()).toEqual(['l1', 'l2', 'l3'])
    await access.revoke(e.id)
  })

  it('members can read only their own entitlements; only staff can change them', async () => {
    const access = getAccess(b.payload)
    const ref = { relationTo: 'courses', value: ids.course }
    const mine = await access.grant({ user: ids.member, target: ref })
    const theirs = await access.grant({ user: ids.other, target: ref })

    const memberUser = await b.payload.findByID({ collection: 'users', id: ids.member, overrideAccess: true })
    const seen = await b.payload.find({ collection: 'entitlements', user: { ...memberUser, collection: 'users' }, overrideAccess: false, depth: 0 })
    expect(seen.docs.map((x) => x.id)).toEqual([mine.id])

    await expect(
      b.payload.create({ collection: 'entitlements', user: { ...memberUser, collection: 'users' }, overrideAccess: false, data: { user: ids.member, target: ref } as never }),
    ).rejects.toThrow()

    await access.revoke(mine.id)
    await access.revoke(theirs.id)
  })

  it('one reaction per user per target: add, replace, remove', async () => {
    const target = { relationTo: 'lessons', value: ids.lesson1 }
    const r = (emoji: string, user = ids.member) => setReaction(b.payload, { user, target, emoji, allowed: ['❤️', '😂'] })
    expect(await r('❤️')).toEqual({ action: 'added', emoji: '❤️' })
    expect(await r('😂')).toEqual({ action: 'replaced', emoji: '😂' })
    expect(await r('😂', ids.other)).toEqual({ action: 'added', emoji: '😂' })
    expect(await reactionSummary(b.payload, { target })).toEqual({ '😂': 2 })
    expect(await r('😂')).toEqual({ action: 'removed', emoji: '😂' })
    expect(await reactionSummary(b.payload, { target })).toEqual({ '😂': 1 })
    await expect(r('💩')).rejects.toThrow(/not allowed/)
  })
})
