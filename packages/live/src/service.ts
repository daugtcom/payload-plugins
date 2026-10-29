import { randomBytes } from 'node:crypto'
import type { Payload, PayloadRequest } from 'payload'
import { findLiveCallBlock } from './block'
import type { EgressInfoLite, EgressService, Id, RecordingSigner, ResolvedLive, RoomService } from './options'
import { egressServiceFor, roomServiceFor, s3Signer } from './livekit'

export interface SessionDoc {
  id: Id
  title: string
  kind: 'group' | 'direct'
  status: 'scheduled' | 'live' | 'ended' | 'cancelled'
  startsAt: string
  endsAt: string
  room: string
  hosts?: (Id | { id: Id })[] | null
  participants?: (Id | { id: Id })[] | null
  allowSpeak: 'all' | 'raise-hand' | 'host'
  capacity?: number | null
  sourceKind?: string | null
  sourceCollection?: string | null
  sourceID?: string | null
  blockID?: string | null
  record?: boolean | null
  recordings?: RecordingDoc[] | null
}

export type RecordingStatus = 'starting' | 'recording' | 'processing' | 'ready' | 'failed'
export interface RecordingDoc {
  id?: string
  egressId: string
  status: RecordingStatus
  startedAt?: string | null
  endedAt?: string | null
  durationSeconds?: number | null
  sizeBytes?: number | null
  fileKey?: string | null
  error?: string | null
}

export const RECORDING_ACTIVE: readonly RecordingStatus[] = ['starting', 'recording']
export const isRecordingNow = (s: Pick<SessionDoc, 'recordings'>) => (s.recordings ?? []).some((r) => RECORDING_ACTIVE.includes(r.status))

const idOf = (v: unknown): Id => (v && typeof v === 'object' ? (v as { id: Id }).id : (v as Id))
export const idsOf = (list: unknown): string[] => (Array.isArray(list) ? list.map((v) => String(idOf(v))) : [])

export type JoinWindow = { state: 'early' | 'open' | 'ended'; opensAt: Date; closesAt: Date }

/** Members may enter from `opensMinutesBefore` before the start until `closesMinutesAfter` after the planned end. */
export function joinWindow(s: { startsAt: string | Date; endsAt: string | Date }, now: Date, o: { opensMinutesBefore: number; closesMinutesAfter: number }): JoinWindow {
  const opensAt = new Date(new Date(s.startsAt).getTime() - o.opensMinutesBefore * 60_000)
  const closesAt = new Date(new Date(s.endsAt).getTime() + o.closesMinutesAfter * 60_000)
  return { state: now < opensAt ? 'early' : now > closesAt ? 'ended' : 'open', opensAt, closesAt }
}

export interface DirectSessionInput {
  title: string
  startsAt: Date
  endsAt: Date
  hostUserIds: Id[]
  participantUserIds: Id[]
  source?: { kind: string; id: Id }
  /** Record the call (needs the plugin's `recording` option). */
  record?: boolean
}

/** What other plugins (booking) and sites use: `getLive(payload)`. */
export class LiveService {
  readonly rooms: RoomService
  constructor(readonly payload: Payload, readonly o: ResolvedLive) {
    this.rooms = o.roomService ?? roomServiceFor(o.livekit)
  }

  private _egress?: EgressService
  private _signer?: RecordingSigner
  private readonly starting = new Set<string>()

  /** Recording is configured and switched on. */
  get recordingEnabled(): boolean {
    return Boolean(this.o.recording?.enabled || this.o.egress)
  }
  get egress(): EgressService {
    if (!this._egress) {
      if (this.o.egress) this._egress = this.o.egress
      else if (this.o.recording) this._egress = egressServiceFor(this.o.livekit, this.o.recording)
      else throw new Error('payload-live: recording is not configured')
    }
    return this._egress
  }
  get signer(): RecordingSigner {
    if (!this._signer) {
      if (this.o.signRecording) this._signer = this.o.signRecording
      else if (this.o.recording) this._signer = s3Signer(this.o.recording)
      else throw new Error('payload-live: recording is not configured')
    }
    return this._signer
  }

  private async saveRecordings(id: Id, recordings: RecordingDoc[]): Promise<SessionDoc> {
    return (await this.payload.update({ collection: this.o.slug as never, id, data: { recordings: recordings.map(({ id: _row, ...r }) => r) } as never, overrideAccess: true, depth: 0 })) as unknown as SessionDoc
  }

  /**
   * Start recording a call now (the room must exist, i.e. somebody is in it). Does nothing when a recording is already running
   * for the session, so several participants asking at once start one file.
   */
  async startRecording(session: SessionDoc): Promise<SessionDoc> {
    if (!this.recordingEnabled) return session
    const key = String(session.id)
    if (this.starting.has(key)) return session
    this.starting.add(key)
    try {
      const fresh = (await this.byId(session.id)) ?? session
      if (isRecordingNow(fresh)) return fresh
      const prefix = (this.o.recording?.storage.prefix ?? 'recordings/').replace(/^\/+/, '')
      const fileKey = `${prefix}${fresh.room}/${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`
      const info = await this.egress.start(fresh.room, fileKey)
      const row: RecordingDoc = { egressId: info.egressId, status: info.state === 'active' ? 'recording' : 'starting', startedAt: (info.startedAt ?? new Date()).toISOString(), fileKey }
      return await this.saveRecordings(fresh.id, [...(fresh.recordings ?? []), row])
    } finally {
      this.starting.delete(key)
    }
  }

  /** Stop the running recording; Egress finishes the file and reports `ready` through the webhook (or `syncRecordings`). */
  async stopRecording(session: SessionDoc): Promise<SessionDoc> {
    const fresh = (await this.byId(session.id)) ?? session
    const rows = fresh.recordings ?? []
    for (const r of rows) if (RECORDING_ACTIVE.includes(r.status)) await this.egress.stop(r.egressId).catch((err) => this.payload.logger.warn({ err }, 'payload-live: stopping a recording failed'))
    return await this.saveRecordings(fresh.id, rows.map((r) => (RECORDING_ACTIVE.includes(r.status) ? { ...r, status: 'processing' as const } : r)))
  }

  /** Writes what Egress says about one recording into the session it belongs to. */
  async applyEgress(info: EgressInfoLite): Promise<SessionDoc | null> {
    const found = await this.payload.find({ collection: this.o.slug as never, where: { room: { equals: info.roomName } }, limit: 1, depth: 0, overrideAccess: true })
    const session = found.docs[0] as unknown as SessionDoc | undefined
    const rows = session?.recordings ?? []
    const row = rows.find((r) => r.egressId === info.egressId)
    if (!session || !row) return null
    const status: RecordingStatus = info.state === 'complete' ? (info.file ? 'ready' : 'failed') : info.state === 'failed' ? 'failed' : info.state === 'ending' ? 'processing' : info.state === 'active' ? 'recording' : 'starting'
    const next: RecordingDoc = {
      ...row,
      status,
      startedAt: info.startedAt?.toISOString() ?? row.startedAt,
      endedAt: info.endedAt?.toISOString() ?? (status === 'ready' || status === 'failed' ? new Date().toISOString() : row.endedAt),
      durationSeconds: info.file?.durationSeconds ?? row.durationSeconds,
      sizeBytes: info.file?.sizeBytes ?? row.sizeBytes,
      fileKey: info.file?.key ?? row.fileKey,
      error: info.error ?? (status === 'failed' && !info.file ? 'Keine Datei erzeugt' : row.error),
    }
    if (JSON.stringify(next) === JSON.stringify(row)) return session
    return await this.saveRecordings(session.id, rows.map((r) => (r.egressId === info.egressId ? next : r)))
  }

  /** Pull Egress's current report for this room (the same updates the webhook pushes): for development without webhooks, and as a catch-up. */
  async syncRecordings(session: SessionDoc): Promise<SessionDoc> {
    if (!this.recordingEnabled || !(session.recordings ?? []).some((r) => r.status !== 'ready' && r.status !== 'failed')) return session
    let current = session
    for (const info of await this.egress.list(session.room).catch(() => [] as EgressInfoLite[])) current = (await this.applyEgress(info)) ?? current
    return current
  }

  /**
   * May this person join or watch this session? Staff and hosts always; direct calls: the listed participants; group calls: the
   * site's `authorizeGroup` rule on the document that holds the block (the same rule that lets them read it).
   */
  async mayAccess(req: PayloadRequest, user: { id: Id; email?: string; roles?: string[] }, session: SessionDoc): Promise<boolean> {
    if (this.o.isStaff(user) || idsOf(session.hosts).includes(String(user.id))) return true
    if (session.kind === 'direct') return idsOf(session.participants).includes(String(user.id))
    if (!session.sourceCollection || !session.sourceID || !this.o.sourceCollections.includes(session.sourceCollection) || !this.o.authorizeGroup) return false
    const doc = (await this.payload.findByID({ collection: session.sourceCollection as never, id: session.sourceID, depth: 0, overrideAccess: true, req }).catch(() => null)) as Record<string, any> | null
    if (!doc) return false
    const block = session.blockID ? findLiveCallBlock(doc[this.o.bodyField], session.blockID) : null
    return Boolean(await this.o.authorizeGroup({ payload: this.payload, req, user, collection: session.sourceCollection, id: session.sourceID, doc, block: block ?? {} }))
  }

  async byId(id: Id): Promise<SessionDoc | null> {
    return ((await this.payload.findByID({ collection: this.o.slug as never, id, depth: 0, overrideAccess: true }).catch(() => null)) as SessionDoc | null) ?? null
  }

  /** A call between named people, e.g. a booked 1:1 session. Only hosts, staff and the listed participants can join. */
  async createDirectSession(i: DirectSessionInput): Promise<SessionDoc> {
    return (await this.payload.create({
      collection: this.o.slug as never,
      overrideAccess: true,
      data: {
        title: i.title,
        kind: 'direct',
        status: 'scheduled',
        startsAt: i.startsAt.toISOString(),
        endsAt: i.endsAt.toISOString(),
        room: `d-${randomBytes(9).toString('base64url')}`,
        hosts: i.hostUserIds,
        participants: i.participantUserIds,
        allowSpeak: 'all',
        record: Boolean(i.record),
        ...(i.source ? { sourceKind: i.source.kind, sourceID: String(i.source.id) } : {}),
      } as never,
    })) as unknown as SessionDoc
  }

  /** The booked time moved. */
  async updateSession(id: Id, t: { startsAt: Date; endsAt: Date }): Promise<void> {
    await this.payload.update({ collection: this.o.slug as never, id, data: { startsAt: t.startsAt.toISOString(), endsAt: t.endsAt.toISOString(), status: 'scheduled', startedAt: null, endedAt: null } as never, overrideAccess: true })
  }

  async cancelSession(id: Id): Promise<void> {
    const s = await this.byId(id)
    if (!s) return
    await this.payload.update({ collection: this.o.slug as never, id, data: { status: 'cancelled' } as never, overrideAccess: true })
    await this.rooms.deleteRoom(s.room).catch(() => undefined) // nobody there is fine
  }

  /** The session behind a `liveCall` block, created or refreshed from the block's fields. */
  async sessionFromBlock(req: PayloadRequest, src: { collection: string; id: Id; blockId: string }): Promise<{ session: SessionDoc; doc: Record<string, any>; block: Record<string, any> } | null> {
    if (!this.o.sourceCollections.includes(src.collection)) return null
    const doc = (await this.payload.findByID({ collection: src.collection as never, id: src.id, depth: 0, overrideAccess: true, req }).catch(() => null)) as Record<string, any> | null
    const block = doc ? findLiveCallBlock(doc[this.o.bodyField], src.blockId) : null
    if (!doc || !block || !block.startsAt) return null

    const startsAt = new Date(block.startsAt)
    const endsAt = new Date(startsAt.getTime() + (Number(block.durationMinutes) || 60) * 60_000)
    const room = `g-${src.collection}-${src.id}-${src.blockId}`
    const wanted = { title: String(block.title ?? 'Live'), startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), allowSpeak: (block.allowSpeak ?? 'raise-hand') as SessionDoc['allowSpeak'], capacity: block.capacity ? Number(block.capacity) : null, record: Boolean(block.record) }

    const found = await this.payload.find({ collection: this.o.slug as never, where: { room: { equals: room } }, limit: 1, depth: 0, overrideAccess: true, req })
    const existing = found.docs[0] as unknown as SessionDoc | undefined
    if (existing) {
      const changed = existing.title !== wanted.title || new Date(existing.startsAt).getTime() !== startsAt.getTime() || new Date(existing.endsAt).getTime() !== endsAt.getTime() || existing.allowSpeak !== wanted.allowSpeak || (existing.capacity ?? null) !== wanted.capacity || Boolean(existing.record) !== wanted.record
      if (!changed) return { session: existing, doc, block }
      const reschedule = new Date(existing.startsAt).getTime() !== startsAt.getTime() ? { status: 'scheduled', startedAt: null, endedAt: null } : {}
      const session = (await this.payload.update({ collection: this.o.slug as never, id: existing.id, data: { ...wanted, ...reschedule } as never, overrideAccess: true, req })) as unknown as SessionDoc
      return { session, doc, block }
    }
    const session = (await this.payload.create({
      collection: this.o.slug as never,
      overrideAccess: true,
      req,
      data: { ...wanted, kind: 'group', status: 'scheduled', room, sourceKind: 'block', sourceCollection: src.collection, sourceID: String(src.id), blockID: src.blockId } as never,
    })) as unknown as SessionDoc
    return { session, doc, block }
  }
}

const services = new WeakMap<Payload, LiveService>()

/** The live service of this Payload instance. Built on first use from the options the plugin stored in the config. */
export function getLive(payload: Payload): LiveService {
  let service = services.get(payload)
  if (!service) {
    const o = (payload.config.custom as { daugtLive?: { options?: ResolvedLive } } | undefined)?.daugtLive?.options
    if (!o) throw new Error('payload-live is not configured')
    service = new LiveService(payload, o)
    services.set(payload, service)
  }
  return service
}
