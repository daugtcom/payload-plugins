import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Payload } from 'payload'
import type { Id } from './options'

export type TokenPurpose = 'confirm' | 'unsubscribe'

const sign = (secret: string, purpose: TokenPurpose, id: Id, email: string) => createHmac('sha256', secret).update(`newsletter:${purpose}:${id}:${email.toLowerCase()}`).digest('base64url')

/** `<id>.<signature>`: nothing stored, the Payload secret is the key. A changed address invalidates old links. */
export const makeToken = (payload: Payload, purpose: TokenPurpose, id: Id, email: string): string => `${id}.${sign(payload.secret, purpose, id, email)}`

export const parseToken = (token: string | null | undefined): { id: string; sig: string } | null => {
  const dot = (token ?? '').indexOf('.')
  if (dot < 1) return null
  return { id: token!.slice(0, dot), sig: token!.slice(dot + 1) }
}

export function verifyToken(payload: Payload, purpose: TokenPurpose, token: string | null | undefined, email: string, id: Id): boolean {
  const t = parseToken(token)
  if (!t || String(t.id) !== String(id)) return false
  const expected = Buffer.from(sign(payload.secret, purpose, id, email))
  const given = Buffer.from(t.sig)
  return expected.length === given.length && timingSafeEqual(expected, given)
}
