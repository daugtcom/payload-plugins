import Stripe from 'stripe'
import type { StripeCheckoutOptions } from '../../options'

export interface StripeCheckoutConfig extends StripeCheckoutOptions {
  /** Inject a Stripe client (tests). Default: created from `secretKey`. */
  stripe?: Stripe
  usersSlug: string
  productsSlug: string
  ordersSlug: string
  cartsSlug: string
  invoicesSlug: string
  shippingSizesSlug: string
  entitlementsSlug: string
  /** Do products grant access? Then subscription events adjust entitlements. */
  grantsAccess: boolean
  accessBridge?: import('../../access/contracts').CommerceAccessBridge
}

export const ADAPTER_NAME = 'stripe-checkout'

export function stripeOf(cfg: StripeCheckoutConfig): Stripe {
  return (cfg.stripe ??= new Stripe(cfg.secretKey))
}
