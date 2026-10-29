import type { Payload, PayloadRequest } from 'payload'
type Id = string | number

export interface BridgeConfig {
  productsSlug: string
  usersSlug: string
  entitlementsSlug: string
}

export interface OrderDoc {
  id: Id
  customer?: Id | { id: Id } | null
  customerEmail?: string | null
  paymentStatus?: string | null
  paidAt?: string | null
  items?: { product?: Id | { id: Id } | null; stripeSubscriptionID?: string | null }[] | null
}

export interface CommerceAccessBridge {
  syncOrderEntitlements(order: OrderDoc, req: PayloadRequest, cfg: BridgeConfig): Promise<void>
  endSubscriptionAccess(payload: Payload, cfg: BridgeConfig, options: { orderId: Id; productId: Id; endsAt: Date; req?: PayloadRequest }): Promise<void>
}
