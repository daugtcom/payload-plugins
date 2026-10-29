import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { handleEndpoints } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { payloadCommerce } from '../src'
import { FakeStripe } from './support/fakeStripe'
import { boot, type Booted } from './support/harness'

describe('monthly invoice export (job queue) on a real Payload + Postgres', () => {
  let b: Booted
  const stripe = new FakeStripe()
  const mails: { to: string; subject: string; text: string }[] = []
  let staffToken: string
  let memberToken: string
  let staffID: number | string

  const post = async (token: string | null, body: unknown) => {
    const res = await handleEndpoints({ config: b.payload.config, request: new Request('http://localhost/api/commerce/invoice-exports', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { Authorization: `JWT ${token}` } : {}) }, body: JSON.stringify(body) }) })
    return { status: res.status, json: (await res.json()) as any }
  }
  const exportDoc = async (id: number | string) => (await b.payload.findByID({ collection: 'invoiceExports' as never, id, depth: 0, overrideAccess: true })) as any

  beforeAll(async () => {
    b = await boot({
      collections: [],
      plugins: [
        payloadCommerce({
          invoiceExportsDir: mkdtempSync(join(tmpdir(), 'exports-')),
          invoiceFileUrl: (key) => `https://files.test/${key}`,
          stripe: { secretKey: 'sk_test_fake', webhookSecret: 'whsec', successUrl: 'http://localhost/ok', cancelUrl: 'http://localhost/cancel', ...({ stripe: stripe.asStripe() } as object) },
        }),
      ],
    })
    const p = b.payload
    p.sendEmail = (async (m: { to: string; subject: string; text: string }) => void mails.push(m)) as never
    staffID = (await p.create({ collection: 'users', data: { email: 'finance@example.com', password: 'pw-pw-pw-1', roles: ['admin'] } as never })).id
    staffToken = (await p.login({ collection: 'users', data: { email: 'finance@example.com', password: 'pw-pw-pw-1' } })).token!
    await p.create({ collection: 'users', data: { email: 'member@example.com', password: 'pw-pw-pw-1' } as never })
    memberToken = (await p.login({ collection: 'users', data: { email: 'member@example.com', password: 'pw-pw-pw-1' } })).token!

    const order = await p.create({ collection: 'orders', data: { currency: 'EUR', amount: 100, customerEmail: 'x@example.com', paymentStatus: 'paid' } as never, overrideAccess: true })
    const inv = (data: Record<string, unknown>, createdAt: string) => p.create({ collection: 'invoices', data: { order: order.id, status: 'paid', createdAt, ...data } as never, overrideAccess: true })
    await inv({ stripeInvoiceID: 'in_sept_1' }, '2026-09-03T10:00:00Z')
    await inv({ stripeInvoiceID: 'in_sept_2' }, '2026-09-28T10:00:00Z')
    await inv({ file: 'invoices/Rechnung-2026-09-A.pdf' }, '2026-09-15T10:00:00Z')
    await inv({ file: 'invoices/other-folder/Rechnung-2026-09-A.pdf' }, '2026-09-16T10:00:00Z') // same file name must not overwrite the first
    await inv({ stripeInvoiceID: 'in_gone' }, '2026-09-20T10:00:00Z') // Stripe has no PDF for it
    await inv({ stripeInvoiceID: 'in_aug' }, '2026-08-31T23:59:59Z') // outside the month
    await inv({ stripeInvoiceID: 'in_unpaid', status: 'open' }, '2026-09-10T10:00:00Z')
    for (const id of ['in_sept_1', 'in_sept_2', 'in_aug']) stripe.invoicePdfs.set(id, `https://pay.stripe.test/${id}.pdf`)

    vi.stubGlobal('fetch', async (url: string) => (url.includes('.pdf') ? new Response(new TextEncoder().encode(`PDF:${url}`), { status: 200 }) : new Response('nope', { status: 404 })))
  }, 90_000)

  afterAll(async () => {
    vi.unstubAllGlobals()
    await b?.close()
  })

  it('only staff may request an export, with a valid month', async () => {
    expect((await post(null, { month: '2026-09' })).status).toBe(403)
    expect((await post(memberToken, { month: '2026-09' })).status).toBe(403)
    expect((await post(staffToken, { month: '09/2026' })).status).toBe(400)
  })

  it('queues the export, the job zips every paid invoice of the month once, and the requester is told', async () => {
    const r = await post(staffToken, { month: '2026-09' })
    expect(r.status).toBe(202)
    expect((await exportDoc(r.json.id)).status).toBe('queued')

    await b.payload.jobs.run()

    const done = await exportDoc(r.json.id)
    expect(done).toMatchObject({ status: 'ready', count: 4, skipped: 1, requestedBy: staffID, mimeType: 'application/zip', filename: 'invoice-export-2026-09.zip' })

    const { readFile } = await import('node:fs/promises')
    const dir = (b.payload.collections['invoiceExports' as never] as any).config.upload.staticDir as string
    const zip = unzipSync(new Uint8Array(await readFile(join(dir, done.filename))))
    expect(Object.keys(zip).sort()).toEqual(['Rechnung-2026-09-A-2.pdf', 'Rechnung-2026-09-A.pdf', 'in_sept_1.pdf', 'in_sept_2.pdf'])
    expect(new TextDecoder().decode(zip['in_sept_1.pdf'])).toBe('PDF:https://pay.stripe.test/in_sept_1.pdf')
    expect(new TextDecoder().decode(zip['Rechnung-2026-09-A.pdf'])).toBe('PDF:https://files.test/invoices/Rechnung-2026-09-A.pdf')

    expect(mails).toHaveLength(1)
    expect(mails[0]).toMatchObject({ to: 'finance@example.com', subject: 'Invoice export 2026-09 is ready' })
    expect(mails[0]!.text).toContain('4 invoices (1 could not be fetched)')
  })

  it('a month without paid invoices ends as "empty" and says so', async () => {
    mails.length = 0
    const r = await post(staffToken, { month: '2026-01' })
    await b.payload.jobs.run()
    expect((await exportDoc(r.json.id)).status).toBe('empty')
    expect(mails[0]!.subject).toBe('Invoice export 2026-01: nothing to export')
  })
})
