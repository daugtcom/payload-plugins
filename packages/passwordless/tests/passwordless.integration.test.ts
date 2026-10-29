import { handleEndpoints } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { needsTermsAcceptance, payloadPasswordless, safeRedirect } from '../src'
import { boot, Users, type Booted } from './support/harness'

describe('payload-passwordless on a real Payload + Postgres', () => {
  let b: Booted
  const mails: { to: string; text: string }[] = []
  const codeFor = (email: string) => /code is (\d+)/.exec([...mails].reverse().find((m) => m.to === email)!.text)![1]!
  const linkFor = (email: string) => /(http\S+\/api\/passwordless\/link\?token=\w+)/.exec([...mails].reverse().find((m) => m.to === email)!.text)![1]!

  const call = async (method: 'GET' | 'POST', path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await handleEndpoints({
      config: b.payload.config,
      request: new Request(`http://localhost${path.startsWith('/api') ? path : `/api${path}`}`, { method, headers: { 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
    })
    const text = await res.text()
    return { status: res.status, json: text && res.headers.get('content-type')?.includes('json') ? (JSON.parse(text) as any) : null, cookies: res.headers.getSetCookie(), location: res.headers.get('location') }
  }
  const post = (path: string, body: unknown, headers?: Record<string, string>) => call('POST', path, body, headers)
  const cookieHeader = (cookies: string[]) => cookies.map((c) => c.split(';')[0]).join('; ')
  const whoAmI = async (cookies: string[]) => (await b.payload.auth({ headers: new Headers({ cookie: cookieHeader(cookies) }) })).user as any

  beforeAll(async () => {
    b = await boot({
      collections: [],
      users: { ...Users, fields: [...Users.fields, { name: 'name', type: 'text' }, { name: 'emailVerifiedAt', type: 'date' }] },
      plugins: [
        payloadPasswordless({
          terms: { version: '2026-10' },
          serverURL: 'http://localhost:3000',
          maxAttempts: 3,
          maxRequests: 4,
          sendEmail: async (_p, to, c) => void mails.push({ to, text: c.text }),
        }),
      ],
    })
  }, 90_000)

  afterAll(async () => {
    await b?.close()
  })

  it('a stranger must accept the terms before a code is sent', async () => {
    expect((await post('/passwordless/status', { email: 'new@example.com' })).json).toEqual({ hasPassword: false, termsRequired: true })
    expect((await post('/passwordless/request-code', { email: 'new@example.com' })).status).toBe(422)
    expect(mails).toHaveLength(0)
    expect((await post('/passwordless/request-code', { email: 'new@example.com', acceptTerms: true })).status).toBe(200)
    expect(mails).toHaveLength(1)
  })

  it('the database never holds the code or the link token in the clear', async () => {
    const code = codeFor('new@example.com')
    const rows = (await b.payload.find({ collection: 'loginChallenges' as never, overrideAccess: true, limit: 0, depth: 0 })).docs as any[]
    expect(JSON.stringify(rows)).not.toContain(code)
    expect(JSON.stringify(rows)).not.toContain(linkFor('new@example.com').split('token=')[1]!)
  })

  it('a wrong code is refused, the right one creates the member and logs them in', async () => {
    const wrong = await post('/passwordless/verify', { email: 'new@example.com', code: '000000' })
    expect(wrong.status).toBe(400)
    expect(wrong.json).toMatchObject({ error: 'invalid-code', attemptsLeft: 2 })

    const ok = await post('/passwordless/verify', { email: 'new@example.com', code: codeFor('new@example.com') })
    expect(ok.status).toBe(200)
    expect(ok.json).toMatchObject({ isNew: true, user: { email: 'new@example.com', roles: ['member'] } })
    const me = await whoAmI(ok.cookies)
    expect(me.email).toBe('new@example.com')

    const doc = (await b.payload.find({ collection: 'users', where: { email: { equals: 'new@example.com' } }, overrideAccess: true, depth: 0 })).docs[0] as any
    expect(doc).toMatchObject({ hasPassword: false, termsVersion: '2026-10' })
    expect(doc.emailVerifiedAt).toBeTruthy()
    expect(doc.termsAcceptedAt).toBeTruthy()
  })

  it('a code works once', async () => {
    const code = codeFor('new@example.com')
    expect((await post('/passwordless/verify', { email: 'new@example.com', code })).status).toBe(400)
  })

  it('too many wrong codes destroy the challenge, even if the next one is right', async () => {
    await post('/passwordless/request-code', { email: 'new@example.com' })
    const right = codeFor('new@example.com')
    for (let i = 0; i < 3; i++) expect((await post('/passwordless/verify', { email: 'new@example.com', code: '111111' })).status).toBe(400)
    expect((await post('/passwordless/verify', { email: 'new@example.com', code: '111111' })).status).toBe(429)
    expect((await post('/passwordless/verify', { email: 'new@example.com', code: right })).status).toBe(400)
  })

  it('requesting codes is rate limited per email', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) statuses.push((await post('/passwordless/request-code', { email: 'spam@example.com', acceptTerms: true })).status)
    expect(statuses).toEqual([200, 200, 200, 200, 429, 429]) // maxRequests is 4 per window
    expect(mails.filter((m) => m.to === 'spam@example.com')).toHaveLength(4)
  })

  it('the emailed link logs in with one click and only goes to same-site paths', async () => {
    await post('/passwordless/request-code', { email: 'link@example.com', acceptTerms: true, redirect: '/access' })
    const url = new URL(linkFor('link@example.com'))
    const res = await call('GET', `/api${url.pathname.replace(/^\/api/, '')}${url.search}`)
    expect(res.status).toBe(302)
    expect(res.location).toBe('/access')
    expect((await whoAmI(res.cookies)).email).toBe('link@example.com')

    expect((await call('GET', `/api${url.pathname.replace(/^\/api/, '')}${url.search}`)).location).toContain('login=expired') // single use
    expect(safeRedirect('//evil.example', '/')).toBe('/')
    expect(safeRedirect('https://evil.example', '/')).toBe('/')
    expect(safeRedirect('/\\evil', '/')).toBe('/')
    expect(safeRedirect('/access/orders', '/')).toBe('/access/orders')
  })

  it('an imported member (random password, hasPassword false) signs in with a code and is asked for the terms once', async () => {
    const imported = await b.payload.create({ collection: 'users', data: { email: 'old@example.com', password: 'x'.repeat(40), hasPassword: false } as never, overrideAccess: true })
    expect((await post('/passwordless/request-code', { email: 'old@example.com' })).status).toBe(200) // no terms needed to log in
    const ok = await post('/passwordless/verify', { email: 'old@example.com', code: codeFor('old@example.com') })
    expect(ok.status).toBe(200)
    expect(ok.json.isNew).toBe(false)

    let user = (await b.payload.findByID({ collection: 'users', id: imported.id, overrideAccess: true, depth: 0 })) as any
    expect(needsTermsAcceptance(user, '2026-10')).toBe(true)

    const cookie = { cookie: cookieHeader(ok.cookies) }
    expect((await post('/passwordless/accept-terms', {}, cookie)).status).toBe(200)
    user = (await b.payload.findByID({ collection: 'users', id: imported.id, overrideAccess: true, depth: 0 })) as any
    expect(needsTermsAcceptance(user, '2026-10')).toBe(false)
    expect(needsTermsAcceptance(user, '2027-01')).toBe(true) // raising the version asks everyone again
    expect((await post('/passwordless/accept-terms', {})).status).toBe(401)
  })

  it('a member can set a password later; from then on only the password works', async () => {
    await post('/passwordless/request-code', { email: 'pw@example.com', acceptTerms: true })
    const ok = await post('/passwordless/verify', { email: 'pw@example.com', code: codeFor('pw@example.com') })
    const cookie = { cookie: cookieHeader(ok.cookies) }

    expect((await post('/passwordless/set-password', { password: 'short' }, cookie)).status).toBe(422)
    const set = await post('/passwordless/set-password', { password: 'a-long-enough-password' }, cookie)
    expect(set.status).toBe(200)
    const kept = { cookie: cookieHeader(set.cookies) } // the response carries a fresh session: the member stays signed in

    expect((await post('/passwordless/status', { email: 'pw@example.com' })).json.hasPassword).toBe(true)
    expect((await post('/passwordless/request-code', { email: 'pw@example.com' })).status).toBe(409)
    const login = await b.payload.login({ collection: 'users', data: { email: 'pw@example.com', password: 'a-long-enough-password' } })
    expect(login.token).toBeTruthy()

    // changing it needs the current password
    expect((await post('/passwordless/set-password', { password: 'another-long-password' }, kept)).status).toBe(422)
    expect((await post('/passwordless/set-password', { password: 'another-long-password', currentPassword: 'not-my-password' }, kept)).status).toBe(403)
    expect((await post('/passwordless/set-password', { password: 'another-long-password', currentPassword: 'a-long-enough-password' }, kept)).status).toBe(200)
    expect((await b.payload.login({ collection: 'users', data: { email: 'pw@example.com', password: 'another-long-password' } })).token).toBeTruthy()
  })

  it('staff impersonate members (never other staff), it is logged, and leaving restores the staff session', async () => {
    const staff = await b.payload.create({ collection: 'users', data: { email: 'staff@example.com', password: 'staff-password-1', roles: ['admin'], hasPassword: true } as never, overrideAccess: true })
    const other = await b.payload.create({ collection: 'users', data: { email: 'other-staff@example.com', password: 'staff-password-2', roles: ['admin'], hasPassword: true } as never, overrideAccess: true })
    const member = (await b.payload.find({ collection: 'users', where: { email: { equals: 'new@example.com' } }, overrideAccess: true, depth: 0 })).docs[0] as any
    const staffLogin = await b.payload.login({ collection: 'users', data: { email: 'staff@example.com', password: 'staff-password-1' } })
    const asStaff = { cookie: `payload-token=${staffLogin.token}` }

    expect((await post('/passwordless/impersonate', { userID: member.id }, { cookie: cookieHeader((await post('/passwordless/verify', { email: 'old@example.com', code: '1' })).cookies) })).status).toBe(403) // not staff
    expect((await post('/passwordless/impersonate', { userID: other.id }, asStaff)).status).toBe(403)

    const res = await post('/passwordless/impersonate', { userID: member.id }, asStaff)
    expect(res.status).toBe(200)
    const memberCookie = res.cookies.find((c) => c.startsWith('payload-token='))!
    expect((await whoAmI([memberCookie])).email).toBe('new@example.com')
    const me = await call('GET', '/passwordless/me', undefined, { cookie: cookieHeader(res.cookies) })
    expect(me.json.impersonating).toBe(true)

    const log = (await b.payload.find({ collection: 'impersonationLog' as never, overrideAccess: true, depth: 0 })).docs as any[]
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ staff: 'staff@example.com', target: 'new@example.com' })

    const left = await post('/passwordless/impersonate/leave', {}, { cookie: cookieHeader(res.cookies) })
    expect(left.status).toBe(200)
    const restored = left.cookies.find((c) => c.startsWith('payload-token='))!
    expect((await whoAmI([restored])).email).toBe('staff@example.com')
    expect(((await b.payload.find({ collection: 'impersonationLog' as never, overrideAccess: true, depth: 0 })).docs[0] as any).endedAt).toBeTruthy()
    void staff
  })
})
