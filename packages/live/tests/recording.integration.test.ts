import { createHash } from 'node:crypto'
import { AccessToken } from 'livekit-server-sdk'
import { handleEndpoints, type CollectionConfig } from 'payload'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getLive, payloadLive, type EgressInfoLite, type EgressService, type RoomService } from '../src'
import { RecordingLinks } from '../src/admin'
import { LiveRecordings } from '../src/ui'
import { boot, type Booted } from './harness'

const lessons: CollectionConfig = { slug: 'lessons', fields: [{ name: 'title', type: 'text' }, { name: 'body', type: 'richText' }] }
const blockNode = (id: string, fields: Record<string, unknown>) => ({ type: 'block', version: 2, format: '', fields: { id, blockType: 'liveCall', blockName: '', ...fields } })
const body = (...children: unknown[]) => ({ root: { type: 'root', version: 1, direction: 'ltr', format: '', indent: 0, children } })
const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString()
const KEY = 'devkey'
const SECRET = 'secret-secret-secret-secret-secret'

describe('payload-live recordings (mocked LiveKit Egress, real Payload + Postgres)', () => {
  let b: Booted
  const ids: Record<string, string | number> = {}
  const tokens: Record<string, string> = {}
  const started: { room: string; key: string }[] = []
  const stopped: string[] = []
  let listing: EgressInfoLite[] = []
  let n = 0
  const egress: EgressService = {
    start: async (room, key) => { started.push({ room, key }); await new Promise((r) => setTimeout(r, 30)); return { egressId: `EG_${++n}`, roomName: room, state: 'starting' } },
    stop: async (id) => void stopped.push(id),
    list: async (room) => listing.filter((i) => i.roomName === room),
  }
  const rooms: RoomService = { listParticipants: async () => [], mutePublishedTrack: async () => undefined, removeParticipant: async () => undefined, updateParticipant: async () => undefined, deleteRoom: async () => undefined }

  const call = async (method: 'GET' | 'POST', path: string, o: { data?: unknown; who?: string; headers?: Record<string, string>; raw?: string } = {}) => {
    const res = await handleEndpoints({
      config: b.payload.config,
      request: new Request(`http://localhost/api${path}`, {
        method,
        redirect: 'manual',
        headers: { ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), ...(o.who ? { authorization: `JWT ${tokens[o.who]}` } : {}), ...o.headers },
        ...(method === 'POST' ? { body: o.raw ?? JSON.stringify(o.data ?? {}) } : {}),
      }),
    })
    return { status: res.status, location: res.headers.get('location'), json: (await res.clone().json().catch(() => null)) as any }
  }
  const sessionOf = async (room: string) => (await b.payload.find({ collection: 'liveSessions', where: { room: { equals: room } }, depth: 0, overrideAccess: true })).docs[0] as any
  const lesson = async (title: string, ...blocks: unknown[]) => (await b.payload.create({ collection: 'lessons', data: { title, body: body(...blocks) } as never })).id
  const signedWebhook = async (event: Record<string, unknown>) => {
    const raw = JSON.stringify({ id: `ev_${Math.random()}`, createdAt: String(Math.floor(Date.now() / 1000)), ...event })
    const at = new AccessToken(KEY, SECRET)
    at.sha256 = createHash('sha256').update(raw).digest('base64')
    return call('POST', '/live/webhook', { raw, headers: { authorization: await at.toJwt() } })
  }

  beforeAll(async () => {
    b = await boot({
      collections: [lessons],
      plugins: [
        payloadLive({
          livekit: { url: 'ws://localhost:7880', apiKey: KEY, apiSecret: SECRET },
          roomService: rooms,
          authorizeGroup: ({ doc, user }) => doc.title === 'Offen' || (doc.title === 'Nur Anna' && user.email === 'anna@example.com'),
          recording: { storage: { bucket: 'rec', region: 'eu-central-1', accessKey: 'a', secret: 'b' } },
          egress,
          signRecording: async (key, o) => `https://signed.example/${key}?sig=1${o.download ? '&dl=1' : ''}`,
        }),
      ],
    })
    const mk = async (email: string, roles: string[] = ['member']) => {
      ids[email] = (await b.payload.create({ collection: 'users', data: { email, password: 'pw-pw-pw-1', roles } as never })).id
      tokens[email] = (await b.payload.login({ collection: 'users', data: { email, password: 'pw-pw-pw-1' } })).token!
    }
    await mk('anna@example.com'); await mk('ben@example.com'); await mk('host@example.com', ['admin'])
  }, 90_000)

  afterAll(async () => { await b?.close() })

  it('a block marked "record" makes a recorded session; the join answer tells the room', async () => {
    const id = await lesson('Nur Anna', blockNode('r1', { title: 'Privat', startsAt: minutes(2), durationMinutes: 60, record: true }))
    ids.private = id
    const j = await call('POST', '/live/join', { data: { source: { collection: 'lessons', id, blockId: 'r1' } }, who: 'anna@example.com' })
    expect(j.status).toBe(200)
    expect(j.json.recording).toEqual({ enabled: true, auto: true })
    expect((await sessionOf(`g-lessons-${id}-r1`)).record).toBe(true)
    const plain = await lesson('Offen', blockNode('r2', { title: 'Ohne', startsAt: minutes(2), durationMinutes: 60 }))
    expect((await call('POST', '/live/join', { data: { source: { collection: 'lessons', id: plain, blockId: 'r2' } }, who: 'anna@example.com' })).json.recording).toEqual({ enabled: true, auto: false })
  })

  it('the room asks for the recording: one file however many ask, only people who may join, only for marked calls', async () => {
    const room = `g-lessons-${ids.private}-r1`
    const sessionId = (await sessionOf(room)).id
    const asks = await Promise.all([call('POST', '/live/record', { data: { sessionId }, who: 'anna@example.com' }), call('POST', '/live/record', { data: { sessionId }, who: 'host@example.com' }), call('POST', '/live/record', { data: { sessionId }, who: 'anna@example.com' })])
    expect(asks.map((a) => a.status)).toEqual([200, 200, 200])
    expect(started.filter((s) => s.room === room)).toHaveLength(1)
    expect(started[0]!.key).toMatch(new RegExp(`^recordings/${room}/.+\\.mp4$`))
    const s = await sessionOf(room)
    expect(s.recordings).toHaveLength(1)
    expect(s.recordings[0]).toMatchObject({ egressId: 'EG_1', status: 'starting' })

    expect((await call('POST', '/live/record', { data: { sessionId }, who: 'ben@example.com' })).status).toBe(403)
    expect((await call('POST', '/live/record', { data: { sessionId } })).status).toBe(401)
    const plainId = (await sessionOf(`g-lessons-${ids.private}-r1`)).id
    expect(plainId).toBe(sessionId)
  })

  it('the webhook (signed) moves a recording through its states; a forged one is refused', async () => {
    const room = `g-lessons-${ids.private}-r1`
    const info = (status: string, extra: Record<string, unknown> = {}) => ({ egressId: 'EG_1', roomName: room, status, startedAt: String(1_700_000_000_000_000_000n), ...extra })
    expect((await signedWebhook({ event: 'egress_started', egressInfo: info('EGRESS_ACTIVE') })).status).toBe(200)
    expect((await sessionOf(room)).recordings[0].status).toBe('recording')

    const forged = await call('POST', '/live/webhook', { raw: JSON.stringify({ event: 'egress_ended', egressInfo: info('EGRESS_COMPLETE') }), headers: { authorization: 'nope' } })
    expect(forged.status).toBe(401)
    expect((await sessionOf(room)).recordings[0].status).toBe('recording')

    const done = await signedWebhook({ event: 'egress_ended', egressInfo: info('EGRESS_COMPLETE', { endedAt: String(1_700_000_600_000_000_000n), fileResults: [{ filename: `recordings/${room}/x.mp4`, size: '1048576', duration: String(600n * 1_000_000_000n) }] }) })
    expect(done.status).toBe(200)
    const r = (await sessionOf(room)).recordings[0]
    expect(r).toMatchObject({ status: 'ready', durationSeconds: 600, sizeBytes: 1048576, fileKey: `recordings/${room}/x.mp4` })
  })

  it('watching: same rule as joining, answered with a short-lived signed link', async () => {
    const s = await sessionOf(`g-lessons-${ids.private}-r1`)
    const path = `/live/recording/${s.id}/EG_1`
    expect((await call('GET', path)).status).toBe(401)
    expect((await call('GET', path, { who: 'ben@example.com' })).status).toBe(403) // may not see this lesson
    const anna = await call('GET', path, { who: 'anna@example.com' })
    expect(anna.status).toBe(302)
    expect(anna.location).toBe(`https://signed.example/${s.recordings[0].fileKey}?sig=1`)
    expect((await call('GET', `${path}?download=1`, { who: 'host@example.com' })).location).toMatch(/&dl=1$/)
    expect((await call('GET', `/live/recording/${s.id}/EG_999`, { who: 'anna@example.com' })).status).toBe(404)
  })

  it('the first person in starts a marked call through the webhook, helpers and egress participants excluded', async () => {
    const id = await lesson('Offen', blockNode('r3', { title: 'Auto', startsAt: minutes(2), durationMinutes: 60, record: true }))
    await call('POST', '/live/join', { data: { source: { collection: 'lessons', id, blockId: 'r3' } }, who: 'anna@example.com' })
    const room = `g-lessons-${id}-r3`
    const before = started.length
    await signedWebhook({ event: 'participant_joined', room: { name: room }, participant: { identity: 'EG_abc' } })
    expect(started.length).toBe(before)
    await signedWebhook({ event: 'participant_joined', room: { name: room }, participant: { identity: `u${ids['anna@example.com']}` } })
    expect(started.length).toBe(before + 1)
    await signedWebhook({ event: 'participant_joined', room: { name: room }, participant: { identity: 'u99' } })
    expect(started.length).toBe(before + 1) // already running
    // the room closes: the running recording is stopped
    await signedWebhook({ event: 'room_finished', room: { name: room } })
    expect(stopped).toContain(`EG_${n}`)
    expect((await sessionOf(room)).recordings.at(-1).status).toBe('processing')
  })

  it('the host starts, stops and syncs by hand (no webhook needed)', async () => {
    const id = await lesson('Offen', blockNode('r4', { title: 'Hand', startsAt: minutes(2), durationMinutes: 60 }))
    await call('POST', '/live/join', { data: { source: { collection: 'lessons', id, blockId: 'r4' } }, who: 'host@example.com' })
    const room = `g-lessons-${id}-r4`
    const sessionId = (await sessionOf(room)).id
    expect((await call('POST', '/live/moderate', { data: { sessionId, action: 'record-start' }, who: 'anna@example.com' })).status).toBe(403)
    expect((await call('POST', '/live/moderate', { data: { sessionId, action: 'record-start' }, who: 'host@example.com' })).status).toBe(200)
    const egressId = (await sessionOf(room)).recordings[0].egressId
    expect((await call('POST', '/live/moderate', { data: { sessionId, action: 'record-stop' }, who: 'host@example.com' })).status).toBe(200)
    expect(stopped).toContain(egressId)
    expect((await sessionOf(room)).recordings[0].status).toBe('processing')
    listing = [{ egressId, roomName: room, state: 'complete', file: { key: `recordings/${room}/h.mp4`, sizeBytes: 5, durationSeconds: 61 } }]
    expect((await call('POST', '/live/moderate', { data: { sessionId, action: 'sync' }, who: 'host@example.com' })).status).toBe(200)
    expect((await sessionOf(room)).recordings[0]).toMatchObject({ status: 'ready', durationSeconds: 61 })
  })

  it('1:1 calls: only the two people (and staff) may watch', async () => {
    const live = getLive(b.payload)
    const s = await live.createDirectSession({ title: 'Einzelsitzung', startsAt: new Date(), endsAt: new Date(Date.now() + 3600_000), hostUserIds: [ids['host@example.com']!], participantUserIds: [ids['anna@example.com']!], record: true })
    expect(s.record).toBe(true)
    await live.startRecording(s)
    const row = (await sessionOf(s.room)).recordings[0]
    await signedWebhook({ event: 'egress_ended', egressInfo: { egressId: row.egressId, roomName: s.room, status: 'EGRESS_COMPLETE', fileResults: [{ filename: 'recordings/d.mp4', size: '1', duration: '1000000000' }] } })
    const path = `/live/recording/${s.id}/${row.egressId}`
    expect((await call('GET', path, { who: 'anna@example.com' })).status).toBe(302)
    expect((await call('GET', path, { who: 'host@example.com' })).status).toBe(302)
    expect((await call('GET', path, { who: 'ben@example.com' })).status).toBe(403)
  })

  it('the member overview lists what the member may watch; the admin column links the finished ones', async () => {
    const html = async (who: string) => renderToStaticMarkup(await LiveRecordings({ payload: b.payload, user: { id: ids[who]!, email: who } }))
    const anna = await html('anna@example.com')
    expect(anna).toContain('Privat') // the private group call she may see
    expect(anna).toContain('Einzelsitzung') // her 1:1
    expect(anna).toContain('Ansehen')
    expect(anna).toMatch(/href="\/api\/live\/recording\/\d+\/EG_\d+\?download=1"/)
    const ben = await html('ben@example.com')
    expect(ben).not.toContain('Privat')
    expect(ben).not.toContain('Einzelsitzung')
    expect(ben).toContain('Auto') // the lessons that are open to every member are visible to him
    const nobody = renderToStaticMarkup(await LiveRecordings({ payload: b.payload, user: { id: 999_999, email: 'x@example.com' } }))
    expect(nobody).toContain('Auto') // open lessons are open to everybody who is signed in
    expect(nobody).not.toContain('Privat')

    const s = await sessionOf(`g-lessons-${ids.private}-r1`)
    const links = renderToStaticMarkup(createElement(RecordingLinks, { rowData: s }))
    expect(links).toContain(`/api/live/recording/${s.id}/EG_1`)
    expect(links).toContain('Min.')
  })
})
