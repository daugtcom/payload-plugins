import { commerceAccessBridge } from '@daugtcom/payload-commerce/access'
import { payloadAccess, createSeries, getAccess } from '@daugtcom/payload-access'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLocalReq, handleEndpoints } from 'payload'
import { addItem, clearCart, removeItem } from '@payloadcms/plugin-ecommerce'
import { payloadCommerce } from '../src'
import { endSubscriptionAccess } from '../src/access/bridge'
import { boot, type Booted } from './support/harness'

const d = (iso: string) => new Date(iso)

describe('payloadCommerce on a real Payload + Postgres (with payload-access)', () => {
  let b: Booted
  let userId: number | string
  let courseId: number | string
  let postId: number | string
  let productIds: { course1y: number | string; postForever: number | string; fixedDates: number | string }

  const order = (data: Record<string, unknown>, context: Record<string, unknown> = {}) =>
    b.payload.create({
      collection: 'orders',
      data: { customer: userId, currency: 'EUR', amount: 1000, status: 'processing', ...data } as never,
      overrideAccess: true,
      context,
    })

  const entitlementsOf = async (orderId: number | string) =>
    (await b.payload.find({ collection: 'entitlements', where: { order: { equals: orderId } }, depth: 0, limit: 0, pagination: false })).docs as unknown as {
      id: number | string
      validityStart?: string | null
      validityEnd?: string | null
      keepAccessibleAfterExpiry?: boolean
      target: { relationTo: string; value: number | string }
    }[]

  beforeAll(async () => {
    const { collections, series } = createSeries({ parent: 'courses', items: 'lessons' })
    b = await boot({
      collections,
      plugins: [payloadAccess({ targetCollections: ['courses', 'lessons'], series: [series] }), payloadCommerce({ accessBridge: commerceAccessBridge, accessTargets: ['courses', 'lessons'] })],
    })
    const p = b.payload
    userId = (await p.create({ collection: 'users', data: { email: 'buyer@example.com', password: 'pw-pw-pw-1' } as never })).id
    courseId = (await p.create({ collection: 'courses', data: { title: 'C', slug: 'c', _status: 'published' } as never })).id
    postId = (await p.create({ collection: 'lessons', data: { title: 'L', slug: 'l', series: [courseId], publishedAt: '2026-01-01T00:00:00Z', _status: 'published' } as never })).id

    const product = (title: string, accessItems: unknown[]) =>
      p.create({
        collection: 'products',
        data: { title, priceInEURENABLED: true, priceInEUR: 4900, inventory: 100, _status: 'published', commerce: { billingType: 'one_time', accessItems } } as never,
      })
    productIds = {
      course1y: (await product('Course 1y', [{ target: { relationTo: 'courses', value: courseId }, mode: 'duration', duration: 1, durationUnit: 'year', keepAccessibleAfterExpiry: true, keepUnlockedWhenActive: true }])).id,
      postForever: (await product('Post', [{ target: { relationTo: 'lessons', value: postId }, mode: 'permanent' }])).id,
      fixedDates: (await product('Dates', [{ target: { relationTo: 'courses', value: courseId }, mode: 'dates', start: '2026-03-01T00:00:00Z', end: '2026-06-01T00:00:00Z' }])).id,
    }
  }, 90_000)

  afterAll(async () => {
    await b?.close()
  })

  it('uses native cart mutations without Stripe configured and stores totals after quantity rules', async () => {
    const user = await b.payload.findByID({ collection: 'users', id: userId })
    const req = await createLocalReq({ user: { ...user, collection: 'users' } }, b.payload)
    const cart = await b.payload.create({ collection: 'carts', data: { customer: userId, currency: 'EUR', items: [{ product: productIds.postForever, quantity: 3 }] } as never }) as any
    expect(cart.items[0].quantity).toBe(1)
    expect(cart.subtotal).toBe(4900)
    const added = await addItem({ payload: b.payload, req, cartsSlug: 'carts', cartID: cart.id, item: { product: productIds.postForever }, quantity: 2 })
    expect((added.cart as any).items[0].quantity).toBe(1)
    expect((added.cart as any).subtotal).toBe(4900)
    const removed = await removeItem({ payload: b.payload, req, cartsSlug: 'carts', cartID: cart.id, itemID: (added.cart as any).items[0].id })
    expect((removed.cart as any).items).toEqual([])
    expect((removed.cart as any).subtotal).toBe(0)
  })

  it('numbers orders from 1000 and keeps a given (imported) number, continuing behind it', async () => {
    const first = await order({ items: [{ product: productIds.postForever, quantity: 1 }], paymentStatus: 'pending' })
    const second = await order({ items: [{ product: productIds.postForever, quantity: 1 }], paymentStatus: 'pending' })
    const imported = await order({ items: [{ product: productIds.postForever, quantity: 1 }], paymentStatus: 'pending', orderNumber: 10_303 })
    const after = await order({ items: [{ product: productIds.postForever, quantity: 1 }], paymentStatus: 'pending' })
    expect((first as unknown as { orderNumber: number }).orderNumber).toBe(1000)
    expect((second as unknown as { orderNumber: number }).orderNumber).toBe(1001)
    expect((imported as unknown as { orderNumber: number }).orderNumber).toBe(10_303)
    expect((after as unknown as { orderNumber: number }).orderNumber).toBe(10_304)
  })

  it('a paid order grants what its products unlock, with the window and flags of each rule', async () => {
    const o = await order({ items: [{ product: productIds.course1y, quantity: 1 }], paymentStatus: 'paid', paidAt: '2026-02-10T09:00:00Z' })
    const ents = await entitlementsOf(o.id)
    expect(ents).toHaveLength(1)
    expect(ents[0]).toMatchObject({ target: { relationTo: 'courses', value: courseId }, keepAccessibleAfterExpiry: true })
    expect(new Date(ents[0]!.validityStart!)).toEqual(d('2026-02-10T09:00:00Z'))
    expect(new Date(ents[0]!.validityEnd!)).toEqual(d('2027-02-10T09:00:00Z'))

    const access = getAccess(b.payload)
    expect(await access.canAccess(userId, { relationTo: 'courses', value: courseId }, d('2026-06-01T00:00:00Z'))).toBe(true)
  })

  it('an unpaid order grants nothing; flipping it to failed revokes what a paid state granted', async () => {
    const pending = await order({ items: [{ product: productIds.postForever, quantity: 1 }], paymentStatus: 'pending' })
    expect(await entitlementsOf(pending.id)).toHaveLength(0)

    const paid = await order({ items: [{ product: productIds.postForever, quantity: 1 }], paymentStatus: 'paid' })
    expect(await entitlementsOf(paid.id)).toHaveLength(1)

    await b.payload.update({ collection: 'orders', id: paid.id, data: { paymentStatus: 'failed' } as never, overrideAccess: true })
    expect(await entitlementsOf(paid.id)).toHaveLength(0)
  })

  it('re-saving a paid order does not duplicate its entitlements', async () => {
    const o = await order({ items: [{ product: productIds.fixedDates, quantity: 1 }], paymentStatus: 'paid' })
    await b.payload.update({ collection: 'orders', id: o.id, data: { status: 'completed' } as never, overrideAccess: true })
    const ents = await entitlementsOf(o.id)
    expect(ents).toHaveLength(1)
    expect(new Date(ents[0]!.validityEnd!)).toEqual(d('2026-06-01T00:00:00Z'))
  })

  it('preserves purchased access when product rules change and the paid order is saved again', async () => {
    const product = await b.payload.create({ collection: 'products', data: {
      title: 'Original access', priceInEURENABLED: true, priceInEUR: 4900, inventory: 100, _status: 'published',
      commerce: { billingType: 'one_time', accessItems: [{ target: { relationTo: 'lessons', value: postId }, mode: 'permanent' }] },
    } as never })
    const o = await order({ items: [{ product: product.id, quantity: 1 }], paymentStatus: 'paid' })
    const original = await entitlementsOf(o.id)
    expect(original).toHaveLength(1)
    await b.payload.update({ collection: 'products', id: product.id, data: { commerce: { billingType: 'one_time', accessItems: [] } } as never })
    expect(await entitlementsOf(o.id)).toEqual(original)
    await b.payload.update({ collection: 'orders', id: o.id, data: { status: 'completed' } as never, overrideAccess: true })
    expect(await entitlementsOf(o.id)).toEqual(original)
    const req = await createLocalReq({}, b.payload)
    await commerceAccessBridge.syncOrderEntitlements(o as never, req, { productsSlug: 'products', usersSlug: 'users', entitlementsSlug: 'entitlements' })
    expect(await entitlementsOf(o.id)).toEqual(original)
    await expect(b.payload.update({ collection: 'orders', id: o.id, data: { items: [] } as never, overrideAccess: true })).rejects.toThrow(/paid order/i)
    await b.payload.update({ collection: 'orders', id: o.id, data: { paymentStatus: 'failed' } as never, overrideAccess: true })
    expect(await entitlementsOf(o.id)).toHaveLength(0)
  })

  it('imported orders (skipEntitlementSync) leave existing entitlements alone', async () => {
    const o = await order({ items: [{ product: productIds.postForever, quantity: 1 }], paymentStatus: 'paid' }, { skipEntitlementSync: true })
    expect(await entitlementsOf(o.id)).toHaveLength(0)
  })

  it('fails rather than silently skipping access if a purchased product cannot be loaded', async () => {
    const req = await createLocalReq({}, b.payload)
    await expect(commerceAccessBridge.syncOrderEntitlements(
      { id: 999999, customer: userId, paymentStatus: 'paid', items: [{ product: 999999 }] }, req,
      { productsSlug: 'products', usersSlug: 'users', entitlementsSlug: 'entitlements' },
    )).rejects.toThrow()
  })

  it('ending a subscription ends the windows its order granted', async () => {
    const o = await order({ items: [{ product: productIds.course1y, quantity: 1 }], paymentStatus: 'paid', paidAt: '2026-01-01T00:00:00Z' })
    await endSubscriptionAccess(b.payload, { productsSlug: 'products', usersSlug: 'users', entitlementsSlug: 'entitlements' }, { orderId: o.id, productId: productIds.course1y, endsAt: d('2026-04-15T00:00:00Z') })
    const ents = await entitlementsOf(o.id)
    expect(new Date(ents[0]!.validityEnd!)).toEqual(d('2026-04-15T00:00:00Z'))
    expect(new Date(ents[0]!.validityStart!)).toEqual(d('2026-01-01T00:00:00Z'))
  })

  it('ends only the subscription grants even if its product rules were removed', async () => {
    const sub = await b.payload.create({ collection: 'products', data: {
      title: 'Changing subscription', priceInEURENABLED: true, priceInEUR: 4900, inventory: 100, _status: 'published',
      commerce: { billingType: 'one_time', accessItems: [{ target: { relationTo: 'courses', value: courseId }, mode: 'permanent' }] },
    } as never })
    const o = await order({ items: [{ product: sub.id, quantity: 1 }, { product: productIds.postForever, quantity: 1 }], paymentStatus: 'paid' })
    await b.payload.update({ collection: 'products', id: sub.id, data: { commerce: { billingType: 'one_time', accessItems: [] } } as never })
    await endSubscriptionAccess(b.payload, { productsSlug: 'products', usersSlug: 'users', entitlementsSlug: 'entitlements' }, { orderId: o.id, productId: sub.id, endsAt: d('2026-04-15T00:00:00Z') })
    const ents = await entitlementsOf(o.id)
    expect(new Date(ents.find((e) => e.target.relationTo === 'courses')!.validityEnd!)).toEqual(d('2026-04-15T00:00:00Z'))
    expect(ents.find((e) => e.target.relationTo === 'lessons')!.validityEnd).toBeNull()
  })

  it('the cart keeps one subscription (the newest) and caps quantity unless the product is multi', async () => {
    const p = b.payload
    const make = (title: string, commerce: Record<string, unknown>) => p.create({ collection: 'products', data: { title, priceInEURENABLED: true, priceInEUR: 1000, inventory: 5, _status: 'published', commerce } as never })
    const subA = await make('Sub A', { billingType: 'recurring', intervalCount: 1, intervalUnit: 'month' })
    const subB = await make('Sub B', { billingType: 'recurring', intervalCount: 1, intervalUnit: 'month' })
    const multi = await make('Multi', { billingType: 'one_time', multi: true })
    const cart = (await p.create({
      collection: 'carts',
      data: { customer: userId, currency: 'EUR', items: [{ product: subA.id, quantity: 1 }, { product: productIds.postForever, quantity: 4 }, { product: multi.id, quantity: 4 }, { product: subB.id, quantity: 1 }] } as never,
      overrideAccess: true,
    })) as unknown as { id: number | string; subtotal: number; items: { product: number | string; quantity: number }[] }
    expect(cart.items.map((i) => [typeof i.product === 'object' ? (i.product as { id: number | string }).id : i.product, i.quantity])).toEqual([[productIds.postForever, 1], [multi.id, 4], [subB.id, 1]])
    expect(cart.subtotal).toBe(9900)
    const stored = await p.findByID({ collection: 'carts', id: cart.id, depth: 0 }) as any
    expect(stored.subtotal).toBe(9900)
    const user = await p.findByID({ collection: 'users', id: userId })
    const req = await createLocalReq({ user: { ...user, collection: 'users' } }, p)
    const replaced = await addItem({ payload: p, req, cartsSlug: 'carts', cartID: cart.id, item: { product: subA.id } })
    expect((replaced.cart as any).subtotal).toBe(9900)
    expect((replaced.cart as any).items.at(-1).product).toBe(subA.id)
    const cleared = await clearCart({ payload: p, req, cartsSlug: 'carts', cartID: cart.id })
    expect((cleared.cart as any).subtotal).toBe(0)
  })

  it('restores only the newest unpurchased cart on the customer join', async () => {
    const customer = await b.payload.create({ collection: 'users', data: { email: 'restore@example.com', password: 'restore-password' } as never })
    await b.payload.create({ collection: 'carts', data: { customer: customer.id, currency: 'EUR', createdAt: '2026-01-01T00:00:00Z' } as never })
    const latest = await b.payload.create({ collection: 'carts', data: { customer: customer.id, currency: 'EUR', createdAt: '2026-02-01T00:00:00Z' } as never })
    await b.payload.create({ collection: 'carts', data: { customer: customer.id, currency: 'EUR', purchasedAt: new Date().toISOString(), createdAt: '2026-03-01T00:00:00Z' } as never })
    const restored = await b.payload.findByID({ collection: 'users', id: customer.id, depth: 0, select: { cart: true } as never }) as any
    expect(restored.cart.docs).toEqual([latest.id])
  })

  it('rejects guest cart creation and external products through native cart operations', async () => {
    await expect(b.payload.create({ collection: 'carts', data: { currency: 'EUR' } as never, overrideAccess: false })).rejects.toThrow()
    const external = await b.payload.create({ collection: 'products', data: { title: 'External', priceInEURENABLED: true, priceInEUR: 100, inventory: 5, _status: 'published', commerce: { externalUrl: 'https://example.com/shop' } } as never })
    const user = await b.payload.findByID({ collection: 'users', id: userId })
    const req = await createLocalReq({ user: { ...user, collection: 'users' } }, b.payload)
    const cart = await b.payload.create({ collection: 'carts', data: { customer: userId, currency: 'EUR' } as never })
    await expect(addItem({ payload: b.payload, req, cartsSlug: 'carts', cartID: cart.id, item: { product: external.id } })).rejects.toThrow(/external/i)
  })

  it('native cart routes assign the logged-in owner and refuse another customer', async () => {
    const customer = await b.payload.create({ collection: 'users', data: { email: 'owner@example.com', password: 'owner-password' } as never })
    const { token } = await b.payload.login({ collection: 'users', data: { email: 'owner@example.com', password: 'owner-password' } })
    const call = (path: string, body: unknown, authenticated = true) => handleEndpoints({ config: b.payload.config, payloadInstanceCacheKey: b.dbName, request: new Request(`http://localhost/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(authenticated ? { Authorization: `JWT ${token}` } : {}) }, body: JSON.stringify(body) }) })
    expect((await call('/carts', { currency: 'EUR' }, false)).status).toBe(403)
    const created = await call('/carts', { customer: userId, currency: 'EUR', items: [{ product: productIds.postForever, quantity: 3 }] })
    expect(created.status).toBe(201)
    const cart = (await created.json()).doc
    expect(typeof cart.customer === 'object' ? cart.customer.id : cart.customer).toBe(customer.id)
    expect(cart.subtotal).toBe(4900)
    const otherCart = await b.payload.create({ collection: 'carts', data: { customer: userId, currency: 'EUR' } as never })
    expect((await call(`/carts/${otherCart.id}/add-item`, { item: { product: productIds.postForever } })).status).toBe(404)
    const added = await call(`/carts/${cart.id}/add-item`, { item: { product: productIds.postForever }, quantity: 3 })
    expect(added.status).toBe(200)
    const stored = await b.payload.findByID({ collection: 'carts', id: cart.id, depth: 0 }) as any
    expect(stored.items[0].quantity).toBe(1)
    expect(stored.subtotal).toBe(4900)
  })

  it('fails loudly when products should grant access but payload-access is missing', async () => {
    await expect(
      boot({ collections: [], plugins: [payloadCommerce({ accessBridge: commerceAccessBridge, accessTargets: ['courses'] })] }).then((x) => x.close()),
    ).rejects.toThrow(/payloadAccess\(\) before payloadCommerce\(\)/)
  })
})
