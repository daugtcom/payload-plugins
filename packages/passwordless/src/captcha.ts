import type { PayloadRequest } from 'payload'

/** Bot protection for the endpoints that can be hammered: `request-code` and `login`. */
export type CaptchaOptions =
  | {
      /** Cloudflare Turnstile. The widget in `@daugtcom/payload-passwordless/ui` produces the token. */
      provider: 'turnstile'
      secretKey: string
    }
  | {
      /** Bring your own provider (hCaptcha, altcha, ...): resolve `true` when the token is good. */
      verify: (token: string, req: PayloadRequest) => Promise<boolean>
    }

export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** Asks Cloudflare whether a Turnstile token is valid. Fails closed: any network or protocol problem is "no". */
export async function verifyTurnstile(secretKey: string, token: string, remoteIP?: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const form = new URLSearchParams({ secret: secretKey, response: token })
    if (remoteIP) form.set('remoteip', remoteIP)
    const res = await fetchImpl(TURNSTILE_VERIFY_URL, { method: 'POST', body: form })
    if (!res.ok) return false
    return ((await res.json()) as { success?: boolean }).success === true
  } catch {
    return false
  }
}

export const clientIP = (req: PayloadRequest): string | undefined => req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined

/** `null` when the request may go on, otherwise the error to answer with. */
export async function checkCaptcha(captcha: CaptchaOptions | undefined, req: PayloadRequest, token: unknown): Promise<{ status: number; error: string } | null> {
  if (!captcha) return null
  if (typeof token !== 'string' || !token) return { status: 400, error: 'captcha-required' }
  const ok = 'verify' in captcha ? await captcha.verify(token, req).catch(() => false) : await verifyTurnstile(captcha.secretKey, token, clientIP(req))
  return ok ? null : { status: 403, error: 'captcha-failed' }
}
