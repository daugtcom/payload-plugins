import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Verifies a Resend (Svix) webhook: the signed text is `<id>.<timestamp>.<body>`, signed with the base64 part of the `whsec_…` secret,
 * and the `svix-signature` header holds one or more `v1,<base64>` values. Rejects timestamps more than 5 minutes off.
 */
export function verifySvix(secret: string, headers: { id: string | null; timestamp: string | null; signature: string | null }, body: string, now = Date.now()): boolean {
  if (!headers.id || !headers.timestamp || !headers.signature) return false
  const ts = Number(headers.timestamp)
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const expected = createHmac('sha256', key).update(`${headers.id}.${headers.timestamp}.${body}`).digest()
  return headers.signature.split(' ').some((part) => {
    const [version, sig] = part.split(',')
    if (version !== 'v1' || !sig) return false
    const given = Buffer.from(sig, 'base64')
    return given.length === expected.length && timingSafeEqual(given, expected)
  })
}

/** Test helper: the header values Svix would send for this body. */
export function signSvix(secret: string, id: string, timestamp: number, body: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  return `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')}`
}
