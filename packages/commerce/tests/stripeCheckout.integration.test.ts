import { commerceAccessBridge } from '@daugtcom/payload-commerce/access'
import { createSeries, getAccess, payloadAccess } from '@daugtcom/payload-access'
import { handleEndpoints } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { payloadCommerce } from '../src'
import { FakeStripe } from './support/fakeStripe'
import { boot, type Booted } from './support/harness'

const d = (iso: string) => new Date(iso)

describe('hosted Stripe Checkout through the ecommerce plugin endpoints (fake Stripe)', () => {
  let b: Booted
  const stripe = new FakeStripe()
  let token: string
  let userId: number | string
  let courseId: number | string
  let rejectOrder = false
  let rejectInvoice = false
  let products: { course: number | string; physical: number | string; sub3: number | string; subOpen: number | string }

  const api = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
    const res = await handleEndpoints({
      config: b.payload.config, payloadInstanceCacheKey: b.dbName,
      request: new Request(`http://localhost/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }),
    })
    return { status: res.status, json: (await res.json()) as any }
  }
  const authed = () => ({ Authorization: `JWT ${token}` })
  const webhook = (event: unknown, signature = 'valid') => api('/payments/stripe-checkout/webhook', JSON.stringify(event), { 'stripe-signature': signature })
  const cartWith = async (...ids: (number | string)[]) =>
    (await b.payload.create({ collection: 'carts', data: { customer: userId, currency: 'EUR', items: ids.map((p) => ({ product: p, quantity: 1 })) } as never, overrideAccess: true })).id
  const initiate = (cartID: number | string, shippingAddress?: unknown) =>
    api('/payments/stripe-checkout/initiate', { cartID, billingAddress: { country: 'AT' }, ...(shippingAddress ? { shippingAddress } : {}) }, authed())
  const confirm = (cartID: number | string, sessionID: string) => api('/payments/stripe-checkout/confirm-order', { cartID, sessionID }, authed())
  const ordersOf = async () => (await b.payload.find({ collection: 'orders', limit: 0, pagination: false, depth: 0, sort: 'createdAt' })).docs as any[]
  const entitlements = async () => (await b.payload.find({ collection: 'entitlements', limit: 0, pagination: false, depth: 0 })).docs as any[]

  beforeAll(async () => {
    const { collections, series } = createSeries({ parent: 'courses', items: 'lessons' })
    b = await boot({
      collections,
      plugins: [
        payloadAccess({ targetCollections: ['courses'], series: [series] }),
        payloadCommerce({
          accessBridge: commerceAccessBridge, accessTargets: ['courses'],
          invoiceFileUrl: (key) => `https://files.test/${key}`,
          shippingDefaults: { mode: 'dynamic', flatRate: 5, method: 'sum', allowedCountries: ['AT', 'DE'] },
          stripe: { secretKey: 'sk_test_fake', webhookSecret: 'whsec_fake', successUrl: 'http://localhost/ok?session_id={CHECKOUT_SESSION_ID}', billingPortalReturnUrl: 'http://localhost/account', cancelUrl: 'http://localhost/cancel', uiMode: 'hosted', defaultTaxCode: 'txcd_10000000', ...({ stripe: stripe.asStripe() } as object) },
        }),
        (config) => {
          for (const collection of config.collections ?? []) {
            if (collection.slug === 'orders' || collection.slug === 'invoices') {
              collection.hooks ??= {}
              collection.hooks.afterChange = [...(collection.hooks.afterChange ?? []), ({ doc }) => {
                if ((collection.slug === 'orders' && rejectOrder) || (collection.slug === 'invoices' && rejectInvoice)) throw new Error('Forced settlement hook failure')
                return doc
              }]
            }
          }
          return config
        },
      ],
    })
    const p = b.payload
    userId = (await p.create({ collection: 'users', data: { email: 'buyer@example.com', password: 'pw-pw-pw-1' } as never })).id
    token = (await p.login({ collection: 'users', data: { email: 'buyer@example.com', password: 'pw-pw-pw-1' } })).token!
    courseId = (await p.create({ collection: 'courses', data: { title: 'C', slug: 'c', _status: 'published' } as never })).id
    const size = await p.create({ collection: 'shippingSizes', data: { name: 'S', rates: [{ country: 'AT', amount: 4 }, { country: 'DE', amount: 6 }], fallbackRate: 12 } as never, overrideAccess: true })
    const product = (title: string, commerce: Record<string, unknown>) =>
      p.create({ collection: 'products', data: { title, priceInEURENABLED: true, priceInEUR: 4900, inventory: 50, _status: 'published', commerce } as never })
    const rule = { target: { relationTo: 'courses', value: courseId }, mode: 'permanent' }
    products = {
      course: (await product('Course', { billingType: 'one_time', accessItems: [{ ...rule, mode: 'duration', duration: 1, durationUnit: 'year' }] })).id,
      physical: (await product('Book', { billingType: 'one_time', requiresShipping: true, shippingSize: size.id })).id,
      sub3: (await product('Sub 3x', { billingType: 'recurring', intervalCount: 1, intervalUnit: 'month', durationType: 'limited', iterations: 3, accessItems: [rule] })).id,
      subOpen: (await product('Sub open', { billingType: 'recurring', intervalCount: 1, intervalUnit: 'month', durationType: 'permanent', accessItems: [rule] })).id,
    }
  }, 90_000)

  afterAll(async () => {
    await b?.close()
  })

  it('initiate creates a hosted Checkout Session with inline prices, tax, invoice and a pending transaction', async () => {
    const cartID = await cartWith(products.course)
    const r = await initiate(cartID)
    expect(r.status).toBe(200)
    expect(r.json.url).toMatch(/^https:\/\/checkout\.stripe\.test\//)

    const p = stripe.createParams.at(-1)!
    expect(p).toMatchObject({ mode: 'payment', automatic_tax: { enabled: true }, billing_address_collection: 'required', allow_promotion_codes: true, invoice_creation: { enabled: true }, client_reference_id: String(cartID) })
    expect(p.customer_update).toEqual({ name: 'auto', address: 'auto' })
    expect(p.line_items[0].price_data).toMatchObject({ currency: 'eur', unit_amount: 4900, tax_behavior: 'inclusive', product_data: { name: 'Course', tax_code: 'txcd_10000000' } })

    const tx = (await b.payload.find({ collection: 'transactions', where: { 'stripeCheckout.sessionID': { equals: r.json.sessionID } }, depth: 0 })).docs[0] as any
    expect(tx).toMatchObject({ status: 'pending', paymentMethod: 'stripe-checkout' })
  })

  it('buyer returns: confirm-order settles through the plugin, grants access and records the invoice', async () => {
    const cartID = await cartWith(products.course)
    const { json } = await initiate(cartID)
    stripe.complete(json.sessionID)

    const r = await confirm(cartID, json.sessionID)
    expect(r.status).toBe(200)

    const order = (await ordersOf()).find((o) => o.id === r.json.orderID)
    expect(order).toMatchObject({ paymentStatus: 'paid', status: 'processing', customer: userId, stripe: { checkoutSessionID: json.sessionID } })
    expect(order.orderNumber).toBeGreaterThanOrEqual(1000)

    const ents = (await entitlements()).filter((e) => e.order === order.id)
    expect(ents).toHaveLength(1)
    expect(await getAccess(b.payload).canAccess(userId, { relationTo: 'courses', value: courseId })).toBe(true)

    // Stripe also sends checkout.session.completed; that is what records the invoice
    await webhook({ type: 'checkout.session.completed', data: { object: stripe.sessions.get(json.sessionID) } })
    expect((await ordersOf()).filter((o) => o.stripe?.checkoutSessionID === json.sessionID)).toHaveLength(1)
    const invoice = (await b.payload.find({ collection: 'invoices', where: { stripeInvoiceID: { equals: `in_test_${json.sessionID}` } }, depth: 0 })).docs[0] as any
    expect(invoice).toMatchObject({ order: order.id, status: 'paid' })
    expect(stripe.invoiceUpdates.some((u) => u.id === `in_test_${json.sessionID}`)).toBe(true)

    const cart = (await b.payload.findByID({ collection: 'carts', id: cartID, depth: 0, overrideAccess: true })) as any
    expect(cart.purchasedAt).toBeTruthy()
    const product = (await b.payload.findByID({ collection: 'products', id: products.course, depth: 0, overrideAccess: true })) as any
    expect(product.inventory).toBeLessThan(50)
  })

  it('buyer never returns: the webhook creates the order; a late confirm-order finds the same one', async () => {
    const before = (await ordersOf()).length
    const cartID = await cartWith(products.course)
    const { json } = await initiate(cartID)
    const session = stripe.complete(json.sessionID)

    const w = await webhook({ type: 'checkout.session.completed', data: { object: session } })
    expect(w.status).toBe(200)
    expect((await ordersOf()).length).toBe(before + 1)

    const late = await confirm(cartID, json.sessionID)
    expect(late.status).toBe(200)
    expect((await ordersOf()).length).toBe(before + 1)
    const order = (await ordersOf()).at(-1)
    expect(late.json.orderID).toBe(order.id)
    expect((await entitlements()).filter((e) => e.order === order.id)).toHaveLength(1)
  })

  it('confirm-order and webhook at the same moment produce exactly one order', async () => {
    const before = (await ordersOf()).length
    const inventory = (await b.payload.findByID({ collection: 'products', id: products.course, depth: 0 }) as any).inventory
    const cartID = await cartWith(products.course)
    const { json } = await initiate(cartID)
    const session = stripe.complete(json.sessionID)

    const results = await Promise.all([confirm(cartID, json.sessionID), webhook({ type: 'checkout.session.completed', data: { object: session } }), webhook({ type: 'checkout.session.async_payment_succeeded', data: { object: session } })])
    expect(results.map((r) => r.status)).toEqual([200, 200, 200])
    expect((await ordersOf()).length).toBe(before + 1)
    const order = (await ordersOf()).find((o) => o.stripe?.checkoutSessionID === json.sessionID)
    expect((await entitlements()).filter((e) => e.order === order.id)).toHaveLength(1)
    expect((await b.payload.findByID({ collection: 'products', id: products.course, depth: 0 }) as any).inventory).toBe(inventory - 1)
  })

  const transactionFor = async (sessionID: string) => (await b.payload.find({ collection: 'transactions', where: { 'stripeCheckout.sessionID': { equals: sessionID } }, depth: 0 })).docs[0] as any
  const sessionOrders = async (sessionID: string) => (await ordersOf()).filter((o) => o.stripe?.checkoutSessionID === sessionID)
  const invoicesFor = async (sessionID: string) => (await b.payload.find({ collection: 'invoices', where: { stripeInvoiceID: { equals: `in_test_${sessionID}` } }, depth: 0 })).docs

  it('webhook validates the retrieved paid session and its original cart metadata', async () => {
    const cartID = await cartWith(products.course)
    const { json } = await initiate(cartID)
    const signedPaidEvent = { ...stripe.complete(json.sessionID) }
    stripe.sessions.get(json.sessionID)!.payment_status = 'unpaid'
    expect((await webhook({ type: 'checkout.session.completed', data: { object: signedPaidEvent } })).status).toBe(500)
    expect(await sessionOrders(json.sessionID)).toHaveLength(0)
    stripe.complete(json.sessionID, { metadata: { cartID: 'another-cart' } })
    expect((await webhook({ type: 'checkout.session.completed', data: { object: signedPaidEvent } })).status).toBe(500)
    expect((await transactionFor(json.sessionID)).status).toBe('pending')
  })

  it('unpaid completion waits for asynchronous payment success', async () => {
    const cartID = await cartWith(products.course)
    const { json } = await initiate(cartID)
    const unpaid = stripe.complete(json.sessionID, { payment_status: 'unpaid' })
    expect((await webhook({ type: 'checkout.session.completed', data: { object: unpaid } })).status).toBe(200)
    expect(await sessionOrders(json.sessionID)).toHaveLength(0)
    const paid = stripe.complete(json.sessionID)
    expect((await webhook({ type: 'checkout.session.async_payment_succeeded', data: { object: paid } })).status).toBe(200)
    expect(await sessionOrders(json.sessionID)).toHaveLength(1)
  })

  it('webhook settles the transaction snapshot after the cart changes', async () => {
    const cartID = await cartWith(products.course)
    const { json } = await initiate(cartID)
    await b.payload.update({ collection: 'carts', id: cartID, data: { items: [{ product: products.physical, quantity: 3 }] } as never })
    const session = stripe.complete(json.sessionID)
    expect((await webhook({ type: 'checkout.session.completed', data: { object: session } })).status).toBe(200)
    const [order] = await sessionOrders(json.sessionID)
    expect(order.items).toHaveLength(1)
    expect(order.items[0]).toMatchObject({ product: products.course, quantity: 1 })
  })

  it('order hook failure rolls back the claim, inventory, order and grants and can retry', async () => {
    const cartID = await cartWith(products.course)
    const { json } = await initiate(cartID)
    const session = stripe.complete(json.sessionID)
    const inventory = (await b.payload.findByID({ collection: 'products', id: products.course, depth: 0 }) as any).inventory
    const grantCount = (await entitlements()).length
    rejectOrder = true
    try {
      expect((await webhook({ type: 'checkout.session.completed', data: { object: session } })).status).toBe(500)
    } finally { rejectOrder = false }
    expect((await transactionFor(json.sessionID)).status).toBe('pending')
    expect(await sessionOrders(json.sessionID)).toHaveLength(0)
    expect((await entitlements()).length).toBe(grantCount)
    expect((await b.payload.findByID({ collection: 'products', id: products.course, depth: 0 }) as any).inventory).toBe(inventory)
    expect((await webhook({ type: 'checkout.session.completed', data: { object: session } })).status).toBe(200)
    const [order] = await sessionOrders(json.sessionID)
    expect((await entitlements()).filter((e) => e.order === order.id)).toHaveLength(1)
    expect((await b.payload.findByID({ collection: 'products', id: products.course, depth: 0 }) as any).inventory).toBe(inventory - 1)
  })

  it('invoice failure leaves a committed order and repeated delivery retries without duplicate fulfillment', async () => {
    const cartID = await cartWith(products.course)
    const { json } = await initiate(cartID)
    const session = stripe.complete(json.sessionID)
    const inventory = (await b.payload.findByID({ collection: 'products', id: products.course, depth: 0 }) as any).inventory
    rejectInvoice = true
    try {
      expect((await webhook({ type: 'checkout.session.completed', data: { object: session } })).status).toBe(500)
    } finally { rejectInvoice = false }
    expect((await transactionFor(json.sessionID)).status).toBe('succeeded')
    expect(await sessionOrders(json.sessionID)).toHaveLength(1)
    expect(await invoicesFor(json.sessionID)).toHaveLength(0)
    for (let i = 0; i < 2; i++) expect((await webhook({ type: 'checkout.session.completed', data: { object: session } })).status).toBe(200)
    const [order] = await sessionOrders(json.sessionID)
    expect(await invoicesFor(json.sessionID)).toHaveLength(1)
    expect((await entitlements()).filter((e) => e.order === order.id)).toHaveLength(1)
    expect((await b.payload.findByID({ collection: 'products', id: products.course, depth: 0 }) as any).inventory).toBe(inventory - 1)
  })

  it('settled replay still synchronizes its invoice after the original cart is deleted', async () => {
    const cartID = await cartWith(products.course)
    const { json } = await initiate(cartID)
    const session = stripe.complete(json.sessionID)
    expect((await confirm(cartID, json.sessionID)).status).toBe(200)
    await b.payload.delete({ collection: 'carts', id: cartID })
    expect((await webhook({ type: 'checkout.session.completed', data: { object: session } })).status).toBe(200)
    expect(await sessionOrders(json.sessionID)).toHaveLength(1)
    expect(await invoicesFor(json.sessionID)).toHaveLength(1)
  })

  it('pending settlement fails visibly when the original cart is deleted', async () => {
    const cartID = await cartWith(products.course)
    const { json } = await initiate(cartID)
    await b.payload.delete({ collection: 'carts', id: cartID })
    const session = stripe.complete(json.sessionID)
    expect((await webhook({ type: 'checkout.session.completed', data: { object: session } })).status).toBe(500)
    expect((await transactionFor(json.sessionID)).status).toBe('pending')
    expect(await sessionOrders(json.sessionID)).toHaveLength(0)
  })

  it('settled replay still synchronizes its invoice after the customer is removed', async () => {
    const customer = await b.payload.create({ collection: 'users', data: { email: 'former-buyer@example.com', password: 'pw-pw-pw-2' } as never })
    const login = await b.payload.login({ collection: 'users', data: { email: 'former-buyer@example.com', password: 'pw-pw-pw-2' } })
    const headers = { Authorization: `JWT ${login.token}` }
    const cart = await b.payload.create({ collection: 'carts', data: { customer: customer.id, currency: 'EUR', items: [{ product: products.physical, quantity: 1 }] } as never })
    const { json } = await api('/payments/stripe-checkout/initiate', { cartID: cart.id, shippingAddress: { country: 'AT' } }, headers)
    const session = stripe.complete(json.sessionID)
    expect((await api('/payments/stripe-checkout/confirm-order', { cartID: cart.id, sessionID: json.sessionID }, headers)).status).toBe(200)
    await b.payload.delete({ collection: 'users', id: customer.id })
    expect((await webhook({ type: 'checkout.session.completed', data: { object: session } })).status).toBe(200)
    expect(await sessionOrders(json.sessionID)).toHaveLength(1)
    expect(await invoicesFor(json.sessionID)).toHaveLength(1)
  })

  it('pending settlement fails visibly when the original customer is missing', async () => {
    const cartID = await cartWith(products.course)
    const { json } = await initiate(cartID)
    const tx = await transactionFor(json.sessionID)
    await b.payload.update({ collection: 'transactions', id: tx.id, data: { customer: null } as never })
    const session = stripe.complete(json.sessionID)
    expect((await webhook({ type: 'checkout.session.completed', data: { object: session } })).status).toBe(500)
    expect(await sessionOrders(json.sessionID)).toHaveLength(0)
  })

  it('session-only confirmation resolves the original owned cart and refuses other buyers', async () => {
    const cartID = await cartWith(products.course)
    const { json } = await initiate(cartID)
    stripe.complete(json.sessionID)
    expect((await api('/payments/stripe-checkout/confirm-order', { sessionID: json.sessionID })).status).toBe(401)
    await b.payload.create({ collection: 'users', data: { email: 'stranger@example.com', password: 'pw-pw-pw-3' } as never })
    const login = await b.payload.login({ collection: 'users', data: { email: 'stranger@example.com', password: 'pw-pw-pw-3' } })
    expect((await api('/payments/stripe-checkout/confirm-order', { sessionID: json.sessionID }, { Authorization: `JWT ${login.token}` })).status).toBe(403)
    const result = await api('/payments/stripe-checkout/confirm-order', { sessionID: json.sessionID }, authed())
    expect(result.status).toBe(200)
    expect(result.json.orderID).toBe((await sessionOrders(json.sessionID))[0].id)
  })

  it('refuses to confirm an unpaid session or a session of another cart', async () => {
    const cartID = await cartWith(products.course)
    const { json } = await initiate(cartID)
    expect((await confirm(cartID, json.sessionID)).status).toBe(500)

    stripe.complete(json.sessionID)
    const other = await cartWith(products.course)
    expect((await confirm(other, json.sessionID)).status).toBe(500)
  })

  it('rejects webhooks with a bad signature', async () => {
    const r = await webhook({ type: 'checkout.session.completed', data: { object: {} } }, 'forged')
    expect(r.status).toBe(400)
  })

  it('shipping: needs a country, applies the size rate for it, refuses countries we do not ship to', async () => {
    const cartID = await cartWith(products.physical)
    expect((await initiate(cartID)).status).toBe(500)
    expect((await initiate(cartID, { country: 'FR' })).status).toBe(500)

    const ok = await initiate(cartID, { country: 'DE' })
    expect(ok.status).toBe(200)
    const p = stripe.createParams.at(-1)!
    expect(p.shipping_address_collection).toEqual({ allowed_countries: ['DE'] })
    expect(p.shipping_options[0].shipping_rate_data).toMatchObject({ type: 'fixed_amount', fixed_amount: { amount: 600, currency: 'eur' }, tax_behavior: 'inclusive' })
    expect(p.customer_update).toEqual({ name: 'auto', address: 'auto', shipping: 'auto' })

    stripe.complete(ok.json.sessionID, { collected_information: { shipping_details: { name: 'Bea Buyer', address: { line1: 'Str 1', city: 'Berlin', postal_code: '10115', country: 'DE' } } } })
    await webhook({ type: 'checkout.session.completed', data: { object: stripe.sessions.get(ok.json.sessionID) } })
    const order = (await ordersOf()).at(-1)
    expect(order.items[0].shippingStatus).toBe('pending')
    expect(order.shippingAddress).toMatchObject({ country: 'DE', city: 'Berlin' })
  })

  it('limited subscription: first payment, scheduled end after N cycles, then access ends when Stripe cancels it', async () => {
    const cartID = await cartWith(products.sub3)
    const { json } = await initiate(cartID)
    expect(stripe.createParams.at(-1)).toMatchObject({ mode: 'subscription' })
    expect(stripe.createParams.at(-1)!.invoice_creation).toBeUndefined()
    expect(stripe.createParams.at(-1)!.line_items[0].price_data.recurring).toEqual({ interval: 'month', interval_count: 1 })

    const session = stripe.complete(json.sessionID, { subscription: 'sub_test_1' })
    await webhook({ type: 'checkout.session.completed', data: { object: session } })
    const order = (await ordersOf()).at(-1)
    expect(order.items[0].stripeSubscriptionID).toBe('sub_test_1')
    const ent = (await entitlements()).find((e) => e.order === order.id)
    expect(ent.validityEnd).toBeNull()

    // active subscription event without an end -> Stripe gets a cancel_at after 3 payments
    await webhook({ type: 'customer.subscription.updated', data: { object: { id: 'sub_test_1', status: 'active', ended_at: null, cancel_at: null } } })
    const upd = stripe.subscriptionUpdates.at(-1)!
    expect(upd.id).toBe('sub_test_1')
    const expectedEnd = new Date(order.paidAt)
    expectedEnd.setUTCMonth(expectedEnd.getUTCMonth() + 3)
    expect(upd.params).toMatchObject({ cancel_at: Math.floor(expectedEnd.getTime() / 1000), proration_behavior: 'none' })

    // Stripe ends it -> the entitlement ends at that instant
    const ended = Math.floor(d('2027-01-15T00:00:00Z').getTime() / 1000)
    await webhook({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_test_1', status: 'canceled', ended_at: ended, cancel_at: null } } })
    const after = (await entitlements()).find((e) => e.order === order.id)
    expect(new Date(after.validityEnd)).toEqual(d('2027-01-15T00:00:00Z'))
  })

  it('subscription renewal invoices are recorded against the original order', async () => {
    const cartID = await cartWith(products.subOpen)
    const { json } = await initiate(cartID)
    const session = stripe.complete(json.sessionID, { subscription: 'sub_test_2' })
    await webhook({ type: 'checkout.session.completed', data: { object: session } })
    const order = (await ordersOf()).at(-1)

    await webhook({ type: 'invoice.paid', data: { object: { id: 'in_renewal_1', status: 'paid', payment_intent: 'pi_1', parent: { subscription_details: { subscription: 'sub_test_2' } } } } })
    const inv = (await b.payload.find({ collection: 'invoices', where: { stripeInvoiceID: { equals: 'in_renewal_1' } }, depth: 0 })).docs[0] as any
    expect(inv).toMatchObject({ order: order.id, status: 'paid', stripePaymentIntentID: 'pi_1' })
  })

  it('customer.updated stores the addresses Stripe holds', async () => {
    const user = (await b.payload.findByID({ collection: 'users', id: userId, depth: 0, overrideAccess: true })) as any
    expect(user.stripeCustomerID).toBeTruthy()
    await webhook({ type: 'customer.updated', data: { object: { id: user.stripeCustomerID, shipping: { name: 'Bea', address: { city: 'Graz' } }, address: { city: 'Wien' } } } })
    const after = (await b.payload.findByID({ collection: 'users', id: userId, depth: 0, overrideAccess: true })) as any
    expect(after.stripeAddresses).toMatchObject({ billing: { city: 'Wien' }, shipping: { address: { city: 'Graz' } } })
  })

  it('billing portal: members with a Stripe customer get a portal session, others a 404', async () => {
    const r = await api('/commerce/billing-portal', {}, authed())
    expect(r.status).toBe(200)
    expect(r.json.url).toMatch(/^https:\/\/billing\.stripe\.test\/cus_/)
    expect(stripe.portalSessions.at(-1)).toMatchObject({ return_url: 'http://localhost/account' })
    expect((await api('/commerce/billing-portal', {})).status).toBe(401)
  })

  it('invoice PDFs: Stripe invoices redirect to Stripe, uploaded legacy files to their file URL; only the owner or staff may open them', async () => {
    const stripeInvoice = (await b.payload.create({ collection: 'invoices', data: { order: (await ordersOf())[0].id, customer: userId, stripeInvoiceID: 'in_pdf_1', status: 'paid' } as never, overrideAccess: true })) as any
    const legacy = (await b.payload.create({ collection: 'invoices', data: { order: (await ordersOf())[0].id, customer: userId, file: 'invoices/Rechnung-2022-00001.pdf', status: 'paid' } as never, overrideAccess: true })) as any
    const stranger = (await b.payload.create({ collection: 'invoices', data: { order: (await ordersOf())[0].id, file: 'invoices/x.pdf', status: 'paid' } as never, overrideAccess: true })) as any
    stripe.invoicePdfs.set('in_pdf_1', 'https://pay.stripe.test/in_pdf_1.pdf')

    const get = async (id: number | string, withAuth = true) => {
      const res = await handleEndpoints({ config: b.payload.config, payloadInstanceCacheKey: b.dbName, request: new Request(`http://localhost/api/commerce/invoices/${id}/pdf`, { method: 'GET', headers: withAuth ? authed() : {} }) })
      return { status: res.status, location: res.headers.get('location') }
    }
    expect(await get(stripeInvoice.id)).toEqual({ status: 302, location: 'https://pay.stripe.test/in_pdf_1.pdf' })
    expect(await get(legacy.id)).toEqual({ status: 302, location: 'https://files.test/invoices/Rechnung-2022-00001.pdf' })
    expect((await get(stranger.id)).status).toBe(403)
    expect((await get(legacy.id, false)).status).toBe(401)
    expect((await get(999999)).status).toBe(404)
  })

})
