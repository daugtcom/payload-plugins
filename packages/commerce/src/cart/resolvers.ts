import type { PayloadRequest } from 'payload'

type Id = string | number

/** A cart line as a line resolver sees it. `meta` is whatever another plugin stored on the line (e.g. a booking id). */
export interface ResolverItem {
  product: Id | { id: Id }
  quantity: number
  meta?: Record<string, unknown> | null
}

export interface LineResolverContext {
  req: PayloadRequest
  item: ResolverItem
  base: { priceCents: number; title: string }
}

export interface LineResolverResult {
  /** Replaces the product's price (minor units, tax inclusive) for this line. */
  priceCents?: number
  title?: string
  /** Merged into the Stripe line item's product metadata. Values are strings. */
  metadata?: Record<string, string>
}

/** Lets another plugin price and label a cart line (appointments: price depends on the chosen options). Return nothing to leave the line as it is. */
export type LineResolver = (ctx: LineResolverContext) => Promise<LineResolverResult | void> | LineResolverResult | void

/** Resolvers live in `config.custom` so plugins can register without the site wiring them: `custom.daugtCommerceLineResolvers.push(fn)`. */
export const LINE_RESOLVERS_KEY = 'daugtCommerceLineResolvers'

export const resolversOf = (req: PayloadRequest): LineResolver[] => ((req.payload.config.custom as Record<string, unknown> | undefined)?.[LINE_RESOLVERS_KEY] as LineResolver[] | undefined) ?? []
