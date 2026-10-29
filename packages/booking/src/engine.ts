import { randomBytes } from 'node:crypto'
import { DateTime } from 'luxon'
import type { Payload, PayloadRequest } from 'payload'
import { isOverlapError } from './constraint'
import { mailCancelled, mailConfirmed, mailHost, mailReminder, fmtWhen } from './email'
import { type Bookable, bookableOf, BookingError, priceOf } from './info'
import { loadBusy } from './ics'
import type { Id, ResolvedBookingOptions } from './options'
import { blockOf, computeSlots, type Interval, type Slot } from './slots'

type Doc = Record<string, any> & { id: Id }
const idOf = (v: unknown): Id => (v && typeof v === 'object' ? (v as { id: Id }).id : (v as Id))
const HOLDING = ['held', 'confirmed']

export async function loadBookable(payload: Payload, o: ResolvedBookingOptions, id: Id, req?: PayloadRequest): Promise<Bookable | null> {
  const doc = (await payload.findByID({ collection: o.productsSlug as never, id, depth: 0, overrideAccess: true, req }).catch(() => null)) as Doc | null
  return bookableOf(doc)
}

/** Holds that ran out stop blocking their slot. Lazy: runs whenever someone looks at or takes slots. */
export async function expireHolds(payload: Payload, o: ResolvedBookingOptions, now = new Date()): Promise<void> {
  await payload.update({
    collection: o.bookingsSlug as never,
    where: { and: [{ status: { equals: 'held' } }, { holdExpiresAt: { less_than: now.toISOString() } }] } as never,
    data: { status: 'expired' } as never,
    overrideAccess: true,
  })
}

async function occupied(payload: Payload, o: ResolvedBookingOptions, resource: string, from: Date, to: Date, exceptId?: Id): Promise<Interval[]> {
  const res = await payload.find({
    collection: o.bookingsSlug as never,
    where: { and: [{ resource: { equals: resource } }, { status: { in: HOLDING } }, { blockEnd: { greater_than: from.toISOString() } }, { blockStart: { less_than: to.toISOString() } }, ...(exceptId != null ? [{ id: { not_equals: exceptId } }] : [])] } as never,
    limit: 0,
    pagination: false,
    depth: 0,
    overrideAccess: true,
    select: { blockStart: true, blockEnd: true } as never,
  })
  return (res.docs as Doc[]).map((b) => ({ start: new Date(b.blockStart), end: new Date(b.blockEnd) }))
}

export interface SlotQuery { from: Date; to: Date; durationMinutes?: number; exceptBookingId?: Id; now?: Date }

type Calendar = { url: string; name?: string; mode: 'busy' | 'available' }
/** Calendars from the code config (always "busy") plus those staff added in the settings global. `webcal://` is `https://`. */
async function calendarsOf(payload: Payload, o: ResolvedBookingOptions): Promise<Calendar[]> {
  const settings = (await payload.findGlobal({ slug: o.settingsSlug as never, depth: 0, overrideAccess: true }).catch(() => null)) as Doc | null
  const added = ((settings?.calendars ?? []) as Doc[]).filter((c) => typeof c.url === 'string' && c.url.trim()).map((c): Calendar => ({ url: String(c.url).trim().replace(/^webcal:/i, 'https:'), name: c.name, mode: c.mode === 'available' ? 'available' : 'busy' }))
  return [...o.busyCalendars.map((c): Calendar => ({ ...c, mode: 'busy' })), ...added]
}

/** Free start times of a product in [from, to): opening hours, minus calendar events and other bookings. */
export async function availableSlots(payload: Payload, o: ResolvedBookingOptions, b: Bookable, q: SlotQuery): Promise<Slot[]> {
  const now = q.now ?? new Date()
  await expireHolds(payload, o, now)
  const pad = 2 * 86_400_000 // blocks and events that start before `from` can still reach into it
  const calendars = await calendarsOf(payload, o)
  const range = [new Date(q.from.getTime() - pad), new Date(q.to.getTime() + pad)] as const
  const read = { timezone: o.timezone, cacheSeconds: o.busyCacheSeconds, warn: (m: string) => payload.logger.warn(`payload-booking: ${m}`) }
  const [busy, available, bookings] = await Promise.all([
    loadBusy(calendars.filter((c) => c.mode === 'busy'), ...range, read),
    // an "available" calendar turns the logic around: its events are the open times. Without one, the weekly hours decide.
    calendars.some((c) => c.mode === 'available') ? loadBusy(calendars.filter((c) => c.mode === 'available'), ...range, { ...read, includeFree: true }) : Promise.resolve(undefined),
    occupied(payload, o, b.resource, new Date(q.from.getTime() - pad), new Date(q.to.getTime() + pad), q.exceptBookingId),
  ])
  return computeSlots({
    rules: b.rules, exceptions: b.exceptions, durationMinutes: q.durationMinutes ?? b.durationMinutes, bufferBeforeMinutes: b.bufferBeforeMinutes, bufferAfterMinutes: b.bufferAfterMinutes,
    minNoticeHours: b.minNoticeHours, maxAdvanceDays: b.maxAdvanceDays, timezone: o.timezone, now, busy, available, bookings, from: q.from, to: q.to, stepMinutes: b.stepMinutes,
  })
}

async function assertSlot(payload: Payload, o: ResolvedBookingOptions, b: Bookable, start: Date, durationMinutes: number, exceptBookingId?: Id): Promise<void> {
  const free = await availableSlots(payload, o, b, { from: start, to: new Date(start.getTime() + 60_000), durationMinutes, exceptBookingId })
  if (!free.some((s) => s.start.getTime() === start.getTime())) throw new BookingError('slot-unavailable', 409)
}

// ------------------------------------------------------------------ carts

async function openCart(payload: Payload, userId: Id, create: boolean): Promise<Doc | null> {
  const found = await payload.find({ collection: 'carts' as never, where: { and: [{ customer: { equals: userId } }, { purchasedAt: { exists: false } }] } as never, sort: '-createdAt', limit: 1, depth: 0, overrideAccess: true })
  if (found.docs[0]) return found.docs[0] as unknown as Doc
  return create ? ((await payload.create({ collection: 'carts' as never, data: { customer: userId, currency: 'EUR', items: [] } as never, overrideAccess: true })) as unknown as Doc) : null
}

type CartLine = { id?: string; product: unknown; quantity: number; variant?: unknown; meta?: { bookingID?: string } & Record<string, unknown> | null }
const plain = (l: CartLine) => ({ product: idOf(l.product), quantity: l.quantity, ...(l.variant ? { variant: idOf(l.variant) } : {}), ...(l.meta ? { meta: l.meta } : {}) })

async function setLines(payload: Payload, cart: Doc, change: (lines: CartLine[]) => CartLine[]): Promise<void> {
  const next = change((cart.items ?? []) as CartLine[]).map(plain)
  await payload.update({ collection: 'carts' as never, id: cart.id, data: { items: next } as never, overrideAccess: true })
}

async function removeLine(payload: Payload, userId: Id | undefined, cartId: Id | undefined, bookingId: Id): Promise<void> {
  const cart = cartId != null ? ((await payload.findByID({ collection: 'carts' as never, id: cartId, depth: 0, overrideAccess: true }).catch(() => null)) as Doc | null) : userId != null ? await openCart(payload, userId, false) : null
  if (!cart || cart.purchasedAt) return
  if (!((cart.items ?? []) as CartLine[]).some((l) => String(l.meta?.bookingID) === String(bookingId))) return
  await setLines(payload, cart, (lines) => lines.filter((l) => String(l.meta?.bookingID) !== String(bookingId)))
}

// ------------------------------------------------------------------ hold

export interface HoldResult { bookingID: Id; cartID: Id; priceCents: number; holdExpiresAt: string; start: string; end: string }

/**
 * Reserves a slot for a buyer and puts it into their cart. The slot is checked again here (the picker may be stale), the price is
 * computed from the product and the chosen options, never taken from the client, and the database refuses an overlap even under a race.
 */
export async function holdSlot(payload: Payload, o: ResolvedBookingOptions, user: { id: Id }, input: { product: Id; start: Date; options?: string[] }): Promise<HoldResult> {
  const b = await loadBookable(payload, o, input.product)
  if (!b) throw new BookingError('not-bookable', 404)
  const { durationMinutes, priceCents, chosen } = priceOf(b, input.options ?? [])
  const now = new Date()
  await expireHolds(payload, o, now)

  // someone could otherwise park the whole calendar behind unpaid carts
  const mine = await payload.find({ collection: o.bookingsSlug as never, where: { and: [{ customer: { equals: user.id } }, { status: { equals: 'held' } }] } as never, depth: 0, limit: 0, pagination: false, overrideAccess: true })
  const sameProduct = (mine.docs as Doc[]).filter((h) => String(idOf(h.product)) === String(b.id))
  if (mine.docs.length - sameProduct.length >= 3) throw new BookingError('too-many-holds', 429)
  // choosing another time for the same service replaces the earlier choice
  for (const h of sameProduct) await dropHold(payload, o, h, user.id)

  await assertSlot(payload, o, b, input.start, durationMinutes)
  const end = new Date(input.start.getTime() + durationMinutes * 60_000)
  const block = blockOf(input.start, durationMinutes, b.bufferBeforeMinutes, b.bufferAfterMinutes)
  const holdExpiresAt = new Date(now.getTime() + o.holdMinutes * 60_000)
  const cart = (await openCart(payload, user.id, true))!

  let booking: Doc
  try {
    booking = (await payload.create({
      collection: o.bookingsSlug as never,
      data: {
        title: `${b.title} · ${fmtWhen(input.start, o.timezone)}`, product: b.id, customer: user.id, start: input.start.toISOString(), end: end.toISOString(),
        blockStart: block.start.toISOString(), blockEnd: block.end.toISOString(), resource: b.resource, status: 'held', holdExpiresAt: holdExpiresAt.toISOString(),
        location: b.location, priceCents, options: chosen.map((c) => c.id), cart: cart.id, cancelToken: randomBytes(18).toString('base64url'),
      } as never,
      overrideAccess: true,
    })) as unknown as Doc
  } catch (err) {
    if (isOverlapError(err)) throw new BookingError('slot-taken', 409)
    throw err
  }
  await setLines(payload, cart, (lines) => [...lines, { product: b.id, quantity: 1, meta: { bookingID: String(booking.id) } }])
  return { bookingID: booking.id, cartID: cart.id, priceCents, holdExpiresAt: holdExpiresAt.toISOString(), start: input.start.toISOString(), end: end.toISOString() }
}

async function dropHold(payload: Payload, o: ResolvedBookingOptions, h: Doc, userId?: Id): Promise<void> {
  await payload.update({ collection: o.bookingsSlug as never, id: h.id, data: { status: 'expired', holdExpiresAt: new Date().toISOString() } as never, overrideAccess: true })
  await removeLine(payload, userId, h.cart ? idOf(h.cart) : undefined, h.id)
}

/** The buyer changed their mind (or left checkout). Only unpaid holds. */
export async function releaseHold(payload: Payload, o: ResolvedBookingOptions, user: { id: Id }, bookingId: Id): Promise<void> {
  const h = (await payload.findByID({ collection: o.bookingsSlug as never, id: bookingId, depth: 0, overrideAccess: true }).catch(() => null)) as Doc | null
  if (!h || String(idOf(h.customer)) !== String(user.id)) throw new BookingError('not-found', 404)
  if (h.status !== 'held') throw new BookingError('not-held', 409)
  await dropHold(payload, o, h, user.id)
}

/**
 * Called when checkout starts for a cart line with a booking: the slot must still be the buyer's. A hold that ran out is taken again if
 * nobody else got the slot meanwhile, and runs for another `holdMinutes` from now (covering the Stripe session).
 */
export async function ensureHeld(payload: Payload, o: ResolvedBookingOptions, bookingId: Id, req?: PayloadRequest): Promise<Doc> {
  const b = (await payload.findByID({ collection: o.bookingsSlug as never, id: bookingId, depth: 0, overrideAccess: true, req }).catch(() => null)) as Doc | null
  if (!b) throw new BookingError('not-found', 404, 'Der Termin existiert nicht mehr.')
  if (b.status === 'confirmed') throw new BookingError('already-booked', 409, 'Dieser Termin ist schon gebucht.')
  if (b.status !== 'held' && b.status !== 'expired') throw new BookingError('not-available', 409, 'Dieser Termin ist nicht mehr verfügbar.')
  const until = new Date(Date.now() + o.holdMinutes * 60_000).toISOString()
  try {
    return (await payload.update({ collection: o.bookingsSlug as never, id: b.id, data: { status: 'held', holdExpiresAt: until } as never, overrideAccess: true, req })) as unknown as Doc
  } catch (err) {
    if (isOverlapError(err)) throw new BookingError('slot-taken', 409, 'Dieser Termin wurde inzwischen vergeben.')
    throw err
  }
}

// ------------------------------------------------------------------ paid: confirm

async function hosts(payload: Payload, o: ResolvedBookingOptions): Promise<{ ids: Id[]; emails: string[] }> {
  let ids: Id[] = []
  if (o.hostUserIds) ids = await o.hostUserIds(payload)
  else ids = ((await payload.find({ collection: o.usersSlug as never, where: { roles: { contains: 'admin' } } as never, limit: 20, depth: 0, overrideAccess: true }).catch(() => ({ docs: [] }))).docs as Doc[]).map((u) => u.id)
  const users = await Promise.all(ids.map((id) => payload.findByID({ collection: o.usersSlug as never, id, depth: 0, overrideAccess: true }).catch(() => null) as Promise<Doc | null>))
  return { ids, emails: users.flatMap((u) => (u?.email ? [String(u.email)] : [])) }
}

const baseUrl = (payload: Payload, o: ResolvedBookingOptions) => o.serverURL ?? payload.config.serverURL ?? undefined

/**
 * The order is paid: every booking in the buyer's cart becomes real. Idempotent (orders are saved more than once).
 * A hold that ran out is honoured if the slot is still free; if somebody took it meanwhile the booking is flagged for a human
 * (`needsAttention`) and the host is told, because the buyer has already paid.
 */
export async function confirmForOrder(req: PayloadRequest, o: ResolvedBookingOptions, order: Doc): Promise<void> {
  const payload = req.payload
  if (order.paymentStatus !== 'paid') return
  const txIds = ((order.transactions ?? []) as unknown[]).map(idOf)
  if (!txIds.length) return
  const txs = (await payload.find({ collection: 'transactions' as never, where: { id: { in: txIds } } as never, depth: 0, limit: 0, pagination: false, overrideAccess: true, req })).docs as Doc[]
  const cartIds = txs.map((t) => t.cart).filter(Boolean).map(idOf)
  if (!cartIds.length) return
  // only the bookings that are lines of the paid cart: holds the buyer dropped or let run out earlier stay as they are
  const carts = (await payload.find({ collection: 'carts' as never, where: { id: { in: cartIds } } as never, depth: 0, limit: 0, pagination: false, overrideAccess: true, req })).docs as Doc[]
  const bookingIds = carts.flatMap((c) => ((c.items ?? []) as CartLine[]).map((l) => l.meta?.bookingID).filter((x): x is string => Boolean(x)))
  if (!bookingIds.length) return
  const found = await payload.find({ collection: o.bookingsSlug as never, where: { and: [{ id: { in: bookingIds } }, { status: { in: ['held', 'expired'] } }] } as never, depth: 0, limit: 0, pagination: false, overrideAccess: true, req })

  for (const b of found.docs as Doc[]) {
    let ok = true
    if (b.status === 'expired') {
      // the hold ran out before the payment arrived: is the slot still free?
      const clash = await occupied(payload, o, b.resource, new Date(b.blockStart), new Date(b.blockEnd), b.id)
      ok = clash.length === 0
    }
    if (!ok) {
      await payload.update({ collection: o.bookingsSlug as never, id: b.id, data: { needsAttention: true, order: order.id } as never, overrideAccess: true, req })
      const h = await hosts(payload, o)
      const customer = (await payload.findByID({ collection: o.usersSlug as never, id: idOf(b.customer), depth: 0, overrideAccess: true, req }).catch(() => null)) as Doc | null
      await mailHost(payload, o, h.emails, `Bezahlt, aber Termin vergeben: ${b.title}`, b, { email: customer?.email, name: customer?.name }, 'Die Zahlung ist eingegangen, der Termin war aber inzwischen anderweitig belegt. Bitte melde dich bei der Kundin und erstatte oder verschiebe.', baseUrl(payload, o))
      continue
    }
    const confirmed = (await payload.update({ collection: o.bookingsSlug as never, id: b.id, data: { status: 'confirmed', holdExpiresAt: null, order: order.id, needsAttention: false } as never, overrideAccess: true, req })) as unknown as Doc
    const customer = (await payload.findByID({ collection: o.usersSlug as never, id: idOf(confirmed.customer), depth: 0, overrideAccess: true, req }).catch(() => null)) as Doc | null
    const h = await hosts(payload, o)

    let liveSession = confirmed.liveSession as string | null | undefined
    const chosen = new Set(((confirmed.options ?? []) as string[]).map(String))
    const record = ((await loadBookable(payload, o, idOf(confirmed.product), req).catch(() => null))?.options ?? []).some((x) => x.recording && chosen.has(x.id))
    if (confirmed.location === 'online' && o.live && !liveSession) {
      try {
        const s = await o.live.createSession({ title: String(confirmed.title), startsAt: new Date(confirmed.start), endsAt: new Date(confirmed.end), hostUserIds: h.ids, participantUserIds: [idOf(confirmed.customer)], ...(record ? { record: true } : {}), source: { kind: 'booking', id: confirmed.id } }, { payload })
        liveSession = String(s.id)
        await payload.update({ collection: o.bookingsSlug as never, id: confirmed.id, data: { liveSession } as never, overrideAccess: true, req })
      } catch (err) {
        payload.logger.error({ err, msg: 'payload-booking: the video session could not be created' })
        await payload.update({ collection: o.bookingsSlug as never, id: confirmed.id, data: { needsAttention: true } as never, overrideAccess: true, req })
      }
    }
    const base = baseUrl(payload, o)
    const product = (await payload.findByID({ collection: o.productsSlug as never, id: idOf(confirmed.product), depth: 0, overrideAccess: true, req }).catch(() => null)) as Doc | null
    const mail = { ...confirmed, liveSession, cancellationHours: product?.booking?.cancellationHours, recording: record }
    await mailConfirmed(payload, o, mail, { email: customer?.email, name: customer?.name }, base)
    await mailHost(payload, o, h.emails, `Neue Buchung: ${confirmed.title}`, mail, { email: customer?.email, name: customer?.name }, '', baseUrl(payload, o))
  }
}

// ------------------------------------------------------------------ cancel / reschedule

async function loadOwned(payload: Payload, o: ResolvedBookingOptions, input: { bookingID?: Id; cancelToken?: string }, user: { id: Id } | null, staff: boolean): Promise<Doc> {
  let b: Doc | null = null
  if (input.bookingID != null) b = (await payload.findByID({ collection: o.bookingsSlug as never, id: input.bookingID, depth: 0, overrideAccess: true, showHiddenFields: true }).catch(() => null)) as Doc | null
  else if (input.cancelToken) b = ((await payload.find({ collection: o.bookingsSlug as never, where: { cancelToken: { equals: input.cancelToken } } as never, limit: 1, depth: 0, overrideAccess: true, showHiddenFields: true })).docs[0] as Doc | undefined) ?? null
  if (!b) throw new BookingError('not-found', 404)
  const viaToken = Boolean(input.cancelToken) && input.bookingID == null
  if (!viaToken && !staff && (!user || String(idOf(b.customer)) !== String(user.id))) throw new BookingError('not-found', 404)
  return b
}

const withinFreeWindow = async (payload: Payload, o: ResolvedBookingOptions, b: Doc): Promise<boolean> => {
  const p = await loadBookable(payload, o, idOf(b.product))
  const hours = p?.cancellationHours ?? 48
  return Date.now() <= new Date(b.start).getTime() - hours * 3_600_000
}

export async function cancelBooking(payload: Payload, o: ResolvedBookingOptions, input: { bookingID?: Id; cancelToken?: string }, user: { id: Id } | null, staff = false): Promise<Doc> {
  const b = await loadOwned(payload, o, input, user, staff)
  if (b.status === 'held') {
    await dropHold(payload, o, b, idOf(b.customer))
    return { ...b, status: 'expired' }
  }
  if (b.status !== 'confirmed') throw new BookingError('not-cancellable', 409)
  if (!staff && !(await withinFreeWindow(payload, o, b))) throw new BookingError('too-late', 403)
  const updated = (await payload.update({ collection: o.bookingsSlug as never, id: b.id, data: { status: 'cancelled', cancelledAt: new Date().toISOString(), refundNeeded: Boolean(b.order), needsAttention: false } as never, overrideAccess: true })) as unknown as Doc
  if (b.liveSession && o.live?.cancelSession) await o.live.cancelSession(b.liveSession, { payload }).catch((err) => payload.logger.error({ err, msg: 'payload-booking: cancelSession failed' }))
  const customer = (await payload.findByID({ collection: o.usersSlug as never, id: idOf(b.customer), depth: 0, overrideAccess: true }).catch(() => null)) as Doc | null
  const base = baseUrl(payload, o)
  await mailCancelled(payload, o, updated, { email: customer?.email, name: customer?.name }, base, staff ? 'staff' : 'customer')
  const h = await hosts(payload, o)
  await mailHost(payload, o, h.emails, `Termin abgesagt: ${b.title}`, b, { email: customer?.email, name: customer?.name }, updated.refundNeeded ? 'Bezahlt: bitte Rückerstattung im Stripe-Dashboard veranlassen.' : '', baseUrl(payload, o))
  return updated
}

export async function rescheduleBooking(payload: Payload, o: ResolvedBookingOptions, input: { bookingID?: Id; cancelToken?: string; start: Date }, user: { id: Id } | null, staff = false): Promise<Doc> {
  const b = await loadOwned(payload, o, input, user, staff)
  if (b.status !== 'confirmed') throw new BookingError('not-reschedulable', 409)
  if (!staff && !(await withinFreeWindow(payload, o, b))) throw new BookingError('too-late', 403)
  const p = await loadBookable(payload, o, idOf(b.product))
  if (!p) throw new BookingError('not-bookable', 404)
  const durationMinutes = Math.round((new Date(b.end).getTime() - new Date(b.start).getTime()) / 60_000)
  await assertSlot(payload, o, p, input.start, durationMinutes, b.id)
  const end = new Date(input.start.getTime() + durationMinutes * 60_000)
  const block = blockOf(input.start, durationMinutes, p.bufferBeforeMinutes, p.bufferAfterMinutes)
  let updated: Doc
  try {
    updated = (await payload.update({ collection: o.bookingsSlug as never, id: b.id, data: { start: input.start.toISOString(), end: end.toISOString(), blockStart: block.start.toISOString(), blockEnd: block.end.toISOString(), title: `${p.title} · ${fmtWhen(input.start, o.timezone)}` } as never, overrideAccess: true })) as unknown as Doc
  } catch (err) {
    if (isOverlapError(err)) throw new BookingError('slot-taken', 409)
    throw err
  }
  if (b.liveSession && o.live?.updateSession) await o.live.updateSession(b.liveSession, { startsAt: input.start, endsAt: end }, { payload }).catch((err) => payload.logger.error({ err, msg: 'payload-booking: updateSession failed' }))
  const customer = (await payload.findByID({ collection: o.usersSlug as never, id: idOf(b.customer), depth: 0, overrideAccess: true }).catch(() => null)) as Doc | null
  const base = baseUrl(payload, o)
  await mailConfirmed(payload, o, { ...updated, cancellationHours: p.cancellationHours }, { email: customer?.email, name: customer?.name }, base)
  const h = await hosts(payload, o)
  await mailHost(payload, o, h.emails, `Termin verschoben: ${updated.title}`, updated, { email: customer?.email, name: customer?.name }, '', baseUrl(payload, o))
  return updated
}

export const localDay = (d: Date, tz: string) => DateTime.fromJSDate(d, { zone: tz }).toISODate()

// ------------------------------------------------------------------ reminders

/**
 * Mail the reminders that are due (`reminderHours` before the start) for confirmed appointments. Safe to call as often as you like
 * (every 5-15 minutes from a scheduler): what was sent is recorded on the booking. A booking made inside a reminder's window
 * (e.g. booked 3 h ahead) skips the earlier reminders instead of sending them late.
 */
export async function sendDueReminders(payload: Payload, o: ResolvedBookingOptions, now = new Date()): Promise<{ sent: number }> {
  if (!o.email || !o.reminderHours.length) return { sent: 0 }
  const widest = Math.max(...o.reminderHours)
  const upcoming = (await payload.find({ collection: o.bookingsSlug as never, where: { and: [{ status: { equals: 'confirmed' } }, { start: { greater_than: now.toISOString() } }, { start: { less_than: new Date(now.getTime() + widest * 3_600_000).toISOString() } }] } as never, depth: 0, limit: 0, pagination: false, overrideAccess: true })).docs as Doc[]
  let sent = 0
  for (const b of upcoming) {
    const done = new Set<number>(Array.isArray(b.remindersSent) ? (b.remindersSent as number[]) : [])
    const hoursLeft = (new Date(b.start).getTime() - now.getTime()) / 3_600_000
    // the tightest reminder that is already due; earlier ones are marked done without mailing
    const due = o.reminderHours.filter((h) => hoursLeft <= h && !done.has(h))
    if (!due.length) continue
    // a reminder whose moment had already passed when the booking was made is skipped: the confirmation just went out
    const startMs = new Date(b.start).getTime()
    const sendable = due.filter((h) => new Date(b.createdAt).getTime() <= startMs - h * 3_600_000)
    if (sendable.length) {
      const customer = (await payload.findByID({ collection: o.usersSlug as never, id: idOf(b.customer), depth: 0, overrideAccess: true }).catch(() => null)) as Doc | null
      if (customer?.email) {
        await mailReminder(payload, o, b, { email: String(customer.email), name: customer.name as string | undefined }, baseUrl(payload, o), Math.min(...sendable))
        sent++
      }
    }
    await payload.update({ collection: o.bookingsSlug as never, id: b.id, data: { remindersSent: [...done, ...due] } as never, overrideAccess: true, depth: 0 })
  }
  return { sent }
}
