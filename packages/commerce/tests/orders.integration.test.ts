import { commerceAccessBridge } from '@daugtcom/payload-commerce/access'
import { createSeries, payloadAccess } from '@daugtcom/payload-access'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { payloadCommerce } from '../src'
import { OrdersList, OrdersView, RecentOrders } from '../src/ui'
import { FakeStripe } from './support/fakeStripe'
import { boot, type Booted } from './support/harness'

type Id = number | string

describe('member orders UI on a real Payload + Postgres', () => {
  let b: Booted
  const stripe = new FakeStripe()
  let a: { id: Id }, other: { id: Id }, empty: { id: Id }, many: { id: Id }
  let course: Id, lesson: Id, productA: Id, productB: Id
  let orderPaid: any, orderPending: any, otherOrder: any
  let invHosted: any, invLegacy: any, invOther: any

  const view = async (user: { id: Id }, extra: Record<string, unknown> = {}) =>
    renderToStaticMarkup(await OrdersView({ payload: b.payload, user, ...extra } as never))
  const create = (data: Record<string, unknown>, context: Record<string, unknown> = {}) =>
    b.payload.create({ collection: 'orders', data: { currency: 'EUR', amount: 1000, status: 'processing', ...data } as never, overrideAccess: true, context }) as Promise<any>

  beforeAll(async () => {
    const { collections, series } = createSeries({ parent: 'courses', items: 'lessons' })
    b = await boot({
      collections,
      plugins: [
        payloadAccess({ targetCollections: ['courses', 'lessons'], series: [series] }),
        payloadCommerce({
          accessBridge: commerceAccessBridge, accessTargets: ['courses', 'lessons'],
          stripe: { secretKey: 'sk_test_fake', webhookSecret: 'whsec_fake', successUrl: 'http://localhost/ok?session_id={CHECKOUT_SESSION_ID}', cancelUrl: 'http://localhost/cancel', ...({ stripe: stripe.asStripe() } as object) },
        }),
      ],
    })
    const p = b.payload
    const user = (email: string) => p.create({ collection: 'users', data: { email, password: 'pw-pw-pw-1' } as never }) as Promise<any>
    a = await user('a@example.com'); other = await user('b@example.com'); empty = await user('c@example.com'); many = await user('d@example.com')
    await p.update({ collection: 'users', id: a.id, data: { stripeCustomerID: 'cus_a' } as never, overrideAccess: true })
    course = (await p.create({ collection: 'courses', data: { title: 'Kurs Alpha', slug: 'alpha', _status: 'published' } as never })).id
    lesson = (await p.create({ collection: 'lessons', data: { title: 'Beitrag Beta', slug: 'beta', series: [course], publishedAt: '2026-01-01T00:00:00Z', _status: 'published' } as never })).id
    const product = (title: string, accessItems: unknown[], commerce: Record<string, unknown> = {}) =>
      p.create({ collection: 'products', data: { title, slug: title.toLowerCase().replace(/\W+/g, '-'), priceInEURENABLED: true, priceInEUR: 4900, inventory: 100, _status: 'published', commerce: { billingType: 'one_time', accessItems, ...commerce } } as never })
    productA = (await product('Kurs Jahr', [{ target: { relationTo: 'courses', value: course }, mode: 'duration', duration: 1, durationUnit: 'year' }])).id
    productB = (await product('Geheimes Buch', [{ target: { relationTo: 'lessons', value: lesson }, mode: 'permanent' }], { requiresShipping: true })).id

    orderPaid = await create({
      customer: a.id, amount: 4900, paymentStatus: 'paid', paidAt: '2026-02-10T09:00:00Z',
      items: [{ product: productA, quantity: 2, shippingStatus: 'shipped' }],
      shippingAddress: { firstName: 'Anna', lastName: 'Muster', addressLine1: 'Hauptstraße 1', postalCode: '1010', city: 'Wien', country: 'AT' },
      billingAddress: { name: 'Anna Muster GmbH', email: 'a@example.com', address: { line1: 'Rechnungsweg 9', city: 'Graz', postal_code: '8010', country: 'AT' } },
    })
    orderPending = await create({ customer: a.id, amount: 2500, paymentStatus: 'pending', items: [{ product: productB, quantity: 1, shippingStatus: 'pending' }] })
    otherOrder = await create({ customer: other.id, amount: 7777, paymentStatus: 'paid', paidAt: '2026-03-01T09:00:00Z', items: [{ product: productB, quantity: 1 }] })
    const invoice = (data: Record<string, unknown>) => p.create({ collection: 'invoices', data: { status: 'paid', ...data } as never, overrideAccess: true }) as Promise<any>
    invHosted = await invoice({ order: orderPaid.id, customer: a.id, stripeInvoiceID: 'in_hosted_a' })
    invLegacy = await invoice({ order: orderPaid.id, customer: a.id, file: 'legacy/1.pdf' })
    invOther = await invoice({ order: otherOrder.id, customer: other.id, stripeInvoiceID: 'in_other_b' })
    stripe.hostedInvoiceUrls.set('in_hosted_a', 'https://invoice.stripe.test/i/a')
    stripe.hostedInvoiceUrls.set('in_other_b', 'https://invoice.stripe.test/i/b')
    stripe.invoiceNumbers.set('in_hosted_a', 'ABC-0001')
    for (let n = 0; n < 22; n++) await create({ customer: many.id, amount: 100 + n, paymentStatus: 'pending', orderNumber: 5000 + n, items: [] })
  }, 120_000)

  afterAll(async () => { await b?.close() })

  it('does not query entitlements when the access bridge is disabled', async () => {
    const commerce = (b.payload.config.custom as any).daugtCommerce
    const targets = commerce.options.accessTargets
    commerce.options.accessTargets = []
    const find = vi.spyOn(b.payload, 'find')
    try {
      await view(a)
      expect(find.mock.calls.some(([args]) => args.collection === 'entitlements')).toBe(false)
    } finally {
      find.mockRestore()
      commerce.options.accessTargets = targets
    }
  })

  it('never shows another member\'s order, entitlement, product or invoice', async () => {
    const html = await view(a)
    expect(html).toContain(`#${orderPaid.orderNumber}`)
    expect(html).toContain(`#${orderPending.orderNumber}`)
    expect(html).not.toContain(`#${otherOrder.orderNumber}`)
    expect(html).not.toContain('77,77')
    expect(html).not.toContain('Beitrag Beta') // B's paid entitlement
    expect(html).not.toContain('https://invoice.stripe.test/i/b')
    expect(html).not.toContain(`/invoices/${invOther.id}/pdf`)
    const htmlOther = await view(other)
    expect(htmlOther).toContain(`#${otherOrder.orderNumber}`)
    expect(htmlOther).not.toContain(`#${orderPaid.orderNumber}`)
    expect(htmlOther).not.toContain('Kurs Alpha')
    expect(htmlOther).not.toContain('ABC-0001')
  })

  it('a forged user id for another member only reveals that member\'s own data (rights come from the given user)', async () => {
    const html = await view({ id: other.id })
    expect(html).not.toContain(`#${orderPaid.orderNumber}`)
  })

  it('renders paid vs pending, totals, items, shipping and the billing notice', async () => {
    const html = await view(a)
    expect(html).toContain('bezahlt'); expect(html).toContain('Zahlung ausstehend')
    expect(html).toContain('bg-green-100'); expect(html).toContain('bg-secondary-100')
    expect(html).toContain('49,00'); expect(html).toContain('25,00'); expect(html).toContain('inkl. MwSt.')
    expect(html).toContain('Details anzeigen'); expect(html).toMatch(/<details/)
    expect(html).toContain('href="/shop/kurs-jahr"'); expect(html).toContain('href="/shop/geheimes-buch"')
    expect(html).toContain('Menge: 2'); expect(html).toContain('Versendet'); expect(html).toContain('Versand ausstehend')
    expect(html).toContain('verwaltest du im Abrechnungsportal von Stripe.')
    expect(await view(a, { showBillingButton: false })).not.toContain('Abrechnungsportal von Stripe')
    expect(await view(other)).toContain('Zahlungen &amp; Abos verwalten') // everyone gets the button; a member without a Stripe customer gets one when it is pressed
  })

  it('unlocks only for paid orders; pending shows the hint', async () => {
    const html = await view(a)
    expect(html).toContain('href="/access/course/alpha/all"')
    expect(html).toContain('10.02.2026 – 10.02.2027')
    expect(html).toContain('Freigeschaltet')
    expect(html.match(/Der Zugang wird freigeschaltet, sobald die Zahlung eingegangen ist/g)).toHaveLength(1)
    // the pending order's product would unlock a lesson, but nothing was granted
    expect(html).not.toContain('Beitrag Beta')
    const forever = await view(other)
    expect(forever).toContain('href="/post/beta"'); expect(forever).toContain('unbegrenzt')
    expect(await view(a, { hrefs: { course: (s: string) => `/c/${s}` } })).toContain('href="/c/alpha"')
  })

  it('renders only the address fields that are set', async () => {
    const html = await view(a)
    expect(html).toContain('Lieferadresse'); expect(html).toContain('Anna Muster'); expect(html).toContain('Hauptstraße 1'); expect(html).toContain('1010 Wien')
    expect(html).toContain('Rechnungsadresse'); expect(html).toContain('Anna Muster GmbH'); expect(html).toContain('8010 Graz'); expect(html).toContain('Rechnungsweg 9')
    expect(html).toContain('Österreich')
    expect(await view(other)).not.toContain('Lieferadresse</h4>')
  })

  it('links Stripe\'s hosted invoice, falls back to the PDF endpoint when Stripe is missing or failing', async () => {
    let html = await view(a)
    expect(html).toContain('Rechnung #ABC-0001')
    expect(html).toContain('href="https://invoice.stripe.test/i/a"'); expect(html).toContain('target="_blank"')
    expect(html).toContain(`href="/api/commerce/invoices/${invLegacy.id}/pdf"`) // legacy upload: no stripeInvoiceID
    expect(html).not.toContain(`/invoices/${invHosted.id}/pdf`)

    stripe.invoiceError = true
    html = await view(a)
    expect(html).toContain(`href="/api/commerce/invoices/${invHosted.id}/pdf"`)
    expect(html).toContain(`Rechnung #${invHosted.id}`)
    stripe.invoiceError = false

    const custom = b.payload.config.custom as any
    const saved = custom.payloadCommerce
    delete custom.payloadCommerce
    try { expect(await view(a)).toContain(`href="/api/commerce/invoices/${invHosted.id}/pdf"`) } finally { custom.payloadCommerce = saved }

    // a hanging Stripe never blocks the page
    const retrieve = stripe.invoices.retrieve
    stripe.invoices.retrieve = (() => new Promise(() => {})) as never
    try {
      const started = Date.now()
      const html = await view(a)
      expect(Date.now() - started).toBeLessThan(8000)
      expect(html).toContain(`href="/api/commerce/invoices/${invHosted.id}/pdf"`)
    } finally { stripe.invoices.retrieve = retrieve }
  })

  it('empty state links to the shop; custom hrefs apply', async () => {
    const html = await view(empty)
    expect(html).toContain('Noch keine Bestellungen'); expect(html).toContain('href="/shop"')
    expect(await view(empty, { hrefs: { shop: '/laden' } })).toContain('href="/laden"')
  })

  it('shows the 20 newest and pages with ?page=', async () => {
    const count = (s: string) => (s.match(/<article/g) ?? []).length
    const first = await view(many)
    expect(count(first)).toBe(20); expect(first).toContain('#5021'); expect(first).not.toContain('#5000')
    expect(first).toContain('href="?page=2"'); expect(first).toContain('Ältere Bestellungen'); expect(first).not.toContain('Neuere Bestellungen')
    const second = await view(many, { page: '2' })
    expect(count(second)).toBe(2); expect(second).toContain('#5000'); expect(second).toContain('href="?page=1"'); expect(second).not.toContain('Ältere Bestellungen')
    expect(count(await view(many, { page: 'abc' }))).toBe(20)
    expect(count(await view(many, { page: -3 }))).toBe(20)
  })

  it('OrdersList stays an alias of OrdersView', async () => {
    expect(OrdersList).toBe(OrdersView)
    expect(renderToStaticMarkup(await OrdersList({ payload: b.payload, user: a }))).toContain(`#${orderPaid.orderNumber}`)
  })

  it('RecentOrders: last 5, own only, empty text and link', async () => {
    const html = renderToStaticMarkup(await RecentOrders({ payload: b.payload, user: many }))
    expect((html.match(/Bestellung #/g) ?? []).length).toBe(5)
    expect(html).toContain('#5021'); expect(html).not.toContain('#5016')
    expect(html).toContain('Alle Bestellungen'); expect(html).toContain('href="/access/orders"'); expect(html).toContain('Letzte Bestellungen')
    const mineOnly = renderToStaticMarkup(await RecentOrders({ payload: b.payload, user: a, hrefs: { orders: '/m/orders' } }))
    expect(mineOnly).toContain(`#${orderPaid.orderNumber}`); expect(mineOnly).not.toContain(`#${otherOrder.orderNumber}`); expect(mineOnly).toContain('href="/m/orders"')
    expect(renderToStaticMarkup(await RecentOrders({ payload: b.payload, user: empty }))).toContain('Du hast noch keine Bestellung aufgegeben.')
  })
})
