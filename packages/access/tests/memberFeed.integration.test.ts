import { handleEndpoints } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEngagement, createNotifications, createSeries, getAccess, payloadAccess } from '../src'
import { createCoursePolicy } from '../recipes/course-policy-payload'
import { loadCourseFeed, loadDashboard, loadReactionState } from '../src/ui/member'
import { loadComments } from '../src/ui/loadComments'
import { boot, type Booted } from './support/harness'

const DAY = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY)
const iso = (d: Date) => d.toISOString()
const body = (text: string) => ({ root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text }] }] } })

describe('the member area feed, dashboard and course switch on a real Payload + Postgres', () => {
  let b: Booted
  const tok: Record<string, string> = {}
  const ids = {} as Record<string, number | string>
  const u = (key: string, roles: string[] = ['member']) => ({ id: ids[key]!, roles })

  const call = async (path: string, who: string | null, payload?: unknown) => {
    const res = await handleEndpoints({
      config: b.payload.config,
      request: new Request(`http://localhost/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(who ? { Authorization: `JWT ${tok[who]}` } : {}) }, body: JSON.stringify(payload ?? {}) }),
    })
    return { status: res.status, json: (await res.json()) as any }
  }

  beforeAll(async () => {
    const { collections, series } = createSeries({
      parent: 'courses', items: 'lessons', categories: 'sections',
      parentFields: [{ name: 'allowMemberComments', type: 'checkbox', defaultValue: true }, { name: 'allowMemberReactions', type: 'checkbox', defaultValue: true }],
      itemFields: [{ name: 'freeForAll', type: 'checkbox', defaultValue: false }],
      categoryFields: [{ name: 'allowMemberPosts', type: 'checkbox', defaultValue: false }],
    })
    const engagement = createEngagement({ targets: ['lessons', 'sections'], mediaSlug: 'media' })
    const notifications = createNotifications({ targets: ['lessons'], subscriptionTargets: ['courses'] })
    b = await boot({
      collections: [...collections, ...engagement.collections, ...notifications.collections],
      plugins: [payloadAccess({ targetCollections: ['courses', 'lessons'], series: [series], policies: createCoursePolicy(), engagement: {}, memberArea: { notifications: {} } })],
    })
    const p = b.payload
    const user = async (key: string, roles: ('admin' | 'member')[] = ['member']) => {
      ids[key] = (await p.create({ collection: 'users', data: { email: `${key}@example.com`, password: 'pw-pw-pw-1', roles } as never })).id
      tok[key] = (await p.login({ collection: 'users', data: { email: `${key}@example.com`, password: 'pw-pw-pw-1' } })).token!
    }
    for (const k of ['member', 'lapsed', 'stranger']) await user(k)
    await user('staff', ['admin'])

    const mk = async (collection: string, key: string, data: Record<string, unknown>) => { ids[key] = (await p.create({ collection: collection as never, data: { _status: 'published', ...data } as never })).id }
    await mk('courses', 'course', { title: 'Course', slug: 'course', summary: 'About' })
    await mk('courses', 'other', { title: 'Other', slug: 'other' })
    await mk('courses', 'draftCourse', { title: 'Draft course', slug: 'draft-course', _status: 'draft' })
    await mk('sections', 'secA', { title: 'Meditation', slug: 'meditation', series: ids.course, order: 1, allowMemberPosts: true })
    await mk('sections', 'secB', { title: 'Documents', slug: 'documents', series: ids.course, order: 2 })
    const lesson = (key: string, days: number, extra: Record<string, unknown> = {}) => mk('lessons', key, { title: key, slug: key.toLowerCase(), series: [ids.course], categories: [ids.secA], publishedAt: iso(ago(days)), ...extra })
    await lesson('Newest', 1, { body: body('breathing exercise') })
    await lesson('Recent', 5, { categories: [ids.secB] })
    await lesson('Third', 7)
    await lesson('Older', 40) // before the member joined
    await lesson('Free', 40, { freeForAll: true })
    await lesson('Draft', 2, { _status: 'draft' })
    await lesson('Future', -3)

    const access = getAccess(p)
    const target = { relationTo: 'courses', value: ids.course! }
    await access.grant({ user: ids.member!, target, start: ago(10), end: new Date(Date.now() + 300 * DAY) })
    await access.grant({ user: ids.lapsed!, target, start: ago(60), end: ago(20), keepAccessibleAfterExpiry: true })

    // reactions and comments under the newest lesson
    await p.create({ collection: 'reactions' as never, data: { user: ids.member, target: { relationTo: 'lessons', value: ids.Newest }, emoji: '❤️' } as never, overrideAccess: true })
    await p.create({ collection: 'reactions' as never, data: { user: ids.lapsed, target: { relationTo: 'lessons', value: ids.Newest }, emoji: '❤️' } as never, overrideAccess: true })
    await p.create({ collection: 'comments' as never, data: { author: ids.member, target: { relationTo: 'lessons', value: ids.Newest }, text: body('nice') } as never, overrideAccess: true })
    await p.create({ collection: 'comments' as never, data: { author: ids.member, target: { relationTo: 'lessons', value: ids.Newest }, text: null, deleted: true } as never, overrideAccess: true })
  }, 90_000)

  afterAll(async () => {
    await b?.close()
  })

  const titles = (feed: { items: { kind: string; title?: string }[] } | null) => feed!.items.filter((i) => i.kind === 'post').map((i) => i.title)

  it('"all" lists the posts the member can open, newest first, and nothing unpublished or outside the access window', async () => {
    const feed = await loadCourseFeed(b.payload, u('member'), { courseSlug: 'course', sectionSlug: 'all' })
    expect(titles(feed)).toEqual(['Newest', 'Recent', 'Third', 'Free'].sort((a, c) => ['Newest', 'Recent', 'Third', 'Free'].indexOf(a) - ['Newest', 'Recent', 'Third', 'Free'].indexOf(c)).slice(0, 3).concat(['Free']).filter(Boolean))
    expect(feed).toMatchObject({ hasAccess: true, state: 'active', total: 4 })
    expect(feed!.sections.map((s) => s.slug)).toEqual(['meditation', 'documents'])
  })

  it('one section shows only its own posts', async () => {
    expect(titles(await loadCourseFeed(b.payload, u('member'), { courseSlug: 'course', sectionSlug: 'documents' }))).toEqual(['Recent'])
    expect(titles(await loadCourseFeed(b.payload, u('member'), { courseSlug: 'course', sectionSlug: 'meditation' }))).toEqual(['Newest', 'Third', 'Free'])
  })

  it('searches titles and the text of a post, case-insensitively', async () => {
    expect(titles(await loadCourseFeed(b.payload, u('member'), { courseSlug: 'course', sectionSlug: 'all', q: 'BREATHING' }))).toEqual(['Newest'])
    expect(titles(await loadCourseFeed(b.payload, u('member'), { courseSlug: 'course', sectionSlug: 'all', q: 'rece' }))).toEqual(['Recent'])
    expect((await loadCourseFeed(b.payload, u('member'), { courseSlug: 'course', sectionSlug: 'all', q: 'nothing like this' }))!.items).toHaveLength(0)
  })

  it('pages the feed and reports the total', async () => {
    const one = await loadCourseFeed(b.payload, u('member'), { courseSlug: 'course', sectionSlug: 'all', pageSize: 3, page: 1 })
    const two = await loadCourseFeed(b.payload, u('member'), { courseSlug: 'course', sectionSlug: 'all', pageSize: 3, page: 2 })
    expect(one!.items).toHaveLength(3)
    expect(two!.items).toHaveLength(1)
    expect([one!.total, two!.total, two!.page]).toEqual([4, 4, 2])
  })

  it('each post carries reaction counts, the viewer\'s own reaction and the number of comments (deleted ones do not count)', async () => {
    const newest = (await loadCourseFeed(b.payload, u('member'), { courseSlug: 'course', sectionSlug: 'all' }))!.items[0] as any
    expect(newest).toMatchObject({ title: 'Newest', reactions: { '❤️': 2 }, mine: '❤️', comments: 1 })
    // the lapsed member cannot see the newest post at all (it is outside her window), staff see it with their own reaction
    expect(titles(await loadCourseFeed(b.payload, u('lapsed'), { courseSlug: 'course', sectionSlug: 'all' }))).not.toContain('Newest')
    await b.payload.create({ collection: 'reactions' as never, data: { user: ids.staff, target: { relationTo: 'lessons', value: ids.Newest }, emoji: '😂' } as never, overrideAccess: true })
    const staffNewest = (await loadCourseFeed(b.payload, u('staff', ['admin']), { courseSlug: 'course', sectionSlug: 'all' }))!.items.find((i) => i.kind === 'post' && i.title === 'Newest') as any
    expect(staffNewest).toMatchObject({ mine: '😂', reactions: { '❤️': 2, '😂': 1 } })
    expect(((await loadCourseFeed(b.payload, u('member'), { courseSlug: 'course', sectionSlug: 'all' }))!.items[1] as any).mine).toBeNull()
  })

  it('members\' own posts in a section join the feed in date order, and only members with an active window may write them', async () => {
    const post = (await b.payload.create({ collection: 'comments' as never, data: { author: ids.member, target: { relationTo: 'sections', value: ids.secA }, text: body('hello all') } as never, overrideAccess: true })) as any
    const all = await loadCourseFeed(b.payload, u('member'), { courseSlug: 'course', sectionSlug: 'all' })
    expect(all!.items[0]).toMatchObject({ kind: 'memberPost', id: post.id })
    expect(all!.total).toBe(5)
    expect(all!.canPost).toBe(false) // "all" is for reading
    expect((await loadCourseFeed(b.payload, u('member'), { courseSlug: 'course', sectionSlug: 'meditation' }))!.canPost).toBe(true)
    expect((await loadCourseFeed(b.payload, u('member'), { courseSlug: 'course', sectionSlug: 'documents' }))!.canPost).toBe(false) // section does not allow it
    expect((await loadCourseFeed(b.payload, u('lapsed'), { courseSlug: 'course', sectionSlug: 'meditation' }))!.canPost).toBe(false) // window is over
  })

  it('filters member posts by search and the course entitlement window before pagination', async () => {
    const create = async (text: string, days: number) => b.payload.create({ collection: 'comments' as never, data: { author: ids.member, target: { relationTo: 'sections', value: ids.secA }, text: body(text), createdAt: iso(ago(days)) } as never, overrideAccess: true })
    const matching = await create('UniqueMatch within window', 2)
    const older = await create('UniqueMatch before window', 40)
    await create('Unrelated text', 3)
    const opts = { courseSlug: 'course', sectionSlug: 'meditation', q: 'uniquematch', pageSize: 1 }
    const first = await loadCourseFeed(b.payload, u('member'), opts)
    expect(first!.total).toBe(1)
    expect(first!.items).toMatchObject([{ kind: 'memberPost', id: matching.id }])
    expect((await loadCourseFeed(b.payload, u('member'), { ...opts, page: 2 }))!.items).toEqual([])
    expect((await loadCourseFeed(b.payload, u('lapsed'), opts))!.items.map((item) => item.id)).toEqual([older.id])
    expect((await loadCourseFeed(b.payload, u('staff', ['admin']), opts))!.total).toBe(2)
  })

  it('excludes member posts outside future and expired course windows', async () => {
    const access = getAccess(b.payload)
    const makeUser = async (email: string) => b.payload.create({ collection: 'users', data: { email, password: 'pw-pw-pw-1', roles: ['member'] } as never })
    const expired = await makeUser('expired-window@example.com')
    const future = await makeUser('future-window@example.com')
    await access.grant({ user: expired.id, target: { relationTo: 'courses', value: ids.course! }, start: ago(60), end: ago(20), keepAccessibleAfterExpiry: false })
    await access.grant({ user: future.id, target: { relationTo: 'courses', value: ids.course! }, start: ago(-2), end: ago(-20) })
    const opts = { courseSlug: 'course', sectionSlug: 'all', q: 'uniquematch' }
    expect((await loadCourseFeed(b.payload, { id: expired.id, roles: ['member'] }, opts))!.total).toBe(0)
    expect((await loadCourseFeed(b.payload, { id: future.id, roles: ['member'] }, opts))!.total).toBe(0)
  })

  it('shows existing member posts in sections where new posting is disabled', async () => {
    const post = await b.payload.create({ collection: 'comments' as never, data: { author: ids.member, target: { relationTo: 'sections', value: ids.secB }, text: body('existing discussion') } as never, overrideAccess: true })
    const feed = await loadCourseFeed(b.payload, u('member'), { courseSlug: 'course', sectionSlug: 'documents', q: 'existing discussion' })
    expect(feed!.items).toMatchObject([{ kind: 'memberPost', id: post.id }])
    expect(feed!.canPost).toBe(false)
  })

  it('loads only requested feed roots and preserves their replies', async () => {
    const target = { relationTo: 'sections', value: ids.secA! }
    const create = (where: { relationTo: string; value: number | string }, text: string) => b.payload.create({ collection: 'comments' as never, data: { author: ids.member, target: where, text: body(text) } as never, overrideAccess: true })
    const root = await create(target, 'Selected root')
    const reply = await create({ relationTo: 'comments', value: root.id }, 'A reply')
    await create(target, 'Other root')
    const views = await loadComments(b.payload, target, u('member'), { rootIds: [root.id], renderBody: () => null })
    expect(views.map((v) => v.id)).toEqual([root.id])
    expect(views[0]!.replies.map((v) => v.id)).toEqual([reply.id])
    expect(await loadComments(b.payload, target, u('member'), { rootIds: [] })).toEqual([])
  })

  it('answers "no access" for strangers, shows the lapsed member what stayed open and gives staff everything', async () => {
    expect(await loadCourseFeed(b.payload, u('stranger'), { courseSlug: 'course', sectionSlug: 'all' })).toMatchObject({ hasAccess: false, items: [] })
    const lapsed = await loadCourseFeed(b.payload, u('lapsed'), { courseSlug: 'course', sectionSlug: 'all' })
    expect(lapsed).toMatchObject({ hasAccess: true, state: 'ended' })
    const staff = await loadCourseFeed(b.payload, u('staff', ['admin']), { courseSlug: 'course', sectionSlug: 'all' })
    expect(staff).toMatchObject({ hasAccess: true, state: 'active' })
    expect(titles(staff)).toEqual(expect.arrayContaining(['Newest', 'Older']))
    expect(titles(staff)).not.toContain('Draft')
    expect(titles(staff)).not.toContain('Future')
  })

  it('unknown or unpublished courses and unknown sections are "not found"', async () => {
    expect(await loadCourseFeed(b.payload, u('member'), { courseSlug: 'nope', sectionSlug: 'all' })).toBeNull()
    expect(await loadCourseFeed(b.payload, u('member'), { courseSlug: 'draft-course', sectionSlug: 'all' })).toBeNull()
    expect(await loadCourseFeed(b.payload, u('member'), { courseSlug: 'course', sectionSlug: 'nope' })).toBeNull()
  })

  it('the dashboard lists the member\'s courses with their sections; staff see every published course', async () => {
    const mine = await loadDashboard(b.payload, u('member'))
    expect(mine.courses.map((c) => c.course.slug)).toEqual(['course'])
    expect(mine.courses[0]!.sections.map((s) => s.slug)).toEqual(['meditation', 'documents'])
    expect(mine.courses[0]).toMatchObject({ state: 'active' })
    expect((await loadDashboard(b.payload, u('stranger'))).courses).toHaveLength(0)
    const staff = await loadDashboard(b.payload, u('staff', ['admin']))
    expect(staff.courses.map((c) => c.course.slug).sort()).toEqual(['course', 'other'])
  })

  it('orders courses by visible published activity even when no lesson previews are requested', async () => {
    const p = b.payload
    const course = await p.create({ collection: 'courses' as never, data: { title: 'Recently updated', slug: 'activity-course', _status: 'published' } as never, overrideAccess: true })
    const draftCourse = await p.create({ collection: 'courses' as never, data: { title: 'Draft only', slug: 'draft-only-course', _status: 'published' } as never, overrideAccess: true })
    const access = getAccess(p)
    for (const c of [course, draftCourse]) await access.grant({ user: ids.member!, target: { relationTo: 'courses', value: c.id } })
    const createLesson = (title: string, parent: number | string, status: string) => p.create({ collection: 'lessons' as never, data: { title, slug: title.toLowerCase().replaceAll(' ', '-'), series: [parent], publishedAt: iso(ago(1)), _status: status } as never, draft: status === 'draft', overrideAccess: true })
    await createLesson('Activity visible', course.id, 'published')
    await createLesson('Activity draft', draftCourse.id, 'draft')
    const member = await loadDashboard(p, u('member'), { newest: 0 })
    const activity = member.courses.find((c) => c.course.id === course.id)!
    const draft = member.courses.find((c) => c.course.id === draftCourse.id)!
    expect(activity.lastActivity).not.toBeNull()
    expect(activity.newest).toEqual([])
    expect(draft.lastActivity).toBeNull()
    expect(member.courses.indexOf(activity)).toBeLessThan(member.courses.indexOf(draft))
    const staff = await loadDashboard(p, u('staff', ['admin']), { newest: 0 })
    expect(staff.courses.find((c) => c.course.id === course.id)!.lastActivity).not.toBeNull()
    expect(staff.courses.find((c) => c.course.id === draftCourse.id)!.lastActivity).toBeNull()
  })

  it('the course email switch turns on and off for members of the course only', async () => {
    const on = await call('/access/notifications/subscribe', 'member', { courseId: ids.course })
    expect(on).toMatchObject({ status: 200, json: { subscribed: true } })
    expect((await loadCourseFeed(b.payload, u('member'), { courseSlug: 'course', sectionSlug: 'all' }))!.subscribed).toBe(true)
    expect((await call('/access/notifications/subscribe', 'member', { courseId: ids.course, subscribed: true })).json).toEqual({ subscribed: true }) // explicit "on" twice stays on, one record
    expect((await b.payload.count({ collection: 'notificationSubscriptions' as never, where: { user: { equals: ids.member } } as never, overrideAccess: true })).totalDocs).toBe(1)
    expect((await call('/access/notifications/subscribe', 'member', { courseId: ids.course })).json).toEqual({ subscribed: false }) // toggles
    expect((await call('/access/notifications/subscribe', 'member', { courseId: ids.course, subscribed: false })).json).toEqual({ subscribed: false })

    expect((await call('/access/notifications/subscribe', 'stranger', { courseId: ids.course })).status).toBe(403)
    expect((await call('/access/notifications/subscribe', null, { courseId: ids.course })).status).toBe(401)
    expect((await call('/access/notifications/subscribe', 'member', {})).status).toBe(400)
    expect((await call('/access/notifications/subscribe', 'member', { courseId: 999_999 })).status).toBe(404)
    expect((await call('/access/notifications/subscribe', 'staff', { courseId: ids.other })).json).toEqual({ subscribed: true })
  })

  it('reaction state of one target: counts and the viewer\'s own', async () => {
    const target = { relationTo: 'lessons', value: ids.Newest! }
    expect(await loadReactionState(b.payload, target, u('member'))).toEqual({ summary: { '❤️': 2, '😂': 1 }, mine: '❤️' })
    expect((await loadReactionState(b.payload, target, u('stranger'))).mine).toBeNull()
  })
})
