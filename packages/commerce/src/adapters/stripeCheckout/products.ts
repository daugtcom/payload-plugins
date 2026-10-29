import type { PayloadRequest } from 'payload'
import { COMMERCE_SETTINGS_SLUG } from '../../globals/commerceSettings'
import type { ShippingLine, ShippingSettings, ShippingSize } from '../../shipping/calculator'
import { resolversOf, type ResolverItem } from '../../cart/resolvers'
import type { CheckoutProduct } from './lineItems'

type Id = string | number

interface CartItemLike {
  product: Id | { id: Id }
  quantity: number
  meta?: Record<string, unknown> | null
}

export interface LoadedItem {
  product: CheckoutProduct
  quantity: number
  size?: ShippingSize | null
}

const idOf = (v: unknown): Id => (v && typeof v === 'object' ? (v as { id: Id }).id : (v as Id))

/** Reads the cart's products with price (in the cart currency), billing, shipping and tax data. */
export async function loadItems(req: PayloadRequest, o: { items: readonly CartItemLike[]; currency: string; productsSlug: string; shippingSizesSlug: string }): Promise<LoadedItem[]> {
  const priceField = `priceIn${o.currency.toUpperCase()}`
  const out: LoadedItem[] = []

  for (const item of o.items) {
    const id = idOf(item.product)
    const doc = (await req.payload.findByID({ collection: o.productsSlug as never, id, depth: 0, overrideAccess: true, req })) as unknown as Record<string, unknown> & {
      title?: string
      commerce?: Record<string, unknown>
    }
    const c = doc.commerce ?? {}
    const enabled = doc[`${priceField}Enabled`]
    const priceCents = enabled === false ? 0 : Number(doc[priceField] ?? 0)

    let size: ShippingSize | null = null
    if (c.requiresShipping && c.shippingSize) {
      const s = (await req.payload.findByID({ collection: o.shippingSizesSlug as never, id: idOf(c.shippingSize), depth: 0, overrideAccess: true, req }).catch(() => null)) as { rates?: { country: string; amount: number }[]; fallbackRate?: number | null } | null
      if (s) size = { rates: s.rates ?? [], fallbackRate: s.fallbackRate ?? null }
    }

    // another plugin may price and label the line (see cart/resolvers.ts)
    let title = String(doc.title ?? `Product ${id}`)
    let price = priceCents
    let metadata: Record<string, string> | undefined
    for (const resolve of resolversOf(req)) {
      const r = await resolve({ req, item: item as ResolverItem, base: { priceCents: price, title } })
      if (!r) continue
      if (r.priceCents !== undefined) price = r.priceCents
      if (r.title) title = r.title
      if (r.metadata) metadata = { ...metadata, ...r.metadata }
    }

    out.push({
      quantity: item.quantity,
      size,
      product: {
        id,
        title,
        priceCents: price,
        ...(metadata ? { metadata } : {}),
        billingType: (c.billingType as CheckoutProduct['billingType']) ?? 'one_time',
        intervalCount: (c.intervalCount as number | undefined) ?? 1,
        intervalUnit: (c.intervalUnit as CheckoutProduct['intervalUnit']) ?? 'month',
        requiresShipping: Boolean(c.requiresShipping),
        multi: Boolean(c.multi),
        externalUrl: (c.externalUrl as string | undefined) || null,
        taxCode: (c.taxCode as string | undefined) || null,
      },
    })
  }
  return out
}

export const toShippingLines = (items: readonly LoadedItem[]): ShippingLine[] => items.map((i) => ({ quantity: i.quantity, requiresShipping: i.product.requiresShipping, size: i.size }))

/** Shipping rules from the settings global (staff-editable), falling back to the plugin defaults. */
export async function loadShippingSettings(req: PayloadRequest, defaults: Partial<ShippingSettings> = {}): Promise<ShippingSettings> {
  const g = (await req.payload.findGlobal({ slug: COMMERCE_SETTINGS_SLUG as never, depth: 0, overrideAccess: true, req }).catch(() => null)) as { shipping?: Partial<ShippingSettings> } | null
  const s = g?.shipping ?? {}
  return {
    mode: s.mode ?? defaults.mode ?? 'dynamic',
    flatRate: s.flatRate ?? defaults.flatRate ?? null,
    method: s.method ?? defaults.method ?? 'sum',
    allowedCountries: s.allowedCountries?.length ? s.allowedCountries : (defaults.allowedCountries ?? []),
  }
}
