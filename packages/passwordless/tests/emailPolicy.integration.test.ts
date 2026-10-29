import { handleEndpoints } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { payloadPasswordless } from '../src'
import { refuseNewEmail } from '../src/emailPolicy'
import { boot, Users, type Booted } from './support/harness'

const noMx = Object.assign(new Error('nope'), { code: 'ENOTFOUND' })
const timeout = Object.assign(new Error('slow'), { code: 'ETIMEOUT' })

describe('refuseNewEmail', () => {
  const ok = async () => [{ exchange: 'mx.example.net', priority: 10 }]
  it('refuses throwaway domains', async () => expect(await refuseNewEmail('x@mailinator.com', {}, ok)).toBe('disposable'))
  it('refuses a domain without a mail server', async () => expect(await refuseNewEmail('x@nowhere.test', {}, async () => { throw noMx })).toBe('no-mail-server'))
  it('lets an address through when DNS is merely slow', async () => expect(await refuseNewEmail('x@real.example', {}, async () => { throw timeout })).toBeNull())
  it('refuses a domain without a dot', async () => expect(await refuseNewEmail('x@localhost', {}, ok)).toBe('no-mail-server'))
  it('honours blockedDomains and the custom check', async () => {
    expect(await refuseNewEmail('x@bad.example', { blockedDomains: ['Bad.example'] }, ok)).toBe('blocked')
    expect(await refuseNewEmail('x@fine.example', { check: (e) => !e.startsWith('x') }, ok)).toBe('blocked')
    expect(await refuseNewEmail('y@fine.example', { check: (e) => !e.startsWith('x') }, ok)).toBeNull()
  })
  it('lets an allowed domain through even if the list has it', async () => expect(await refuseNewEmail('x@mailinator.com', { allowedDomains: ['mailinator.com'] }, ok)).toBeNull())
  it('can be relaxed', async () => expect(await refuseNewEmail('x@mailinator.com', { blockDisposable: false, requireMx: false })).toBeNull())
})

describe('registration guards on a real Payload + Postgres', () => {
  let b: Booted
  const mails: string[] = []
  const post = async (body: unknown, ip?: string) => {
    const res = await handleEndpoints({
      config: b.payload.config,
      request: new Request('http://localhost/api/passwordless/request-code', { method: 'POST', headers: { 'content-type': 'application/json', ...(ip ? { 'x-forwarded-for': ip } : {}) }, body: JSON.stringify(body) }),
    })
    return { status: res.status, json: (await res.json().catch(() => null)) as any }
  }

  beforeAll(async () => {
    b = await boot({
      collections: [],
      users: Users,
      plugins: [payloadPasswordless({ newEmails: { requireMx: false }, maxRequestsPerIP: 2, sendEmail: async (_p, to) => void mails.push(to) })],
    })
    await b.payload.create({ collection: 'users', data: { email: 'old@mailinator.com', password: 'x'.repeat(12) } as never, overrideAccess: true })
  }, 90_000)
  afterAll(async () => { await b?.close() })

  it('refuses a throwaway address and sends nothing', async () => {
    const r = await post({ email: 'bot@mailinator.com' })
    expect(r.status).toBe(422)
    expect(r.json.error).toBe('email-not-allowed')
    expect(mails).toHaveLength(0)
  })

  it('does not check an existing member', async () => {
    expect((await post({ email: 'old@mailinator.com' })).status).toBe(200)
    expect(mails).toEqual(['old@mailinator.com'])
  })

  it('limits requests per IP across addresses', async () => {
    expect((await post({ email: 'a@example.com' }, '9.9.9.9')).status).toBe(200)
    expect((await post({ email: 'b@example.com' }, '9.9.9.9')).status).toBe(200)
    expect((await post({ email: 'c@example.com' }, '9.9.9.9')).status).toBe(429)
    expect((await post({ email: 'c@example.com' }, '8.8.8.8')).status).toBe(200)
  })
})
