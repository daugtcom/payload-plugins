import { handleEndpoints } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createNotifications, createSeries, createSingle, getAccess, payloadAccess } from '../src'
import { createCoursePolicy } from '../recipes/course-policy-payload'
import { boot, type Booted } from './support/harness'

const DAY = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY)
const iso = (d: Date) => d.toISOString()

describe('member area data and content notifications on a real Payload + Postgres', () => {
  let b: Booted
  const tok: Record<string, string> = {}
  const ids = {} as Record<string, number | string>
  const mails: { to: string; subject: string; text: string }[] = []

  const call = async (method: 'GET' | 'POST', path: string, who: string | null, body?: unknown) => {
    const res = await handleEndpoints({
      config: b.payload.config,
      request: new Request(`http://localhost/api${path}`, { method, headers: { 'content-type': 'application/json', ...(who ? { Authorization: `JWT ${tok[who]}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
    })
    return { status: res.status, json: (await res.json()) as any }
  }

  beforeAll(async () => {
    const { collections, series } = createSeries({ parent: 'courses', items: 'lessons', itemFields: [{ name: 'freeForAll', type: 'checkbox', defaultValue: false }] })
    const notifications = createNotifications({ targets: ['lessons'], subscriptionTargets: ['courses'] })
    const downloads = createSingle({ slug: 'downloads' })
    b = await boot({
      collections: [...collections, ...notifications.collections, downloads],
      plugins: [
        payloadAccess({
          targetCollections: ['courses', 'lessons', 'downloads'],
          series: [series],
          policies: createCoursePolicy({ sections: 'unused' }),
          memberArea: { singlesSlug: 'downloads', notifications: { serverURL: 'http://site.test', sendEmail: async (_p, to, c) => void mails.push({ to, subject: c.subject, text: c.text }) } },
        }),
      ],
    })
    const p = b.payload
    const user = async (key: string, roles: ('admin' | 'member')[] = ['member']) => {
      ids[key] = (await p.create({ collection: 'users', data: { email: `${key}@example.com`, password: 'pw-pw-pw-1', roles } as never })).id
      tok[key] = (await p.login({ collection: 'users', data: { email: `${key}@example.com`, password: 'pw-pw-pw-1' } })).token!
    }
    for (const k of ['active', 'upcoming', 'lapsed', 'stranger', 'buyer']) await user(k)
    await user('staff', ['admin'])

    const mk = async (collection: string, key: string, data: Record<string, unknown>) => { ids[key] = (await p.create({ collection: collection as never, data: { _status: 'published', ...data } as never })).id }
    await mk('courses', 'course', { title: 'Course', slug: 'course' })
    const lesson = (key: string, days: number, extra: object = {}) => mk('lessons', key, { title: key, slug: key, series: [ids.course], publishedAt: iso(ago(days)), ...extra })
    await lesson('older', 40)
    await lesson('recent', 5)
    await lesson('newest', 1)
    await lesson('free', 40, { freeForAll: true })
    await mk('downloads', 'dl', { title: 'Download', slug: 'dl' })

    const access = getAccess(p)
    const target = { relationTo: 'courses', value: ids.course! }
    await access.grant({ user: ids.active!, target, start: ago(10), end: new Date(Date.now() + 300 * DAY) })
    await access.grant({ user: ids.upcoming!, target, start: new Date(Date.now() + 5 * DAY), end: new Date(Date.now() + 300 * DAY) })
    await access.grant({ user: ids.lapsed!, target, start: ago(60), end: ago(20), keepAccessibleAfterExpiry: true })
    await access.grant({ user: ids.buyer!, target: { relationTo: 'downloads', value: ids.dl! } })
    await access.grant({ user: ids.buyer!, target: { relationTo: 'lessons', value: ids.older! } })

    for (const k of ['active', 'upcoming', 'stranger', 'buyer']) await p.create({ collection: 'notificationSubscriptions' as never, data: { user: ids[k], target } as never, overrideAccess: true })
  }, 90_000)

  afterAll(async () => {
    await b?.close()
  })

  it('the dashboard shows each course with its state and exactly the lessons the member can open', async () => {
    const r = await call('GET', '/access/dashboard', 'active')
    expect(r.status).toBe(200)
    expect(r.json.courses).toHaveLength(1)
    const c = r.json.courses[0]
    expect(c.state).toBe('active')
    // joined 10 days ago: "recent" and "newest" are theirs, "older" is before they joined, "free" is open to every member
    expect(c.newest.map((l: any) => l.slug)).toEqual(['newest', 'recent', 'free'])
    expect(c.visibleLessons).toBe(3)
  })

  it('a window that has not begun yet is "upcoming"; an old one is "ended" but keeps what was inside it', async () => {
    const up = (await call('GET', '/access/dashboard', 'upcoming')).json.courses[0]
    expect(up.state).toBe('upcoming')
    expect(up.newest.map((l: any) => l.slug)).toEqual(['free']) // freeForAll works for anyone with any grant, even a future one
    const ended = (await call('GET', '/access/dashboard', 'lapsed')).json.courses[0]
    expect(ended.state).toBe('ended')
    expect(ended.newest.map((l: any) => l.slug).sort()).toEqual(['free', 'older'])
  })

  it('single purchases and direct lesson grants show up; strangers see nothing; visitors are refused', async () => {
    const buyer = (await call('GET', '/access/dashboard', 'buyer')).json
    expect(buyer.courses).toEqual([])
    expect(buyer.singles.map((s: any) => s.slug)).toEqual(['dl'])
    expect((await call('GET', '/access/dashboard', 'stranger')).json).toEqual({ courses: [], singles: [] })
    expect((await call('GET', '/access/dashboard', null)).status).toBe(401)
  })

  it('preview names who is mailed and why, and who is left out', async () => {
    const target = { relationTo: 'lessons', value: ids.recent }
    expect((await call('POST', '/access/notifications/preview', 'active', { target })).status).toBe(403)
    const r = (await call('POST', '/access/notifications/preview', 'staff', { target })).json
    expect(r.recipients.map((x: any) => [x.email, x.reasons])).toEqual([['active@example.com', ['subscribed']]])
    // upcoming and stranger are subscribed but cannot see "recent" (outside their window / no access); buyer subscribed without access to it
    expect(r.excluded.map((x: any) => x.email).sort()).toEqual(['buyer@example.com', 'stranger@example.com', 'upcoming@example.com'])
  })

  it('a direct purchaser is mailed even without a subscription, and both reasons are shown together', async () => {
    const r = (await call('POST', '/access/notifications/preview', 'staff', { target: { relationTo: 'lessons', value: ids.older } })).json
    const buyer = r.recipients.find((x: any) => x.email === 'buyer@example.com')
    expect(buyer.reasons).toEqual(['subscribed', 'direct-access']) // subscribed to the course AND bought this lesson on its own
    expect(r.recipients.map((x: any) => x.email)).toEqual(['buyer@example.com']) // "older" predates everyone else's window
  })

  it('send mails exactly the previewed recipients, records the history, and every mail can be unsubscribed from', async () => {
    mails.length = 0
    const target = { relationTo: 'lessons', value: ids.recent }
    const sent = await call('POST', '/access/notifications/send', 'staff', { target, title: 'New lesson online', url: 'http://site.test/lesson/recent' })
    expect(sent.json).toMatchObject({ sent: 1, failed: [] })
    expect(mails.map((m) => m.to)).toEqual(['active@example.com'])
    expect(mails[0]!.text).toContain('http://site.test/lesson/recent')

    const log = (await b.payload.find({ collection: 'notificationLog' as never, overrideAccess: true, depth: 0 })).docs as any[]
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ title: 'New lesson online', recipientsCount: 1 })

    const link = /(http:\/\/site\.test\/api\/access\/notifications\/unsubscribe\?\S+)/.exec(mails[0]!.text)![1]!
    const get = (url: string) => handleEndpoints({ config: b.payload.config, request: new Request(url.replace('http://site.test', 'http://localhost'), { method: 'GET' }) })
    expect((await get(link.replace(/token=\w+/, 'token=forged'))).status).toBe(400)
    expect((await get(link)).status).toBe(200)
    expect((await b.payload.find({ collection: 'notificationSubscriptions' as never, where: { user: { equals: ids.active } }, overrideAccess: true })).totalDocs).toBe(0)
  })
})
