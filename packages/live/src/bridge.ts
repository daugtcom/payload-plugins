import type { Payload } from 'payload'
import { getLive } from './service'

type Id = string | number

/**
 * The bridge `payload-booking` expects in its `live` option: a confirmed online appointment becomes a direct call
 * (host + customer), a moved appointment moves the call, a cancelled one cancels it.
 * `joinHref` is where the site shows the call, e.g. `/live/<id>`.
 */
export const liveBookingBridge = (o: { joinHref?: (sessionId: Id) => string; /** Record every booked call (needs the `recording` option of the plugin). */ record?: boolean; /** Where a recording is watched, e.g. `/aufnahme/<session>/<recording>`. */ recordingHref?: (sessionId: Id, egressId: string) => string } = {}) => ({
  createSession: async (a: { title: string; startsAt: Date; endsAt: Date; hostUserIds: Id[]; participantUserIds: Id[]; record?: boolean; source: { kind: 'booking'; id: Id } }, ctx: { payload: Payload }) => {
    const s = await getLive(ctx.payload).createDirectSession({ title: a.title, startsAt: a.startsAt, endsAt: a.endsAt, hostUserIds: a.hostUserIds, participantUserIds: a.participantUserIds, source: a.source, record: a.record ?? o.record })
    return { id: s.id }
  },
  updateSession: (id: Id, t: { startsAt: Date; endsAt: Date }, ctx: { payload: Payload }) => getLive(ctx.payload).updateSession(id, t),
  cancelSession: (id: Id, ctx: { payload: Payload }) => getLive(ctx.payload).cancelSession(id),
  joinHref: o.joinHref,
  recordingHref: o.recordingHref,
  /** Finished recordings per session id, for the booking list ("Watch recording" on past appointments). */
  recordings: async (ids: Id[], ctx: { payload: Payload }) => {
    const live = getLive(ctx.payload)
    const out: Record<string, { egressId: string; durationSeconds?: number | null }[]> = {}
    for (const id of ids) {
      let s = await live.byId(id)
      if (!s) continue
      s = await live.syncRecordings(s).catch(() => s as NonNullable<typeof s>)
      const ready = (s.recordings ?? []).filter((r) => r.status === 'ready').map((r) => ({ egressId: r.egressId, durationSeconds: r.durationSeconds }))
      if (ready.length) out[String(id)] = ready
    }
    return out
  },
})
