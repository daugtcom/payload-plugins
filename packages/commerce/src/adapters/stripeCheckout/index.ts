import type { PaymentAdapter } from '@payloadcms/plugin-ecommerce/types'
import { addDataAndFileToRequest, createLocalReq, type Endpoint, type PayloadRequest } from 'payload'
import type Stripe from 'stripe'
import { calculateShippingCents, isCountryAllowed, toIso2 } from '../../shipping/calculator'
import { ADAPTER_NAME, stripeOf, type StripeCheckoutConfig } from './config'
import { buildLineItems } from './lineItems'
import { loadItems, loadShippingSettings, toShippingLines, type LoadedItem } from './products'
import { buildOrderData, findTransaction, confirmWebhookTransaction, isPaid, syncInvoice, tagStripeInvoice, type ProductFlags } from './settlement'
import { findOrderBySubscription, handleSubscriptionEvent } from './subscription'

type Id = string | number
type Doc = Record<string, unknown> & { id: Id }
const idOf = (v: unknown): Id => (v && typeof v === 'object' ? (v as { id: Id }).id : (v as Id))

const ALL_COUNTRIES = ['AT', 'DE', 'CH', 'LI', 'LU', 'BE', 'NL', 'FR', 'IT', 'ES', 'PT', 'DK', 'SE', 'FI', 'IE', 'PL', 'CZ', 'HU', 'GB', 'US']

const flagsOf = (items: readonly LoadedItem[]): Map<string, ProductFlags> =>
  new Map(items.map((i) => [String(i.product.id), { requiresShipping: i.product.requiresShipping, recurring: i.product.billingType === 'recurring' }]))

/** The member's Stripe customer id, created on first use. Guests get none (Checkout collects their email). */
export async function ensureCustomer(req: PayloadRequest, cfg: StripeCheckoutConfig): Promise<string | undefined> {
  const user = req.user as ({ id: Id; email?: string; stripeCustomerID?: string; name?: string } & Record<string, unknown>) | null
  if (!user) return undefined
  if (user.stripeCustomerID) return user.stripeCustomerID
  const customer = await stripeOf(cfg).customers.create({ email: user.email, name: user.name, metadata: { payloadUserID: String(user.id) } })
  await req.payload.update({ collection: cfg.usersSlug as never, id: user.id, data: { stripeCustomerID: customer.id } as never, overrideAccess: true, req })
  return customer.id
}

export function stripeCheckoutAdapter(cfg: StripeCheckoutConfig & { shippingDefaults?: Parameters<typeof loadShippingSettings>[1] }): PaymentAdapter {
  return {
    name: ADAPTER_NAME,
    label: 'Stripe Checkout',
    group: {
      name: 'stripeCheckout',
      type: 'group',
      admin: { condition: (data) => data?.paymentMethod === ADAPTER_NAME },
      fields: [
        { name: 'sessionID', type: 'text', label: 'Checkout Session ID', index: true },
        { name: 'customerID', type: 'text', label: 'Stripe Customer ID' },
      ],
    },

    initiatePayment: async ({ data, req, transactionsSlug }) => {
      const { cart, currency, customerEmail, billingAddress, shippingAddress } = data as { cart: { id: Id; items: { product: Id | { id: Id }; quantity: number }[] }; currency: string; customerEmail?: string; billingAddress?: unknown; shippingAddress?: { country?: string } }
      const loaded = await loadItems(req, { items: cart.items, currency, productsSlug: cfg.productsSlug, shippingSizesSlug: cfg.shippingSizesSlug })
      const built = buildLineItems(loaded.map((l) => ({ product: l.product, quantity: l.quantity })), currency, cfg.defaultTaxCode)

      const embedded = (cfg.uiMode ?? 'form') === 'form'
      // shipping: embedded checkout prices it from the address entered in the form (see `/shipping`). Hosted checkout
      // cannot update it, so the destination country is chosen first and one exact rate is sent.
      let shipping: Pick<Stripe.Checkout.SessionCreateParams, 'shipping_address_collection' | 'shipping_options'> = {}
      if (built.hasShipping) {
        const settings = await loadShippingSettings(req, cfg.shippingDefaults)
        if (embedded) {
          const allowed = settings.allowedCountries.map(toIso2).filter(Boolean)
          shipping = {
            shipping_address_collection: { allowed_countries: (allowed.length ? allowed : ALL_COUNTRIES) as Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry[] },
            // placeholder: replaced with the real rate as soon as the buyer has entered an address
            shipping_options: [{ shipping_rate_data: { display_name: 'Shipping', type: 'fixed_amount', fixed_amount: { amount: 0, currency: currency.toLowerCase() }, tax_behavior: 'inclusive' } }],
          }
        } else {
          const country = toIso2(shippingAddress?.country)
          if (!country) throw new Error('A shipping country is required for this cart')
          if (!isCountryAllowed(country, settings)) throw new Error(`We do not ship to ${country}`)
          const cents = calculateShippingCents(country, toShippingLines(loaded), settings)
          if (cents === null) throw new Error(`No shipping rate available for ${country}`)
          shipping = {
            shipping_address_collection: { allowed_countries: [country as Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry] },
            shipping_options: [{ shipping_rate_data: { display_name: 'Shipping', type: 'fixed_amount', fixed_amount: { amount: cents, currency: currency.toLowerCase() }, tax_behavior: 'inclusive' } }],
          }
        }
      }

      const customer = await ensureCustomer(req, cfg)
      const email = (req.user as { email?: string } | null)?.email ?? customerEmail
      const session = await stripeOf(cfg).checkout.sessions.create({
        mode: built.mode,
        line_items: built.lineItems,
        ...(embedded ? { ui_mode: 'form' as const, return_url: cfg.successUrl } : { success_url: cfg.successUrl, cancel_url: cfg.cancelUrl }),
        automatic_tax: { enabled: cfg.automaticTax ?? true },
        billing_address_collection: 'required',
        allow_promotion_codes: cfg.allowPromotionCodes ?? true,
        client_reference_id: String(cart.id),
        metadata: { cartID: String(cart.id) },
        ...(customer ? { customer, customer_update: { name: 'auto', address: 'auto', ...(built.hasShipping ? { shipping: 'auto' as const } : {}) } } : { customer_email: email }),
        ...(built.mode === 'payment' ? { invoice_creation: { enabled: true } } : { subscription_data: { metadata: { cartID: String(cart.id) } } }),
        ...shipping,
      })

      await req.payload.create({
        collection: transactionsSlug as never,
        data: {
          ...(req.user ? { customer: (req.user as { id: Id }).id } : { customerEmail: email }),
          amount: session.amount_total ?? 0,
          billingAddress,
          cart: cart.id,
          currency: currency.toUpperCase(),
          items: cart.items.map((i) => ({ product: idOf(i.product), quantity: i.quantity })),
          paymentMethod: ADAPTER_NAME,
          status: 'pending',
          stripeCheckout: { sessionID: session.id, customerID: customer },
        } as never,
        req,
      })

      return { message: 'Checkout session created', url: session.url ?? undefined, clientSecret: session.client_secret ?? undefined, sessionID: session.id } as { message: string } & Record<string, unknown>
    },

    confirmOrder: async ({ data, finalizeOrder, req, transactionsSlug = 'transactions' }) => {
      const sessionID = (data as { sessionID?: string }).sessionID
      if (!sessionID) throw new Error('A Checkout Session ID is required')
      const session = await stripeOf(cfg).checkout.sessions.retrieve(sessionID, { expand: ['subscription'] })
      if (!isPaid(session)) throw new Error('The Checkout Session is not paid')
      if (session.metadata?.cartID !== String((data as { cartID?: Id }).cartID)) throw new Error('The Checkout Session does not belong to this cart')

      const transaction = await findTransaction(req.payload, req, sessionID, transactionsSlug)
      if (!transaction) throw new Error('No transaction for this Checkout Session')

      const items = await loadItems(req, { items: (transaction.items as { product: Id; quantity: number }[]) ?? [], currency: String(transaction.currency), productsSlug: cfg.productsSlug, shippingSizesSlug: cfg.shippingSizesSlug })
      const order = (await finalizeOrder({ orderData: buildOrderData({ session, transaction, flags: flagsOf(items) }), transactionID: transaction.id as never })) as Doc
      // Invoices are recorded by the webhook path only: this request still holds the plugin's open transaction
      // (the order is not committed yet), and two writers racing on the unique invoice id would abort it.
      // ids are numbers or strings depending on the database adapter
      return { message: 'Order confirmed', orderID: order.id, transactionID: transaction.id } as { message: string; orderID: never; transactionID: never }
    },

    endpoints: [webhookEndpoint(cfg), shippingEndpoint(cfg)],
  }
}

/** Resolve a session-only browser return using the authenticated transaction owner. */
export function withCheckoutCart(endpoint: Endpoint, cfg: StripeCheckoutConfig): Endpoint {
  return {
    ...endpoint,
    handler: async (req) => {
      await addDataAndFileToRequest(req)
      const data = { ...req.data }
      if (!data.cartID) {
        if (!req.user) return Response.json({ message: 'Login required' }, { status: 401 })
        const transaction = typeof data.sessionID === 'string' && await findTransaction(req.payload, req, data.sessionID)
        if (!transaction || !transaction.customer || req.user.collection !== cfg.usersSlug || String(idOf(transaction.customer)) !== String(req.user.id)) return Response.json({ message: 'Checkout session not found for this customer' }, { status: 403 })
        if (!transaction.cart) return Response.json({ message: 'Original checkout cart is missing' }, { status: 409 })
        data.cartID = idOf(transaction.cart)
      }
      const local = await createLocalReq({ user: req.user ?? undefined, locale: req.locale ?? undefined, context: req.context, req: { data } }, req.payload)
      return endpoint.handler(local)
    },
  }
}

/** Invoice bookkeeping after the order is committed (webhook path). Idempotent and safe against concurrent webhooks. */
async function afterSettlement(req: PayloadRequest, cfg: StripeCheckoutConfig, session: Stripe.Checkout.Session, order: Doc): Promise<void> {
  const invoiceID = typeof session.invoice === 'string' ? session.invoice : session.invoice?.id
  if (!invoiceID) return
  await syncInvoice(req, cfg, { invoiceID, order, status: 'paid' })
  await tagStripeInvoice(cfg, invoiceID, order)
}

/** Wallet buttons bypass the shipping reprice of the embedded form: shout if the amount charged is not the rate we would have set. */
async function auditShipping(req: PayloadRequest, cfg: StripeCheckoutConfig & { shippingDefaults?: Parameters<typeof loadShippingSettings>[1] }, session: Stripe.Checkout.Session, items: readonly LoadedItem[]): Promise<void> {
  const lines = toShippingLines(items)
  if (!lines.some((l) => l.requiresShipping)) return
  const country = toIso2(session.collected_information?.shipping_details?.address?.country)
  const settings = await loadShippingSettings(req, cfg.shippingDefaults)
  const expected = country ? calculateShippingCents(country, lines, settings) : null
  const charged = session.shipping_cost?.amount_total ?? null
  if (expected === null || charged === null || expected !== charged) req.payload.logger.warn({ msg: 'Shipping amount differs from the calculated rate', session: session.id, country, expected, charged })
}

export async function settleFromWebhook(req: PayloadRequest, cfg: StripeCheckoutConfig & { shippingDefaults?: Parameters<typeof loadShippingSettings>[1] }, session: Stripe.Checkout.Session): Promise<void> {
  if (!isPaid(session)) return
  const transaction = await findTransaction(req.payload, req, session.id)
  if (!transaction) return // not one of ours
  const full = await stripeOf(cfg).checkout.sessions.retrieve(session.id, { expand: ['subscription'] })
  if (!isPaid(full)) throw new Error('The Checkout Session is not paid')
  if (transaction.status !== 'succeeded') {
    if (!transaction.cart || full.metadata?.cartID !== String(idOf(transaction.cart))) throw new Error('The Checkout Session does not belong to this cart')
    const items = await loadItems(req, { items: (transaction.items as { product: Id; quantity: number }[]) ?? [], currency: String(transaction.currency), productsSlug: cfg.productsSlug, shippingSizesSlug: cfg.shippingSizesSlug })
    await auditShipping(req, cfg, full, items)
  }
  const order = await confirmWebhookTransaction(req, cfg, transaction, session.id)
  await afterSettlement(req, cfg, full, order)
}

/**
 * `POST /shipping { sessionID, shippingDetails: { address: { country } } }`: prices the cart for the address the buyer
 * entered in the embedded form and puts that one rate on the session. The reply shape is what `runServerUpdate` expects.
 */
function shippingEndpoint(cfg: StripeCheckoutConfig & { shippingDefaults?: Parameters<typeof loadShippingSettings>[1] }): Endpoint {
  const fail = (message: string, status = 200) => Response.json({ type: 'error', message }, { status })
  return {
    path: '/shipping',
    method: 'post',
    handler: async (req) => {
      if (!req.user) return fail('login-required', 401)
      const b = ((await req.json?.().catch(() => ({}))) ?? {}) as { sessionID?: string; shippingDetails?: { address?: { country?: string } } }
      if (!b.sessionID) return fail('sessionID-required', 400)
      const transaction = await findTransaction(req.payload, req, b.sessionID)
      // only the buyer of this checkout may reprice it
      if (!transaction || String(idOf(transaction.customer)) !== String((req.user as { id: Id }).id)) return fail('not-found', 404)
      const country = toIso2(b.shippingDetails?.address?.country)
      const settings = await loadShippingSettings(req, cfg.shippingDefaults)
      if (!country || !isCountryAllowed(country, settings)) return fail(`We do not ship to ${b.shippingDetails?.address?.country ?? 'this country'}.`)
      const loaded = await loadItems(req, { items: (transaction.items as { product: Id; quantity: number }[]) ?? [], currency: String(transaction.currency), productsSlug: cfg.productsSlug, shippingSizesSlug: cfg.shippingSizesSlug })
      const cents = calculateShippingCents(country, toShippingLines(loaded), settings)
      if (cents === null) return fail(`No shipping rate available for ${country}.`)
      await stripeOf(cfg).checkout.sessions.update(b.sessionID, {
        shipping_options: [{ shipping_rate_data: { display_name: 'Shipping', type: 'fixed_amount', fixed_amount: { amount: cents, currency: String(transaction.currency).toLowerCase() }, tax_behavior: 'inclusive' } }],
      })
      return Response.json({ type: 'object', value: { succeeded: true } })
    },
  }
}

function webhookEndpoint(cfg: StripeCheckoutConfig): Endpoint {
  return {
    path: '/webhook',
    method: 'post',
    handler: async (req) => {
      const raw = await req.text!()
      const signature = req.headers.get('stripe-signature') ?? ''
      let event: Stripe.Event
      try {
        if (!cfg.webhookSecret) throw new Error('Webhook secret is not configured')
        event = await stripeOf(cfg).webhooks.constructEventAsync(raw, signature, cfg.webhookSecret)
      } catch (err) {
        return Response.json({ message: `Webhook error: ${(err as Error).message}` }, { status: 400 })
      }
      try {
        await handleEvent(req, cfg, event)
      } catch (err) {
        req.payload.logger.error({ err, msg: `Stripe webhook ${event.type} failed` })
        return Response.json({ message: 'Handler failed, Stripe will retry' }, { status: 500 })
      }
      return Response.json({ received: true })
    },
  }
}

export async function handleEvent(req: PayloadRequest, cfg: StripeCheckoutConfig, event: Stripe.Event): Promise<void> {
  const obj = event.data.object as unknown
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      return settleFromWebhook(req, cfg, obj as Stripe.Checkout.Session)
    case 'checkout.session.async_payment_failed':
    case 'checkout.session.expired': {
      const t = await findTransaction(req.payload, req, (obj as Stripe.Checkout.Session).id)
      if (t && (t.status === 'pending' || t.status === 'processing')) await req.payload.update({ collection: 'transactions' as never, id: t.id, data: { status: event.type === 'checkout.session.expired' ? 'expired' : 'failed' } as never, overrideAccess: true, req })
      return
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return handleSubscriptionEvent(req, cfg, obj as Stripe.Subscription)
    case 'customer.updated': {
      const c = obj as Stripe.Customer
      const users = await req.payload.find({ collection: cfg.usersSlug as never, where: { stripeCustomerID: { equals: c.id } }, limit: 1, depth: 0, overrideAccess: true, req })
      const user = users.docs[0] as unknown as Doc | undefined
      if (user) await req.payload.update({ collection: cfg.usersSlug as never, id: user.id, data: { stripeAddresses: { shipping: c.shipping ?? null, billing: c.address ?? null } } as never, overrideAccess: true, req })
      return
    }
    default:
      if (event.type.startsWith('invoice.')) return handleInvoiceEvent(req, cfg, obj as Stripe.Invoice)
  }
}

/** Invoices of subscriptions (renewals). One-time invoices are recorded when the order is settled. */
async function handleInvoiceEvent(req: PayloadRequest, cfg: StripeCheckoutConfig, inv: Stripe.Invoice): Promise<void> {
  const raw = inv as unknown as { subscription?: string | { id: string }; parent?: { subscription_details?: { subscription?: string | { id: string } } }; payment_intent?: string | { id: string } | null }
  const sub = raw.subscription ?? raw.parent?.subscription_details?.subscription
  const subscriptionID = typeof sub === 'string' ? sub : sub?.id
  if (!subscriptionID) return
  const order = await findOrderBySubscription(req.payload, req, cfg.ordersSlug, subscriptionID)
  if (!order) throw new Error(`No order for subscription ${subscriptionID} yet`)
  const pi = raw.payment_intent
  await syncInvoice(req, cfg, { invoiceID: inv.id!, order, status: inv.status ?? 'open', paymentIntentID: typeof pi === 'string' ? pi : pi?.id })
}
