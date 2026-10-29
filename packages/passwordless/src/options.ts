import type { CollectionSlug, Payload } from 'payload'
import type { CaptchaOptions } from './captcha'
import type { NewEmailPolicy } from './emailPolicy'

export type { CaptchaOptions } from './captcha'
export type { NewEmailPolicy } from './emailPolicy'

export interface EmailContent {
  subject: string
  text: string
  html?: string
}

export interface LoginEmailInput {
  email: string
  code: string
  /** One-click link that logs in without typing the code. */
  link: string
  ttlMinutes: number
}

export interface EmailChangeInput {
  /** The NEW address the code is sent to. */
  email: string
  code: string
  ttlMinutes: number
}

export interface PasswordlessOptions {
  enabled?: boolean
  /** Auth collection of the members. Default `users`. */
  usersSlug?: CollectionSlug
  /** Digits in the code. Default 6. */
  codeLength?: number
  /** Minutes a code / link stays valid. Default 10. */
  ttlMinutes?: number
  /** Wrong codes allowed per challenge before it is destroyed. Default 5. */
  maxAttempts?: number
  /** New codes per email within `rateWindowMinutes`. Default 5 per 15 minutes. */
  maxRequests?: number
  rateWindowMinutes?: number
  /** Unknown emails get an account on first login. Default true. */
  allowRegistration?: boolean
  /** Roles of a self-registered member. Default `['member']`. */
  defaultRoles?: string[]
  /** Terms (AGB + privacy) acceptance. `version` re-prompts everyone when raised. Default: not required. */
  terms?: { version: string }
  /** Public base URL used in the emailed link. Default `payload.config.serverURL`. */
  serverURL?: string
  /** Where a successful link login goes when the request named no (valid) redirect. Default `/`. */
  defaultRedirect?: string
  /** Staff may impersonate members. Default: `user.roles` includes `admin`. */
  isStaff?: (user: unknown) => boolean
  /** Impersonation sessions last this many minutes. Default 60. */
  impersonationMinutes?: number
  /**
   * Bot protection. When set, `request-code` and `login` (password) need a `captchaToken` in the body and answer
   * 400 `captcha-required` / 403 `captcha-failed` without it. `status` stays open. Not set: nothing changes.
   * Payload's own `/users/login` (used by the admin panel) is not gated.
   */
  captcha?: CaptchaOptions
  /**
   * Which addresses may open a NEW account (existing members are never checked): throwaway providers (the maintained `mailchecker` list) and domains without a mail
   * server are refused by default (422 `email-not-allowed`). An account only exists once the emailed code was entered, so a typo
   * or a stranger's address never creates one; this keeps junk mail out of the sending reputation. Pass `false` to switch off.
   */
  newEmails?: NewEmailPolicy | false
  /** Code requests per client IP within `rateWindowMinutes`, across all addresses. Default 20. The IP comes from `cf-connecting-ip` / `x-forwarded-for`: run behind a proxy that sets them. */
  maxRequestsPerIP?: number
  /**
   * Member profile. `mediaSlug` is the upload collection used for avatars (adds an `avatar` field to the users collection and enables the avatar endpoints;
   * the media collection's own access rules decide who may upload). `avatarMaxMB` defaults to 10. Without `mediaSlug` no avatar field or endpoint is active.
   */
  profile?: { mediaSlug?: string; avatarMaxMB?: number }
  /** Optional shared site theme for the built-in email templates. */
  mailTheme?: import('@daugtcom/payload-mail').MailTheme
  /** Build the "confirm your new address" email. Default: German + English text. */
  renderEmailChange?: (input: EmailChangeInput) => EmailContent | Promise<EmailContent>
  /** Build the login email. Default: a plain English message. */
  renderEmail?: (input: LoginEmailInput) => EmailContent | Promise<EmailContent>
  /** Send it. Default: `payload.sendEmail` (use your configured adapter, e.g. Resend). */
  sendEmail?: (payload: Payload, to: string, content: EmailContent) => Promise<void>
}

export interface ResolvedOptions extends Required<Pick<PasswordlessOptions, 'usersSlug' | 'codeLength' | 'ttlMinutes' | 'maxAttempts' | 'maxRequests' | 'rateWindowMinutes' | 'allowRegistration' | 'defaultRoles' | 'defaultRedirect' | 'isStaff' | 'impersonationMinutes' | 'renderEmail' | 'renderEmailChange' | 'sendEmail'>> {
  terms?: { version: string }
  profile: { mediaSlug?: string; avatarMaxMB: number }
  serverURL?: string
  captcha?: CaptchaOptions
  newEmails: NewEmailPolicy | false
  maxRequestsPerIP: number
}
