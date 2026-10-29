import { commerceAccessBridge } from '@daugtcom/payload-commerce/access'
import { createSeries, payloadAccess } from '@daugtcom/payload-access'
import { handleEndpoints } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { payloadCommerce } from '../src'
import { FakeStripe } from './support/fakeStripe'
import { boot, type Booted } from './support/harness'

describe('embedded checkout form: shipping is priced from the address entered in the form (fake Stripe)', () => {
  let b: Booted
  const stripe = new FakeStripe()
  let token: string
  let otherToken: string
  let userId: number | string
  let physical: number | string

  const api = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
    const res = await handleEndpoints({
      config: b.payload.config, payloadInstanceCacheKey: b.dbName,
      request: new Request(`http://localhost/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }),
    })
    return { status: res.status, json: (await res.json()) as any }
  }
  const as = (t: string) => ({ Authorization: `JWT ${t}` })
  const shipping = (t: string, sessionID: string, country: string) => api('/payments/stripe-checkout/shipping', { sessionID, shippingDetails: { address: { country } } }, as(t))

  beforeAll(async () => {
    const { collections, series } = createSeries({ parent: 'courses', items: 'lessons' })
    b = await boot({
      collections,
      plugins: [
        payloadAccess({ targetCollections: ['courses'], series: [series] }),
        payloadCommerce({
          accessBridge: commerceAccessBridge, accessTargets: ['courses'],
          shippingDefaults: { mode: 'dynamic', flatRate: 5, method: 'sum', allowedCountries: ['AT', 'DE'] },
          stripe: { secretKey: 'sk_test_fake', webhookSecret: 'whsec_fake', successUrl: 'http://localhost/ok?session_id={CHECKOUT_SESSION_ID}', cancelUrl: 'http://localhost/cancel', ...({ stripe: stripe.asStripe() } as object) },
        }),
      ],
    })
    const p = b.payload
    userId = (await p.create({ collection: 'users', data: { email: 'buyer@example.com', password: 'pw-pw-pw-1' } as never })).id
    await p.create({ collection: 'users', data: { email: 'other@example.com', password: 'pw-pw-pw-1' } as never })
    token = (await p.login({ collection: 'users', data: { email: 'buyer@example.com', password: 'pw-pw-pw-1' } })).token!
    otherToken = (await p.login({ collection: 'users', data: { email: 'other@example.com', password: 'pw-pw-pw-1' } })).token!
    const size = await p.create({ collection: 'shippingSizes', data: { name: 'S', rates: [{ country: 'AT', amount: 4 }, { country: 'DE', amount: 6 }], fallbackRate: 12 } as never, overrideAccess: true })
    physical = (await p.create({ collection: 'products', data: { title: 'Book', priceInEURENABLED: true, priceInEUR: 4900, inventory: 50, _status: 'published', commerce: { billingType: 'one_time', requiresShipping: true, shippingSize: size.id } } as never })).id
  }, 90_000)

  afterAll(async () => {
    await b?.close()
  })

  async function start() {
    const cart = await b.payload.create({ collection: 'carts', data: { customer: userId, currency: 'EUR', items: [{ product: physical, quantity: 1 }] } as never, overrideAccess: true })
    return api('/payments/stripe-checkout/initiate', { cartID: cart.id, billingAddress: {} }, as(token)) // no country: the form asks for it
  }

  it('creates an embedded session without knowing the country and returns the client secret', async () => {
    const r = await start()
    expect(r.status).toBe(200)
    expect(r.json.clientSecret).toMatch(/_secret_/)
    expect(r.json.url).toBeUndefined()
    const p = stripe.createParams.at(-1)!
    expect(p).toMatchObject({ ui_mode: 'form', return_url: 'http://localhost/ok?session_id={CHECKOUT_SESSION_ID}' })
    expect(p.success_url).toBeUndefined()
    expect(p.shipping_address_collection).toEqual({ allowed_countries: ['AT', 'DE'] })
    expect(p.shipping_options[0].shipping_rate_data.fixed_amount.amount).toBe(0) // placeholder until the address is known
  })

  it('prices the shipping for the entered address and refuses countries we do not ship to', async () => {
    const { json } = await start()
    expect((await shipping(token, json.sessionID, 'DE')).json).toEqual({ type: 'object', value: { succeeded: true } })
    expect(stripe.sessionUpdates.at(-1)!.params.shipping_options[0].shipping_rate_data).toMatchObject({ fixed_amount: { amount: 600, currency: 'eur' }, tax_behavior: 'inclusive' })
    await shipping(token, json.sessionID, 'AT')
    expect(stripe.sessionUpdates.at(-1)!.params.shipping_options[0].shipping_rate_data.fixed_amount.amount).toBe(400)

    const before = stripe.sessionUpdates.length
    expect((await shipping(token, json.sessionID, 'FR')).json).toMatchObject({ type: 'error' })
    expect(stripe.sessionUpdates).toHaveLength(before)
  })

  it('only the buyer of the checkout may reprice it', async () => {
    const { json } = await start()
    const before = stripe.sessionUpdates.length
    expect((await shipping(otherToken, json.sessionID, 'DE')).status).toBe(404)
    expect((await api('/payments/stripe-checkout/shipping', { sessionID: json.sessionID, shippingDetails: { address: { country: 'DE' } } })).status).toBe(401)
    expect(stripe.sessionUpdates).toHaveLength(before)
  })
})
