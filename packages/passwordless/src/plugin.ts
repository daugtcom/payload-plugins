import type { Config, Payload, Plugin } from 'payload'
import { impersonationLog, loginChallenges } from './collections/loginChallenges'
import { defaultEmailChangeEmail, defaultLoginEmail, defaultSend } from './email'
import { endpoints } from './endpoints'
import type { PasswordlessOptions, ResolvedOptions } from './options'

const defaultIsStaff = (user: unknown): boolean => {
  const u = user as { roles?: string[]; role?: string } | null
  return Boolean(u && (u.role === 'admin' || (Array.isArray(u.roles) && u.roles.includes('admin'))))
}

export const resolve = (o: PasswordlessOptions): ResolvedOptions => ({
  usersSlug: o.usersSlug ?? 'users',
  codeLength: o.codeLength ?? 6,
  ttlMinutes: o.ttlMinutes ?? 10,
  maxAttempts: o.maxAttempts ?? 5,
  maxRequests: o.maxRequests ?? 5,
  rateWindowMinutes: o.rateWindowMinutes ?? 15,
  allowRegistration: o.allowRegistration ?? true,
  defaultRoles: o.defaultRoles ?? ['member'],
  defaultRedirect: o.defaultRedirect ?? '/',
  isStaff: o.isStaff ?? defaultIsStaff,
  impersonationMinutes: o.impersonationMinutes ?? 60,
  renderEmail: o.renderEmail ?? ((input) => defaultLoginEmail(input, o.mailTheme)),
  renderEmailChange: o.renderEmailChange ?? ((input) => defaultEmailChangeEmail(input, o.mailTheme)),
  profile: { mediaSlug: o.profile?.mediaSlug, avatarMaxMB: o.profile?.avatarMaxMB ?? 10 },
  sendEmail: o.sendEmail ?? defaultSend,
  terms: o.terms,
  serverURL: o.serverURL,
  captcha: o.captcha,
  newEmails: o.newEmails ?? {},
  maxRequestsPerIP: o.maxRequestsPerIP ?? 20,
})

/** Passwordless login (emailed code + magic link), terms acceptance and staff impersonation. */
export const payloadPasswordless =
  (options: PasswordlessOptions = {}): Plugin =>
  (incoming: Config): Config => {
    if (options.enabled === false) return incoming
    const o = resolve(options)
    const users = incoming.collections?.find((c) => c.slug === o.usersSlug)
    if (!users) throw new Error(`payloadPasswordless: the users collection "${o.usersSlug}" does not exist (list the plugin after your collections)`)

    const extended = {
      ...users,
      fields: [
        ...users.fields,
        ...(users.fields.some((f) => 'name' in f && f.name === 'fullName') ? [] : [{ name: 'fullName', type: 'text' }]),
        ...(o.profile.mediaSlug && !users.fields.some((f) => 'name' in f && f.name === 'avatar') ? [{ name: 'avatar', type: 'upload', relationTo: o.profile.mediaSlug }] : []),
        { name: 'hasPassword', type: 'checkbox', defaultValue: false, admin: { position: 'sidebar', readOnly: true, description: 'Members with a password sign in with it; everyone else gets an emailed code.' } },
        { name: 'termsAcceptedAt', type: 'date', admin: { position: 'sidebar', readOnly: true } },
        { name: 'termsVersion', type: 'text', admin: { position: 'sidebar', readOnly: true } },
      ],
      hooks: {
        ...users.hooks,
        beforeChange: [
          ...(users.hooks?.beforeChange ?? []),
          // whoever sets a password (forgot-password, admin, "set a password" endpoint) becomes a password member,
          // unless the caller says explicitly (registration, import: random unusable password, hasPassword false)
          ({ data }: { data: Record<string, unknown> }) => (data.password && data.hasPassword === undefined ? { ...data, hasPassword: true } : data),
        ],
      },
    } as typeof users

    return {
      ...incoming,
      collections: [...(incoming.collections ?? []).map((c) => (c.slug === o.usersSlug ? extended : c)), loginChallenges, impersonationLog(o.isStaff)],
      endpoints: [...(incoming.endpoints ?? []), ...endpoints(o)],
      custom: { ...incoming.custom, daugtPasswordless: o },
    }
  }

export function passwordlessOptions(payload: Payload): ResolvedOptions {
  const o = (payload.config.custom as { daugtPasswordless?: ResolvedOptions } | undefined)?.daugtPasswordless
  if (!o) throw new Error('payloadPasswordless plugin is not installed')
  return o
}

/** Does the member still have to accept the current terms? */
export function needsTermsAcceptance(user: { termsAcceptedAt?: string | null; termsVersion?: string | null } | null | undefined, currentVersion: string | undefined): boolean {
  if (!currentVersion || !user) return false
  return !user.termsAcceptedAt || user.termsVersion !== currentVersion
}
