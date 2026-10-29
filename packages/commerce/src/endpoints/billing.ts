import type { Endpoint } from 'payload'
import { stripeOf, type StripeCheckoutConfig } from '../adapters/stripeCheckout/config'
import { ensureCustomer } from '../adapters/stripeCheckout'

type Id = string | number

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
const idOf = (v: unknown): Id => (v && typeof v === 'object' ? (v as { id: Id }).id : (v as Id))

export function billingEndpoints(cfg: StripeCheckoutConfig, o: { isStaff: (u: unknown) => boolean; invoiceFileUrl?: (key: string) => string | Promise<string> }): Endpoint[] {
  return [
    // the member manages payment methods, cancels or resumes subscriptions in Stripe's hosted portal
    {
      path: '/commerce/billing-portal',
      method: 'post',
      handler: async (req) => {
        if (!req.user) return json(401, { error: 'login-required' })
        // a member who has not paid yet has no Stripe customer: create it as checkout would, so the portal opens for everyone
        const customer = await ensureCustomer(req, cfg)
        if (!customer) return json(404, { error: 'no-customer' })
        let session
        try {
          session = await stripeOf(cfg).billingPortal.sessions.create({ customer, return_url: cfg.billingPortalReturnUrl ?? cfg.cancelUrl })
        } catch (error) {
          req.payload.logger.error({ err: error }, 'billing portal session failed') // typically: the portal is not configured in the Stripe dashboard
          return json(502, { error: 'portal-unavailable' })
        }
        return json(200, { url: session.url })
      },
    },

    // the PDF of an invoice: Stripe's own, or the uploaded file of an old invoice
    {
      path: '/commerce/invoices/:id/pdf',
      method: 'get',
      handler: async (req) => {
        if (!req.user) return json(401, { error: 'login-required' })
        const id = (req.routeParams as { id?: string } | undefined)?.id
        const invoice = id ? ((await req.payload.findByID({ collection: cfg.invoicesSlug as never, id, depth: 0, overrideAccess: true }).catch(() => null)) as (Record<string, any> & { id: Id }) | null) : null
        if (!invoice) return json(404, { error: 'not-found' })
        const mine = invoice.customer != null && String(idOf(invoice.customer)) === String((req.user as { id: Id }).id)
        if (!mine && !o.isStaff(req.user)) return json(403, { error: 'forbidden' })

        let url: string | undefined
        if (invoice.stripeInvoiceID) url = (await stripeOf(cfg).invoices.retrieve(invoice.stripeInvoiceID)).invoice_pdf ?? undefined
        else if (invoice.file && o.invoiceFileUrl) url = await o.invoiceFileUrl(invoice.file)
        if (!url) return json(404, { error: 'no-pdf' })
        return new Response(null, { status: 302, headers: { Location: url } })
      },
    },
  ]
}
