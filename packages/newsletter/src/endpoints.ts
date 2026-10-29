import type { Endpoint, PayloadRequest } from 'payload'
import { ImportError, importSubscribers } from './csv'
import type { Id, ResolvedNewsletterOptions } from './options'
import { renderNewsletter } from './render'
import { audienceOf, cancelSchedule, sendTest, SendError, startSending } from './send'
import { confirm, limited, normalizeEmail, subscribe, unsubscribe } from './subscribe'
import { verifySvix } from './webhook'

const json = (status: number, data: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } })
const idish = (v: unknown): Id | undefined => (typeof v === 'string' && v ? v : typeof v === 'number' ? v : undefined)
const clientIp = (req: PayloadRequest): string | null => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null

export function newsletterEndpoints(o: ResolvedNewsletterOptions): Endpoint[] {
  const staffOnly = (handler: (req: PayloadRequest) => Promise<Response>): Endpoint['handler'] => async (req) => {
    if (!req.user || !o.isStaff(req.user)) return json(401, { error: 'unauthorized' })
    try {
      return await handler(req)
    } catch (err) {
      if (err instanceof SendError) return json(err.status, { error: err.code, message: err.message })
      if (err instanceof ImportError) return json(400, { error: err.code, message: err.message })
      req.payload.logger.error({ err, msg: 'payload-newsletter endpoint failed' })
      return json(500, { error: 'failed' })
    }
  }
  const body = async (req: PayloadRequest): Promise<Record<string, any>> => ((await req.json?.().catch(() => ({}))) ?? {}) as Record<string, any>
  const base = (req: PayloadRequest) => (o.serverURL ?? req.payload.config.serverURL ?? '').replace(/\/$/, '')
  const redirect = (req: PayloadRequest, path: string) => new Response(null, { status: 302, headers: { location: `${base(req)}${path}`, 'cache-control': 'no-store' } })
  /** The newsletter to work on: saved (`id`) with the editor's unsaved values on top (`data`), or just the data. */
  const dataOf = async (req: PayloadRequest, b: Record<string, any>) => {
    const id = idish(b.id)
    const saved = id != null ? ((await req.payload.findByID({ collection: o.newslettersSlug as never, id, depth: 0, overrideAccess: true }).catch(() => null)) as Record<string, any> | null) : null
    return { ...(saved ?? {}), ...(b.data ?? {}) }
  }

  return [
    // ------------------------------------------------------------ public
    {
      path: '/newsletter/subscribe',
      method: 'post',
      handler: async (req) => {
        const b = await body(req)
        const ip = clientIp(req)
        if (limited(`ip:${ip ?? 'unknown'}`, o.rateLimit.max, o.rateLimit.windowMinutes)) return json(429, { error: 'rate-limited' })
        const email = normalizeEmail(b.email)
        if (!email) return json(400, { error: 'invalid-email' })
        // bots: a filled honeypot or a form that was submitted too fast. They get the same friendly answer, nothing happens.
        const filledAt = Number(b.ts)
        const tooFast = !Number.isFinite(filledAt) || Date.now() - filledAt < o.minFillSeconds * 1000
        const bot = (typeof b.website === 'string' && b.website.trim() !== '') || tooFast
        if (!bot && !limited(`email:${email}`, 3, o.rateLimit.windowMinutes)) {
          await subscribe(req.payload, o, { email, name: typeof b.name === 'string' ? b.name.trim().slice(0, 120) : undefined, ip, source: 'form' }).catch((err) => req.payload.logger.error({ err, msg: 'payload-newsletter: subscribe failed' }))
        }
        return json(200, { ok: true })
      },
    },
    { path: '/newsletter/confirm', method: 'get', handler: async (req) => redirect(req, (await confirm(req.payload, o, new URL(req.url!).searchParams.get('token'))) === 'ok' ? o.pages.confirmed : o.pages.invalid) },
    { path: '/newsletter/unsubscribe', method: 'get', handler: async (req) => redirect(req, (await unsubscribe(req.payload, o, new URL(req.url!).searchParams.get('token'))) === 'ok' ? o.pages.unsubscribed : o.pages.invalid) },
    // RFC 8058 one-click: the mail client POSTs `List-Unsubscribe=One-Click` to the link of the List-Unsubscribe header
    { path: '/newsletter/unsubscribe', method: 'post', handler: async (req) => ((await unsubscribe(req.payload, o, new URL(req.url!).searchParams.get('token'))) === 'ok' ? json(200, { ok: true }) : json(400, { error: 'invalid-token' })) },

    // ------------------------------------------------------------ staff: editor
    {
      path: '/newsletter/live-preview',
      method: 'get',
      handler: staffOnly(async () => new Response(`<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Newsletter-Vorschau</title>
<style>html,body{margin:0;width:100%;height:100%;background:#fff}iframe{width:100%;height:100%;border:0;display:block}</style></head>
<body><iframe title="Newsletter-Vorschau" sandbox></iframe><script>
(() => {
  const frame = document.querySelector('iframe');
  const parentWindow = window.opener || window.parent;
  let timer, active;
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== parentWindow || event.data?.type !== 'payload-live-preview' || !event.data.data) return;
    clearTimeout(timer);
    if (active) active.abort();
    const data = event.data.data;
    timer = setTimeout(async () => {
      active = new AbortController();
      const current = active;
      try {
        const response = await fetch(location.pathname.slice(0, location.pathname.lastIndexOf('/')) + '/preview', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: data.id, data: { subject: data.subject, preheader: data.preheader, blocks: data.blocks } }), signal: current.signal });
        if (response.ok) { const result = await response.json(); if (!current.signal.aborted) frame.srcdoc = result.html; }
      } catch (error) { if (!current.signal.aborted) console.error('Newsletter preview failed', error); }
    }, 500);
  });
  parentWindow.postMessage({ type: 'payload-live-preview', ready: true }, location.origin);
})();
</script></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })),
    },
    {
      path: '/newsletter/preview',
      method: 'post',
      handler: staffOnly(async (req) => {
        const r = await renderNewsletter(req.payload, o, await dataOf(req, await body(req)))
        return json(200, { subject: r.subject, html: r.html.split('%%UNSUBSCRIBE_URL%%').join('#') })
      }),
    },
    {
      path: '/newsletter/test',
      method: 'post',
      handler: staffOnly(async (req) => {
        const to = (req.user as { email?: string }).email
        if (!to) return json(400, { error: 'no-email' })
        await sendTest(req.payload, o, await dataOf(req, await body(req)), to)
        return json(200, { ok: true, to })
      }),
    },
    {
      path: '/newsletter/audience',
      method: 'get',
      handler: staffOnly(async (req) => {
        const id = idish(new URL(req.url!).searchParams.get('id'))
        const n = id != null ? ((await req.payload.findByID({ collection: o.newslettersSlug as never, id, depth: 0, overrideAccess: true }).catch(() => null)) as Record<string, any> | null) : null
        return json(200, { recipients: (await audienceOf(req.payload, o, n ?? {})).length })
      }),
    },
    {
      path: '/newsletter/send',
      method: 'post',
      handler: staffOnly(async (req) => {
        const b = await body(req)
        const id = idish(b.id)
        if (id == null) return json(400, { error: 'id-required' })
        const at = typeof b.at === 'string' && b.at ? new Date(b.at) : null
        if (at && Number.isNaN(at.getTime())) return json(400, { error: 'invalid-date' })
        const r = await startSending(req.payload, o, id, at)
        // start working right away when a job runner is there; otherwise the next scheduled tick picks it up
        if (r.status === 'sending') void req.payload.jobs.queue({ task: 'newsletterTick' as never, input: {} as never }).then(() => req.payload.jobs.run({ limit: 1 })).catch(() => undefined)
        return json(200, r)
      }),
    },
    {
      path: '/newsletter/cancel',
      method: 'post',
      handler: staffOnly(async (req) => {
        const id = idish((await body(req)).id)
        if (id == null) return json(400, { error: 'id-required' })
        await cancelSchedule(req.payload, o, id)
        return json(200, { ok: true })
      }),
    },

    // ------------------------------------------------------------ staff: import
    {
      path: '/newsletter/import',
      method: 'post',
      handler: staffOnly(async (req) => {
        const type = req.headers.get('content-type') ?? ''
        const q = new URL(req.url!).searchParams
        let csv = ''
        let fields: Record<string, any> = {}
        if (type.includes('multipart/form-data')) {
          const form = await (req as unknown as Request).formData()
          const file = form.get('file')
          csv = typeof file === 'string' ? file : file ? await (file as File).text() : ''
          fields = { mode: form.get('mode'), attest: form.get('attest'), dryRun: form.get('dryRun') }
        } else if (type.includes('text/csv') || type.includes('text/plain')) {
          csv = await (req as unknown as Request).text()
          fields = { mode: q.get('mode'), attest: q.get('attest'), dryRun: q.get('dryRun') }
        } else {
          const b = await body(req)
          csv = String(b.csv ?? '')
          fields = b
        }
        const truthy = (v: unknown) => v === true || v === 'true' || v === '1' || v === 1
        const attest = typeof fields.attest === 'string' && fields.attest.length > 5 && fields.attest !== 'false' && fields.attest !== 'true' ? fields.attest : truthy(fields.attest)
        const summary = await importSubscribers(req.payload, o, { csv, mode: fields.mode === 'already-consented' ? 'already-consented' : 'reconfirm', attest, dryRun: fields.dryRun === undefined || fields.dryRun === null ? true : !(fields.dryRun === false || fields.dryRun === 'false' || fields.dryRun === '0'), ip: clientIp(req) })
        return json(200, summary)
      }),
    },

    // ------------------------------------------------------------ Resend webhook: bounces and spam complaints
    {
      path: '/newsletter/webhook/resend',
      method: 'post',
      handler: async (req) => {
        const secret = o.webhookSecret ?? process.env.RESEND_WEBHOOK_SECRET
        const raw = await (req as unknown as Request).text()
        if (!secret || !verifySvix(secret, { id: req.headers.get('svix-id'), timestamp: req.headers.get('svix-timestamp'), signature: req.headers.get('svix-signature') }, raw)) return json(401, { error: 'invalid-signature' })
        let event: { type?: string; data?: { to?: string[] | string; bounce?: { type?: string } } } = {}
        try { event = JSON.parse(raw) } catch { return json(400, { error: 'invalid-json' }) }
        const status = event.type === 'email.bounced' ? (event.data?.bounce?.type?.toLowerCase() === 'transient' ? null : 'bounced') : event.type === 'email.complained' ? 'complained' : null
        if (status) {
          for (const raw of ([] as string[]).concat(event.data?.to ?? [])) {
            const email = normalizeEmail(raw.replace(/^.*<(.+)>$/, '$1'))
            if (email) await req.payload.update({ collection: o.subscribersSlug as never, where: { and: [{ email: { equals: email } }, { status: { in: ['confirmed', 'pending'] } }] } as never, data: { status } as never, overrideAccess: true, depth: 0 })
          }
        }
        return json(200, { ok: true })
      },
    },
  ]
}
