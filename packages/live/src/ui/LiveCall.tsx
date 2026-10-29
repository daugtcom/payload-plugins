'use client'

import { CalendarPlus, Mic, Video } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { t, type Locale } from './i18n'
import type { JoinResult } from './Room'

const Room = lazy(() => import('./Room'))

export type LiveSource = { collection: string; id: string | number; blockId: string } | { sessionId: string | number }

export interface LiveCallProps {
  /** A `liveCall` block in a document, or a ready session (a booked 1:1 call). */
  source: LiveSource
  title: string
  description?: string | null
  /** ISO timestamps */
  startsAt: string
  endsAt: string
  /** Members may enter this many minutes before the start. Keep in step with the plugin option. Default 10. */
  opensMinutesBefore?: number
  /** The call is recorded: the lobby says so before anybody joins. */
  record?: boolean
  /** Staff and hosts can enter at any time. Only a hint for the button; the server decides. */
  isHost?: boolean
  locale?: Locale
  loginHref?: string
  className?: string
}

const pad = (n: number) => String(n).padStart(2, '0')
const icsDate = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => `\\${m}`)

function icsHref(p: { title: string; description?: string | null; startsAt: string; endsAt: string; url: string }) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//daugt//live//DE', 'BEGIN:VEVENT', `UID:${icsDate(new Date(p.startsAt))}-${encodeURIComponent(p.url)}@live`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(new Date(p.startsAt))}`, `DTEND:${icsDate(new Date(p.endsAt))}`, `SUMMARY:${icsText(p.title)}`, `DESCRIPTION:${icsText(`${p.description ? `${p.description}\n\n` : ''}${p.url}`)}`, `URL:${p.url}`, 'END:VEVENT', 'END:VCALENDAR']
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(lines.join('\r\n'))}`
}

function span(ms: number, L: ReturnType<typeof t>): string {
  const m = Math.max(0, Math.ceil(ms / 60_000))
  if (m < 1) return L.soon
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  const min = m % 60
  return d > 0 ? `${d} ${L.days} ${h} ${L.hours}` : h > 0 ? `${h} ${L.hours} ${min} ${L.minutes}` : `${min} ${L.minutes}`
}

/**
 * A live call in a page: the lobby (date, countdown, calendar file, device choice) and, after joining, the room.
 * The server decides who may join; this component only asks and shows the answer. Style it by passing `className` for the wrapper;
 * colours come from the site's `primary-*` / `neutral-*` tokens and `font-display`.
 */
export function LiveCall({ source, title, description, startsAt, endsAt, opensMinutesBefore = 10, record, isHost, locale = 'de', loginHref = '/login', className = '' }: LiveCallProps) {
  const L = t(locale)
  const [now, setNow] = useState<number | null>(null)
  const [phase, setPhase] = useState<'lobby' | 'joining' | 'live' | 'left'>('lobby')
  const [join, setJoin] = useState<JoinResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mic, setMic] = useState(true)
  const [cam, setCam] = useState(true)
  const [full, setFull] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 10_000)
    return () => window.clearInterval(id)
  }, [])

  // the room is tall: bring it fully into view once the member is in
  useEffect(() => { if (phase === 'live') box.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }, [phase])

  const start = new Date(startsAt).getTime()
  const end = new Date(endsAt).getTime()
  const opensAt = start - opensMinutesBefore * 60_000
  const open = now !== null && (isHost ? true : now >= opensAt)
  const over = now !== null && now > end + 30 * 60_000 && !isHost
  const live = now !== null && now >= start && now <= end
  const when = now === null ? '' : `${new Intl.DateTimeFormat('de-AT', { weekday: 'long', day: 'numeric', month: 'long' }).format(start)}, ${new Intl.DateTimeFormat('de-AT', { hour: '2-digit', minute: '2-digit' }).format(start)} – ${new Intl.DateTimeFormat('de-AT', { hour: '2-digit', minute: '2-digit' }).format(end)}`

  async function enter() {
    setPhase('joining')
    setError(null)
    const r = await api<JoinResult & { error?: string }>('/live/join', { body: 'sessionId' in source ? { sessionId: source.sessionId } : { source } })
    if (r.ok) {
      setJoin(r.data)
      setPhase('live')
      return
    }
    const e = (r.data as { error?: string }).error
    setError(r.status === 401 ? 'login' : e === 'forbidden' ? L.errForbidden : e === 'full' ? L.errFull : e === 'ended' || e === 'cancelled' ? L.errEnded : e === 'not-open' ? L.errNotOpen : L.errGeneric)
    setPhase('lobby')
  }

  if (phase === 'live' && join) {
    return (
      <div ref={box} className={`${full ? 'fixed inset-0 z-50 rounded-none p-3 sm:p-5' : 'h-[min(82vh,46rem)] rounded-[1.75rem] p-3 sm:p-5'} bg-primary-950 ${className}`}>
        <Suspense fallback={<div className="flex h-full items-center justify-center text-white/70">{L.connecting}</div>}>
          <Room join={join} mic={mic} cam={cam} locale={locale} fullscreen={full} onFullscreen={() => setFull((x) => !x)} onLeave={() => { setFull(false); setPhase('left') }} />
        </Suspense>
      </div>
    )
  }

  const status = over ? L.ended : live && open ? L.liveNow : open ? L.roomOpen : now === null ? '' : now < opensAt ? L.opensIn(span(opensAt - now, L)) : L.startsIn(span(start - now, L))
  return (
    <section className={`relative overflow-hidden rounded-[1.75rem] bg-primary-950 px-6 py-8 text-white sm:px-10 sm:py-10 ${className}`} aria-label={title}>
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-gradient-to-br from-primary-600/60 to-secondary-400/30 blur-3xl" />
      <div className="relative grid gap-8 lg:grid-cols-[1.4fr_1fr] lg:items-center">
        <div>
          <p className="m-0 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary-200">
            <span className={`h-2 w-2 rounded-full ${live && open ? 'animate-pulse bg-primary-400' : 'bg-primary-200/60'}`} aria-hidden />{L.live}
          </p>
          <h3 className="m-0 mt-3 text-balance font-display text-3xl leading-tight text-white [font-variation-settings:'SOFT'_100] sm:text-4xl">{title}</h3>
          {when && <p className="m-0 mt-3 text-base text-primary-100">{when}</p>}
          {description && <p className="m-0 mt-4 max-w-xl whitespace-pre-line leading-relaxed text-white/70">{description}</p>}
          {!over && now !== null && (
            <a href={icsHref({ title, description, startsAt, endsAt, url: typeof window === 'undefined' ? '' : window.location.href })} download={`${title.replace(/[^\w]+/g, '-')}.ics`} className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-primary-200 no-underline underline-offset-4 hover:text-white hover:underline">
              <CalendarPlus className="h-4 w-4" aria-hidden />{L.addToCalendar}
            </a>
          )}
        </div>

        <div className="rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
          <p className="m-0 font-display text-2xl text-white [font-variation-settings:'SOFT'_100]" aria-live="polite">{status || '\u00a0'}</p>
          {phase === 'left' && <p className="m-0 mt-2 text-sm text-white/70">{L.left}</p>}
          {!over && (
            <>
              <div className="mt-4 flex flex-wrap gap-2 text-sm">
                <label className={`inline-flex cursor-pointer select-none items-center gap-2 rounded-full px-3.5 py-2 ring-1 transition-colors ${mic ? 'bg-white text-primary-950 ring-white' : 'bg-transparent text-white/80 ring-white/25'}`}>
                  <input type="checkbox" checked={mic} onChange={(e) => setMic(e.target.checked)} className="sr-only" /><Mic className="h-4 w-4" aria-hidden />{L.joinMic}
                </label>
                <label className={`inline-flex cursor-pointer select-none items-center gap-2 rounded-full px-3.5 py-2 ring-1 transition-colors ${cam ? 'bg-white text-primary-950 ring-white' : 'bg-transparent text-white/80 ring-white/25'}`}>
                  <input type="checkbox" checked={cam} onChange={(e) => setCam(e.target.checked)} className="sr-only" /><Video className="h-4 w-4" aria-hidden />{L.joinCam}
                </label>
              </div>
              {record && <p className="m-0 mt-4 flex items-start gap-2 text-sm text-primary-100"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-red-500" aria-hidden />{L.recordingNotice}</p>}
              <button type="button" onClick={enter} disabled={!open || phase === 'joining'} className="mt-5 inline-flex w-full items-center justify-center rounded-full bg-primary-500 px-6 py-3 text-base font-semibold text-white transition-colors duration-300 hover:bg-primary-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-primary-950 disabled:cursor-not-allowed disabled:opacity-40">
                {phase === 'joining' ? L.joining : phase === 'left' ? L.rejoin : L.join}
              </button>
            </>
          )}
          {error === 'login' ? (
            <p role="alert" className="m-0 mt-3 text-sm text-primary-100">{L.errLogin} <a href={loginHref} className="font-semibold text-white underline underline-offset-4">{L.login}</a></p>
          ) : error ? (
            <p role="alert" className="m-0 mt-3 text-sm text-primary-100">{error}</p>
          ) : null}
        </div>
      </div>
    </section>
  )
}
