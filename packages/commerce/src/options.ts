import type { CollectionConfig, CollectionSlug, Field } from 'payload'
import type { LineResolver } from './cart/resolvers'
import type { ShippingSettings } from './shipping/calculator'

export interface CommercePluginOptions {
  enabled?: boolean
  /** Auth collection of the customers. Default `users`. */
  usersSlug?: CollectionSlug
  /** Staff may manage everything (products, orders, invoices). Default: `user.roles` includes `admin`. */
  isStaff?: (user: unknown) => boolean
  /** Media collection for product images. Default `media`. */
  mediaSlug?: CollectionSlug
  /** Currencies. Default: EUR only (amounts are minor units, tax inclusive). */
  currency?: { code: string; label?: string; symbol?: string; decimals?: number }
  /**
   * Collections a product can unlock (series, posts…). Needs `payload-access`.
   * Empty/omitted = products do not grant access.
   */
  accessTargets?: CollectionSlug[]
  /** Explicit access integration, imported from @daugtcom/payload-commerce/access. */
  accessBridge?: import('./access/contracts').CommerceAccessBridge
  /** Slug of the entitlements collection from `payload-access`. Default `entitlements`. */
  entitlementsSlug?: string
  /** Defaults used until staff change them in the `commerceSettings` global. */
  shippingDefaults?: Partial<ShippingSettings>
  /** Extra fields for the plugin-owned collections. */
  productFields?: Field[]
  orderFields?: Field[]
  invoiceFields?: Field[]
  shopCategoryFields?: Field[]
  /** Last-chance hooks into the collections the ecommerce plugin builds. */
  productsCollectionOverride?: (c: CollectionConfig) => CollectionConfig
  ordersCollectionOverride?: (c: CollectionConfig) => CollectionConfig
  /** Turns a stored invoice file key (legacy uploaded PDFs) into a URL the member may open, e.g. a signed bucket URL. */
  invoiceFileUrl?: (key: string) => string | Promise<string>
  /** Folder for monthly invoice export ZIPs. Default `./invoice-exports`. */
  invoiceExportsDir?: string
  /** Price and label cart lines (other plugins add theirs themselves, see cart/resolvers.ts). */
  lineResolvers?: LineResolver[]
  /** Stripe Checkout (hosted). Omit to run without a payment adapter (tests, imports). */
  stripe?: StripeCheckoutOptions
}

export interface StripeCheckoutOptions {
  secretKey: string
  webhookSecret?: string
  /** Where Stripe sends the buyer back to. `{CHECKOUT_SESSION_ID}` is replaced by Stripe. */
  successUrl: string
  cancelUrl: string
  /**
   * `form` (default): the embedded checkout form on your own page. Shipping is priced from the address the buyer enters,
   * so no country is needed before checkout. `hosted`: redirect to Stripe; the country must be chosen up front.
   */
  uiMode?: 'form' | 'hosted'
  /** Stripe Tax on every checkout. Default true (legacy behavior). */
  automaticTax?: boolean
  allowPromotionCodes?: boolean
  /** Default Stripe tax code for products without their own. */
  defaultTaxCode?: string
  /** Where the Stripe billing portal sends the member back to. Default: `cancelUrl`. */
  billingPortalReturnUrl?: string
}
