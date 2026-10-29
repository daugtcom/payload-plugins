import { PlyrPlayer } from '@daugtcom/payload-media'
import { createLocalReq, type Payload } from 'payload'
import { DEFAULT_SLUG, type ResolvedLive } from '../options'
import { getLive, type RecordingDoc, type SessionDoc } from '../service'
import { t, type Locale } from './i18n'

type User = { id: string | number; email?: string; roles?: string[] }

/** The recordings this person may see, newest first: [session, finished recording] pairs. Group calls follow the site's `authorizeGroup` rule. */
export async function listRecordings(payload: Payload, user: User): Promise<{ session: SessionDoc; recording: RecordingDoc }[]> {
  const live = getLive(payload)
  const o = (payload.config.custom as { daugtLive?: { options?: ResolvedLive } }).daugtLive?.options
  const req = await createLocalReq({ user: { ...user, collection: o?.usersSlug ?? 'users' } as never }, payload)
  const found = await payload.find({ collection: (o?.slug ?? DEFAULT_SLUG) as never, where: { 'recordings.status': { in: ['ready', 'processing', 'recording', 'starting'] } } as never, sort: '-startsAt', limit: 200, depth: 0, overrideAccess: true })
  const out: { session: SessionDoc; recording: RecordingDoc }[] = []
  for (let s of found.docs as unknown as SessionDoc[]) {
    if (!(await live.mayAccess(req, user, s))) continue
    s = await live.syncRecordings(s).catch(() => s) // unfinished ones: ask Egress (no webhook needed)
    for (const r of s.recordings ?? []) if (r.status !== 'failed') out.push({ session: s, recording: r })
  }
  return out.sort((a, b) => new Date(b.recording.startedAt ?? b.session.startsAt).getTime() - new Date(a.recording.startedAt ?? a.session.startsAt).getTime())
}

const fmt = (iso: string | null | undefined, locale: Locale) => (iso ? new Intl.DateTimeFormat(locale === 'de' ? 'de-AT' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '')

/**
 * "Aufnahmen" in the member area: every finished recording of the calls this member could join. Server component.
 * `watchHref` is where "Ansehen" leads (a page with `<RecordingPlayer>`); default: the video itself.
 */
export async function LiveRecordings({ payload, user, locale = 'de', watchHref, className = '' }: { payload: Payload; user: User; locale?: Locale; watchHref?: (sessionId: string | number, egressId: string) => string; className?: string }) {
  const L = t(locale)
  const items = await listRecordings(payload, user)
  if (items.length === 0) return <p className={`m-0 rounded-2xl border border-dashed border-neutral-300 p-8 text-neutral-600 ${className}`}>{L.noRecordings}</p>
  return (
    <ul className={`m-0 flex list-none flex-col gap-4 p-0 ${className}`}>
      {items.map(({ session, recording: r }) => (
        <li key={`${session.id}-${r.egressId}`} className="m-0 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-neutral-200 bg-white p-5">
          <div className="min-w-0">
            <p className="m-0 text-sm text-neutral-600">{fmt(r.startedAt ?? session.startsAt, locale)}{r.durationSeconds ? ` · ${Math.max(1, Math.round(r.durationSeconds / 60))} ${L.minutesShort}` : ''}</p>
            <h3 className="m-0 mt-1 font-display text-2xl leading-tight text-primary-950">{session.title}</h3>
          </div>
          {r.status === 'ready' ? (
            <div className="flex flex-wrap gap-2">
              <a href={watchHref?.(session.id, r.egressId) ?? `/api/live/recording/${session.id}/${r.egressId}`} className="inline-flex items-center rounded-full bg-primary-700 px-5 py-2.5 text-[0.95rem] font-semibold text-white no-underline hover:bg-primary-600">{L.watch}</a>
              <a href={`/api/live/recording/${session.id}/${r.egressId}?download=1`} className="inline-flex items-center rounded-full border border-neutral-300 px-5 py-2.5 text-[0.95rem] font-medium text-neutral-800 no-underline hover:bg-neutral-100">{L.download}</a>
            </div>
          ) : (
            <span className="rounded-full bg-secondary-100 px-3 py-1 text-sm font-medium text-secondary-900">{r.status === 'processing' ? L.processing : L.recordingRunning}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

/** The player for one recording: Plyr on the plugin's signed-link endpoint. Check access on the page first with `canWatchRecording`. */
export function RecordingPlayer({ sessionId, egressId, className = '' }: { sessionId: string | number; egressId: string; className?: string }) {
  return <PlyrPlayer kind="video" src={`/api/live/recording/${encodeURIComponent(sessionId)}/${encodeURIComponent(egressId)}`} className={`w-full rounded-2xl bg-black ${className}`} />
}

/** The session and recording behind a player page, or null when this person may not watch it (or it does not exist). */
export async function canWatchRecording(payload: Payload, user: User, sessionId: string | number, egressId: string): Promise<{ session: SessionDoc; recording: RecordingDoc } | null> {
  const live = getLive(payload)
  const o = (payload.config.custom as { daugtLive?: { options?: ResolvedLive } }).daugtLive?.options
  const session = await live.byId(sessionId)
  if (!session) return null
  const req = await createLocalReq({ user: { ...user, collection: o?.usersSlug ?? 'users' } as never }, payload)
  if (!(await live.mayAccess(req, user, session))) return null
  const synced = await live.syncRecordings(session).catch(() => session)
  const recording = (synced.recordings ?? []).find((r) => r.egressId === egressId && r.status === 'ready')
  return recording ? { session: synced, recording } : null
}

/**
 * The finished recordings of ONE call, as a small box: "Watch" (and download) per recording. Put it under the call block in a post
 * (`source` = the post and the block's id), so past calls show their recording where the call was. Renders nothing when there is none
 * or the person may not see it. Server component.
 */
export async function BlockRecordings({ payload, user, source, locale = 'de', watchHref, className = '' }: { payload: Payload; user: User; source: { collection: string; id: string | number; blockId: string }; locale?: Locale; watchHref?: (sessionId: string | number, egressId: string) => string; className?: string }) {
  const L = t(locale)
  const o = (payload.config.custom as { daugtLive?: { options?: ResolvedLive } }).daugtLive?.options
  const found = await payload.find({ collection: (o?.slug ?? DEFAULT_SLUG) as never, where: { and: [{ sourceCollection: { equals: source.collection } }, { sourceID: { equals: String(source.id) } }, { blockID: { equals: source.blockId } }] } as never, limit: 1, depth: 0, overrideAccess: true })
  let session = found.docs[0] as unknown as SessionDoc | undefined
  if (!session) return null
  const live = getLive(payload)
  const req = await createLocalReq({ user: { ...user, collection: o?.usersSlug ?? 'users' } as never }, payload)
  if (!(await live.mayAccess(req, user, session))) return null
  session = await live.syncRecordings(session).catch(() => session as SessionDoc)
  const ready = (session.recordings ?? []).filter((r) => r.status === 'ready')
  if (ready.length === 0) return null
  return (
    <div className={`rounded-2xl border border-neutral-200 bg-white p-5 ${className}`}>
      <p className="m-0 text-sm font-semibold uppercase tracking-[0.14em] text-primary-700">{L.recording}</p>
      <ul className="m-0 mt-3 flex list-none flex-col gap-3 p-0">
        {ready.map((r) => (
          <li key={r.egressId} className="m-0 flex flex-wrap items-center justify-between gap-3">
            <span className="text-neutral-700">{fmt(r.startedAt ?? session!.startsAt, locale)}{r.durationSeconds ? ` · ${Math.max(1, Math.round(r.durationSeconds / 60))} ${L.minutesShort}` : ''}</span>
            <span className="flex flex-wrap gap-2">
              <a href={watchHref?.(session!.id, r.egressId) ?? `/api/live/recording/${session!.id}/${r.egressId}`} className="inline-flex items-center rounded-full bg-primary-700 px-5 py-2 text-[0.95rem] font-semibold text-white no-underline hover:bg-primary-600">{L.watch}</a>
              <a href={`/api/live/recording/${session!.id}/${r.egressId}?download=1`} className="inline-flex items-center rounded-full border border-neutral-300 px-5 py-2 text-[0.95rem] font-medium text-neutral-800 no-underline hover:bg-neutral-100">{L.download}</a>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
