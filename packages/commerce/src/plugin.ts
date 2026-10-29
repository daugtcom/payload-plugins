import { ecommercePlugin } from '@payloadcms/plugin-ecommerce'
import { APIError, type CollectionConfig, type Config, type Field, type Plugin } from 'payload'
import type { BridgeConfig } from './access/contracts'
import { invoices, INVOICES_SLUG } from './collections/invoices'
import { shippingSizes, SHIPPING_SIZES_SLUG } from './collections/shippingSizes'
import { shopCategories, SHOP_CATEGORIES_SLUG } from './collections/shopCategories'
import { orderFields, orderItemFields } from './fields/orderFields'
import { baseProductFields, productFields } from './fields/productFields'
import { commerceSettings } from './globals/commerceSettings'
import { stripeCheckoutAdapter, withCheckoutCart } from './adapters/stripeCheckout'
import type { StripeCheckoutConfig } from './adapters/stripeCheckout/config'
import { billingEndpoints } from './endpoints/billing'
import { exportEndpoint, exportTask, invoiceExports } from './invoices/plugin'
import { applyCartRules, type ProductRule } from './cart/rules'
import { LINE_RESOLVERS_KEY, type LineResolver } from './cart/resolvers'
import { assignOrderNumber, stampPaidAt } from './orders/hooks'
import type { CommercePluginOptions } from './options'

type AccessConfig = NonNullable<Parameters<typeof ecommercePlugin>[0]>['access']

const defaultIsStaff = (user: unknown): boolean => {
  const u = user as { roles?: string[]; role?: string } | null
  return Boolean(u && (u.role === 'admin' || (Array.isArray(u.roles) && u.roles.includes('admin'))))
}

function accessConfig(isStaff: (u: unknown) => boolean): AccessConfig {
  const staff = (user: unknown) => Boolean(user && isStaff(user))
  return {
    adminOnlyFieldAccess: ({ req }) => staff(req.user),
    adminOrPublishedStatus: ({ req }) => (staff(req.user) ? true : { _status: { equals: 'published' } }),
    isAdmin: ({ req }) => staff(req.user),
    isAuthenticated: ({ req }) => Boolean(req.user),
    isCustomer: ({ req }) => Boolean(req.user) && !staff(req.user),
    isDocumentOwner: ({ req }) => (req.user ? { customer: { equals: (req.user as { id: string | number }).id } } : false),
  }
}

/** A free-form `meta` object on every cart line, for plugins that attach data to a line (a booked slot, a chosen variant). Hidden in the admin. */
const withCartItemMeta = (fields: Field[]): Field[] =>
  fields.map((f) => {
    if (f.type === 'tabs') return { ...f, tabs: f.tabs.map((t) => ({ ...t, fields: withCartItemMeta(t.fields) })) }
    if ('name' in f && f.name === 'items' && f.type === 'array') return { ...f, fields: [...f.fields, { name: 'meta', type: 'json', admin: { hidden: true } } as Field] }
    return f
  })

/** Subscriptions, shipping, invoices and the order → access bridge on top of @payloadcms/plugin-ecommerce. */
export const payloadCommerce =
  (o: CommercePluginOptions = {}): Plugin =>
  async (incoming: Config): Promise<Config> => {
    if (o.enabled === false) return incoming

    const usersSlug = o.usersSlug ?? 'users'
    const isStaff = o.isStaff ?? defaultIsStaff
    const accessTargets = o.accessTargets ?? []
    const entitlementsSlug = o.entitlementsSlug ?? 'entitlements'
    const currency = o.currency ?? { code: 'EUR', label: 'Euro', symbol: '€', decimals: 2 }
    const bridge: BridgeConfig = { productsSlug: 'products', usersSlug, entitlementsSlug }

    if (accessTargets.length && !o.accessBridge) throw new Error('payloadCommerce: accessTargets requires the optional commerceAccessBridge.')
    if (accessTargets.length && !incoming.collections?.some((c) => c.slug === entitlementsSlug)) {
      throw new Error(`payloadCommerce: accessTargets is set but "${entitlementsSlug}" does not exist. List payloadAccess() before payloadCommerce() in plugins.`)
    }

    const withOrderHooks = (c: CollectionConfig): CollectionConfig => {
      const itemsAt = (f: Field) => 'name' in f && f.name === 'items'
      const addItemFields = (fields: Field[]): Field[] =>
        fields.map((f) => {
          if (f.type === 'tabs') return { ...f, tabs: f.tabs.map((t) => ({ ...t, fields: addItemFields(t.fields) })) }
          if (itemsAt(f) && f.type === 'array') return { ...f, fields: [...f.fields, ...orderItemFields] }
          return f
        })
      return {
        ...c,
        fields: [...addItemFields(c.fields), ...orderFields, ...(o.orderFields ?? [])],
        hooks: {
          ...c.hooks,
          beforeChange: [...(c.hooks?.beforeChange ?? []), assignOrderNumber(c.slug), stampPaidAt],
          afterChange: [
            ...(c.hooks?.afterChange ?? []),
            async ({ doc, req }) => {
              if (accessTargets.length) await o.accessBridge!.syncOrderEntitlements(doc, req, bridge)
              return doc
            },
          ],
        },
      }
    }

    const withUserFields = (c: CollectionConfig): CollectionConfig =>
      c.slug !== usersSlug
        ? c
        : {
            ...c,
            fields: [
              ...c.fields,
              { name: 'cart', type: 'join', collection: 'carts', on: 'customer', defaultLimit: 1, defaultSort: '-createdAt', where: { purchasedAt: { exists: false } }, admin: { hidden: true } },
              { name: 'stripeCustomerID', type: 'text', index: true, admin: { readOnly: true, position: 'sidebar' } },
              { name: 'stripeAddresses', type: 'json', admin: { readOnly: true, description: 'Shipping and billing address as last reported by Stripe.' } },
            ],
          }

    const withEntitlementOrder = (c: CollectionConfig): CollectionConfig =>
      c.slug !== entitlementsSlug ? c : { ...c, fields: [...c.fields, { name: 'order', type: 'relationship', relationTo: 'orders', index: true, admin: { readOnly: true, description: 'The order that granted this access.' } }] }

    const withCommerce: Config = {
      ...incoming,
      collections: [
        ...(incoming.collections ?? []).map(withUserFields).map((c) => (accessTargets.length ? withEntitlementOrder(c) : c)),
        shippingSizes(isStaff),
        shopCategories(isStaff, o.shopCategoryFields),
        invoices({ usersSlug, ordersSlug: 'orders', isStaff, extraFields: o.invoiceFields }),
      ],
      globals: [...(incoming.globals ?? []), commerceSettings(isStaff, o.shippingDefaults)],
      custom: { ...incoming.custom, daugtCommerce: { options: o, bridge }, [LINE_RESOLVERS_KEY]: [...(((incoming.custom as Record<string, unknown> | undefined)?.[LINE_RESOLVERS_KEY] as LineResolver[] | undefined) ?? []), ...(o.lineResolvers ?? [])] },
    }

    const withProductsHook = (c: CollectionConfig): CollectionConfig => {
      const extended: CollectionConfig = {
        ...c,
        admin: { ...c.admin, useAsTitle: 'title', defaultColumns: ['title', ...(c.admin?.defaultColumns ?? [])] },
        fields: [...baseProductFields({ mediaSlug: o.mediaSlug ?? 'media', categoriesSlug: SHOP_CATEGORIES_SLUG }), ...c.fields, ...productFields({ accessTargets, shippingSizesSlug: SHIPPING_SIZES_SLUG }), ...(o.productFields ?? [])],
      }
      return o.productsCollectionOverride ? o.productsCollectionOverride(extended) : extended
    }

    const stripeCfg: StripeCheckoutConfig | undefined = o.stripe && { ...o.stripe, usersSlug, productsSlug: 'products', ordersSlug: 'orders', cartsSlug: 'carts', invoicesSlug: INVOICES_SLUG, shippingSizesSlug: SHIPPING_SIZES_SLUG, entitlementsSlug, grantsAccess: accessTargets.length > 0, accessBridge: o.accessBridge }

    const configured = await ecommercePlugin({
      access: accessConfig(isStaff),
      customers: { slug: usersSlug },
      currencies: { defaultCurrency: currency.code, supportedCurrencies: [{ code: currency.code, decimals: currency.decimals ?? 2, label: currency.label ?? currency.code, symbol: currency.symbol ?? currency.code }] },
      products: { productsCollectionOverride: ({ defaultCollection }) => withProductsHook(defaultCollection) },
      carts: {
        allowGuestCarts: false,
        cartsCollectionOverride: ({ defaultCollection }) => ({
          ...defaultCollection,
          fields: withCartItemMeta(defaultCollection.fields),
          hooks: {
            ...defaultCollection.hooks,
            beforeChange: [
              async ({ data, req, operation, originalDoc }) => {
                // Native cart creation must bind ownership to the authenticated buyer.
                if (req.user && !isStaff(req.user)) {
                  if (operation === 'create') data.customer = req.user.id
                  else if (originalDoc) data.customer = originalDoc.customer && typeof originalDoc.customer === 'object' ? originalDoc.customer.id : originalDoc.customer
                }
                if (!Array.isArray(data?.items) || data.items.length === 0) return data
                const rules = new Map<string, ProductRule>()
                for (const item of data.items as { product: string | number | { id: string | number } }[]) {
                  const id = typeof item.product === 'object' ? item.product.id : item.product
                  if (rules.has(String(id))) continue
                  const p = (await req.payload.findByID({ collection: 'products' as never, id, depth: 0, overrideAccess: true, req }).catch(() => null)) as { commerce?: { billingType?: string; multi?: boolean; externalUrl?: string } } | null
                  if (p?.commerce?.externalUrl) throw new APIError('External products cannot be added to the cart', 400)
                  rules.set(String(id), { recurring: p?.commerce?.billingType === 'recurring', multi: Boolean(p?.commerce?.multi) })
                }
                const lines = data.items.map((i: { product: string | number | { id: string | number } }) => ({ ...i, product: typeof i.product === 'object' ? i.product.id : i.product }))
                return { ...data, items: applyCartRules(lines as never, rules) }
              },
              // Calculate the native subtotal from the final normalized items.
              ...(defaultCollection.hooks?.beforeChange ?? []),
            ],
          },
        }),
      },
      orders: { ordersCollectionOverride: ({ defaultCollection }) => (o.ordersCollectionOverride ?? ((c) => c))(withOrderHooks(defaultCollection)) },
      payments: {
        paymentMethods: o.stripe
          ? [stripeCheckoutAdapter({ ...stripeCfg!, shippingDefaults: o.shippingDefaults })]
          : [],
      },
    })(withCommerce)

    if (!stripeCfg) return configured
    configured.endpoints = configured.endpoints?.map((endpoint) =>
      endpoint.method === 'post' && endpoint.path === '/payments/stripe-checkout/confirm-order' ? withCheckoutCart(endpoint, stripeCfg) : endpoint,
    )
    return {
      ...configured,
      // server-side only: lets the UI server components (OrdersView) ask Stripe for hosted invoice links
      custom: { ...configured.custom, payloadCommerce: { stripe: stripeCfg } },
      collections: [...(configured.collections ?? []), invoiceExports({ usersSlug, isStaff, dir: o.invoiceExportsDir ?? './invoice-exports' })],
      endpoints: [...(configured.endpoints ?? []), ...billingEndpoints(stripeCfg, { isStaff, invoiceFileUrl: o.invoiceFileUrl }), exportEndpoint(stripeCfg, isStaff)],
      jobs: { ...configured.jobs, tasks: [...(configured.jobs?.tasks ?? []), exportTask({ cfg: stripeCfg, invoiceFileUrl: o.invoiceFileUrl, serverURL: incoming.serverURL })] },
    }
  }

export { INVOICES_SLUG, SHIPPING_SIZES_SLUG }
