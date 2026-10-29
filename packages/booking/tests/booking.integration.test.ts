import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { payloadCommerce } from '@daugtcom/payload-commerce'
import { DateTime } from 'luxon'
import pg from 'pg'
import { handleEndpoints } from 'payload'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { payloadBooking, resolveOptions, sendDueReminders, type BookingLiveBridge } from '../src'
import { clearIcsCache } from '../src/ics'
import { MyBookings } from '../src/ui'
import { FakeStripe } from './support/fakeStripe'
import { boot, type Booted } from './support/harness'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {} }) }))

const TZ = 'Europe/Vienna'
const fixture = pathToFileURL(fileURLToPath(new URL('../fixtures/busy.ics', import.meta.url))).href
const local = (iso: string) => DateTime.fromISO(iso, { zone: TZ })

describe('payloadBooking on a real Payload + Postgres (with payload-commerce, fake Stripe)', () => {
  let b: Booted
  const stripe = new FakeStripe()
  const sessions: Record<string, { id: number | string; token: string }> = {}
  const liveCalls: Parameters<BookingLiveBridge['createSession']>[0][] = []
  const liveCancelled: (string | number)[] = []
  const emails: { to: unknown; subject: string; attachments?: { contentType: string; content: string }[] }[] = []
  let productId: number | string
  let adminId: number | string
  let slots: { start: string; end: string }[] = []

  const call = async (method: 'GET' | 'POST', path: string, o: { body?: unknown; as?: string } = {}) => {
    const res = await handleEndpoints({
      config: b.payload.config,
      payloadInstanceCacheKey: b.dbName,
      request: new Request(`http://localhost/api${path}`, {
        method,
        headers: { ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), ...(o.as ? { Authorization: `JWT ${sessions[o.as]!.token}` } : {}) },
        ...(method === 'POST' ? { body: JSON.stringify(o.body ?? {}) } : {}),
      }),
    })
    return { status: res.status, json: (await res.json()) as any }
  }
  const slotsOf = async (query = '') => (await call('GET', `/booking/slots?product=${productId}&from=${encodeURIComponent(new Date().toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 20 * 86_400_000).toISOString())}${query}`)).json
  const hold = (as: string, start: string, options: string[] = []) => call('POST', '/booking/hold', { as, body: { product: productId, start, options } })
  const bookingsOf = async (where: Record<string, unknown> = {}) => (await b.payload.find({ collection: 'bookings', where: where as never, depth: 0, limit: 0, pagination: false, sort: 'createdAt', overrideAccess: true })).docs as any[]
  const checkout = async (as: string, cartID: number | string) => call('POST', '/payments/stripe-checkout/initiate', { as, body: { cartID, billingAddress: { country: 'AT' } } })
  const pay = async (as: string, cartID: number | string) => {
    const init = await checkout(as, cartID)
    expect(init.status).toBe(200)
    stripe.complete(init.json.sessionID)
    return call('POST', '/payments/stripe-checkout/confirm-order', { as, body: { cartID, sessionID: init.json.sessionID } })
  }

  beforeAll(async () => {
    clearIcsCache()
    const live: BookingLiveBridge = {
      createSession: async (a) => {
        liveCalls.push(a)
        return { id: `live_${liveCalls.length}` }
      },
      cancelSession: async (id) => void liveCancelled.push(id),
    }
    b = await boot({
      collections: [],
      plugins: [
        payloadCommerce({ stripe: { secretKey: 'sk_test_fake', webhookSecret: 'whsec_fake', successUrl: 'http://localhost/ok?session_id={CHECKOUT_SESSION_ID}', cancelUrl: 'http://localhost/cancel', uiMode: 'hosted', defaultTaxCode: 'txcd_10000000', ...({ stripe: stripe.asStripe() } as object) } }),
        payloadBooking({ timezone: TZ, busyCalendars: [{ url: fixture }], live, serverURL: 'http://localhost:3000', siteName: 'Test Praxis' }),
      ],
    })
    const p = b.payload
    const realSend = p.sendEmail.bind(p)
    ;(p as any).sendEmail = async (m: any) => {
      emails.push(m)
      return realSend(m).catch(() => undefined)
    }
    adminId = (await p.create({ collection: 'users', data: { email: 'host@example.com', password: 'pw-pw-pw-1', roles: ['admin'] } as never })).id
    for (const name of ['anna', 'ben', 'cara']) {
      const u = await p.create({ collection: 'users', data: { email: `${name}@example.com`, name: `${name} Test`, password: 'pw-pw-pw-1' } as never })
      sessions[name] = { id: u.id, token: (await p.login({ collection: 'users', data: { email: `${name}@example.com`, password: 'pw-pw-pw-1' } })).token! }
    }
    productId = (
      await p.create({
        collection: 'products',
        data: {
          title: 'Telefonische Sitzung', priceInEURENABLED: true, priceInEUR: 9000, inventory: 100, _status: 'published', commerce: { billingType: 'one_time' },
          booking: {
            enabled: true, durationMinutes: 60, bufferBeforeMinutes: 0, bufferAfterMinutes: 15, minNoticeHours: 0, maxAdvanceDays: 45, cancellationHours: 48, location: 'online',
            weekly: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday: String(weekday), from: '09:00', to: '17:00' })),
            options: [{ id: 'plus30', label: '30 Minuten länger', priceDeltaCents: 4500, durationDeltaMinutes: 30 }, { id: 'rec', label: 'Mitschnitt', priceDeltaCents: 1000, durationDeltaMinutes: 0, recording: true }],
          },
        },
      } as never)
    ).id
    await p.create({ collection: 'products', data: { title: 'Buch', priceInEURENABLED: true, priceInEUR: 2000, inventory: 5, _status: 'published', commerce: { billingType: 'one_time' } } } as never)
    slots = (await slotsOf()).slots
  }, 120_000)

  afterAll(async () => {
    await b?.close()
  })

  it('applies the no-overlap constraint to the database', async () => {
    const pool = new pg.Pool({ connectionString: (b.payload.db as any).pool.options.connectionString })
    const { rows } = await pool.query("select conname, pg_get_constraintdef(oid) as def from pg_constraint where conname = 'bookings_no_overlap'")
    await pool.end()
    expect(rows).toHaveLength(1)
    expect(rows[0].def).toMatch(/EXCLUDE USING gist/)
  })

  it('lists free slots for bookable products only, and keeps calendar busy time free (ICS fixture)', async () => {
    expect(slots.length).toBeGreaterThan(50)
    const books = await b.payload.find({ collection: 'products', where: { title: { equals: 'Buch' } }, overrideAccess: true })
    expect((await call('GET', `/booking/slots?product=${books.docs[0]!.id}`)).status).toBe(404)
    expect((await call('GET', '/booking/slots?product=999999')).status).toBe(404)

    // the fixture blocks every Tuesday 10:00-12:00 (Europe/Vienna): no appointment (plus its 15 minutes after) may touch that
    const tuesday = slots.filter((s) => local(s.start).weekday === 2)
    expect(tuesday.length).toBeGreaterThan(0)
    for (const s of tuesday) {
      const start = local(s.start)
      const busyStart = start.set({ hour: 10, minute: 0 })
      const busyEnd = start.set({ hour: 12, minute: 0 })
      const blockEnd = local(s.end).plus({ minutes: 15 })
      expect(start < busyEnd && busyStart < blockEnd).toBe(false)
    }
    // ... and a Tuesday 12:00 slot exists
    expect(tuesday.some((s) => local(s.start).hour === 12 && local(s.start).minute === 0)).toBe(true)
    // all slots are on the 30 minute grid in local time
    expect(slots.every((s) => [0, 30].includes(local(s.start).minute))).toBe(true)
  })

  it('requires a login to hold, and computes the price on the server (options extend duration and price)', async () => {
    expect((await call('POST', '/booking/hold', { body: { product: productId, start: slots[3]!.start } })).status).toBe(401)
    expect((await hold('anna', slots[3]!.start, ['nope'])).status).toBe(400)

    const r = await hold('anna', slots[3]!.start, ['plus30'])
    expect(r.status).toBe(200)
    expect(r.json.priceCents).toBe(13500)
    expect(new Date(r.json.end).getTime() - new Date(r.json.start).getTime()).toBe(90 * 60_000)
    const booking = (await bookingsOf({ id: { equals: r.json.bookingID } }))[0]
    expect(booking).toMatchObject({ status: 'held', priceCents: 13500, resource: 'default', location: 'online', options: ['plus30'] })
    expect(new Date(booking.blockEnd).getTime() - new Date(booking.end).getTime()).toBe(15 * 60_000) // buffer after is blocked too

    const cart = (await b.payload.findByID({ collection: 'carts', id: r.json.cartID, depth: 0, overrideAccess: true })) as any
    expect(cart.items).toHaveLength(1)
    expect(cart.items[0]).toMatchObject({ product: productId, quantity: 1, meta: { bookingID: String(r.json.bookingID) } })
    expect(cart.customer).toBe(sessions.anna!.id)

    // choosing another time for the same service replaces the first choice (one line, the old hold is free again)
    const again = await hold('anna', slots[5]!.start)
    expect(again.status).toBe(200)
    const cart2 = (await b.payload.findByID({ collection: 'carts', id: again.json.cartID, depth: 0, overrideAccess: true })) as any
    expect(cart2.items).toHaveLength(1)
    expect(cart2.items[0].meta.bookingID).toBe(String(again.json.bookingID))
    expect((await bookingsOf({ id: { equals: r.json.bookingID } }))[0].status).toBe('expired')
    expect(again.json.priceCents).toBe(9000)
    await call('POST', '/booking/release', { as: 'anna', body: { bookingID: again.json.bookingID } })
    expect((await b.payload.findByID({ collection: 'carts', id: again.json.cartID, depth: 0, overrideAccess: true }) as any).items).toHaveLength(0)
  })

  it('two buyers racing for the same slot: exactly one gets it, the other a 409', async () => {
    const start = slots[10]!.start
    const results = await Promise.all([hold('ben', start), hold('cara', start)])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    expect(['slot-taken', 'slot-unavailable']).toContain(results.find((r) => r.status === 409)!.json.error)
    expect(await bookingsOf({ start: { equals: start }, status: { equals: 'held' } })).toHaveLength(1)
    // neighbours inside the blocked time (buffer) are gone too: a slot that starts right at the end of the held one is blocked by its 15 minute buffer
    const after = (await slotsOf()).slots.map((s: any) => s.start)
    expect(after).not.toContain(start)
  })

  it('an expired hold frees the slot', async () => {
    const start = slots[20]!.start
    const first = await hold('ben', start)
    expect(first.status).toBe(200)
    expect((await hold('cara', start)).status).toBe(409)
    await b.payload.update({ collection: 'bookings', id: first.json.bookingID, data: { holdExpiresAt: new Date(Date.now() - 60_000).toISOString() } as never, overrideAccess: true })
    expect((await slotsOf()).slots.map((s: any) => s.start)).toContain(start)
    const second = await hold('cara', start)
    expect(second.status).toBe(200)
    expect((await bookingsOf({ id: { equals: first.json.bookingID } }))[0].status).toBe('expired')
    await call('POST', '/booking/release', { as: 'cara', body: { bookingID: second.json.bookingID } })
  })

  it('pays through checkout: priced and labelled from the booking, confirmed once when the order is paid, video session created once', async () => {
    const start = slots[30]!.start
    const held = await hold('anna', start, ['plus30'])
    expect(held.status).toBe(200)
    const init = await checkout('anna', held.json.cartID)
    expect(init.status).toBe(200)
    const line = stripe.createParams.at(-1)!.line_items[0]
    expect(line.price_data.unit_amount).toBe(13500)
    expect(line.price_data.product_data.name).toMatch(/^Telefonische Sitzung · .*Uhr$/)
    expect(line.price_data.product_data.metadata).toMatchObject({ bookingID: String(held.json.bookingID), productID: String(productId) })

    stripe.complete(init.json.sessionID)
    const confirmed = await call('POST', '/payments/stripe-checkout/confirm-order', { as: 'anna', body: { cartID: held.json.cartID, sessionID: init.json.sessionID } })
    expect(confirmed.status).toBe(200)

    const booking = (await bookingsOf({ id: { equals: held.json.bookingID } }))[0]
    expect(booking).toMatchObject({ status: 'confirmed', order: confirmed.json.orderID, needsAttention: false, liveSession: 'live_1' })
    expect(booking.holdExpiresAt).toBeNull()
    expect(liveCalls).toHaveLength(1)
    expect(liveCalls[0]).toMatchObject({ participantUserIds: [sessions.anna!.id], hostUserIds: [adminId], source: { kind: 'booking', id: held.json.bookingID } })
    expect(liveCalls[0]!.endsAt.getTime() - liveCalls[0]!.startsAt.getTime()).toBe(90 * 60_000)

    // saving the order again (status change by staff) does not create a second session
    await b.payload.update({ collection: 'orders', id: confirmed.json.orderID, data: { status: 'completed' } as never, overrideAccess: true })
    expect(liveCalls).toHaveLength(1)

    const mail = emails.find((m) => String(m.to) === 'anna@example.com' && /Dein Termin/.test(m.subject))!
    expect(mail.attachments![0]!.contentType).toMatch(/text\/calendar/)
    expect(mail.attachments![0]!.content).toContain('BEGIN:VEVENT')
    expect(emails.some((m) => String(m.to) === 'host@example.com' && /Neue Buchung/.test(m.subject))).toBe(true)

    // the confirmed booking blocks the slot for everyone
    expect((await hold('ben', start)).status).toBe(409)
    expect((await slotsOf()).slots.map((s: any) => s.start)).not.toContain(start)

    // it is in "mine", without the secret token
    const mine = await call('GET', '/booking/mine', { as: 'anna' })
    expect(mine.json.bookings.find((x: any) => x.id === held.json.bookingID)).toMatchObject({ status: 'confirmed', liveSession: 'live_1' })
    expect(mine.json.bookings[0].cancelToken).toBeUndefined()
    expect((await call('GET', '/booking/mine')).status).toBe(401)
  })

  it('a hold that ran out is still honoured when the slot is free, and flagged when somebody else took it', async () => {
    // free: the buyer was slow, nobody else wanted the slot
    const slow = await hold('ben', slots[40]!.start)
    const initSlow = await checkout('ben', slow.json.cartID)
    expect(initSlow.status).toBe(200)
    await b.payload.update({ collection: 'bookings', id: slow.json.bookingID, data: { status: 'expired' } as never, overrideAccess: true })
    stripe.complete(initSlow.json.sessionID)
    const ok = await call('POST', '/payments/stripe-checkout/confirm-order', { as: 'ben', body: { cartID: slow.json.cartID, sessionID: initSlow.json.sessionID } })
    expect(ok.status).toBe(200)
    expect((await bookingsOf({ id: { equals: slow.json.bookingID } }))[0]).toMatchObject({ status: 'confirmed', needsAttention: false })

    // taken: cara pays after her hold expired and anna got the slot
    const taken = slots[50]!.start
    const late = await hold('cara', taken)
    const initLate = await checkout('cara', late.json.cartID)
    await b.payload.update({ collection: 'bookings', id: late.json.bookingID, data: { status: 'expired' } as never, overrideAccess: true })
    expect((await hold('anna', taken)).status).toBe(200)
    const before = liveCalls.length
    stripe.complete(initLate.json.sessionID)
    const paid = await call('POST', '/payments/stripe-checkout/confirm-order', { as: 'cara', body: { cartID: late.json.cartID, sessionID: initLate.json.sessionID } })
    expect(paid.status).toBe(200) // the order itself must never fail because of the booking
    expect((await bookingsOf({ id: { equals: late.json.bookingID } }))[0]).toMatchObject({ status: 'expired', needsAttention: true, order: paid.json.orderID })
    expect(liveCalls).toHaveLength(before)
    expect(emails.some((m) => String(m.to) === 'host@example.com' && /Bezahlt, aber Termin vergeben/.test(m.subject))).toBe(true)
    await call('POST', '/booking/release', { as: 'anna', body: { bookingID: (await bookingsOf({ customer: { equals: sessions.anna!.id }, status: { equals: 'held' } }))[0].id } })
  })

  it('checkout refuses a cart line whose booking was lost', async () => {
    const start = slots[60]!.start
    const mine = await hold('cara', start)
    await b.payload.update({ collection: 'bookings', id: mine.json.bookingID, data: { status: 'expired' } as never, overrideAccess: true })
    const thief = await hold('ben', start) // takes the free slot
    expect(thief.status).toBe(200)
    const init = await checkout('cara', mine.json.cartID)
    expect(init.status).not.toBe(200)
    await call('POST', '/booking/release', { as: 'ben', body: { bookingID: thief.json.bookingID } })
  })

  it('cancels (free slot, session cancelled, refund flagged for a paid booking, emails), but not too late', async () => {
    const confirmed = (await bookingsOf({ status: { equals: 'confirmed' }, customer: { equals: sessions.anna!.id } }))[0]
    const r = await call('POST', '/booking/cancel', { as: 'anna', body: { bookingID: confirmed.id } })
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ status: 'cancelled', refundNeeded: true })
    expect(liveCancelled).toEqual(['live_1'])
    expect((await slotsOf()).slots.map((s: any) => s.start)).toContain(new Date(confirmed.start).toISOString())
    expect(emails.some((m) => String(m.to) === 'anna@example.com' && /Termin abgesagt/.test(m.subject))).toBe(true)
    expect((await call('POST', '/booking/cancel', { as: 'anna', body: { bookingID: confirmed.id } })).status).toBe(409)

    // inside the free window (48 h) a customer cannot cancel; strangers cannot see it at all
    const soon = (await bookingsOf({ status: { equals: 'confirmed' }, customer: { equals: sessions.ben!.id } }))[0]
    await b.payload.update({ collection: 'bookings', id: soon.id, data: { start: new Date(Date.now() + 5 * 3_600_000).toISOString(), end: new Date(Date.now() + 6 * 3_600_000).toISOString(), blockStart: new Date(Date.now() + 5 * 3_600_000).toISOString(), blockEnd: new Date(Date.now() + 6.25 * 3_600_000).toISOString() } as never, overrideAccess: true })
    const owner = 'ben'
    const stranger = 'cara'
    expect((await call('POST', '/booking/cancel', { as: stranger, body: { bookingID: soon.id } })).status).toBe(404)
    expect((await call('POST', '/booking/cancel', { as: owner, body: { bookingID: soon.id } })).json.error).toBe('too-late')
  })

  it('reschedules a confirmed booking to another free slot', async () => {
    const start = slots[80]!.start
    const held = await hold('cara', start)
    stripe.complete((await checkout('cara', held.json.cartID)).json.sessionID)
    const init = stripe.createParams.length
    expect(init).toBeGreaterThan(0)
    const sid = [...stripe.sessions.keys()].at(-1)!
    const done = await call('POST', '/payments/stripe-checkout/confirm-order', { as: 'cara', body: { cartID: held.json.cartID, sessionID: sid } })
    expect(done.status).toBe(200)
    const target = slots[120]!.start
    const moved = await call('POST', '/booking/reschedule', { as: 'cara', body: { bookingID: held.json.bookingID, start: target } })
    expect(moved.status).toBe(200)
    const row = (await bookingsOf({ id: { equals: held.json.bookingID } }))[0]
    expect(new Date(row.start).toISOString()).toBe(new Date(target).toISOString())
    expect((await slotsOf()).slots.map((s: any) => s.start)).toContain(new Date(start).toISOString())
    expect((await call('POST', '/booking/reschedule', { as: 'cara', body: { bookingID: held.json.bookingID, start: slots[1]!.start } })).status).toBe(200) // a different free slot still works
  })

  it('MyBookings lists upcoming and past appointments with Join and Cancel', async () => {
    const html = (user: string) => MyBookings({ payload: b.payload, user: { id: sessions[user]!.id } }).then((el) => renderToStaticMarkup(el))
    const cara = await html('cara')
    expect(cara).toContain('Anstehend')
    expect(cara).toContain('Bestätigt')
    expect(cara).toContain('Zum Videoanruf')
    expect(cara).toMatch(/href="\/access\/live\/live_\d+"/)
    expect(cara).toContain('Absagen') // free window not over yet
    const anna = await html('anna')
    expect(anna).toContain('Abgesagt')
    expect(anna).toContain('Die Rückerstattung veranlassen wir in Kürze.')
    expect(anna).not.toContain('Zum Videoanruf')
  })

  it('an option that includes the recording switches recording on for that call, and only for that call', async () => {
    const before = liveCalls.length
    const fresh = (await slotsOf()).slots as { start: string }[]
    const withRec = await hold('anna', fresh[2]!.start, ['rec'])
    expect(withRec.status).toBe(200)
    expect((await pay('anna', withRec.json.cartID)).status).toBe(200)
    const without = await hold('anna', fresh[Math.floor(fresh.length / 2)]!.start, ['plus30'])
    expect((await pay('anna', without.json.cartID)).status).toBe(200)
    const made = liveCalls.slice(before)
    expect(made).toHaveLength(2)
    expect(made[0]!.record).toBe(true)
    expect(made[1]!.record).toBeUndefined()
    expect(emails.some((m) => String(m.to) === 'anna@example.com' && /aufgezeichnet/.test((m as any).text ?? ''))).toBe(true)
  })

  it('mails reminders once, 24 h and 1 h before, and uses the theme layout', async () => {
    const o = resolveOptions({ timezone: TZ, serverURL: 'http://localhost:3000', siteName: 'Test Praxis', mailLayout: (c) => ({ html: `<b>THEMED ${c.heading}</b>`, text: c.heading }) })
    const row = (await bookingsOf({ and: [{ status: { equals: 'confirmed' } }, { 'customer': { equals: sessions.cara!.id } }] }))[0]
    const start = new Date(row.start).getTime()
    const before = emails.length
    const run = async (at: number) => { await sendDueReminders(b.payload, o, new Date(at)); return emails.slice(before).filter((m) => String(m.to) === 'cara@example.com').length }
    expect(await run(start - 30 * 3_600_000)).toBe(0) // too early
    expect(await run(start - 23 * 3_600_000)).toBe(1) // the day-before reminder
    expect(await run(start - 22 * 3_600_000)).toBe(1) // only once
    expect(await run(start - 50 * 60_000)).toBe(2) // the short-notice one
    const sent = emails.slice(before).filter((m) => String(m.to) === 'cara@example.com')
    expect(sent.map((m) => m.subject)).toEqual([expect.stringMatching(/^Erinnerung:/), expect.stringMatching(/^Gleich geht es los/)])
    expect((sent[0] as any).html).toContain('THEMED')
    expect((await bookingsOf({ id: { equals: row.id } }))[0].remindersSent).toEqual([24, 1])
  })

  it('calendar settings: an "available" calendar turns the logic around (only its events are bookable), a "busy" one blocks', async () => {
    const availableUrl = pathToFileURL(fileURLToPath(new URL('../fixtures/available.ics', import.meta.url))).href
    const setCalendars = (calendars: unknown[]) => b.payload.updateGlobal({ slug: 'bookingSettings' as never, data: { calendars } as never, overrideAccess: true })
    const normal = (await slotsOf()).slots as { start: string }[]
    expect(normal.some((x) => local(x.start).weekday !== 3)).toBe(true) // weekly hours: more than Wednesdays

    await setCalendars([{ name: 'Sprechzeit', url: availableUrl.replace('file:', 'file:'), mode: 'available' }])
    const only = (await slotsOf()).slots as { start: string }[]
    expect(only.length).toBeGreaterThan(0)
    for (const x of only) {
      const l = local(x.start)
      expect(l.weekday).toBe(3)
      expect(l.hour).toBeGreaterThanOrEqual(13)
      expect(l.hour).toBeLessThan(16)
    }
    // a booking can still only be made inside it
    const outside = normal.find((x) => local(x.start).weekday !== 3)!
    expect((await hold('ben', outside.start)).status).toBe(409)

    await setCalendars([])
    expect(((await slotsOf()).slots as unknown[]).length).toBe(normal.length)
  })
})
