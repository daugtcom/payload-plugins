import type { Payload, PayloadRequest } from 'payload'
import { getAccess, type AccessService } from '@daugtcom/payload-access'
import { applySubscriptionEnd, computeGrantWindow, type AccessRule } from './grantWindow'

type Id = string | number

interface RuleDoc {
  enabled?: boolean | null
  target: { relationTo: string; value: Id | { id: Id } }
  mode: AccessRule['mode']
  permanentFromPaymentDate?: boolean | null
  duration?: number | null
  durationUnit?: AccessRule['durationUnit']
  start?: string | null
  end?: string | null
  keepAccessibleAfterExpiry?: boolean | null
  keepUnlockedWhenActive?: boolean | null
}

const idOf = (v: unknown): Id => (v && typeof v === 'object' ? (v as { id: Id }).id : (v as Id))

export function toRule(r: RuleDoc): AccessRule {
  return {
    mode: r.mode,
    permanentFromPaymentDate: Boolean(r.permanentFromPaymentDate),
    duration: r.duration,
    durationUnit: r.durationUnit,
    start: r.start ? new Date(r.start) : null,
    end: r.end ? new Date(r.end) : null,
    keepAccessibleAfterExpiry: Boolean(r.keepAccessibleAfterExpiry),
    keepUnlockedWhenActive: Boolean(r.keepUnlockedWhenActive),
  }
}

import type { BridgeConfig, OrderDoc } from './contracts'

async function customerOf(payload: Payload, order: OrderDoc, usersSlug: string, req?: PayloadRequest): Promise<Id | null> {
  if (order.customer) return idOf(order.customer)
  if (!order.customerEmail) return null
  // guest checkout: attach to an existing member with the same email, otherwise nothing to unlock
  const res = await payload.find({ collection: usersSlug as never, where: { email: { equals: order.customerEmail } }, limit: 1, depth: 0, overrideAccess: true, req })
  return (res.docs[0] as { id: Id } | undefined)?.id ?? null
}

async function rulesOf(payload: Payload, productsSlug: string, productId: Id, req?: PayloadRequest): Promise<RuleDoc[]> {
  const product = (await payload.findByID({ collection: productsSlug as never, id: productId, depth: 0, overrideAccess: true, req }).catch(() => null)) as { commerce?: { accessItems?: RuleDoc[] } } | null
  return (product?.commerce?.accessItems ?? []).filter((r) => r.enabled !== false)
}

/** Revoke everything an order granted. */
export async function revokeForOrder(access: AccessService, payload: Payload, cfg: BridgeConfig, orderId: Id, req?: PayloadRequest): Promise<void> {
  const res = await payload.find({ collection: cfg.entitlementsSlug as never, where: { order: { equals: orderId } }, limit: 0, pagination: false, depth: 0, overrideAccess: true, req })
  for (const e of res.docs as unknown as { id: Id }[]) await access.revoke(e.id, req)
}

/**
 * Entitlements follow the order: on every save, drop what the order granted and regrant it if the order is paid.
 * Orders stay editable by staff and the result always matches the order's current state.
 * Skipped when `req.context.skipEntitlementSync` is set (the importer copies entitlements verbatim).
 */
export async function syncOrderEntitlements(order: OrderDoc, req: PayloadRequest, cfg: BridgeConfig): Promise<void> {
  if ((req.context as { skipEntitlementSync?: boolean } | undefined)?.skipEntitlementSync) return
  const payload = req.payload
  const access = getAccess(payload)

  await revokeForOrder(access, payload, cfg, order.id, req)
  if (order.paymentStatus !== 'paid') return

  const userId = await customerOf(payload, order, cfg.usersSlug, req)
  if (userId === null) return

  const paidAt = order.paidAt ? new Date(order.paidAt) : null
  for (const item of order.items ?? []) {
    if (!item.product) continue
    for (const rule of await rulesOf(payload, cfg.productsSlug, idOf(item.product), req)) {
      const w = computeGrantWindow(toRule(rule), paidAt)
      await access.grant({
        user: userId,
        target: { relationTo: rule.target.relationTo, value: idOf(rule.target.value) },
        start: w.start,
        end: w.end,
        keepAccessibleAfterExpiry: w.keepAccessibleAfterExpiry,
        keepUnlockedWhenActive: w.keepUnlockedWhenActive,
        data: { order: order.id },
        req,
      })
    }
  }
}

/** A subscription ended (cancelled, finished): end the windows that its order granted for this product. */
export async function endSubscriptionAccess(payload: Payload, cfg: BridgeConfig, o: { orderId: Id; productId: Id; endsAt: Date; req?: PayloadRequest }): Promise<void> {
  const rules = await rulesOf(payload, cfg.productsSlug, o.productId, o.req)
  for (const rule of rules) {
    const target = { relationTo: rule.target.relationTo, value: idOf(rule.target.value) }
    const res = await payload.find({
      collection: cfg.entitlementsSlug as never,
      where: { and: [{ order: { equals: o.orderId } }, { 'target.relationTo': { equals: target.relationTo } }, { 'target.value': { equals: target.value } }] },
      limit: 0,
      pagination: false,
      depth: 0,
      overrideAccess: true,
      req: o.req,
    })
    for (const e of res.docs as unknown as { id: Id; validityStart?: string | null }[]) {
      const ended = applySubscriptionEnd(
        { start: e.validityStart ? new Date(e.validityStart) : null, end: null, keepAccessibleAfterExpiry: false, keepUnlockedWhenActive: false },
        o.endsAt,
      )
      await payload.update({ collection: cfg.entitlementsSlug as never, id: e.id, data: { validityEnd: ended.end!.toISOString() } as never, overrideAccess: true, req: o.req })
    }
  }
}

/** Opt-in integration between commerce and payload-access. */
export const commerceAccessBridge = { syncOrderEntitlements, endSubscriptionAccess }
