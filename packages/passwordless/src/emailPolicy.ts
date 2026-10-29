import { resolveMx } from 'node:dns/promises'
import MailChecker from 'mailchecker'

/** What may open a NEW account. Existing members are never checked: only an address we have not seen. */
export interface NewEmailPolicy {
  /** Refuse throwaway inboxes (mailinator, yopmail, ...) using the maintained `mailchecker` list (55k+ domains, updated with the package). Default true. */
  blockDisposable?: boolean
  /** Refuse domains that cannot receive mail (no MX/A record). A DNS timeout lets the address through. Default true. */
  requireMx?: boolean
  /** Extra domains to refuse, on top of the list. */
  blockedDomains?: string[]
  /** Domains that are always fine, even if the list wrongly has them. */
  allowedDomains?: string[]
  /** Your own rule, run last. Resolve `false` to refuse. */
  check?: (email: string) => boolean | Promise<boolean>
}

export type EmailRefusal = 'disposable' | 'no-mail-server' | 'blocked'

const domainOf = (email: string) => email.slice(email.lastIndexOf('@') + 1)

/** `ENOTFOUND` / `ENODATA` mean the domain has no mail server; anything else (timeout, SERVFAIL) is not the address's fault. */
async function canReceiveMail(domain: string, lookup: typeof resolveMx): Promise<boolean> {
  try {
    return (await lookup(domain)).length > 0
  } catch (e) {
    const code = (e as { code?: string }).code
    return !(code === 'ENOTFOUND' || code === 'ENODATA')
  }
}

/** Returns why a new address is refused, or null. Cheap checks first; DNS only when the rest passed. */
export async function refuseNewEmail(email: string, policy: NewEmailPolicy = {}, lookup: typeof resolveMx = resolveMx): Promise<EmailRefusal | null> {
  const domain = domainOf(email)
  if (!domain.includes('.')) return 'no-mail-server'
  if ((policy.blockedDomains ?? []).some((d) => d.toLowerCase() === domain)) return 'blocked'
  const allowed = (policy.allowedDomains ?? []).some((d) => d.toLowerCase() === domain)
  if (policy.blockDisposable !== false && !allowed && !MailChecker.isValid(email)) return 'disposable'
  if (policy.requireMx !== false && !(await canReceiveMail(domain, lookup))) return 'no-mail-server'
  if (policy.check && !(await policy.check(email))) return 'blocked'
  return null
}
