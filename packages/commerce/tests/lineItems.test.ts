import { describe, expect, it } from 'vitest'
import { buildLineItems, type CheckoutProduct } from '../src/adapters/stripeCheckout/lineItems'

const product = (over: Partial<CheckoutProduct> = {}): CheckoutProduct => ({
  id: 1,
  title: 'Course',
  priceCents: 4900,
  billingType: 'one_time',
  requiresShipping: false,
  multi: false,
  ...over,
})

describe('buildLineItems', () => {
  it('builds inline tax-inclusive prices, no Stripe catalog needed', () => {
    const r = buildLineItems([{ product: product(), quantity: 1 }], 'EUR')
    expect(r.mode).toBe('payment')
    expect(r.lineItems).toEqual([
      {
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: 4900,
          tax_behavior: 'inclusive',
          product_data: { name: 'Course', metadata: { productID: '1' } },
        },
      },
    ])
  })

  it('subscription mode with the recurrence on the price', () => {
    const r = buildLineItems([{ product: product({ billingType: 'recurring', intervalCount: 3, intervalUnit: 'month' }), quantity: 1 }], 'EUR')
    expect(r.mode).toBe('subscription')
    expect(r.lineItems[0]!.price_data.recurring).toEqual({ interval: 'month', interval_count: 3 })
  })

  it('a one-time item next to a subscription is allowed (Stripe adds it to the first invoice)', () => {
    const r = buildLineItems([{ product: product({ id: 1, billingType: 'recurring', intervalCount: 1, intervalUnit: 'year' }), quantity: 1 }, { product: product({ id: 2 }), quantity: 1 }], 'EUR')
    expect(r.mode).toBe('subscription')
    expect(r.lineItems).toHaveLength(2)
    expect(r.lineItems[1]!.price_data.recurring).toBeUndefined()
  })

  it('refuses two subscriptions in one checkout', () => {
    const sub = (id: number) => ({ product: product({ id, billingType: 'recurring', intervalCount: 1, intervalUnit: 'month' }), quantity: 1 })
    expect(() => buildLineItems([sub(1), sub(2)], 'EUR')).toThrow(/one subscription/i)
  })

  it('refuses external products and quantities above 1 unless the product allows several', () => {
    expect(() => buildLineItems([{ product: product({ externalUrl: 'https://x.test' }), quantity: 1 }], 'EUR')).toThrow(/external/i)
    expect(() => buildLineItems([{ product: product(), quantity: 2 }], 'EUR')).toThrow(/quantity/i)
    expect(buildLineItems([{ product: product({ multi: true }), quantity: 3 }], 'EUR').lineItems[0]!.quantity).toBe(3)
  })

  it('carries the tax code (product, else default) and reports shipping/subscription flags', () => {
    const r = buildLineItems([{ product: product({ taxCode: 'txcd_1', requiresShipping: true }), quantity: 1 }, { product: product({ id: 2 }), quantity: 1 }], 'EUR', 'txcd_default')
    expect(r.lineItems[0]!.price_data.product_data.tax_code).toBe('txcd_1')
    expect(r.lineItems[1]!.price_data.product_data.tax_code).toBe('txcd_default')
    expect(r.hasShipping).toBe(true)
    expect(r.hasSubscription).toBe(false)
  })

  it('refuses an empty cart and unpriced products', () => {
    expect(() => buildLineItems([], 'EUR')).toThrow(/empty/i)
    expect(() => buildLineItems([{ product: product({ priceCents: 0 }), quantity: 1 }], 'EUR')).toThrow(/price/i)
  })
})
