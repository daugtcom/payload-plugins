import { handleEndpoints } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { payloadPasswordless } from '../src'
import { verifyTurnstile, TURNSTILE_VERIFY_URL } from '../src/captcha'
import { boot, Users, type Booted } from './support/harness'

describe('captcha on a real Payload + Postgres', () => {
  let b: Booted
  const mails: string[] = []

  const post = async (path: string, body: unknown) => {
    const res = await handleEndpoints({
      config: b.payload.config,
      request: new Request(`http://localhost/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    })
    return { status: res.status, json: (await res.json().catch(() => null)) as any, cookies: res.headers.getSetCookie() }
  }

  beforeAll(async () => {
    b = await boot({
      collections: [],
      users: { ...Users, fields: [...Users.fields, { name: 'emailVerifiedAt', type: 'date' }] },
      plugins: [payloadPasswordless({ captcha: { verify: async (token) => token === 'good' }, sendEmail: async (_p, to) => void mails.push(to) })],
    })
    await b.payload.create({ collection: 'users', data: { email: 'pw@example.com', password: 'correct-horse', hasPassword: true } as never, overrideAccess: true })
  }, 90_000)

  afterAll(async () => {
    await b?.close()
  })

  it('refuses a code request without a token', async () => {
    const r = await post('/passwordless/request-code', { email: 'a@example.com' })
    expect(r.status).toBe(400)
    expect(r.json.error).toBe('captcha-required')
    expect(mails).toHaveLength(0)
  })

  it('refuses a bad token', async () => {
    const r = await post('/passwordless/request-code', { email: 'a@example.com', captchaToken: 'bad' })
    expect(r.status).toBe(403)
    expect(r.json.error).toBe('captcha-failed')
    expect(mails).toHaveLength(0)
  })

  it('sends the code with a good token', async () => {
    const r = await post('/passwordless/request-code', { email: 'a@example.com', captchaToken: 'good' })
    expect(r.status).toBe(200)
    expect(mails).toEqual(['a@example.com'])
  })

  it('the password login needs the token too, then logs in with a cookie', async () => {
    const creds = { email: 'pw@example.com', password: 'correct-horse' }
    expect((await post('/passwordless/login', creds)).json.error).toBe('captcha-required')
    expect((await post('/passwordless/login', { ...creds, captchaToken: 'bad' })).status).toBe(403)
    expect((await post('/passwordless/login', { ...creds, password: 'nope', captchaToken: 'good' })).status).toBe(401)
    const ok = await post('/passwordless/login', { ...creds, captchaToken: 'good' })
    expect(ok.status).toBe(200)
    const cookie = ok.cookies.map((c) => c.split(';')[0]).join('; ')
    expect(((await b.payload.auth({ headers: new Headers({ cookie }) })).user as any)?.email).toBe('pw@example.com')
  })

  it('status stays open', async () => {
    expect((await post('/passwordless/status', { email: 'pw@example.com' })).json.hasPassword).toBe(true)
  })
})

describe('verifyTurnstile', () => {
  const reply = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as Response)

  it('posts secret, token and ip to Cloudflare and trusts success: true', async () => {
    const f = reply({ success: true })
    expect(await verifyTurnstile('sec', 'tok', '1.2.3.4', f as never)).toBe(true)
    const [url, init] = f.mock.calls[0] as unknown as [string, { body: URLSearchParams }]
    expect(url).toBe(TURNSTILE_VERIFY_URL)
    expect(Object.fromEntries(init.body)).toEqual({ secret: 'sec', response: 'tok', remoteip: '1.2.3.4' })
  })

  it('says no for success: false, an error status and a network failure', async () => {
    expect(await verifyTurnstile('s', 't', undefined, reply({ success: false }) as never)).toBe(false)
    expect(await verifyTurnstile('s', 't', undefined, reply({ success: true }, false) as never)).toBe(false)
    expect(await verifyTurnstile('s', 't', undefined, (async () => { throw new Error('down') }) as never)).toBe(false)
  })
})
