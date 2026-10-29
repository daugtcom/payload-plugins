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

// own file: handleEndpoints caches the Payload instance per process/file, so a second boot must not share a file with another
describe('avatar upload respects the media collection access rules', () => {
  let b: Booted
  const { call } = client(() => b)
  const Locked: CollectionConfig = { slug: 'locked', upload: { staticDir: tmpdir() }, access: { create: () => false }, fields: [] }

  beforeAll(async () => {
    b = await boot({ collections: [Locked], users: usersWithName, plugins: [payloadPasswordless({ profile: { mediaSlug: 'locked' } })] })
  }, 90_000)
  afterAll(async () => { await b?.close() })

  it('answers 403 and stores nothing', async () => {
    const user = await b.payload.create({ collection: 'users', data: { email: 'l@example.com', password: 'x'.repeat(30) } as never, overrideAccess: true })
    const { startSession } = await import('../src')
    const s = await startSession(b.payload, 'users', user.id)
    const f = new FormData()
    f.set('file', new Blob([PNG], { type: 'image/png' }), 'me.png')
    const res = await call('/passwordless/profile/avatar', f, { cookie: `payload-token=${s.token}` })
    expect(res.status).toBe(403)
    expect(res.json.error).toBe('upload-forbidden')
    expect((await b.payload.count({ collection: 'locked' as never, overrideAccess: true })).totalDocs).toBe(0)
  })
})
