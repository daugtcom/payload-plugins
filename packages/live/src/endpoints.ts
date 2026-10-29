import { WebhookReceiver } from 'livekit-server-sdk'
import type { Endpoint, PayloadRequest } from 'payload'
import { egressInfoLite, mintToken } from './livekit'
import type { Id, ResolvedLive } from './options'
import { getLive, idsOf, isRecordingNow, joinWindow, type SessionDoc } from './service'

type User = { id: Id; email?: string; name?: string | null; roles?: string[] }

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
const body = async (req: PayloadRequest): Promise<Record<string, any>> => ((await req.json?.().catch(() => ({}))) ?? {}) as Record<string, any>
const displayName = (u: User) => (u.name?.trim() || u.email?.split('@')[0] || 'Gast').slice(0, 60)

export function liveEndpoints(o: ResolvedLive): Endpoint[] {
  const isHost = (u: User, s: SessionDoc) => o.isStaff(u) || idsOf(s.hosts).includes(String(u.id))

  return [
    // a member asks to join a call: the answer is a short-lived token for LiveKit, or the reason why not
    {
      path: '/live/join',
      method: 'post',
      handler: async (req) => {
        const user = req.user as User | null
        if (!user) return json(401, { error: 'login-required' })
        const b = await body(req)
        const live = getLive(req.payload)

        let session: SessionDoc | null = null
        let allowed = false
        if (b.source && typeof b.source === 'object') {
          const src = { collection: String(b.source.collection ?? ''), id: b.source.id as Id, blockId: String(b.source.blockId ?? '') }
          const hit = await live.sessionFromBlock(req, src)
          if (!hit) return json(404, { error: 'not-found' })
          session = hit.session
          allowed = o.isStaff(user) || Boolean(await o.authorizeGroup?.({ payload: req.payload, req, user, collection: src.collection, id: src.id, doc: hit.doc, block: hit.block }))
        } else if (b.sessionId != null) {
          session = await live.byId(b.sessionId as Id)
          if (!session) return json(404, { error: 'not-found' })
          if (session.kind === 'direct') allowed = isHost(user, session) || idsOf(session.participants).includes(String(user.id))
          else {
            const hit = session.sourceCollection && session.blockID ? await live.sessionFromBlock(req, { collection: session.sourceCollection, id: session.sourceID as Id, blockId: session.blockID }) : null
            allowed = o.isStaff(user) || Boolean(hit && (await o.authorizeGroup?.({ payload: req.payload, req, user, collection: hit.session.sourceCollection!, id: session.sourceID as Id, doc: hit.doc, block: hit.block })))
          }
        } else return json(400, { error: 'invalid-request' })

        if (!allowed) return json(403, { error: 'forbidden' })
        if (session.status === 'cancelled') return json(410, { error: 'cancelled' })

        const host = isHost(user, session)
        const win = joinWindow(session, new Date(), o)
        if (win.state === 'ended' && !host) return json(410, { error: 'ended' })
        if (win.state === 'early' && !host) return json(409, { error: 'not-open', opensAt: win.opensAt.toISOString() })
        if (session.status === 'ended' && !host) return json(410, { error: 'ended' })

        if (!host && session.capacity) {
          const present = await live.rooms.listParticipants(session.room).catch(() => [])
          if (present.length >= session.capacity) return json(409, { error: 'full' })
        }

        const canPublish = host || session.kind === 'direct' || session.allowSpeak === 'all'
        const ttl = Math.min(6 * 3600, Math.max(900, Math.round((win.closesAt.getTime() - Date.now()) / 1000)))
        const identity = `u${user.id}`
        const token = await mintToken(o.livekit, { room: session.room, identity, name: displayName(user), role: host ? 'host' : canPublish ? 'guest' : 'viewer', canPublish, ttlSeconds: ttl })

        if (session.status !== 'live' && win.state === 'open') {
          await req.payload.update({ collection: o.slug as never, id: session.id, data: { status: 'live', startedAt: new Date().toISOString(), endedAt: null } as never, overrideAccess: true }).catch(() => undefined)
        }
        return json(200, {
          token,
          url: o.livekit.url,
          identity,
          role: host ? 'host' : canPublish ? 'guest' : 'viewer',
          session: { id: session.id, title: session.title, startsAt: session.startsAt, endsAt: session.endsAt, allowSpeak: session.allowSpeak, kind: session.kind },
          // recording: `enabled` = the host may start/stop; `auto` = the call is marked to be recorded, so the room asks for it once everybody is in
          recording: { enabled: live.recordingEnabled, auto: live.recordingEnabled && Boolean(session.record) },
        })
      },
    },

    // the host moves people around: mute, remove, let someone speak, end the call for everyone
    {
      path: '/live/moderate',
      method: 'post',
      handler: async (req) => {
        const user = req.user as User | null
        if (!user) return json(401, { error: 'login-required' })
        const b = await body(req)
        const live = getLive(req.payload)
        const session = b.sessionId != null ? await live.byId(b.sessionId as Id) : null
        if (!session) return json(404, { error: 'not-found' })
        if (!isHost(user, session)) return json(403, { error: 'forbidden' })
        const identity = typeof b.identity === 'string' ? b.identity : ''
        try {
          switch (b.action) {
            case 'mute': {
              const p = (await live.rooms.listParticipants(session.room)).find((x) => x.identity === identity)
              for (const t of p?.tracks ?? []) if (t.type === 0 /* audio */ && !t.muted) await live.rooms.mutePublishedTrack(session.room, identity, t.sid, true)
              break
            }
            case 'remove':
              await live.rooms.removeParticipant(session.room, identity)
              break
            case 'allow-speak':
            case 'revoke-speak':
              await live.rooms.updateParticipant(session.room, identity, undefined, { canPublish: b.action === 'allow-speak', canSubscribe: true, canPublishData: true, canUpdateMetadata: true } /* the update replaces ALL permissions, so repeat the ones members keep */)
              break
            case 'record-start':
              if (!live.recordingEnabled) return json(409, { error: 'recording-disabled' })
              await live.startRecording(session)
              break
            case 'record-stop':
              if (!live.recordingEnabled) return json(409, { error: 'recording-disabled' })
              await live.stopRecording(session)
              break
            case 'sync':
              await live.syncRecordings(session)
              break
            case 'end':
              await live.stopRecording(session).catch(() => undefined)
              await live.rooms.deleteRoom(session.room).catch(() => undefined)
              await req.payload.update({ collection: o.slug as never, id: session.id, data: { status: 'ended', endedAt: new Date().toISOString() } as never, overrideAccess: true })
              break
            default:
              return json(400, { error: 'invalid-action' })
          }
        } catch (error) {
          req.payload.logger.error({ err: error }, 'live moderation failed')
          return json(502, { error: 'livekit-unavailable' })
        }
        return json(200, { ok: true })
      },
    },
    // a participant's room asks for the recording of a call that is marked "record" (idempotent: one file, however many ask)
    {
      path: '/live/record',
      method: 'post',
      handler: async (req) => {
        const user = req.user as User | null
        if (!user) return json(401, { error: 'login-required' })
        const b = await body(req)
        const live = getLive(req.payload)
        const session = b.sessionId != null ? await live.byId(b.sessionId as Id) : null
        if (!session) return json(404, { error: 'not-found' })
        if (!(await live.mayAccess(req, user, session))) return json(403, { error: 'forbidden' })
        if (!live.recordingEnabled || !session.record) return json(200, { recording: false })
        if (session.status === 'ended' || session.status === 'cancelled') return json(410, { error: 'ended' })
        try {
          const now = await live.startRecording(session)
          return json(200, { recording: isRecordingNow(now) })
        } catch (error) {
          req.payload.logger.error({ err: error }, 'live recording could not start')
          return json(502, { error: 'egress-unavailable' })
        }
      },
    },

    // LiveKit tells us about egress progress and about people entering / leaving; the signature is checked against the API secret
    {
      path: '/live/webhook',
      method: 'post',
      handler: async (req) => {
        const raw = (await req.text?.().catch(() => '')) ?? ''
        let event
        try {
          event = await new WebhookReceiver(o.livekit.apiKey, o.livekit.apiSecret).receive(raw, req.headers.get('authorization') ?? undefined)
        } catch {
          return json(401, { error: 'invalid-signature' })
        }
        const live = getLive(req.payload)
        try {
          if (event.egressInfo && (event.event === 'egress_started' || event.event === 'egress_updated' || event.event === 'egress_ended')) {
            await live.applyEgress(egressInfoLite(event.egressInfo))
          } else if (event.event === 'participant_joined' && live.recordingEnabled && event.room?.name && !event.participant?.identity.startsWith('EG_')) {
            // the first person in: begin recording a call that is marked "record"
            const hit = await req.payload.find({ collection: o.slug as never, where: { room: { equals: event.room.name } }, limit: 1, depth: 0, overrideAccess: true })
            const session = hit.docs[0] as unknown as SessionDoc | undefined
            if (session?.record && session.status !== 'cancelled') await live.startRecording(session)
          } else if (event.event === 'participant_left' && live.recordingEnabled && event.room?.name && !event.participant?.identity.startsWith('EG_')) {
            // the last person left: LiveKit keeps the room (and Egress recording it) around for minutes, so stop the file now
            const hit = await req.payload.find({ collection: o.slug as never, where: { room: { equals: event.room.name } }, limit: 1, depth: 0, overrideAccess: true })
            const session = hit.docs[0] as unknown as SessionDoc | undefined
            if (session && isRecordingNow(session)) {
              const left = (await live.rooms.listParticipants(event.room.name).catch(() => [])).filter((p) => !p.identity.startsWith('EG_'))
              if (left.length === 0) await live.syncRecordings(await live.stopRecording(session))
            }
          } else if (event.event === 'room_finished' && event.room?.name) {
            const hit = await req.payload.find({ collection: o.slug as never, where: { room: { equals: event.room.name } }, limit: 1, depth: 0, overrideAccess: true })
            const session = hit.docs[0] as unknown as SessionDoc | undefined
            if (session) await live.syncRecordings(await live.stopRecording(session))
          }
        } catch (error) {
          req.payload.logger.error({ err: error }, 'live webhook failed')
          return json(500, { error: 'failed' })
        }
        return json(200, { ok: true })
      },
    },

    // watch (or download) a finished recording: same rule as joining, answered with a short-lived signed link to the file
    {
      path: '/live/recording/:sessionId/:egressId',
      method: 'get',
      handler: async (req) => {
        const user = req.user as User | null
        if (!user) return json(401, { error: 'login-required' })
        const live = getLive(req.payload)
        const { sessionId, egressId } = (req.routeParams ?? {}) as { sessionId?: string; egressId?: string }
        let session = sessionId ? await live.byId(sessionId) : null
        if (!session || !live.recordingEnabled) return json(404, { error: 'not-found' })
        if (!(await live.mayAccess(req, user, session))) return json(403, { error: 'forbidden' })
        let row = (session.recordings ?? []).find((r) => r.egressId === egressId)
        if (row && row.status !== 'ready') {
          session = await live.syncRecordings(session) // catch up without a webhook
          row = (session.recordings ?? []).find((r) => r.egressId === egressId)
        }
        if (!row || row.status !== 'ready' || !row.fileKey) return json(404, { error: 'not-ready', status: row?.status ?? null })
        const q = new URL(req.url!).searchParams
        const url = await live.signer(row.fileKey, { download: q.get('download') === '1', filename: session.title })
        return new Response(null, { status: 302, headers: { location: url, 'cache-control': 'no-store' } })
      },
    },
  ]
}
