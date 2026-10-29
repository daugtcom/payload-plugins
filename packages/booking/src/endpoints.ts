import type { Endpoint, PayloadRequest } from 'payload'
import { DateTime } from 'luxon'
import { availableSlots, cancelBooking, holdSlot, loadBookable, releaseHold, rescheduleBooking } from './engine'
import { BookingError, priceOf } from './info'
import type { Id, ResolvedBookingOptions } from './options'

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
const body = async (req: PayloadRequest): Promise<Record<string, any>> => ((await req.json?.().catch(() => ({}))) ?? {}) as Record<string, any>
const idish = (v: unknown): Id | undefined => (typeof v === 'string' && v ? v : typeof v === 'number' ? v : undefined)

export function bookingEndpoints(o: ResolvedBookingOptions): Endpoint[] {
  const userOf = (req: PayloadRequest) => (req.user && (req.user as { collection?: string }).collection === o.usersSlug ? (req.user as unknown as { id: Id }) : null)
  const guarded = (handler: (req: PayloadRequest) => Promise<Response>): Endpoint['handler'] => async (req) => {
    try {
      return await handler(req)
    } catch (err) {
      if (err instanceof BookingError) return json(err.status, { error: err.code, message: err.message })
      req.payload.logger.error({ err, msg: 'payload-booking endpoint failed' })
      return json(500, { error: 'failed' })
    }
  }
  const date = (v: unknown): Date | null => {
    const d = new Date(String(v))
    return typeof v === 'string' && !Number.isNaN(d.getTime()) ? d : null
  }

  return [
    // free start times, computed on the server
    {
      path: '/booking/slots',
      method: 'get',
      handler: guarded(async (req) => {
        const q = new URL(req.url!).searchParams
        const id = idish(q.get('product'))
        const b = id != null ? await loadBookable(req.payload, o, id) : null
        if (!b) return json(404, { error: 'not-bookable' })
        const { durationMinutes, priceCents } = priceOf(b, (q.get('options') ?? '').split(',').filter(Boolean))
        const from = date(q.get('from')) ?? new Date()
        const to = new Date(Math.min((date(q.get('to')) ?? new Date(from.getTime() + 14 * 86_400_000)).getTime(), from.getTime() + 62 * 86_400_000))
        const slots = await availableSlots(req.payload, o, b, { from, to, durationMinutes })
        return json(200, { timezone: o.timezone, durationMinutes, priceCents, slots: slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })) })
      }),
    },
    // reserve a slot and put it into the cart
    {
      path: '/booking/hold',
      method: 'post',
      handler: guarded(async (req) => {
        const user = userOf(req)
        if (!user) return json(401, { error: 'login-required' })
        const b = await body(req)
        const start = date(b.start)
        const product = idish(b.product)
        if (!start || product == null) return json(400, { error: 'invalid-request' })
        const options = Array.isArray(b.options) ? b.options.map(String) : []
        return json(200, await holdSlot(req.payload, o, user, { product, start, options }))
      }),
    },
    {
      path: '/booking/release',
      method: 'post',
      handler: guarded(async (req) => {
        const user = userOf(req)
        if (!user) return json(401, { error: 'login-required' })
        const id = idish((await body(req)).bookingID)
        if (id == null) return json(400, { error: 'invalid-request' })
        await releaseHold(req.payload, o, user, id)
        return json(200, { released: true })
      }),
    },
    {
      path: '/booking/cancel',
      method: 'post',
      handler: guarded(async (req) => {
        const user = userOf(req)
        const b = await body(req)
        const bookingID = idish(b.bookingID)
        const cancelToken = typeof b.cancelToken === 'string' ? b.cancelToken : undefined
        if (bookingID == null && !cancelToken) return json(400, { error: 'invalid-request' })
        if (bookingID != null && !user) return json(401, { error: 'login-required' })
        const done = await cancelBooking(req.payload, o, { bookingID, cancelToken }, user, Boolean(req.user && o.isStaff(req.user)))
        return json(200, { status: done.status, refundNeeded: Boolean(done.refundNeeded) })
      }),
    },
    {
      path: '/booking/reschedule',
      method: 'post',
      handler: guarded(async (req) => {
        const user = userOf(req)
        const b = await body(req)
        const start = date(b.start)
        const bookingID = idish(b.bookingID)
        const cancelToken = typeof b.cancelToken === 'string' ? b.cancelToken : undefined
        if (!start || (bookingID == null && !cancelToken)) return json(400, { error: 'invalid-request' })
        if (bookingID != null && !user) return json(401, { error: 'login-required' })
        const done = await rescheduleBooking(req.payload, o, { bookingID, cancelToken, start }, user, Boolean(req.user && o.isStaff(req.user)))
        return json(200, { start: done.start, end: done.end })
      }),
    },
    // the member's own appointments
    {
      path: '/booking/mine',
      method: 'get',
      handler: guarded(async (req) => {
        const user = userOf(req)
        if (!user) return json(401, { error: 'login-required' })
        const res = await req.payload.find({ collection: o.bookingsSlug as never, where: { and: [{ customer: { equals: user.id } }, { status: { in: ['held', 'confirmed', 'cancelled', 'completed', 'no_show'] } }] } as never, sort: 'start', limit: 200, depth: 0, overrideAccess: true, select: { title: true, start: true, end: true, status: true, location: true, liveSession: true, product: true } as never })
        return json(200, { timezone: o.timezone, now: DateTime.now().toISO(), bookings: res.docs })
      }),
    },
  ]
}
