import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

/** A numeric code, uniformly random, zero padded. */
export const randomCode = (length: number): string => String(randomInt(0, 10 ** length)).padStart(length, '0')

export const randomToken = (): string => randomBytes(32).toString('hex')

/** Codes are low entropy, so they are keyed with the server secret and attempts are limited; the database never holds a usable code. */
export const digest = (secret: string, value: string): string => createHmac('sha256', secret).update(value).digest('hex')

export const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
