import { handleEndpoints } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEngagement, createSeries, getAccess, payloadAccess } from '../src'
import { createCoursePolicy } from '../recipes/course-policy-payload'
import { boot, type Booted } from './support/harness'

const DAY = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()

describe('engagement with the legacy course rules (policies + endpoints) on a real Payload + Postgres', () => {
  let b: Booted
  const tok: Record<string, string> = {}
  const ids = {} as Record<string, number | string>

  const call = async (method: 'POST' | 'DELETE', path: string, who: string | null, body?: unknown) => {
    const res = await handleEndpoints({
      config: b.payload.config,
      request: new Request(`http://localhost/api${path}`, { method, headers: { 'content-type': 'application/json', ...(who ? { Authorization: `JWT ${tok[who]}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
    })
    return { status: res.status, json: (await res.json()) as any }
  }
  const comment = (who: string | null, target: unknown, text = 'Hello', extra: object = {}) => call('POST', '/engagement/comments', who, { target, text, ...extra })
  const react = (who: string | null, target: unknown, emoji: string) => call('POST', '/engagement/reactions', who, { target, emoji })
  const lesson = (key: string) => ({ relationTo: 'lessons', value: ids[key] })
  const section = (key: string) => ({ relationTo: 'sections', value: ids[key] })

  beforeAll(async () => {
    const { collections, series } = createSeries({
      parent: 'courses', items: 'lessons', categories: 'sections',
      parentFields: [{ name: 'allowMemberComments', type: 'checkbox', defaultValue: true }, { name: 'allowMemberReactions', type: 'checkbox', defaultValue: true }],
      itemFields: [{ name: 'freeForAll', type: 'checkbox', defaultValue: false }],
      categoryFields: [{ name: 'allowMemberPosts', type: 'checkbox', defaultValue: false }],
    })
    const engagement = createEngagement({ targets: ['lessons', 'sections'], emojis: ['❤️', '😂'], mediaSlug: 'media' })
    b = await boot({
      collections: [...collections, ...engagement.collections],
      plugins: [payloadAccess({ targetCollections: ['courses', 'lessons'], series: [series], policies: createCoursePolicy(), engagement: { emojis: ['❤️', '😂'] } })],
    })
    const p = b.payload
    const user = async (key: string, roles: ('admin' | 'member')[] = ['member']) => {
      ids[key] = (await p.create({ collection: 'users', data: { email: `${key}@example.com`, password: 'pw-pw-pw-1', roles } as never })).id
      tok[key] = (await p.login({ collection: 'users', data: { email: `${key}@example.com`, password: 'pw-pw-pw-1' } })).token!
    }
    await user('member'); await user('stranger'); await user('lapsed'); await user('staff', ['admin'])

    const mk = async (collection: string, key: string, data: Record<string, unknown>) => { ids[key] = (await p.create({ collection: collection as never, data: { _status: 'published', ...data } as never })).id }
    await mk('courses', 'courseOpen', { title: 'Open', slug: 'open' })
    await mk('courses', 'courseQuiet', { title: 'Quiet', slug: 'quiet', allowMemberComments: false, allowMemberReactions: false })
    await mk('sections', 'secPosts', { title: 'Share', slug: 'share', series: ids.courseOpen, allowMemberPosts: true })
    await mk('sections', 'secNoPosts', { title: 'Read only', slug: 'ro', series: ids.courseOpen, allowMemberPosts: false })
    await mk('sections', 'secQuiet', { title: 'Q', slug: 'q', series: ids.courseQuiet, allowMemberPosts: true })
    // member joined 10 days ago: lessons published since then are theirs, older ones are not
    await mk('lessons', 'inWindow', { title: 'A', slug: 'a', series: [ids.courseOpen], categories: [ids.secPosts], publishedAt: ago(5) })
    await mk('lessons', 'beforeJoin', { title: 'B', slug: 'b', series: [ids.courseOpen], categories: [ids.secPosts], publishedAt: ago(40) })
    await mk('lessons', 'quietLesson', { title: 'C', slug: 'c', series: [ids.courseQuiet], categories: [ids.secQuiet], publishedAt: ago(5) })

    const access = getAccess(p)
    const grant = (user: string, course: string, start: string, end: string | null) => access.grant({ user: ids[user]!, target: { relationTo: 'courses', value: ids[course]! }, start: new Date(start), end: end ? new Date(end) : null, keepAccessibleAfterExpiry: true })
    await grant('member', 'courseOpen', ago(10), new Date(Date.now() + 300 * DAY).toISOString())
    await grant('member', 'courseQuiet', ago(10), new Date(Date.now() + 300 * DAY).toISOString())
    await grant('lapsed', 'courseOpen', ago(100), ago(20)) // window over, content stays reachable (keepAccessibleAfterExpiry)
  }, 90_000)

  afterAll(async () => {
    await b?.close()
  })

  it('anonymous visitors cannot comment or react', async () => {
    expect((await comment(null, lesson('inWindow'))).status).toBe(401)
    expect((await react(null, lesson('inWindow'), '❤️')).status).toBe(401)
  })

  it('a member comments on lessons inside their window, not on older ones, not without access', async () => {
    expect((await comment('member', lesson('inWindow'))).status).toBe(201)
    expect((await comment('member', lesson('beforeJoin'))).status).toBe(403)
    expect((await comment('stranger', lesson('inWindow'))).status).toBe(403)
  })

  it('a course that does not allow member comments blocks them even when the lesson is viewable', async () => {
    expect((await comment('member', lesson('quietLesson'))).status).toBe(403)
    expect((await react('member', lesson('quietLesson'), '❤️')).status).toBe(403)
  })

  it('member posts in a section need the section to allow it and an ACTIVE window', async () => {
    expect((await comment('member', section('secPosts'), 'My first post')).status).toBe(201)
    expect((await comment('member', section('secNoPosts'))).status).toBe(403)
    expect((await comment('lapsed', section('secPosts'))).status).toBe(403) // expired window
    expect((await comment('stranger', section('secPosts'))).status).toBe(403)
  })

  it('replies are judged by what the thread hangs on', async () => {
    const root = (await comment('member', lesson('inWindow'), 'root')).json.id
    expect((await comment('member', { relationTo: 'comments', value: root }, 'reply')).status).toBe(201)
    expect((await comment('stranger', { relationTo: 'comments', value: root }, 'nope')).status).toBe(403)
  })

  it('one reaction per member: add, replace, remove; only allowed emojis; summary is returned', async () => {
    const t = lesson('inWindow')
    expect((await react('member', t, '❤️')).json).toMatchObject({ action: 'added', summary: { '❤️': 1 } })
    expect((await react('member', t, '😂')).json).toMatchObject({ action: 'replaced', summary: { '😂': 1 } })
    expect((await react('member', t, '😂')).json).toMatchObject({ action: 'removed', summary: {} })
    expect((await react('member', t, '💩')).status).toBe(400)
    expect((await react('stranger', t, '❤️')).status).toBe(403)
  })

  it('reacting to a comment follows the permission of where the comment is', async () => {
    const underSection = (await comment('member', section('secPosts'), 'post')).json.id
    expect((await react('member', { relationTo: 'comments', value: underSection }, '❤️')).status).toBe(200)
    expect((await react('lapsed', { relationTo: 'comments', value: underSection }, '❤️')).status).toBe(403)
  })

  it('authors and staff delete comments; a comment with replies is blanked, one without disappears', async () => {
    const root = (await comment('member', lesson('inWindow'), 'to delete')).json.id
    const reply = (await comment('member', { relationTo: 'comments', value: root }, 'reply')).json.id
    await react('member', { relationTo: 'comments', value: root }, '❤️')
    await react('member', { relationTo: 'comments', value: reply }, '❤️')

    expect((await call('DELETE', `/engagement/comments/${root}`, 'stranger')).status).toBe(403)
    expect((await call('DELETE', `/engagement/comments/${root}`, null)).status).toBe(401)
    // the root has a reply: it is blanked, the reply stays readable
    expect((await call('DELETE', `/engagement/comments/${root}`, 'member')).json).toEqual({ deleted: 'blanked' })
    const blanked = (await b.payload.findByID({ collection: 'comments' as never, id: root, depth: 0, overrideAccess: true })) as any
    expect(blanked).toMatchObject({ deleted: true, text: null, anonymous: false })
    expect((await b.payload.findByID({ collection: 'comments' as never, id: reply, depth: 0, overrideAccess: true })) as any).toMatchObject({ deleted: false })
    expect((await b.payload.find({ collection: 'reactions' as never, where: { and: [{ 'target.relationTo': { equals: 'comments' } }, { 'target.value': { equals: root } }] } as never, overrideAccess: true })).totalDocs).toBe(0)

    // deleting the last reply removes it; the blanked parent can then be removed for good
    expect((await call('DELETE', `/engagement/comments/${reply}`, 'member')).json).toEqual({ deleted: 'removed' })
    expect((await b.payload.find({ collection: 'reactions' as never, where: { 'target.value': { equals: reply } }, overrideAccess: true })).totalDocs).toBe(0)
    expect((await call('DELETE', `/engagement/comments/${root}`, 'member')).json).toEqual({ deleted: 'removed' })

    const other = (await comment('member', lesson('inWindow'), 'staff will remove')).json.id
    expect((await call('DELETE', `/engagement/comments/${other}`, 'staff')).status).toBe(200)
  })

  it('stores only the allowed formatting of a comment and rejects empty or oversized ones', async () => {
    const rich = { root: { type: 'root', children: [
      { type: 'paragraph', children: [{ type: 'text', text: 'fett', format: 1 }, { type: 'text', text: ' & hack', format: 1 | 16 }, { type: 'link', fields: { url: 'https://evil.example' }, children: [{ type: 'text', text: 'klick' }] }] },
      { type: 'list', listType: 'bullet', children: [{ type: 'listitem', children: [{ type: 'text', text: 'eins' }] }] },
      { type: 'upload', value: 1 },
    ] } }
    const id = (await comment('member', lesson('inWindow'), rich as never)).json.id
    const saved = JSON.stringify(((await b.payload.findByID({ collection: 'comments' as never, id, depth: 0, overrideAccess: true })) as any).text)
    expect(saved).toContain('"text":"fett"')
    expect(saved).toContain('"listType":"bullet"')
    expect(saved).not.toContain('evil.example')
    expect(saved).not.toContain('klick')
    expect(saved).not.toContain('upload')
    expect(saved).toContain('"format":1')
    expect(saved).not.toContain('"format":17') // code format is dropped, bold stays
    expect((await comment('member', lesson('inWindow'), { root: { type: 'root', children: [{ type: 'paragraph', children: [] }] } } as never)).status).toBe(400)
    expect((await comment('member', lesson('inWindow'), 'x'.repeat(10_001))).status).toBe(400)
  })

  describe('pictures', () => {
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    const upload = async (who: string | null, file?: Blob, name = 'bild.png') => {
      const f = new FormData()
      if (file) f.set('file', file, name)
      const res = await handleEndpoints({ config: b.payload.config, request: new Request('http://localhost/api/engagement/uploads', { method: 'POST', headers: who ? { Authorization: `JWT ${tok[who]}` } : {}, body: f }) })
      return { status: res.status, json: (await res.json()) as any }
    }

    it('uploads an image as the member and only accepts real images of a sensible size', async () => {
      const ok = await upload('member', new Blob([PNG], { type: 'image/png' }))
      expect(ok.status).toBe(201)
      const doc = (await b.payload.findByID({ collection: 'media' as never, id: ok.json.id, depth: 0, overrideAccess: true })) as any
      expect(doc).toMatchObject({ userUpload: true, uploadedBy: ids.member, prefix: 'user-uploads' }) // members' pictures go into their own bucket folder
      expect((await upload(null, new Blob([PNG], { type: 'image/png' }))).status).toBe(401)
      expect((await upload('member')).json).toMatchObject({ error: 'file-required' })
      expect((await upload('member', new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: 'image/svg+xml' }), 'a.svg')).status).toBe(415)
      expect((await upload('member', new Blob(['not an image'], { type: 'image/png' }))).status).toBe(415) // declared png, bytes say no
      const big = Buffer.concat([PNG, Buffer.alloc(11 * 1024 * 1024)])
      expect((await upload('member', new Blob([big], { type: 'image/png' }))).status).toBe(413)
    })

    it('attaches only the member\'s own uploads, at most five, and removes them with the comment', async () => {
      const mine = (await upload('member', new Blob([PNG], { type: 'image/png' }))).json.id
      const theirs = (await upload('stranger', new Blob([PNG], { type: 'image/png' }))).json.id
      const plain = (await b.payload.create({ collection: 'media' as never, data: { alt: 'staff media' } as never, file: { data: PNG, mimetype: 'image/png', name: 'x.png', size: PNG.length }, overrideAccess: true })).id

      expect((await comment('member', lesson('inWindow'), 'with picture', { media: [theirs] })).status).toBe(400)
      expect((await comment('member', lesson('inWindow'), 'with picture', { media: [plain] })).status).toBe(400)
      expect((await comment('member', lesson('inWindow'), 'with picture', { media: Array.from({ length: 6 }, () => mine) })).status).toBe(201) // duplicates collapse to one
      const six: (number | string)[] = []
      for (let i = 0; i < 6; i++) six.push((await upload('member', new Blob([PNG], { type: 'image/png' }))).json.id)
      expect((await comment('member', lesson('inWindow'), 'too many', { media: six })).status).toBe(400)

      const own = (await upload('member', new Blob([PNG], { type: 'image/png' }))).json.id
      const id = (await comment('member', lesson('inWindow'), 'one picture', { media: [own] })).json.id
      expect(((await b.payload.findByID({ collection: 'comments' as never, id, depth: 0, overrideAccess: true })) as any).media).toEqual([own])
      expect((await call('DELETE', `/engagement/comments/${id}`, 'member')).json).toEqual({ deleted: 'removed' })
      expect((await b.payload.find({ collection: 'media' as never, where: { id: { equals: own } } as never, overrideAccess: true })).totalDocs).toBe(0)
    })
  })

  it('anonymous comments hide the author from members but not from staff', async () => {
    const id = (await comment('member', lesson('inWindow'), 'secret', { anonymous: true })).json.id
    const asUser = async (key: string) => ({ ...((await b.payload.findByID({ collection: 'users', id: ids[key]!, overrideAccess: true })) as object), collection: 'users' as const })
    const seenByMember = (await b.payload.findByID({ collection: 'comments' as never, id, depth: 0, overrideAccess: false, user: (await asUser('stranger')) as never })) as any
    const seenByStaff = (await b.payload.findByID({ collection: 'comments' as never, id, depth: 0, overrideAccess: false, user: (await asUser('staff')) as never })) as any
    expect(seenByMember.author).toBeUndefined()
    expect(seenByStaff.author).toBeTruthy()
  })

  it('staff may do everything', async () => {
    expect((await comment('staff', lesson('beforeJoin'))).status).toBe(201)
    expect((await comment('staff', section('secNoPosts'))).status).toBe(201)
  })
})
