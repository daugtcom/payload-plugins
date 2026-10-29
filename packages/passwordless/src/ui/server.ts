import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { Payload } from 'payload'
import { needsTermsAcceptance } from '../plugin'

export type Id = string | number

/** The member as the pages read it. */
export interface SessionUser {
  id: Id
  email: string
  name?: string | null
  roles?: string[] | null
  hasPassword?: boolean | null
  termsAcceptedAt?: string | null
  termsVersion?: string | null
}

/** The logged-in member of the current request (cookie), or null. Server components only. */
export async function getSessionUser(payload: Payload): Promise<SessionUser | null> {
  const { user } = await payload.auth({ headers: await headers() })
  return (user as unknown as SessionUser | null) ?? null
}

/**
 * Members only: sends visitors to `${loginPath}?redirect=<path>`.
 * `termsRequired` is true until the member accepted the current terms: render `<TermsGate />` instead of the page.
 */
export async function requireMember(payload: Payload, path: string, o: { termsVersion?: string; loginPath?: string } = {}): Promise<{ user: SessionUser; termsRequired: boolean }> {
  const user = await getSessionUser(payload)
  if (!user) redirect(`${o.loginPath ?? '/login'}?redirect=${encodeURIComponent(path)}`)
  return { user, termsRequired: needsTermsAcceptance(user, o.termsVersion) }
}
