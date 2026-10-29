import { createLocalReq, type Payload, type PayloadRequest } from 'payload'
import type Stripe from 'stripe'
import { ADAPTER_NAME, stripeOf, type StripeCheckoutConfig } from './config'

type Id = string | number
type Doc = Record<string, unknown> & { id: Id }

const idOf = (v: unknown): Id => (v && typeof v === 'object' ? (v as { id: Id }).id : (v as Id))

export const isPaid = (s: Stripe.Checkout.Session) => s.payment_status === 'paid' || s.payment_status === 'no_payment_required'

export async function findTransaction(payload: Payload, req: PayloadRequest, sessionID: string, transactionsSlug = 'transactions'): Promise<Doc | null> {
  const r = await payload.find({ collection: transactionsSlug as never, where: { 'stripeCheckout.sessionID': { equals: sessionID } }, limit: 1, depth: 0, overrideAccess: true, req })
  return (r.docs[0] as unknown as Doc | undefined) ?? null
}

/** Stripe's address shape -> the ecommerce plugin's address fields. */
export function toPluginAddress(d: { name?: string | null; address?: Stripe.Address | null; phone?: string | null } | null | undefined) {
  if (!d?.address) return undefined
  const [firstName, ...rest] = (d.name ?? '').split(' ')
  return {
    firstName: firstName || undefined,
    lastName: rest.join(' ') || undefined,
    addressLine1: d.address.line1 ?? undefined,
    addressLine2: d.address.line2 ?? undefined,
    city: d.address.city ?? undefined,
    state: d.address.state ?? undefined,
    postalCode: d.address.postal_code ?? undefined,
    country: d.address.country ?? undefined,
    phone: d.phone ?? undefined,
  }
}

/** Everything the order needs beyond what the plugin derives from the cart. */
export interface ProductFlags {
  requiresShipping: boolean
  recurring: boolean
}

export function buildOrderData(o: { session: Stripe.Checkout.Session; transaction: Doc; flags: Map<string, ProductFlags> }): Record<string, unknown> {
  const { session, transaction } = o
  const subscriptionID = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id
  const items = ((transaction.items as { product: unknown; quantity: number; variant?: unknown }[]) ?? []).map((it) => {
    const f = o.flags.get(String(idOf(it.product)))
    return {
      product: idOf(it.product),
      ...(it.variant ? { variant: idOf(it.variant) } : {}),
      quantity: it.quantity,
      ...(f?.requiresShipping ? { shippingStatus: 'pending' } : {}),
      ...(f?.recurring && subscriptionID ? { stripeSubscriptionID: subscriptionID } : {}),
    }
  })
  return {
    amount: session.amount_total ?? (transaction.amount as number),
    currency: String(session.currency ?? transaction.currency).toUpperCase(),
    ...(transaction.customer ? { customer: idOf(transaction.customer) } : { customerEmail: (transaction.customerEmail as string) ?? session.customer_details?.email }),
    items,
    status: 'processing',
    paymentStatus: 'paid',
    paidAt: new Date().toISOString(),
    shippingAddress: toPluginAddress(session.collected_information?.shipping_details ?? undefined),
    billingAddress: session.customer_details ?? undefined,
    stripe: { checkoutSessionID: session.id, customerID: typeof session.customer === 'string' ? session.customer : session.customer?.id },
  }
}

/** Verify committed canonical linkage before requiring a historical cart or customer. */
async function settledOrder(req: PayloadRequest, transaction: Doc, cfg: StripeCheckoutConfig): Promise<Doc | null> {
  if (transaction.status !== 'succeeded') return null
  const orders = await req.payload.find({ collection: cfg.ordersSlug as never, where: { transactions: { equals: transaction.id } }, limit: 2, depth: 0, overrideAccess: true, req })
  const canonical = orders.docs[0] as unknown as Doc | undefined
  if (!transaction.order || orders.totalDocs !== 1 || orders.docs.length !== 1 || !canonical || String(canonical.id) !== String(idOf(transaction.order))) throw new Error('Transaction does not have exactly one canonical linked order')
  return canonical
}

/** Server-only bridge: authority comes from the signed event's stored transaction. */
export async function confirmWebhookTransaction(req: PayloadRequest, cfg: StripeCheckoutConfig, transaction: Doc, sessionID: string): Promise<Doc> {
  const existing = await settledOrder(req, transaction, cfg)
  if (existing) return existing
  if (!transaction.cart || !transaction.customer) throw new Error('Pending Checkout transaction requires its original cart and customer')
  const customer = await req.payload.findByID({ collection: cfg.usersSlug as never, id: idOf(transaction.customer), depth: 0, overrideAccess: true, req }) as unknown as Doc
  const handler = req.payload.config.endpoints.find((endpoint) => endpoint.method === 'post' && endpoint.path === `/payments/${ADAPTER_NAME}/confirm-order`)?.handler
  if (!handler) throw new Error('Checkout confirmation endpoint is not configured')
  // Keep the consumed signed body, webhook transaction and caller identity out of confirmation.
  const local = await createLocalReq({ user: { ...customer, collection: cfg.usersSlug } as never, req: { data: { cartID: idOf(transaction.cart), sessionID } } }, req.payload)
  const response = await handler(local)
  if (!response.ok) throw new Error(`Checkout confirmation failed (${response.status})`)
  const result = await response.json() as { orderID?: Id; transactionID?: Id }
  const committed = await findTransaction(req.payload, req, sessionID)
  const order = committed && await settledOrder(req, committed, cfg)
  if (!order || String(result.transactionID) !== String(transaction.id) || String(result.orderID) !== String(order.id)) throw new Error('Checkout confirmation did not return its committed canonical order')
  return order
}

/** Invoice doc for a Stripe invoice (idempotent), and the order id written back onto the Stripe invoice. */
export async function syncInvoice(req: PayloadRequest, cfg: StripeCheckoutConfig, o: { invoiceID: string; order: Doc; status: string; paymentIntentID?: string | null }): Promise<void> {
  const data = { order: o.order.id, customer: o.order.customer ? idOf(o.order.customer) : undefined, stripeInvoiceID: o.invoiceID, stripePaymentIntentID: o.paymentIntentID ?? undefined, status: o.status }
  const find = async () => (await req.payload.find({ collection: cfg.invoicesSlug as never, where: { stripeInvoiceID: { equals: o.invoiceID } }, limit: 1, depth: 0, overrideAccess: true })).docs[0] as unknown as Doc | undefined
  const update = (doc: Doc) => req.payload.update({ collection: cfg.invoicesSlug as never, id: doc.id, data: data as never, overrideAccess: true })

  const existing = await find()
  if (existing) return void (await update(existing))
  try {
    await req.payload.create({ collection: cfg.invoicesSlug as never, data: data as never, overrideAccess: true })
  } catch (err) {
    // the other settlement path wrote it between our check and our insert (unique stripeInvoiceID)
    const raced = await find()
    if (!raced) throw err
    await update(raced)
  }
}

export async function tagStripeInvoice(cfg: StripeCheckoutConfig, invoiceID: string, order: Doc): Promise<void> {
  await stripeOf(cfg).invoices.update(invoiceID, { metadata: { orderID: String(order.id), orderNumber: String(order.orderNumber ?? '') } }).catch(() => undefined)
}
