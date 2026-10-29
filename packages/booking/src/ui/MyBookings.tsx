import { DateTime } from 'luxon'
import type { Payload } from 'payload'
import { BOOKING_CUSTOM_KEY } from '../constants'
import type { ResolvedBookingOptions } from '../options'
import { CancelBookingButton } from './CancelBookingButton'
import { t, type Locale } from './i18n'

type Doc = Record<string, any>

/**
 * "Termine" in the member area: upcoming and past appointments, a Join link for confirmed online ones, Cancel inside the free window.
 * Server component: needs the Payload instance and the signed-in member. `joinHref` overrides where Join leads (default: the `live` bridge's
 * `joinHref`, else `/access/live/<session>`).
 */
export async function MyBookings({ payload, user, host = false, locale = 'de', joinHref, checkoutHref = '/checkout', shopHref = '/shop', className = '' }: { payload: Payload; user: { id: string | number }; /** Host view: every customer's appointments (for staff), with the customer's name and the host's Join link. */ host?: boolean; locale?: Locale; joinHref?: (sessionId: string) => string; checkoutHref?: string; shopHref?: string; className?: string }) {
  const L = t(locale)
  const o = (payload.config.custom as Record<string, { options?: ResolvedBookingOptions }> | undefined)?.[BOOKING_CUSTOM_KEY]?.options
  const tz = o?.timezone ?? 'Europe/Vienna'
  const slug = o?.bookingsSlug ?? 'bookings'
  const res = await payload.find({ collection: slug as never, where: { and: [...(host ? [] : [{ customer: { equals: user.id } }]), { status: { in: host ? ['confirmed', 'cancelled', 'completed', 'no_show'] : ['held', 'confirmed', 'cancelled', 'completed', 'no_show'] } }] } as never, sort: 'start', limit: 200, depth: 1, overrideAccess: true })
  const now = Date.now()
  const rows = (res.docs as Doc[]).filter((b) => !(b.status === 'held' && b.holdExpiresAt && new Date(b.holdExpiresAt).getTime() < now))
  const upcoming = rows.filter((b) => b.status !== 'cancelled' && new Date(b.end).getTime() >= now)
  const past = rows.filter((b) => !upcoming.includes(b)).reverse()
  // recordings of past online appointments, when the video plugin offers them
  const pastLive = rows.filter((b) => b.liveSession && !upcoming.includes(b)).map((b) => String(b.liveSession))
  const recs: Record<string, { egressId: string }[]> = o?.live?.recordings && pastLive.length ? await o.live.recordings(pastLive, { payload }).catch(() => ({})) : {}
  const join = (id: string) => joinHref?.(id) ?? o?.live?.joinHref?.(id) ?? `/access/live/${id}`
  const when = (iso: string) => DateTime.fromJSDate(new Date(iso), { zone: tz }).setLocale(locale).toFormat(locale === 'de' ? "cccc, d. LLLL yyyy · HH:mm 'Uhr'" : "cccc, d LLLL yyyy · HH:mm")

  const card = (b: Doc, isPast: boolean) => {
    const product = b.product && typeof b.product === 'object' ? (b.product as Doc) : null
    const free = (Number(product?.booking?.cancellationHours ?? 48)) * 3_600_000
    const cancellable = !isPast && b.status === 'confirmed' && (host || now <= new Date(b.start).getTime() - free)
    const who = host && b.customer && typeof b.customer === 'object' ? [b.customer.name, b.customer.email].filter(Boolean).join(' · ') : ''
    return (
      <li key={b.id} className="m-0 rounded-2xl border border-neutral-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="m-0 text-sm text-neutral-600">{when(b.start)}</p>
            <h3 className="m-0 mt-1 font-display text-2xl leading-tight text-primary-950">{String(b.title ?? product?.title ?? '').split(' · ')[0]}</h3>
            <p className="m-0 mt-1 text-sm text-neutral-600">{L.location[(b.location as 'online') ?? 'online']}</p>
            {who && <p className="m-0 mt-1 text-sm font-medium text-neutral-800">{who}</p>}
          </div>
          <span className={`rounded-full px-3 py-1 text-sm font-medium ${b.status === 'confirmed' ? 'bg-green-100 text-green-900' : b.status === 'held' ? 'bg-secondary-100 text-secondary-900' : 'bg-neutral-200 text-neutral-800'}`}>{L.status[b.status as keyof typeof L.status]}</span>
        </div>
        {b.needsAttention && <p className="m-0 mt-3 rounded-xl bg-primary-50 px-4 py-3 text-sm text-primary-900">{L.needsAttention}</p>}
        {b.status === 'cancelled' && b.refundNeeded && <p className="m-0 mt-3 text-sm text-neutral-700">{L.refund}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {!isPast && b.status === 'confirmed' && b.liveSession && <a href={join(String(b.liveSession))} className="inline-flex items-center rounded-full bg-primary-700 px-5 py-2.5 text-[0.95rem] font-semibold text-white no-underline hover:bg-primary-600">{L.join}</a>}
          {!isPast && b.status === 'held' && <a href={checkoutHref} className="inline-flex items-center rounded-full bg-primary-700 px-5 py-2.5 text-[0.95rem] font-semibold text-white no-underline hover:bg-primary-600">{L.toCheckout}</a>}
          {isPast && b.status === 'confirmed' && b.liveSession && (recs[String(b.liveSession)] ?? []).map((r) => (
            <a key={r.egressId} href={o?.live?.recordingHref?.(String(b.liveSession), r.egressId) ?? `/api/live/recording/${b.liveSession}/${r.egressId}`} className="inline-flex items-center rounded-full bg-primary-700 px-5 py-2.5 text-[0.95rem] font-semibold text-white no-underline hover:bg-primary-600">{L.watchRecording}</a>
          ))}
          {cancellable && <CancelBookingButton bookingID={b.id} locale={locale} />}
        </div>
      </li>
    )
  }

  return (
    <div className={className}>
      {rows.length === 0 ? (
        <p className="m-0 rounded-2xl border border-dashed border-neutral-300 p-8 text-neutral-600">{L.none} <a href={shopHref} className="font-semibold text-primary-700">{L.bookOne}</a></p>
      ) : (
        <>
          {upcoming.length > 0 && (<section aria-labelledby="bk-up"><h2 id="bk-up" className="m-0 mb-4 font-display text-2xl text-primary-950">{L.upcoming}</h2><ul className="m-0 flex list-none flex-col gap-4 p-0">{upcoming.map((b) => card(b, false))}</ul></section>)}
          {past.length > 0 && (<section aria-labelledby="bk-past" className={upcoming.length ? 'mt-10' : ''}><h2 id="bk-past" className="m-0 mb-4 font-display text-2xl text-primary-950">{L.past}</h2><ul className="m-0 flex list-none flex-col gap-4 p-0">{past.map((b) => card(b, true))}</ul></section>)}
        </>
      )}
    </div>
  )
}
