import type { Payload, PayloadRequest } from 'payload'
import type Stripe from 'stripe'
import { addUnits, type DurationUnit } from '../../access/grantWindow'
import { stripeOf, type StripeCheckoutConfig } from './config'

type Id = string | number
type Doc = Record<string, unknown> & { id: Id }
const idOf = (v: unknown): Id => (v && typeof v === 'object' ? (v as { id: Id }).id : (v as Id))

/** Subscription events can arrive before the order exists (webhook order). Wait a little before giving up and letting Stripe retry. */
export async function findOrderBySubscription(payload: Payload, req: PayloadRequest, ordersSlug: string, subscriptionID: string, waitMs = 10_000): Promise<Doc | null> {
  const deadline = Date.now() + waitMs
  do {
    const r = await payload.find({ collection: ordersSlug as never, where: { 'items.stripeSubscriptionID': { equals: subscriptionID } }, limit: 1, depth: 0, overrideAccess: true, req })
    if (r.docs[0]) return r.docs[0] as unknown as Doc
    if (Date.now() >= deadline) return null
    await new Promise((r) => setTimeout(r, 500))
  } while (true)
}

/** Subscription ended: `ended_at`, else the scheduled `cancel_at`. */
export const subscriptionEnd = (s: Pick<Stripe.Subscription, 'ended_at' | 'cancel_at'>): Date | null =>
  s.ended_at ? new Date(s.ended_at * 1000) : s.cancel_at ? new Date(s.cancel_at * 1000) : null

/** Limited subscriptions end after N payments: paid date + interval × iterations. */
export function limitedSubscriptionEnd(o: { paidAt: Date; intervalCount: number; intervalUnit: DurationUnit; iterations: number }): Date {
  let end = o.paidAt
  for (let i = 0; i < o.iterations; i++) end = addUnits(end, o.intervalCount, o.intervalUnit)
  return end
}

/** customer.subscription.updated | deleted */
export async function handleSubscriptionEvent(req: PayloadRequest, cfg: StripeCheckoutConfig, sub: Stripe.Subscription): Promise<void> {
  const { payload } = req
  const order = await findOrderBySubscription(payload, req, cfg.ordersSlug, sub.id)
  if (!order) throw new Error(`No order for subscription ${sub.id} yet`)

  const item = ((order.items as { product: unknown; stripeSubscriptionID?: string }[]) ?? []).find((i) => i.stripeSubscriptionID === sub.id)
  if (!item) return
  const productID = idOf(item.product)
  const product = (await payload.findByID({ collection: cfg.productsSlug as never, id: productID, depth: 0, overrideAccess: true, req })) as unknown as { commerce?: { durationType?: string; iterations?: number; intervalCount?: number; intervalUnit?: DurationUnit } }

  let endsAt = subscriptionEnd(sub)
  if (!endsAt) {
    const c = product.commerce ?? {}
    if (c.durationType !== 'limited' || !c.iterations || !order.paidAt) return
    endsAt = limitedSubscriptionEnd({ paidAt: new Date(order.paidAt as string), intervalCount: c.intervalCount ?? 1, intervalUnit: c.intervalUnit ?? 'month', iterations: c.iterations })
    await stripeOf(cfg).subscriptions.update(sub.id, { cancel_at: Math.floor(endsAt.getTime() / 1000), proration_behavior: 'none' })
  }

  if (!cfg.grantsAccess || !cfg.accessBridge) return
  const bridge = { productsSlug: cfg.productsSlug, usersSlug: cfg.usersSlug, entitlementsSlug: cfg.entitlementsSlug }
  if (sub.status === 'canceled') await cfg.accessBridge.endSubscriptionAccess(payload, bridge, { orderId: order.id, productId: productID, endsAt, req })
  else await cfg.accessBridge.syncOrderEntitlements(order as never, req, bridge)
}
