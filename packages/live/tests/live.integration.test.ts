import { handleEndpoints, type CollectionConfig } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getLive, joinWindow, liveBookingBridge, liveCallBlock, payloadLive, type RoomService } from '../src'
import { boot, type Booted } from './harness'

const lessons: CollectionConfig = { slug: 'lessons', fields: [{ name: 'title', type: 'text' }, { name: 'body', type: 'richText' }] }

const blockNode = (id: string, fields: Record<string, unknown>) => ({ type: 'block', version: 2, format: '', fields: { id, blockType: 'liveCall', blockName: '', ...fields } })
const body = (...children: unknown[]) => ({ root: { type: 'root', version: 1, direction: 'ltr', format: '', indent: 0, children } })
const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString()

describe('payload-live on a real Payload + Postgres', () => {
  let b: Booted
  const calls: string[] = []
  let present: { identity: string; tracks: { sid: string; type: number; muted: boolean }[] }[] = []
  const rooms: RoomService = {
    listParticipants: async () => present,
    mutePublishedTrack: async (room, identity, sid) => void calls.push(`mute ${room} ${identity} ${sid}`),
    removeParticipant: async (room, identity) => void calls.push(`remove ${room} ${identity}`),
    updateParticipant: async (room, identity, _m, perm) => void calls.push(`perm ${identity} ${perm.canPublish} ${perm.canUpdateMetadata}`),
    deleteRoom: async (room) => void calls.push(`delete ${room}`),
  }
  const ids: Record<string, string | number> = {}
  const tokens: Record<string, string> = {}

  const call = async (path: string, data: unknown, who?: string) => {
    const res = await handleEndpoints({
      config: b.payload.config,
      request: new Request(`http://localhost/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(who ? { authorization: `JWT ${tokens[who]}` } : {}) }, body: JSON.stringify(data) }),
    })
    return { status: res.status, json: (await res.json().catch(() => null)) as any }
  }
  const decode = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString())

  const lesson = async (title: string, ...blocks: unknown[]) => (await b.payload.create({ collection: 'lessons', data: { title, body: body(...blocks) } as never })).id

  beforeAll(async () => {
    b = await boot({
      collections: [lessons],
      plugins: [
        payloadLive({
          livekit: { url: 'ws://localhost:7880', apiKey: 'devkey', apiSecret: 'secret-secret-secret-secret-secret' },
          roomService: rooms,
          // members may join when the lesson's title says so: stands in for the real access rules
          authorizeGroup: ({ doc, user }) => doc.title === 'Offen' || (doc.title === 'Nur Anna' && user.email === 'anna@example.com'),
        }),
      ],
    })
    const mk = async (email: string, roles: string[] = ['member']) => {
      ids[email] = (await b.payload.create({ collection: 'users', data: { email, password: 'pw-pw-pw-1', roles } as never })).id
      tokens[email] = (await b.payload.login({ collection: 'users', data: { email, password: 'pw-pw-pw-1' } })).token!
    }
    await mk('anna@example.com')
    await mk('ben@example.com')
    await mk('host@example.com', ['admin'])
  }, 90_000)

  afterAll(async () => {
    await b?.close()
  })

  it('the block is a normal Payload block with the fields editors need', () => {
    expect(liveCallBlock.slug).toBe('liveCall')
    expect(liveCallBlock.fields.map((f) => (f as { name: string }).name)).toEqual(['title', 'description', 'startsAt', 'durationMinutes', 'allowSpeak', 'capacity', 'record'])
  })

  it('computes the join window', () => {
    const o = { opensMinutesBefore: 10, closesMinutesAfter: 30 }
    const s = { startsAt: '2026-10-27T18:00:00Z', endsAt: '2026-10-27T19:00:00Z' }
    expect(joinWindow(s, new Date('2026-10-27T17:49:00Z'), o).state).toBe('early')
    expect(joinWindow(s, new Date('2026-10-27T17:50:00Z'), o).state).toBe('open')
    expect(joinWindow(s, new Date('2026-10-27T19:30:00Z'), o).state).toBe('open')
    expect(joinWindow(s, new Date('2026-10-27T19:31:00Z'), o).state).toBe('ended')
  })

  it('group call: login, access rule, time window and a token with the right grants', async () => {
    const open = await lesson('Offen', blockNode('b1', { title: 'Meditationsabend', startsAt: minutes(5), durationMinutes: 60, allowSpeak: 'raise-hand' }))
    const src = { collection: 'lessons', id: open, blockId: 'b1' }

    expect((await call('/live/join', { source: src })).status).toBe(401)

    const anna = await call('/live/join', { source: src }, 'anna@example.com')
    expect(anna.status).toBe(200)
    expect(anna.json.role).toBe('viewer') // raise-hand: members listen until the host lets them speak
    expect(anna.json.url).toBe('ws://localhost:7880')
    const claims = decode(anna.json.token)
    expect(claims.sub).toBe(`u${ids['anna@example.com']}`)
    expect(claims.video).toMatchObject({ roomJoin: true, canPublish: false, canSubscribe: true, canPublishData: true })
    expect(claims.video.room).toBe(`g-lessons-${open}-b1`)

    const host = await call('/live/join', { source: src }, 'host@example.com')
    expect(host.json.role).toBe('host')
    expect(decode(host.json.token).video.canPublish).toBe(true)

    // the session was created from the block, once
    const sessions = await b.payload.find({ collection: 'liveSessions', limit: 0, pagination: false })
    expect(sessions.docs.filter((s) => (s as { blockID?: string }).blockID === 'b1')).toHaveLength(1)
    expect((sessions.docs[0] as unknown as { status: string }).status).toBe('live')
  })

  it('group call: the access rule decides, not the block', async () => {
    const closed = await lesson('Gesperrt', blockNode('b2', { title: 'Geheim', startsAt: minutes(1), durationMinutes: 60 }))
    const only = await lesson('Nur Anna', blockNode('b3', { title: 'Privat', startsAt: minutes(1), durationMinutes: 60, allowSpeak: 'all' }))
    expect((await call('/live/join', { source: { collection: 'lessons', id: closed, blockId: 'b2' } }, 'anna@example.com')).status).toBe(403)
    expect((await call('/live/join', { source: { collection: 'lessons', id: closed, blockId: 'b2' } }, 'host@example.com')).status).toBe(200) // staff
    expect((await call('/live/join', { source: { collection: 'lessons', id: only, blockId: 'b3' } }, 'ben@example.com')).status).toBe(403)
    const anna = await call('/live/join', { source: { collection: 'lessons', id: only, blockId: 'b3' } }, 'anna@example.com')
    expect(anna.json.role).toBe('guest') // allowSpeak 'all'
    expect((await call('/live/join', { source: { collection: 'lessons', id: only, blockId: 'nope' } }, 'anna@example.com')).status).toBe(404)
    expect((await call('/live/join', { source: { collection: 'users', id: 1, blockId: 'x' } }, 'anna@example.com')).status).toBe(404) // only configured collections
  })

  it('group call: not before it opens, not after it is over; staff any time', async () => {
    const later = await lesson('Offen', blockNode('b4', { title: 'Später', startsAt: minutes(120), durationMinutes: 60 }))
    const early = await call('/live/join', { source: { collection: 'lessons', id: later, blockId: 'b4' } }, 'anna@example.com')
    expect(early.status).toBe(409)
    expect(early.json.error).toBe('not-open')
    expect(new Date(early.json.opensAt).getTime()).toBeLessThan(new Date(minutes(111)).getTime())
    expect((await call('/live/join', { source: { collection: 'lessons', id: later, blockId: 'b4' } }, 'host@example.com')).status).toBe(200)

    const past = await lesson('Offen', blockNode('b5', { title: 'Vorbei', startsAt: minutes(-200), durationMinutes: 60 }))
    expect((await call('/live/join', { source: { collection: 'lessons', id: past, blockId: 'b5' } }, 'anna@example.com')).status).toBe(410)
  })

  it('group call: rescheduling the block moves the session; capacity is enforced', async () => {
    const id = await lesson('Offen', blockNode('b6', { title: 'Klein', startsAt: minutes(5), durationMinutes: 60, capacity: 2, allowSpeak: 'all' }))
    const src = { collection: 'lessons', id, blockId: 'b6' }
    present = [{ identity: 'u1', tracks: [] }, { identity: 'u2', tracks: [] }]
    expect((await call('/live/join', { source: src }, 'anna@example.com')).json.error).toBe('full')
    expect((await call('/live/join', { source: src }, 'host@example.com')).status).toBe(200) // the host always gets in
    present = []

    await b.payload.update({ collection: 'lessons', id, data: { body: body(blockNode('b6', { title: 'Klein, neu', startsAt: minutes(300), durationMinutes: 45, capacity: 2 })) } as never })
    const moved = await call('/live/join', { source: src }, 'anna@example.com')
    expect(moved.status).toBe(409) // now in five hours
    const s = (await b.payload.find({ collection: 'liveSessions', where: { room: { equals: `g-lessons-${id}-b6` } } })).docs[0] as any
    expect(s.title).toBe('Klein, neu')
    expect(s.status).toBe('scheduled')
  })

  it('direct call: only the listed people, hosts and staff', async () => {
    const live = getLive(b.payload)
    const s = await live.createDirectSession({ title: 'Einzelsitzung', startsAt: new Date(Date.now() + 5 * 60_000), endsAt: new Date(Date.now() + 65 * 60_000), hostUserIds: [ids['host@example.com']!], participantUserIds: [ids['anna@example.com']!], source: { kind: 'booking', id: 7 } })
    expect(s.room).toMatch(/^d-/)
    expect((await call('/live/join', { sessionId: s.id }, 'ben@example.com')).status).toBe(403)
    const anna = await call('/live/join', { sessionId: s.id }, 'anna@example.com')
    expect(anna.status).toBe(200)
    expect(anna.json.role).toBe('guest')
    expect(decode(anna.json.token).video.canPublish).toBe(true) // both talk in a 1:1
    expect((await call('/live/join', { sessionId: s.id }, 'host@example.com')).json.role).toBe('host')

    // members can read their own session, not others'
    const mine = await b.payload.find({ collection: 'liveSessions', where: { id: { equals: s.id } }, overrideAccess: false, user: { ...(await b.payload.findByID({ collection: 'users', id: ids['anna@example.com']! })), collection: 'users' } as never })
    expect(mine.totalDocs).toBe(1)
    const other = await b.payload.find({ collection: 'liveSessions', where: { id: { equals: s.id } }, overrideAccess: false, user: { ...(await b.payload.findByID({ collection: 'users', id: ids['ben@example.com']! })), collection: 'users' } as never })
    expect(other.totalDocs).toBe(0)

    await live.cancelSession(s.id)
    expect((await call('/live/join', { sessionId: s.id }, 'anna@example.com')).status).toBe(410)
    expect(calls).toContain(`delete ${s.room}`)
  })

  it('moderation: only hosts, and it goes through LiveKit', async () => {
    const live = getLive(b.payload)
    const s = await live.createDirectSession({ title: 'Mod', startsAt: new Date(), endsAt: new Date(Date.now() + 3_600_000), hostUserIds: [ids['host@example.com']!], participantUserIds: [ids['anna@example.com']!] })
    present = [{ identity: `u${ids['anna@example.com']}`, tracks: [{ sid: 'TR_a', type: 0, muted: false }, { sid: 'TR_v', type: 1, muted: false }] }]
    const identity = `u${ids['anna@example.com']}`
    expect((await call('/live/moderate', { sessionId: s.id, identity, action: 'mute' }, 'anna@example.com')).status).toBe(403)
    expect((await call('/live/moderate', { sessionId: s.id, identity, action: 'mute' })).status).toBe(401)
    expect((await call('/live/moderate', { sessionId: s.id, identity, action: 'mute' }, 'host@example.com')).status).toBe(200)
    expect(calls).toContain(`mute ${s.room} ${identity} TR_a`)
    expect(calls).not.toContain(`mute ${s.room} ${identity} TR_v`) // only audio
    await call('/live/moderate', { sessionId: s.id, identity, action: 'allow-speak' }, 'host@example.com')
    expect(calls).toContain(`perm ${identity} true true`) // keeps the right to raise a hand
    await call('/live/moderate', { sessionId: s.id, identity, action: 'remove' }, 'host@example.com')
    expect(calls).toContain(`remove ${s.room} ${identity}`)
    expect((await call('/live/moderate', { sessionId: s.id, identity, action: 'explode' }, 'host@example.com')).status).toBe(400)
    await call('/live/moderate', { sessionId: s.id, action: 'end' }, 'host@example.com')
    expect(((await b.payload.findByID({ collection: 'liveSessions', id: s.id })) as any).status).toBe('ended')
    expect((await call('/live/join', { sessionId: s.id }, 'anna@example.com')).status).toBe(410)
  })

  it('the booking bridge creates, moves and cancels a direct call', async () => {
    const bridge = liveBookingBridge({ joinHref: (id) => `/live/${id}` })
    const ctx = { payload: b.payload }
    const start = new Date(Date.now() + 3_600_000)
    const { id } = await bridge.createSession({ title: 'Gebucht', startsAt: start, endsAt: new Date(start.getTime() + 3_600_000), hostUserIds: [ids['host@example.com']!], participantUserIds: [ids['anna@example.com']!], source: { kind: 'booking', id: 42 } }, ctx)
    const s = (await b.payload.findByID({ collection: 'liveSessions', id })) as any
    expect(s).toMatchObject({ kind: 'direct', sourceKind: 'booking', sourceID: '42', status: 'scheduled' })
    expect(bridge.joinHref!(id)).toBe(`/live/${id}`)

    const later = new Date(start.getTime() + 86_400_000)
    await bridge.updateSession(id, { startsAt: later, endsAt: new Date(later.getTime() + 3_600_000) }, ctx)
    expect(new Date(((await b.payload.findByID({ collection: 'liveSessions', id })) as any).startsAt).getTime()).toBe(later.getTime())
    // the guest can only enter in the new window
    expect((await call('/live/join', { sessionId: id }, 'anna@example.com')).status).toBe(409)

    await bridge.cancelSession(id, ctx)
    expect(((await b.payload.findByID({ collection: 'liveSessions', id })) as any).status).toBe('cancelled')
  })
})
