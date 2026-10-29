/** Checkout line items from cart products. Pure. Prices are inline (price_data), so no product/price sync with Stripe is needed. */

export interface CheckoutProduct {
  id: string | number
  title: string
  /** Minor units, tax inclusive. */
  priceCents: number
  billingType: 'one_time' | 'recurring'
  intervalCount?: number | null
  intervalUnit?: 'day' | 'week' | 'month' | 'year' | null
  requiresShipping: boolean
  multi: boolean
  externalUrl?: string | null
  taxCode?: string | null
  /** Extra Stripe product metadata (set by line resolvers). */
  metadata?: Record<string, string>
}

export interface LineItem {
  quantity: number
  price_data: {
    currency: string
    unit_amount: number
    tax_behavior: 'inclusive'
    product_data: { name: string; metadata: { productID: string }; tax_code?: string }
    recurring?: { interval: 'day' | 'week' | 'month' | 'year'; interval_count: number }
  }
}

export interface BuiltLineItems {
  lineItems: LineItem[]
  mode: 'payment' | 'subscription'
  hasShipping: boolean
  hasSubscription: boolean
}

export function buildLineItems(items: readonly { product: CheckoutProduct; quantity: number }[], currency: string, defaultTaxCode?: string): BuiltLineItems {
  if (items.length === 0) throw new Error('The cart is empty')

  let subscriptions = 0
  const lineItems = items.map(({ product, quantity }): LineItem => {
    if (product.externalUrl) throw new Error(`"${product.title}" is an external product and cannot be bought here`)
    if (!(product.priceCents > 0)) throw new Error(`"${product.title}" has no price in ${currency}`)
    if (quantity > 1 && !product.multi) throw new Error(`"${product.title}" can only be bought once at a time (quantity ${quantity})`)

    const taxCode = product.taxCode || defaultTaxCode
    const line: LineItem = {
      quantity,
      price_data: {
        currency: currency.toLowerCase(),
        unit_amount: product.priceCents,
        tax_behavior: 'inclusive',
        product_data: { name: product.title, metadata: { ...product.metadata, productID: String(product.id) }, ...(taxCode ? { tax_code: taxCode } : {}) },
      },
    }
    if (product.billingType === 'recurring') {
      subscriptions++
      line.price_data.recurring = { interval: product.intervalUnit ?? 'month', interval_count: product.intervalCount ?? 1 }
    }
    return line
  })

  if (subscriptions > 1) throw new Error('Only one subscription can be bought at a time')
  return { lineItems, mode: subscriptions ? 'subscription' : 'payment', hasShipping: items.some((i) => i.product.requiresShipping), hasSubscription: subscriptions > 0 }
}
