import type Stripe from 'stripe'

/** The few Stripe calls the adapter makes, scripted. `complete()` plays the buyer paying on Stripe's page. */
export class FakeStripe {
  sessions = new Map<string, Record<string, any>>()
  createParams: Record<string, any>[] = []
  customersCreated: Record<string, any>[] = []
  invoiceUpdates: { id: string; params: unknown }[] = []
  subscriptionUpdates: { id: string; params: any }[] = []
  sessionUpdates: { id: string; params: any }[] = []
  private n = 0

  checkout = {
    sessions: {
      create: async (p: Record<string, any>) => {
        this.createParams.push(p)
        const id = `cs_test_${++this.n}`
        const lines = (p.line_items ?? []) as { quantity: number; price_data: { unit_amount: number } }[]
        const shipping = p.shipping_options?.[0]?.shipping_rate_data?.fixed_amount?.amount ?? 0
        const session = {
          id,
          url: p.ui_mode === 'form' ? null : `https://checkout.stripe.test/${id}`,
          client_secret: p.ui_mode === 'form' ? `${id}_secret_fake` : null,
          mode: p.mode,
          status: 'open',
          payment_status: 'unpaid',
          currency: p.line_items?.[0]?.price_data?.currency ?? 'eur',
          amount_total: lines.reduce((s, l) => s + l.quantity * l.price_data.unit_amount, 0) + shipping,
          metadata: p.metadata ?? {},
          customer: p.customer ?? null,
          customer_details: null,
          collected_information: null,
          invoice: null,
          subscription: null,
        }
        this.sessions.set(id, session)
        return session
      },
      retrieve: async (id: string) => {
        const s = this.sessions.get(id)
        if (!s) throw new Error(`no session ${id}`)
        return s
      },
      update: async (id: string, params: Record<string, any>) => {
        const s = this.sessions.get(id)
        if (!s) throw new Error(`no session ${id}`)
        this.sessionUpdates.push({ id, params })
        return s
      },
    },
  }
  customers = {
    create: async (p: Record<string, any>) => {
      this.customersCreated.push(p)
      return { id: `cus_test_${++this.n}`, ...p }
    },
  }
  invoices = {
    retrieve: async (id: string) => {
      if (this.invoiceError) throw new Error('stripe down')
      return { id, number: this.invoiceNumbers.get(id) ?? null, invoice_pdf: this.invoicePdfs.get(id) ?? null, hosted_invoice_url: this.hostedInvoiceUrls.get(id) ?? null }
    },
    update: async (id: string, params: unknown) => {
      this.invoiceUpdates.push({ id, params })
      return { id }
    },
  }
  subscriptions = {
    update: async (id: string, params: any) => {
      this.subscriptionUpdates.push({ id, params })
      return { id }
    },
  }
  portalSessions: Record<string, any>[] = []
  billingPortal = {
    sessions: {
      create: async (p: Record<string, any>) => {
        this.portalSessions.push(p)
        return { url: `https://billing.stripe.test/${p.customer}` }
      },
    },
  }
  invoicePdfs = new Map<string, string>()
  hostedInvoiceUrls = new Map<string, string>()
  invoiceNumbers = new Map<string, string>()
  invoiceError = false
  webhooks = {
    constructEventAsync: async (raw: string, signature: string) => {
      if (signature !== 'valid') throw new Error('bad signature')
      return JSON.parse(raw) as Stripe.Event
    },
  }

  /** The buyer paid. */
  complete(id: string, extra: Record<string, any> = {}) {
    const s = this.sessions.get(id)!
    Object.assign(s, {
      status: 'complete',
      payment_status: 'paid',
      customer_details: { email: 'buyer@example.com', name: 'Bea Buyer', address: { country: 'AT', city: 'Wien', line1: 'Gasse 1', postal_code: '1010' } },
      invoice: s.mode === 'payment' ? `in_test_${id}` : `in_test_first_${id}`,
      ...extra,
    })
    return s
  }

  asStripe(): Stripe {
    return this as unknown as Stripe
  }
}
