import { randomUUID } from 'node:crypto'
import { jwtSign, type Payload, type SanitizedCollectionConfig } from 'payload'

type Id = string | number

export interface StartedSession {
  token: string
  exp: number
  cookie: string
}

const cookiePrefix = (payload: Payload) => payload.config.cookiePrefix ?? 'payload'

/** The sanitized config of a collection by slug (typed loosely: slugs are project specific). */
export const collectionConfig = (payload: Payload, slug: string): SanitizedCollectionConfig => (payload.collections as unknown as Record<string, { config: SanitizedCollectionConfig }>)[slug]!.config

/** `Set-Cookie` value for a Payload auth token, built from the collection's own cookie settings. */
export function authCookie(payload: Payload, collection: SanitizedCollectionConfig, token: string | null, expires: Date, name = `${cookiePrefix(payload)}-token`): string {
  const c = collection.auth && typeof collection.auth === 'object' ? collection.auth.cookies : undefined
  const sameSite = typeof c?.sameSite === 'string' ? c.sameSite : c?.sameSite ? 'Strict' : 'Lax'
  const parts = [`${name}=${token ?? ''}`, 'Path=/', `Expires=${expires.toUTCString()}`, 'HttpOnly', `SameSite=${sameSite}`]
  if (c?.secure) parts.push('Secure')
  if (c?.domain) parts.push(`Domain=${c.domain}`)
  return parts.join('; ')
}

/**
 * A login without a password: the same thing Payload's own login does after it checked the password
 * (add a session to the user, sign a JWT that carries its id). The token works for REST, GraphQL, the Local API and the admin.
 */
export async function startSession(payload: Payload, collectionSlug: string, userId: Id, o: { tokenExpirationSeconds?: number } = {}): Promise<StartedSession> {
  const collection = collectionConfig(payload, collectionSlug)
  const auth = collection.auth as { useSessions?: boolean; tokenExpiration: number }
  const tokenExpiration = o.tokenExpirationSeconds ?? auth.tokenExpiration

  const user = (await payload.findByID({ collection: collectionSlug as never, id: userId, depth: 0, showHiddenFields: true, overrideAccess: true })) as unknown as Record<string, unknown> & { id: Id; email: string; sessions?: { id: string; createdAt: Date | string; expiresAt: Date | string }[] }

  let sid: string | undefined
  if (auth.useSessions) {
    sid = randomUUID()
    const now = new Date()
    const live = (user.sessions ?? []).filter((s) => new Date(s.expiresAt) > now)
    user.sessions = [...live, { id: sid, createdAt: now, expiresAt: new Date(now.getTime() + tokenExpiration * 1000) }]
    user.updatedAt = null as never // adding a session is not an edit of the member
    await (payload.db as unknown as { updateOne: (a: unknown) => Promise<unknown> }).updateOne({ id: user.id, collection: collectionSlug, data: user, returning: false })
  }

  const { token, exp } = await jwtSign({ fieldsToSign: { id: user.id, collection: collectionSlug, email: user.email, ...(sid ? { sid } : {}) }, secret: payload.secret, tokenExpiration })
  return { token, exp, cookie: authCookie(payload, collection, token, new Date(exp * 1000)) }
}
