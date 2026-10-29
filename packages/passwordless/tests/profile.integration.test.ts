import { tmpdir } from 'node:os'
import { handleEndpoints, type CollectionConfig } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { payloadPasswordless } from '../src'
import { boot, Users, type Booted } from './support/harness'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

function client(getB: () => Booted) {
  const call = async (path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const multipart = body instanceof FormData
    const res = await handleEndpoints({
      config: getB().payload.config,
      request: new Request(`http://localhost/api${path}`, {
        method: 'POST',
        headers: { ...(multipart ? {} : { 'content-type': 'application/json' }), ...headers },
        body: multipart ? body : JSON.stringify(body ?? {}),
      }),
    })
    const text = await res.text()
    return { status: res.status, json: text && res.headers.get('content-type')?.includes('json') ? (JSON.parse(text) as any) : null, cookies: res.headers.getSetCookie() }
  }
  return { call, cookie: (c: string[]) => ({ cookie: c.map((x) => x.split(';')[0]).join('; ') }) }
}

const usersWithName: CollectionConfig = { ...Users, fields: [...Users.fields, { name: 'name', type: 'text' }, { name: 'emailVerifiedAt', type: 'date' }] }

describe('member profile', () => {
  let b: Booted
  const mails: { to: string; text: string }[] = []
  const codeFor = (to: string) => /(\d{6})/.exec([...mails].reverse().find((m) => m.to === to)!.text)![1]!
  const { call, cookie } = client(() => b)
  const login = async (email: string) => {
    const user = await b.payload.create({ collection: 'users', data: { email, password: 'x'.repeat(30), hasPassword: false, name: 'Anna' } as never, overrideAccess: true })
    const session = (await import('../src')).startSession
    const s = await session(b.payload, 'users', user.id)
    return { id: user.id, headers: { cookie: `payload-token=${s.token}` } }
  }
  const whoAmI = async (headers: Record<string, string>) => (await b.payload.auth({ headers: new Headers(headers) })).user as any
  let anna: Awaited<ReturnType<typeof login>>

  beforeAll(async () => {
    b = await boot({
      collections: [],
      users: usersWithName,
      plugins: [payloadPasswordless({ profile: { mediaSlug: 'media', avatarMaxMB: 1 }, newEmails: { requireMx: false }, maxAttempts: 3, sendEmail: async (_p, to, c) => void mails.push({ to, text: c.text }) })],
    })
    anna = await login('anna@example.com')
  }, 90_000)
  afterAll(async () => { await b?.close() })

  it('needs a session', async () => {
    expect((await call('/passwordless/profile', { name: 'x' })).status).toBe(401)
    expect((await call('/passwordless/email/request', { email: 'a@example.com' })).status).toBe(401)
  })

  it('updates name and full name, trims, and requires a name', async () => {
    const ok = await call('/passwordless/profile', { name: '  Anni ', fullName: ' Anna Beispiel ' }, anna.headers)
    expect(ok.status).toBe(200)
    expect(ok.json.user).toMatchObject({ email: 'anna@example.com', name: 'Anni', fullName: 'Anna Beispiel', avatarUrl: null })
    expect((await call('/passwordless/profile', { name: '   ', fullName: 'x' }, anna.headers)).json).toMatchObject({ error: 'name-required' })
    expect((await call('/passwordless/profile', { name: 'a'.repeat(121) }, anna.headers)).status).toBe(422)
  })

  it('cannot change roles or other protected fields through the endpoint', async () => {
    await call('/passwordless/profile', { name: 'Anni', roles: ['admin'], hasPassword: true, termsVersion: 'x', emailVerifiedAt: '2000-01-01T00:00:00.000Z' }, anna.headers)
    const doc = (await b.payload.findByID({ collection: 'users', id: anna.id, overrideAccess: true, depth: 0 })) as any
    expect(doc.roles).toEqual(['member'])
    expect(doc.hasPassword).toBe(false)
    expect(doc.termsVersion).toBeFalsy()
    expect(doc.emailVerifiedAt).toBeFalsy()
  })

  const upload = (file: Blob | string, name = 'me.png') => {
    const f = new FormData()
    if (file) f.set('file', file as never, typeof file === 'string' ? undefined : name)
    return f
  }

  it('uploads an avatar, replaces it and removes it', async () => {
    const first = await call('/passwordless/profile/avatar', upload(new Blob([PNG], { type: 'image/png' })), anna.headers)
    expect(first.status).toBe(200)
    expect(first.json.avatarUrl).toMatch(/avatar-/)
    expect(first.json.user.avatarUrl).toBe(first.json.avatarUrl)
    const second = await call('/passwordless/profile/avatar', upload(new Blob([PNG], { type: 'image/png' })), anna.headers)
    expect(second.status).toBe(200)
    expect(second.json.avatarUrl).not.toBe(first.json.avatarUrl)
    expect((await call('/passwordless/profile/avatar/remove', {}, anna.headers)).json.user.avatarUrl).toBeNull()
    const doc = (await b.payload.findByID({ collection: 'users', id: anna.id, overrideAccess: true, depth: 0 })) as any
    expect(doc.avatar).toBeFalsy()
  })

  it('refuses wrong, fake and oversized files and anonymous uploads', async () => {
    expect((await call('/passwordless/profile/avatar', new FormData(), anna.headers)).json).toMatchObject({ error: 'file-required' })
    expect((await call('/passwordless/profile/avatar', upload(new Blob(['<svg/>'], { type: 'image/svg+xml' }), 'a.svg'), anna.headers)).status).toBe(415)
    expect((await call('/passwordless/profile/avatar', upload(new Blob(['not an image at all'], { type: 'image/png' })), anna.headers)).status).toBe(415) // declared png, bytes say no
    const big = Buffer.concat([PNG, Buffer.alloc(1024 * 1024)])
    expect((await call('/passwordless/profile/avatar', upload(new Blob([big], { type: 'image/png' })), anna.headers)).status).toBe(413)
    expect((await call('/passwordless/profile/avatar', upload(new Blob([PNG], { type: 'image/png' })))).status).toBe(401)
  })

  it('changes the address with a code sent to the new one, and the session keeps working', async () => {
    const req = await call('/passwordless/email/request', { email: 'Anna.New@Example.com' }, anna.headers)
    expect(req.status).toBe(200)
    expect(mails.at(-1)!.to).toBe('anna.new@example.com')
    expect(mails.at(-1)!.text).toContain('Dein Code')

    expect((await call('/passwordless/email/confirm', { code: '000000' }, anna.headers)).json).toMatchObject({ error: 'invalid-code', attemptsLeft: 2 })
    // the pending code cannot be used to log in as the new address
    expect((await call('/passwordless/verify', { email: 'anna.new@example.com', code: codeFor('anna.new@example.com') })).status).toBe(400)

    const done = await call('/passwordless/email/confirm', { code: codeFor('anna.new@example.com') }, anna.headers)
    expect(done.status).toBe(200)
    expect(done.json.user.email).toBe('anna.new@example.com')

    const doc = (await b.payload.findByID({ collection: 'users', id: anna.id, overrideAccess: true, depth: 0 })) as any
    expect(doc.email).toBe('anna.new@example.com')
    expect(doc.emailVerifiedAt).toBeTruthy()
    expect((await whoAmI(anna.headers)).email).toBe('anna.new@example.com') // the old cookie still works
    expect((await whoAmI(cookie(done.cookies))).email).toBe('anna.new@example.com') // and so does the fresh one
    expect((await call('/passwordless/profile', { name: 'Anni' }, anna.headers)).status).toBe(200)
    expect((await call('/passwordless/email/confirm', { code: '123456' }, anna.headers)).status).toBe(400) // used once
  })

  it('refuses an address of another account, a disposable one, the same one and garbage', async () => {
    await b.payload.create({ collection: 'users', data: { email: 'taken@example.com', password: 'x'.repeat(30) } as never, overrideAccess: true })
    const before = mails.length
    expect((await call('/passwordless/email/request', { email: 'taken@example.com' }, anna.headers)).json).toMatchObject({ error: 'email-taken' })
    expect((await call('/passwordless/email/request', { email: 'bot@mailinator.com' }, anna.headers)).json).toMatchObject({ error: 'email-not-allowed' })
    expect((await call('/passwordless/email/request', { email: 'anna.new@example.com' }, anna.headers)).json).toMatchObject({ error: 'email-unchanged' })
    expect((await call('/passwordless/email/request', { email: 'nonsense' }, anna.headers)).status).toBe(400)
    expect(mails).toHaveLength(before)
  })

  it('destroys the challenge after too many wrong codes', async () => {
    await call('/passwordless/email/request', { email: 'anna.third@example.com' }, anna.headers)
    const right = codeFor('anna.third@example.com')
    const headers = { cookie: `payload-token=${(await (await import('../src')).startSession(b.payload, 'users', anna.id)).token}` }
    for (let i = 0; i < 3; i++) expect((await call('/passwordless/email/confirm', { code: '111111' }, headers)).status).toBe(400)
    expect((await call('/passwordless/email/confirm', { code: '111111' }, headers)).status).toBe(429)
    expect((await call('/passwordless/email/confirm', { code: right }, headers)).status).toBe(400)
  })
})
