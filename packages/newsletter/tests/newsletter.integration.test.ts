import { handleEndpoints, type CollectionConfig } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mailLayout, type MailTheme } from '@daugtcom/payload-mail'
import { makeToken, parseCsv, parseSubscribers, payloadNewsletter, renderNewsletter, resetRateLimits, resolveOptions, sendBatch, signSvix, startSending, tick, deleteStalePending, importSubscribers } from '../src'
import { boot, type Booted } from './support/harness'

const theme: MailTheme = {
  siteName: 'Test Praxis',
  baseUrl: 'https://praxis.example',
  logoUrl: 'https://praxis.example/logo.png',
  colors: { primary: '#a32a55', heading: '#3a0c1e', text: '#4a3f3b', muted: '#85766f', background: '#fcf8f5', card: '#ffffff', border: '#eadfd9', tint: '#fbf1f3' },
}
const SECRET = 'whsec_' + Buffer.from('webhook-test-secret-123').toString('base64')
const Articles: CollectionConfig = { slug: 'articles', fields: [{ name: 'title', type: 'text' }, { name: 'slug', type: 'text' }, { name: 'summary', type: 'textarea' }] }

describe('payloadNewsletter on a real Payload + Postgres', () => {
  let b: Booted
  const sent: any[] = []
  let failFor: string | null = null
  let adminToken = ''
  let memberToken = ''
  const o = () => resolveOptions({ theme, serverURL: 'https://praxis.example', mailLayout: mailLayout(theme), postalAddress: ['Test Praxis', 'Musterweg 1, 1010 Wien'], teaserCollections: ['articles'], hrefFor: (c, d) => `/${c}/${d.slug}`, sendDelayMs: 0, pendingDays: 14 })

  const call = async (method: 'GET' | 'POST', path: string, init: { body?: unknown; token?: string; headers?: Record<string, string>; raw?: string } = {}) => {
    const res = await handleEndpoints({
      config: b.payload.config,
      payloadInstanceCacheKey: b.dbName,
      request: new Request(`http://localhost/api${path}`, {
        method,
        redirect: 'manual',
        headers: { ...(method === 'POST' && init.raw === undefined ? { 'content-type': 'application/json' } : {}), ...(init.token ? { Authorization: `JWT ${init.token}` } : {}), ...init.headers },
        ...(method === 'POST' ? { body: init.raw ?? JSON.stringify(init.body ?? {}) } : {}),
      }),
    })
    const text = await res.text()
    return { status: res.status, location: res.headers.get('location'), json: (() => { try { return JSON.parse(text) } catch { return null } })() }
  }
  const subscribeBody = (email: string, extra: Record<string, unknown> = {}) => ({ email, name: 'Anna Test', ts: Date.now() - 10_000, website: '', ...extra })
  const subs = async (where: Record<string, unknown> = {}) => (await b.payload.find({ collection: 'newsletterSubscribers', where: where as never, limit: 0, pagination: false, depth: 0, overrideAccess: true, sort: 'email' })).docs as any[]
  const mk = (email: string, status = 'confirmed', extra: Record<string, unknown> = {}) => b.payload.create({ collection: 'newsletterSubscribers', data: { email, status, consentAt: new Date().toISOString(), consentSource: 'manual', ...extra } as never, overrideAccess: true }) as Promise<any>
  const tokenOf = (mail: any) => decodeURIComponent((mail.html as string).match(/token=([^"&]+)/)![1]!)

  beforeAll(async () => {
    b = await boot({
      collections: [Articles],
      plugins: [payloadNewsletter({ theme, serverURL: 'https://praxis.example', mailLayout: mailLayout(theme), postalAddress: ['Test Praxis', 'Musterweg 1, 1010 Wien'], teaserCollections: ['articles'], hrefFor: (c, d) => `/${c}/${d.slug}`, sendDelayMs: 0, webhookSecret: SECRET, rateLimit: { max: 6, windowMinutes: 60 } })],
    })
    const p = b.payload
    ;(p as any).sendEmail = async (m: any) => {
      if (failFor && String(m.to) === failFor) throw new Error('mailbox full')
      sent.push(m)
    }
    await p.create({ collection: 'users', data: { email: 'admin@example.com', password: 'pw-pw-pw-1', roles: ['admin'] } as never })
    await p.create({ collection: 'users', data: { email: 'member@example.com', password: 'pw-pw-pw-1' } as never })
    adminToken = (await p.login({ collection: 'users', data: { email: 'admin@example.com', password: 'pw-pw-pw-1' } })).token!
    memberToken = (await p.login({ collection: 'users', data: { email: 'member@example.com', password: 'pw-pw-pw-1' } })).token!
  }, 90_000)

  afterAll(async () => { await b?.close() })
  beforeEach(() => { resetRateLimits(); sent.length = 0; failFor = null })

  it('signup always answers the same, mails only new or still pending addresses, never confirmed ones', async () => {
    const first = await call('POST', '/newsletter/subscribe', { body: subscribeBody('Neu@Example.com'), headers: { 'x-forwarded-for': '1.1.1.1' } })
    expect(first).toMatchObject({ status: 200, json: { ok: true } })
    const row = (await subs({ email: { equals: 'neu@example.com' } }))[0]
    expect(row).toMatchObject({ status: 'pending', consentSource: 'form', consentIp: '1.1.1.1', name: 'Anna Test' })
    expect(sent).toHaveLength(1)
    expect(sent[0].subject).toMatch(/bestätige/i)
    expect(sent[0].html).toContain('/api/newsletter/confirm?token=')
    expect(sent[0].html).toContain('Test Praxis') // themed layout

    // again right away: same answer, no second mail (once per 10 minutes)
    expect(await call('POST', '/newsletter/subscribe', { body: subscribeBody('neu@example.com'), headers: { 'x-forwarded-for': '1.1.1.2' } })).toMatchObject({ status: 200, json: { ok: true } })
    expect(sent).toHaveLength(1)

    // a confirmed address: same answer, nothing happens
    await mk('bekannt@example.com')
    expect(await call('POST', '/newsletter/subscribe', { body: subscribeBody('bekannt@example.com'), headers: { 'x-forwarded-for': '1.1.1.3' } })).toMatchObject({ status: 200, json: { ok: true } })
    expect(sent).toHaveLength(1)
    expect((await subs({ email: { equals: 'bekannt@example.com' } }))[0].status).toBe('confirmed')

    expect((await call('POST', '/newsletter/subscribe', { body: subscribeBody('kein-email') })).status).toBe(400)
  })

  it('honeypot, too-fast forms and rate limits get the friendly answer but do nothing', async () => {
    const hp = await call('POST', '/newsletter/subscribe', { body: subscribeBody('bot1@example.com', { website: 'http://spam' }), headers: { 'x-forwarded-for': '2.2.2.2' } })
    const fast = await call('POST', '/newsletter/subscribe', { body: subscribeBody('bot2@example.com', { ts: Date.now() }), headers: { 'x-forwarded-for': '2.2.2.2' } })
    const noTs = await call('POST', '/newsletter/subscribe', { body: { email: 'bot3@example.com' }, headers: { 'x-forwarded-for': '2.2.2.2' } })
    for (const r of [hp, fast, noTs]) expect(r).toMatchObject({ status: 200, json: { ok: true } })
    expect(await subs({ email: { in: ['bot1@example.com', 'bot2@example.com', 'bot3@example.com'] } })).toHaveLength(0)
    expect(sent).toHaveLength(0)

    // per IP: 6 allowed (the three above counted), then 429
    for (let i = 0; i < 3; i++) await call('POST', '/newsletter/subscribe', { body: subscribeBody(`ip${i}@example.com`), headers: { 'x-forwarded-for': '2.2.2.2' } })
    expect((await call('POST', '/newsletter/subscribe', { body: subscribeBody('ip9@example.com'), headers: { 'x-forwarded-for': '2.2.2.2' } })).status).toBe(429)
    // per address: the 4th try for one address from different IPs does nothing
    for (let i = 0; i < 5; i++) await call('POST', '/newsletter/subscribe', { body: subscribeBody('viel@example.com'), headers: { 'x-forwarded-for': `3.3.3.${i}` } })
    expect(sent.filter((m) => String(m.to) === 'viel@example.com').length).toBeLessThanOrEqual(1)
  })

  it('confirm and unsubscribe work with signed links only (also one-click POST), forged ones lead to the invalid page', async () => {
    await call('POST', '/newsletter/subscribe', { body: subscribeBody('ok@example.com'), headers: { 'x-forwarded-for': '4.4.4.4' } })
    const token = tokenOf(sent.at(-1))
    const bad = await call('GET', `/newsletter/confirm?token=${encodeURIComponent(token.replace(/.$/, 'x'))}`)
    expect(bad).toMatchObject({ status: 302 }); expect(bad.location).toContain('/newsletter/ungueltig')
    expect((await subs({ email: { equals: 'ok@example.com' } }))[0].status).toBe('pending')
    const good = await call('GET', `/newsletter/confirm?token=${encodeURIComponent(token)}`)
    expect(good.location).toBe('https://praxis.example/newsletter/bestaetigt')
    const row = (await subs({ email: { equals: 'ok@example.com' } }))[0]
    expect(row.status).toBe('confirmed'); expect(row.confirmedAt).toBeTruthy()
    // a confirm token cannot unsubscribe (different purpose)
    expect((await call('GET', `/newsletter/unsubscribe?token=${encodeURIComponent(token)}`)).location).toContain('/newsletter/ungueltig')
    const unsub = makeToken(b.payload, 'unsubscribe', row.id, row.email)
    expect((await call('POST', `/newsletter/unsubscribe?token=${encodeURIComponent(unsub)}`, { raw: 'List-Unsubscribe=One-Click', headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status).toBe(200)
    expect((await subs({ email: { equals: 'ok@example.com' } }))[0]).toMatchObject({ status: 'unsubscribed' })
    expect((await call('GET', `/newsletter/unsubscribe?token=${encodeURIComponent(unsub)}`)).location).toBe('https://praxis.example/newsletter/abgemeldet')
  })

  it('the cleanup job deletes only old pending signups', async () => {
    const old = new Date(Date.now() - 15 * 86_400_000).toISOString()
    const fresh = new Date(Date.now() - 2 * 86_400_000).toISOString()
    await mk('old-pending@example.com', 'pending', { consentAt: old })
    await mk('fresh-pending@example.com', 'pending', { consentAt: fresh })
    await mk('old-confirmed@example.com', 'confirmed', { consentAt: old })
    const deleted = await deleteStalePending(b.payload, o())
    expect(deleted).toBeGreaterThanOrEqual(1)
    const left = (await subs()).map((s) => s.email)
    expect(left).not.toContain('old-pending@example.com')
    expect(left).toContain('fresh-pending@example.com')
    expect(left).toContain('old-confirmed@example.com')
  })

  it('renders the blocks in the theme with the unsubscribe link, address and teaser', async () => {
    const article = await b.payload.create({ collection: 'articles', data: { title: 'Ankommen im Herbst', slug: 'ankommen', summary: 'Eine kurze Übung für dunkle Tage.' } as never })
    const r = await renderNewsletter(b.payload, o(), {
      subject: 'Herbstpost', preheader: 'Neu für dich',
      blocks: [
        { blockType: 'heading', text: 'Hallo Welt', level: 'h1' },
        { blockType: 'text', content: { root: { children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Fett', format: 1 }, { type: 'text', text: ' und ' }, { type: 'link', fields: { url: 'https://x.example/a' }, children: [{ type: 'text', text: 'Link' }] }] }] } } },
        { blockType: 'button', label: 'Zum Shop', url: '/shop' },
        { blockType: 'divider' },
        { blockType: 'teaser', doc: { relationTo: 'articles', value: article.id }, buttonLabel: 'Lesen' },
      ],
    })
    expect(r.subject).toBe('Herbstpost')
    expect(r.html).toContain('Test Praxis')
    expect(r.html).toContain('https://praxis.example/logo.png')
    expect(r.html).toContain('Hallo Welt')
    expect(r.html).toContain('href="https://praxis.example/shop"')
    expect(r.html).toContain('<strong>Fett</strong>')
    expect(r.html).toContain('Ankommen im Herbst')
    expect(r.html).toContain('href="https://praxis.example/articles/ankommen"')
    expect(r.html).toContain('Eine kurze Übung für dunkle Tage.')
    expect(r.html).toContain('Musterweg 1, 1010 Wien')
    expect(r.html).toContain('%%UNSUBSCRIBE_URL%%')
    expect(r.text).toContain('Newsletter abbestellen')
  })

  it('sends in batches exactly once per recipient: failures are recorded, reruns and a crashed claim never double-send', async () => {
    for (const e of ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com']) await mk(`send-${e}`)
    await mk('send-out@example.com', 'unsubscribed')
    await mk('send-wait@example.com', 'pending')
    const n = (await b.payload.create({ collection: 'newsletters', data: { subject: 'Test', blocks: [{ blockType: 'heading', text: 'Hi', level: 'h2' }] } as never })) as any
    failFor = 'send-b@example.com'
    const started = await startSending(b.payload, o(), n.id)
    expect(started.status).toBe('sending')
    const confirmedCount = (await subs({ status: { equals: 'confirmed' } })).length
    expect(started.recipients).toBe(confirmedCount)
    // starting twice does not queue twice
    await expect(startSending(b.payload, o(), n.id)).rejects.toMatchObject({ code: 'already-sent' })

    const first = await sendBatch(b.payload, o(), n.id, 2)
    expect(first.sent + first.failed).toBe(2)
    sent.length = 0
    // a crash between claiming and sending leaves a delivery "sending": it is not picked up again
    const queued = (await b.payload.find({ collection: 'newsletterDeliveries', where: { and: [{ newsletter: { equals: n.id } }, { status: { equals: 'queued' } }] } as never, limit: 1, depth: 0, overrideAccess: true })).docs[0] as any
    await b.payload.update({ collection: 'newsletterDeliveries', id: queued.id, data: { status: 'sending' } as never, overrideAccess: true })
    let guard = 0
    while (guard++ < 10 && !(await sendBatch(b.payload, o(), n.id, 2)).done) { /* keep going */ }
    const all = (await b.payload.find({ collection: 'newsletterDeliveries', where: { newsletter: { equals: n.id } } as never, limit: 0, pagination: false, depth: 0, overrideAccess: true })).docs as any[]
    expect(all).toHaveLength(confirmedCount)
    expect(all.find((d) => d.email === 'send-b@example.com')).toMatchObject({ status: 'failed', error: 'mailbox full' })
    expect(all.find((d) => d.id === queued.id)?.status).toBe('sending') // stuck, not retried
    // nobody got two copies, and unsubscribed/pending people got none
    const recipients = [...sent.map((m) => String(m.to))]
    expect(new Set(recipients).size).toBe(recipients.length)
    expect(recipients).not.toContain('send-out@example.com'); expect(recipients).not.toContain('send-wait@example.com')
    const mail = sent[0]
    expect(mail.headers['List-Unsubscribe']).toMatch(/\/api\/newsletter\/unsubscribe\?token=/)
    expect(mail.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    expect(mail.html).toContain('/api/newsletter/unsubscribe?token=')
    expect(mail.html).not.toContain('%%UNSUBSCRIBE_URL%%')
    // every recipient has their own link
    expect(new Set(sent.map((m) => (m.html as string).match(/unsubscribe\?token=([^"]+)/)![1])).size).toBe(sent.length)
    // a rerun sends nothing more
    sent.length = 0
    expect((await sendBatch(b.payload, o(), n.id, 50)).sent).toBe(0)
    expect(sent).toHaveLength(0)
    const nl = (await b.payload.findByID({ collection: 'newsletters', id: n.id, depth: 0, overrideAccess: true })) as any
    expect(nl.stats.failed).toBe(1)
  })

  it('the job tick starts a scheduled newsletter when its time has come and sends it', async () => {
    const n = (await b.payload.create({ collection: 'newsletters', data: { subject: 'Geplant', blocks: [{ blockType: 'heading', text: 'Später', level: 'h2' }] } as never })) as any
    const later = new Date(Date.now() + 3_600_000)
    expect(await startSending(b.payload, o(), n.id, later)).toMatchObject({ status: 'scheduled' })
    expect((await tick(b.payload, o())).started).toBe(0)
    expect(sent.filter((m) => m.subject === 'Geplant')).toHaveLength(0)
    const r = await tick(b.payload, o(), new Date(later.getTime() + 1000))
    expect(r.started).toBe(1)
    expect(r.sent).toBeGreaterThan(0)
    expect(((await b.payload.findByID({ collection: 'newsletters', id: n.id, depth: 0, overrideAccess: true })) as any).status).toBe('sent')
  })

  it('CSV: BOM, semicolons, quotes and ActiveCampaign columns; dry run; both import modes', async () => {
    const ac = '﻿"Email","First Name","Last Name","Status"\r\n"csv-a@example.com","Anna","Berger","Active"\r\n"CSV-B@example.com","Ben ""B""","Tester","Active"\r\n"csv-a@example.com","Doppelt","",""\r\n"kaputt","X","Y","Active"\r\n"csv-out@example.com","Olga","Weg","Unsubscribed"\r\n'
    const parsed = parseSubscribers(ac)
    expect(parsed.rows.map((r) => r.email)).toEqual(['csv-a@example.com', 'csv-b@example.com', 'csv-out@example.com'])
    expect(parsed.rows[1]!.name).toBe('Ben "B" Tester')
    expect(parsed.rows[2]!.status).toBe('unsubscribed')
    expect(parsed.invalid).toEqual(['kaputt']); expect(parsed.duplicates).toBe(1)
    expect(parseCsv('email;name\nx@example.com;"Mit; Semikolon"\n')[1]).toEqual(['x@example.com', 'Mit; Semikolon'])
    expect(parseSubscribers('E-Mail-Adresse,Vorname\nde@example.com,Dora\n').rows[0]).toMatchObject({ email: 'de@example.com', name: 'Dora' })

    // dry run changes nothing
    await mk('csv-a@example.com') // exists already
    const dry = await importSubscribers(b.payload, o(), { csv: ac, mode: 'reconfirm' })
    expect(dry).toMatchObject({ dryRun: true, new: 2, existing: 1, invalid: 1, duplicates: 1, suppressed: 1 })
    expect(await subs({ email: { equals: 'csv-b@example.com' } })).toHaveLength(0)

    // reconfirm: pending + opt-in mail, suppressed ones never mailed
    sent.length = 0
    const done = await importSubscribers(b.payload, o(), { csv: ac, mode: 'reconfirm', dryRun: false })
    expect(done).toMatchObject({ dryRun: false, new: 2, mailed: 1 })
    expect((await subs({ email: { equals: 'csv-b@example.com' } }))[0]).toMatchObject({ status: 'pending', consentSource: 'import' })
    expect((await subs({ email: { equals: 'csv-out@example.com' } }))[0].status).toBe('unsubscribed')
    expect(sent.map((m) => String(m.to))).toEqual(['csv-b@example.com'])

    // already-consented needs the attestation, then imports as confirmed with the text stored
    const csv2 = 'email,name\nconsent-1@example.com,Eins\nconsent-2@example.com,Zwei\n'
    await expect(importSubscribers(b.payload, o(), { csv: csv2, mode: 'already-consented', dryRun: false })).rejects.toMatchObject({ code: 'attestation-required' })
    sent.length = 0
    await importSubscribers(b.payload, o(), { csv: csv2, mode: 'already-consented', dryRun: false, attest: 'Alle haben per Double Opt-in zugestimmt (Export vom 1.10.).' })
    expect((await subs({ email: { equals: 'consent-1@example.com' } }))[0]).toMatchObject({ status: 'confirmed', consentSource: 'import', consentNote: 'Alle haben per Double Opt-in zugestimmt (Export vom 1.10.).' })
    expect(sent).toHaveLength(0)
  })

  it('staff endpoints refuse anonymous visitors and members; staff get preview, import preview and test mail', async () => {
    for (const path of ['/newsletter/preview', '/newsletter/test', '/newsletter/send', '/newsletter/import', '/newsletter/cancel']) {
      expect((await call('POST', path, { body: {} })).status).toBe(401)
      expect((await call('POST', path, { body: {}, token: memberToken })).status).toBe(401)
    }
    expect((await call('GET', '/newsletter/live-preview')).status).toBe(401)
    expect((await call('GET', '/newsletter/live-preview', { token: memberToken })).status).toBe(401)
    expect((await call('GET', '/newsletter/live-preview', { token: adminToken })).status).toBe(200)
    const pv = await call('POST', '/newsletter/preview', { token: adminToken, body: { data: { subject: 'Vorschau', blocks: [{ blockType: 'heading', text: 'Live', level: 'h2' }] } } })
    expect(pv.status).toBe(200); expect(pv.json.html).toContain('Live'); expect(pv.json.html).not.toContain('%%UNSUBSCRIBE_URL%%')
    sent.length = 0
    expect((await call('POST', '/newsletter/test', { token: adminToken, body: { data: { subject: 'Probe', blocks: [{ blockType: 'heading', text: 'T', level: 'h2' }] } } })).json).toMatchObject({ ok: true, to: 'admin@example.com' })
    expect(sent[0].subject).toBe('[Test] Probe')
    const imp = await call('POST', '/newsletter/import', { token: adminToken, body: { csv: 'email\nendpoint@example.com\n', mode: 'reconfirm' } })
    expect(imp.json).toMatchObject({ dryRun: true, new: 1 })
    const attestMissing = await call('POST', '/newsletter/import', { token: adminToken, body: { csv: 'email\nendpoint@example.com\n', mode: 'already-consented', dryRun: false } })
    expect(attestMissing.status).toBe(400)
  })

  it('the Resend webhook needs a valid signature and marks bounces and complaints', async () => {
    await mk('hard@example.com'); await mk('spam@example.com'); await mk('soft@example.com')
    const post = (event: unknown, sign = true, ts = Math.floor(Date.now() / 1000)) => {
      const raw = JSON.stringify(event)
      return call('POST', '/newsletter/webhook/resend', { raw, headers: { 'content-type': 'application/json', 'svix-id': 'msg_1', 'svix-timestamp': String(ts), 'svix-signature': sign ? signSvix(SECRET, 'msg_1', ts, raw) : 'v1,AAAA' } })
    }
    expect((await post({ type: 'email.bounced', data: { to: ['hard@example.com'] } }, false)).status).toBe(401)
    expect((await post({ type: 'email.bounced', data: { to: ['hard@example.com'] } }, true, Math.floor(Date.now() / 1000) - 3600)).status).toBe(401)
    expect((await subs({ email: { equals: 'hard@example.com' } }))[0].status).toBe('confirmed')
    expect((await post({ type: 'email.bounced', data: { to: ['Hard <hard@example.com>'], bounce: { type: 'Permanent' } } })).status).toBe(200)
    expect((await post({ type: 'email.complained', data: { to: ['spam@example.com'] } })).status).toBe(200)
    expect((await post({ type: 'email.bounced', data: { to: ['soft@example.com'], bounce: { type: 'Transient' } } })).status).toBe(200)
    expect((await subs({ email: { equals: 'hard@example.com' } }))[0].status).toBe('bounced')
    expect((await subs({ email: { equals: 'spam@example.com' } }))[0].status).toBe('complained')
    expect((await subs({ email: { equals: 'soft@example.com' } }))[0].status).toBe('confirmed')
  })
})
