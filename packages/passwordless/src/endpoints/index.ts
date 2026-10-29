import { randomBytes } from 'node:crypto'
import type { Endpoint, Payload, PayloadRequest } from 'payload'
import { IMPERSONATION_LOG_SLUG, LOGIN_CHALLENGES_SLUG } from '../collections/loginChallenges'
import { checkCaptcha, clientIP } from '../captcha'
import { refuseNewEmail } from '../emailPolicy'
import { digest, randomCode, randomToken, safeEqual } from '../crypto'
import type { ResolvedOptions } from '../options'
import { authCookie, collectionConfig, startSession } from '../session'

type Id = string | number
type Doc = Record<string, unknown> & { id: Id }

const normalize = (email: unknown): string => (typeof email === 'string' ? email.trim().toLowerCase() : '')
const body = async (req: PayloadRequest): Promise<Record<string, unknown>> => ((await req.json?.().catch(() => ({}))) ?? {}) as Record<string, unknown>

function json(status: number, data: unknown, cookies: string[] = []): Response {
  const headers = new Headers({ 'content-type': 'application/json' })
  for (const c of cookies) headers.append('Set-Cookie', c)
  return new Response(JSON.stringify(data), { status, headers })
}

/** Only same-site relative paths: no scheme, no `//host`, no backslash tricks. */
export const safeRedirect = (value: unknown, fallback: string): string =>
  typeof value === 'string' && /^\/(?![/\\])/.test(value) ? value : fallback

const findUser = async (payload: Payload, o: ResolvedOptions, email: string): Promise<Doc | null> =>
  ((await payload.find({ collection: o.usersSlug as never, where: { email: { equals: email } }, limit: 1, depth: 0, overrideAccess: true, showHiddenFields: true })).docs[0] as unknown as Doc | undefined) ?? null

const baseURL = (payload: Payload, o: ResolvedOptions) => (o.serverURL ?? payload.config.serverURL ?? '').replace(/\/$/, '')

async function removeExpired(payload: Payload): Promise<void> {
  await payload.delete({ collection: LOGIN_CHALLENGES_SLUG as never, where: { expiresAt: { less_than: new Date(Date.now() - 24 * 3_600_000).toISOString() } }, overrideAccess: true }).catch(() => undefined)
}

/** Turn a verified challenge into a logged-in member (creating the account on first login). */
async function completeLogin(req: PayloadRequest, o: ResolvedOptions, challenge: Doc): Promise<{ user: Doc; session: Awaited<ReturnType<typeof startSession>>; isNew: boolean } | { error: 'password-required' }> {
  const { payload } = req
  const email = String(challenge.email)
  let user = await findUser(payload, o, email)
  const now = new Date().toISOString()
  let isNew = false

  if (user?.hasPassword) return { error: 'password-required' }

  if (!user) {
    isNew = true
    user = (await payload.create({
      collection: o.usersSlug as never,
      data: {
        email,
        password: randomBytes(24).toString('hex'), // nobody knows it: this member signs in with codes until they choose a password
        hasPassword: false,
        roles: o.defaultRoles,
        emailVerifiedAt: now,
        ...(challenge.termsAcceptedAt ? { termsAcceptedAt: challenge.termsAcceptedAt, termsVersion: challenge.termsVersion } : {}),
      } as never,
      overrideAccess: true,
      disableVerificationEmail: true,
    })) as unknown as Doc
  } else {
    const patch: Record<string, unknown> = {}
    if (!user.emailVerifiedAt) patch.emailVerifiedAt = now // a code that reached the inbox proves the address
    if (challenge.termsAcceptedAt && !user.termsAcceptedAt) Object.assign(patch, { termsAcceptedAt: challenge.termsAcceptedAt, termsVersion: challenge.termsVersion })
    if (Object.keys(patch).length) await payload.update({ collection: o.usersSlug as never, id: user.id, data: patch as never, overrideAccess: true })
  }

  const session = await startSession(payload, o.usersSlug, user.id)
  await payload.delete({ collection: LOGIN_CHALLENGES_SLUG as never, id: challenge.id, overrideAccess: true })
  return { user, session, isNew }
}

const EMAIL_CHANGE = 'email-change'
const NAME_MAX = 120
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }

/** The real image type from the first bytes: the browser-declared type is only a claim. */
function sniffImage(b: Uint8Array): (typeof IMAGE_TYPES)[number] | null {
  const at = (i: number, s: string) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0))
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x89 && at(1, 'PNG')) return 'image/png'
  if (at(0, 'GIF87a') || at(0, 'GIF89a')) return 'image/gif'
  if (at(0, 'RIFF') && at(8, 'WEBP')) return 'image/webp'
  return null
}

const mediaURL = (m: unknown): string | null => {
  const d = m as { url?: string; sizes?: { thumbnail?: { url?: string } } } | null
  return typeof d === 'object' && d ? (d.sizes?.thumbnail?.url ?? d.url ?? null) : null
}

const isImpersonating = (req: PayloadRequest) => /(?:^|;\s*)[^=]+-impersonator=/.test(req.headers.get('cookie') ?? '')

const publicUser = (u: Doc) => ({ id: u.id, email: u.email, name: u.name, roles: u.roles })

/** The member as the profile page needs it. Re-read with depth 1 so the avatar is a populated media doc. */
async function profileUser(payload: Payload, o: ResolvedOptions, id: Id) {
  const u = (await payload.findByID({ collection: o.usersSlug as never, id, depth: 1, overrideAccess: true })) as unknown as Doc
  return { id: u.id, email: u.email, name: u.name ?? '', fullName: u.fullName ?? '', avatarUrl: mediaURL(u.avatar) }
}

/** Best effort: remove the member's previous avatar, but only a file they uploaded themselves (`uploadedBy`), under the media collection's own access rules. */
async function dropOldAvatar(req: PayloadRequest, mediaSlug: string, oldId: Id | undefined, userId: Id, keep?: Id): Promise<void> {
  if (oldId === undefined || oldId === null || oldId === keep) return
  try {
    const old = (await req.payload.findByID({ collection: mediaSlug as never, id: oldId, depth: 0, overrideAccess: true })) as unknown as Doc
    if (old.uploadedBy === undefined || String(old.uploadedBy) !== String(userId)) return
    await req.payload.delete({ collection: mediaSlug as never, id: oldId, overrideAccess: false, user: req.user })
  } catch {
    /* an orphaned file is harmless */
  }
}

export function endpoints(o: ResolvedOptions): Endpoint[] {
  const staff = (user: unknown) => Boolean(user) && o.isStaff(user)

  return [
    // Which login does this email use? Unknown emails look like members without a password (no account enumeration).
    {
      path: '/passwordless/status',
      method: 'post',
      handler: async (req) => {
        const email = normalize((await body(req)).email)
        if (!email) return json(400, { error: 'email-required' })
        const user = await findUser(req.payload, o, email)
        return json(200, { hasPassword: Boolean(user?.hasPassword), termsRequired: Boolean(o.terms) && !user })
      },
    },

    {
      path: '/passwordless/request-code',
      method: 'post',
      handler: async (req) => {
        const { payload } = req
        const b = await body(req)
        const email = normalize(b.email)
        if (!email || !email.includes('@')) return json(400, { error: 'email-required' })
        const blocked = await checkCaptcha(o.captcha, req, b.captchaToken)
        if (blocked) return json(blocked.status, { error: blocked.error })

        const user = await findUser(payload, o, email)
        if (user?.hasPassword) return json(409, { error: 'password-required' })

        let termsAcceptedAt: string | undefined
        if (!user) {
          if (!o.allowRegistration) return json(200, { sent: true }) // do not reveal that the address is unknown
          if (o.terms && b.acceptTerms !== true) return json(422, { error: 'terms-required' })
          if (o.newEmails && (await refuseNewEmail(email, o.newEmails))) return json(422, { error: 'email-not-allowed' })
          if (o.terms) termsAcceptedAt = new Date().toISOString()
        }

        const windowStart = new Date(Date.now() - o.rateWindowMinutes * 60_000).toISOString()
        const recent = await payload.count({ collection: LOGIN_CHALLENGES_SLUG as never, where: { and: [{ email: { equals: email } }, { createdAt: { greater_than: windowStart } }] }, overrideAccess: true })
        if (recent.totalDocs >= o.maxRequests) return json(429, { error: 'too-many-requests' })
        const ip = clientIP(req)
        const ipHash = ip ? digest(payload.secret, `ip:${ip}`) : undefined
        if (ipHash) {
          const fromIP = await payload.count({ collection: LOGIN_CHALLENGES_SLUG as never, where: { and: [{ ipHash: { equals: ipHash } }, { createdAt: { greater_than: windowStart } }] }, overrideAccess: true })
          if (fromIP.totalDocs >= o.maxRequestsPerIP) return json(429, { error: 'too-many-requests' })
        }

        const code = randomCode(o.codeLength)
        const token = randomToken()
        await payload.create({
          collection: LOGIN_CHALLENGES_SLUG as never,
          data: {
            email,
            codeHash: digest(payload.secret, `code:${email}:${code}`),
            tokenHash: digest(payload.secret, `token:${token}`),
            expiresAt: new Date(Date.now() + o.ttlMinutes * 60_000).toISOString(),
            redirect: safeRedirect(b.redirect, o.defaultRedirect),
            ...(ipHash ? { ipHash } : {}),
            ...(termsAcceptedAt ? { termsAcceptedAt, termsVersion: o.terms?.version } : {}),
          } as never,
          overrideAccess: true,
        })
        void removeExpired(payload)

        const link = `${baseURL(payload, o)}/api/passwordless/link?token=${token}`
        await o.sendEmail(payload, email, await o.renderEmail({ email, code, link, ttlMinutes: o.ttlMinutes }))
        return json(200, { sent: true })
      },
    },

    // password login behind the captcha (Payload's own /users/login stays for the admin panel)
    {
      path: '/passwordless/login',
      method: 'post',
      handler: async (req) => {
        const { payload } = req
        const b = await body(req)
        const email = normalize(b.email)
        if (!email || typeof b.password !== 'string' || !b.password) return json(400, { error: 'invalid-credentials' })
        const blocked = await checkCaptcha(o.captcha, req, b.captchaToken)
        if (blocked) return json(blocked.status, { error: blocked.error })
        try {
          const res = await payload.login({ collection: o.usersSlug as never, data: { email, password: b.password } as never, req })
          if (!res.token || !res.exp) return json(401, { error: 'invalid-credentials' })
          const cookie = authCookie(payload, collectionConfig(payload, o.usersSlug), res.token, new Date(res.exp * 1000))
          return json(200, { user: publicUser(res.user as unknown as Doc), exp: res.exp }, [cookie])
        } catch {
          return json(401, { error: 'invalid-credentials' })
        }
      },
    },

    {
      path: '/passwordless/verify',
      method: 'post',
      handler: async (req) => {
        const { payload } = req
        const b = await body(req)
        const email = normalize(b.email)
        const code = typeof b.code === 'string' ? b.code.trim() : ''
        if (!email || !code) return json(400, { error: 'invalid-code' })

        const found = await payload.find({ collection: LOGIN_CHALLENGES_SLUG as never, where: { and: [{ email: { equals: email } }, { purpose: { not_equals: EMAIL_CHANGE } }, { expiresAt: { greater_than: new Date().toISOString() } }] }, sort: '-createdAt', limit: 1, depth: 0, overrideAccess: true })
        const challenge = found.docs[0] as unknown as Doc | undefined
        if (!challenge) return json(400, { error: 'invalid-code' })

        const attempts = Number(challenge.attempts ?? 0) + 1
        if (attempts > o.maxAttempts) {
          // expire it rather than delete it: it still counts against the request rate
          await payload.update({ collection: LOGIN_CHALLENGES_SLUG as never, id: challenge.id, data: { expiresAt: new Date().toISOString() } as never, overrideAccess: true })
          return json(429, { error: 'too-many-attempts' })
        }
        if (!safeEqual(String(challenge.codeHash), digest(payload.secret, `code:${email}:${code}`))) {
          await payload.update({ collection: LOGIN_CHALLENGES_SLUG as never, id: challenge.id, data: { attempts } as never, overrideAccess: true })
          return json(400, { error: 'invalid-code', attemptsLeft: o.maxAttempts - attempts })
        }

        const done = await completeLogin(req, o, challenge)
        if ('error' in done) return json(409, { error: done.error })
        return json(200, { user: publicUser(done.user), isNew: done.isNew, redirect: challenge.redirect, exp: done.session.exp }, [done.session.cookie])
      },
    },

    // the emailed link: the same login, one click
    {
      path: '/passwordless/link',
      method: 'get',
      handler: async (req) => {
        const { payload } = req
        const token = new URL(req.url ?? 'http://x').searchParams.get('token') ?? ''
        const fail = (reason: string) => new Response(null, { status: 302, headers: { Location: `${o.defaultRedirect}?login=${reason}` } })
        if (!token) return fail('invalid')

        const found = await payload.find({ collection: LOGIN_CHALLENGES_SLUG as never, where: { and: [{ tokenHash: { equals: digest(payload.secret, `token:${token}`) } }, { purpose: { not_equals: EMAIL_CHANGE } }, { expiresAt: { greater_than: new Date().toISOString() } }] }, limit: 1, depth: 0, overrideAccess: true })
        const challenge = found.docs[0] as unknown as Doc | undefined
        if (!challenge) return fail('expired')

        const done = await completeLogin(req, o, challenge)
        if ('error' in done) return fail('password-required')
        const headers = new Headers({ Location: safeRedirect(challenge.redirect, o.defaultRedirect) })
        headers.append('Set-Cookie', done.session.cookie)
        return new Response(null, { status: 302, headers })
      },
    },

    // a logged-in member chooses a password; from then on they sign in with it. Changing an existing password also needs the current one.
    {
      path: '/passwordless/set-password',
      method: 'post',
      handler: async (req) => {
        if (!req.user) return json(401, { error: 'login-required' })
        if (isImpersonating(req)) return json(403, { error: 'impersonating' }) // staff looking at the site as a member must not change their password
        const b = await body(req)
        const password = b.password
        if (typeof password !== 'string' || password.length < 8) return json(422, { error: 'password-too-short' })
        const id = (req.user as unknown as Doc).id
        const me = (await req.payload.findByID({ collection: o.usersSlug as never, id, depth: 0, overrideAccess: true, showHiddenFields: true })) as unknown as Doc
        if (me.hasPassword) {
          const current = typeof b.currentPassword === 'string' ? b.currentPassword : ''
          if (!current) return json(422, { error: 'current-password-required' })
          // the same check as signing in, so a wrong guess counts towards the collection's login lockout
          try { await req.payload.login({ collection: o.usersSlug as never, data: { email: String(me.email), password: current } as never, req }) } catch { return json(403, { error: 'wrong-password' }) }
        }
        await req.payload.update({ collection: o.usersSlug as never, id, data: { password, hasPassword: true } as never, overrideAccess: true })
        // a new password ends every session (other devices are signed out); this one gets a fresh session so the member stays signed in
        const session = await startSession(req.payload, o.usersSlug, id)
        return json(200, { hasPassword: true }, [session.cookie])
      },
    },

    // ---- member profile: only the signed-in member's own safe fields, never roles / hasPassword / terms / emailVerifiedAt ----
    {
      path: '/passwordless/profile',
      method: 'post',
      handler: async (req) => {
        if (!req.user) return json(401, { error: 'login-required' })
        const b = await body(req)
        const name = typeof b.name === 'string' ? b.name.trim() : ''
        const fullName = typeof b.fullName === 'string' ? b.fullName.trim() : ''
        if (!name) return json(422, { error: 'name-required' })
        if (name.length > NAME_MAX || fullName.length > NAME_MAX) return json(422, { error: 'too-long' })
        const id = (req.user as unknown as Doc).id
        await req.payload.update({ collection: o.usersSlug as never, id, data: { name, fullName } as never, overrideAccess: true })
        return json(200, { user: await profileUser(req.payload, o, id) })
      },
    },

    {
      path: '/passwordless/profile/avatar',
      method: 'post',
      handler: async (req) => {
        const { payload } = req
        const mediaSlug = o.profile.mediaSlug
        if (!mediaSlug) return json(404, { error: 'avatar-disabled' })
        if (!req.user) return json(401, { error: 'login-required' })
        const form = await req.formData?.().catch(() => null)
        const file = form?.get('file')
        if (!file || typeof file === 'string') return json(400, { error: 'file-required' })
        if (file.size > o.profile.avatarMaxMB * 1024 * 1024) return json(413, { error: 'file-too-large' })
        const data = Buffer.from(await file.arrayBuffer())
        const type = sniffImage(data)
        if (!type || !(IMAGE_TYPES as readonly string[]).includes(file.type)) return json(415, { error: 'unsupported-type' })

        const userId = (req.user as unknown as Doc).id
        const fields = ((payload.collections as unknown as Record<string, { config: { fields: { name?: string }[] } }>)[mediaSlug]?.config.fields ?? []).map((f) => f.name)
        let media: Doc
        try {
          media = (await payload.create({
            collection: mediaSlug as never,
            data: { ...(fields.includes('userUpload') ? { userUpload: true } : {}), ...(fields.includes('uploadedBy') ? { uploadedBy: userId } : {}), ...(fields.includes('prefix') ? { prefix: 'user-uploads' } : {}) } as never,
            file: { data, mimetype: type, name: `avatar-${userId}-${Date.now()}.${EXT[type]}`, size: data.length },
            overrideAccess: false, // the media collection's own access rules decide: never bypassed
            user: req.user,
          })) as unknown as Doc
        } catch (e) {
          const status = (e as { status?: number }).status
          if (status === 401 || status === 403) return json(403, { error: 'upload-forbidden' })
          payload.logger.error({ err: e }, 'passwordless: avatar upload failed')
          return json(500, { error: 'upload-failed' })
        }

        const before = (await payload.findByID({ collection: o.usersSlug as never, id: userId, depth: 0, overrideAccess: true })) as unknown as Doc
        await payload.update({ collection: o.usersSlug as never, id: userId, data: { avatar: media.id } as never, overrideAccess: true })
        await dropOldAvatar(req, mediaSlug, before.avatar as Id | undefined, userId, media.id)
        return json(200, { avatarUrl: mediaURL(media), user: await profileUser(payload, o, userId) })
      },
    },

    {
      path: '/passwordless/profile/avatar/remove',
      method: 'post',
      handler: async (req) => {
        const mediaSlug = o.profile.mediaSlug
        if (!mediaSlug) return json(404, { error: 'avatar-disabled' })
        if (!req.user) return json(401, { error: 'login-required' })
        const userId = (req.user as unknown as Doc).id
        const before = (await req.payload.findByID({ collection: o.usersSlug as never, id: userId, depth: 0, overrideAccess: true })) as unknown as Doc
        await req.payload.update({ collection: o.usersSlug as never, id: userId, data: { avatar: null } as never, overrideAccess: true })
        await dropOldAvatar(req, mediaSlug, before.avatar as Id | undefined, userId)
        return json(200, { avatarUrl: null, user: await profileUser(req.payload, o, userId) })
      },
    },

    // change the login address: a code goes to the NEW address, the old one stays valid until it is entered
    {
      path: '/passwordless/email/request',
      method: 'post',
      handler: async (req) => {
        const { payload } = req
        if (!req.user) return json(401, { error: 'login-required' })
        if (isImpersonating(req)) return json(403, { error: 'impersonating' })
        const user = req.user as unknown as Doc
        const email = normalize((await body(req)).email)
        if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: 'email-required' })
        if (email === normalize(user.email)) return json(400, { error: 'email-unchanged' })
        if (await findUser(payload, o, email)) return json(409, { error: 'email-taken' })
        if (o.newEmails && (await refuseNewEmail(email, o.newEmails))) return json(422, { error: 'email-not-allowed' })

        const windowStart = new Date(Date.now() - o.rateWindowMinutes * 60_000).toISOString()
        const mine = await payload.count({ collection: LOGIN_CHALLENGES_SLUG as never, where: { and: [{ purpose: { equals: EMAIL_CHANGE } }, { userId: { equals: String(user.id) } }, { createdAt: { greater_than: windowStart } }] }, overrideAccess: true })
        if (mine.totalDocs >= o.maxRequests) return json(429, { error: 'too-many-requests' })
        const ip = clientIP(req)
        const ipHash = ip ? digest(payload.secret, `ip:${ip}`) : undefined
        if (ipHash) {
          const fromIP = await payload.count({ collection: LOGIN_CHALLENGES_SLUG as never, where: { and: [{ ipHash: { equals: ipHash } }, { createdAt: { greater_than: windowStart } }] }, overrideAccess: true })
          if (fromIP.totalDocs >= o.maxRequestsPerIP) return json(429, { error: 'too-many-requests' })
        }

        // only the newest request is valid
        await payload.update({ collection: LOGIN_CHALLENGES_SLUG as never, where: { and: [{ purpose: { equals: EMAIL_CHANGE } }, { userId: { equals: String(user.id) } }] }, data: { expiresAt: new Date().toISOString() } as never, overrideAccess: true })
        const code = randomCode(o.codeLength)
        await payload.create({
          collection: LOGIN_CHALLENGES_SLUG as never,
          data: {
            email,
            purpose: EMAIL_CHANGE,
            userId: String(user.id),
            codeHash: digest(payload.secret, `code:${email}:${code}`),
            tokenHash: digest(payload.secret, `token:${randomToken()}`), // required by the collection, never emailed: this flow has no link
            expiresAt: new Date(Date.now() + o.ttlMinutes * 60_000).toISOString(),
            ...(ipHash ? { ipHash } : {}),
          } as never,
          overrideAccess: true,
        })
        void removeExpired(payload)
        await o.sendEmail(payload, email, await o.renderEmailChange({ email, code, ttlMinutes: o.ttlMinutes }))
        return json(200, { sent: true })
      },
    },

    {
      path: '/passwordless/email/confirm',
      method: 'post',
      handler: async (req) => {
        const { payload } = req
        if (!req.user) return json(401, { error: 'login-required' })
        if (isImpersonating(req)) return json(403, { error: 'impersonating' })
        const userId = (req.user as unknown as Doc).id
        const raw = (await body(req)).code
        const code = typeof raw === 'string' ? raw.trim() : ''
        if (!code) return json(400, { error: 'invalid-code' })

        const found = await payload.find({ collection: LOGIN_CHALLENGES_SLUG as never, where: { and: [{ purpose: { equals: EMAIL_CHANGE } }, { userId: { equals: String(userId) } }, { expiresAt: { greater_than: new Date().toISOString() } }] }, sort: '-createdAt', limit: 1, depth: 0, overrideAccess: true })
        const challenge = found.docs[0] as unknown as Doc | undefined
        if (!challenge) return json(400, { error: 'invalid-code' })
        const email = String(challenge.email)

        const attempts = Number(challenge.attempts ?? 0) + 1
        if (attempts > o.maxAttempts) {
          await payload.update({ collection: LOGIN_CHALLENGES_SLUG as never, id: challenge.id, data: { expiresAt: new Date().toISOString() } as never, overrideAccess: true })
          return json(429, { error: 'too-many-attempts' })
        }
        if (!safeEqual(String(challenge.codeHash), digest(payload.secret, `code:${email}:${code}`))) {
          await payload.update({ collection: LOGIN_CHALLENGES_SLUG as never, id: challenge.id, data: { attempts } as never, overrideAccess: true })
          return json(400, { error: 'invalid-code', attemptsLeft: o.maxAttempts - attempts })
        }

        const taken = await findUser(payload, o, email) // somebody may have registered it in the meantime
        if (taken && taken.id !== userId) return json(409, { error: 'email-taken' })
        await payload.update({ collection: o.usersSlug as never, id: userId, data: { email, emailVerifiedAt: new Date().toISOString() } as never, overrideAccess: true })
        await payload.delete({ collection: LOGIN_CHALLENGES_SLUG as never, where: { and: [{ purpose: { equals: EMAIL_CHANGE } }, { userId: { equals: String(userId) } }] }, overrideAccess: true })
        // a fresh token that carries the new address; the old session keeps working too
        const session = await startSession(payload, o.usersSlug, userId)
        return json(200, { user: await profileUser(payload, o, userId), exp: session.exp }, [session.cookie])
      },
    },

    {
      path: '/passwordless/accept-terms',
      method: 'post',
      handler: async (req) => {
        if (!req.user) return json(401, { error: 'login-required' })
        await req.payload.update({ collection: o.usersSlug as never, id: (req.user as unknown as Doc).id, data: { termsAcceptedAt: new Date().toISOString(), termsVersion: o.terms?.version } as never, overrideAccess: true })
        return json(200, { accepted: true })
      },
    },

    // who am I, and am I looking at the site as someone else (for the "leave impersonation" banner)
    {
      path: '/passwordless/me',
      method: 'get',
      handler: async (req) => {
        if (!req.user) return json(200, { user: null })
        const cookies = req.headers.get('cookie') ?? ''
        const impersonating = /(?:^|;\s*)[^=]+-impersonator=/.test(cookies)
        return json(200, { user: publicUser(req.user as unknown as Doc), impersonating })
      },
    },

    {
      path: '/passwordless/impersonate',
      method: 'post',
      handler: async (req) => {
        const { payload } = req
        if (!staff(req.user)) return json(403, { error: 'forbidden' })
        const targetID = (await body(req)).userID as Id | undefined
        if (targetID === undefined) return json(400, { error: 'user-required' })
        const target = (await payload.findByID({ collection: o.usersSlug as never, id: targetID, depth: 0, overrideAccess: true }).catch(() => null)) as unknown as Doc | null
        if (!target) return json(404, { error: 'not-found' })
        if (staff(target)) return json(403, { error: 'cannot-impersonate-staff' }) // legacy rule: staff cannot be impersonated

        const session = await startSession(payload, o.usersSlug, target.id, { tokenExpirationSeconds: o.impersonationMinutes * 60 })
        const collection = collectionConfig(payload, o.usersSlug)
        const prefix = payload.config.cookiePrefix ?? 'payload'
        // the staff member's own token is kept aside (still a valid session) so "leave" can put it back
        const ownToken = /(?:^|;\s*)payload-token=([^;]+)/.exec(req.headers.get('cookie') ?? '')?.[1] ?? /(?:^|;\s*)[^=]*-token=([^;]+)/.exec(req.headers.get('cookie') ?? '')?.[1]
        const keep = authCookie(payload, collection as never, ownToken ?? '', new Date(session.exp * 1000), `${prefix}-impersonator`)
        await payload.create({ collection: IMPERSONATION_LOG_SLUG as never, data: { staff: String((req.user as unknown as Doc).email), target: String(target.email) } as never, overrideAccess: true })
        return json(200, { user: publicUser(target), exp: session.exp }, [session.cookie, keep])
      },
    },

    {
      path: '/passwordless/impersonate/leave',
      method: 'post',
      handler: async (req) => {
        const { payload } = req
        const prefix = payload.config.cookiePrefix ?? 'payload'
        const original = new RegExp(`(?:^|;\\s*)${prefix}-impersonator=([^;]+)`).exec(req.headers.get('cookie') ?? '')?.[1]
        if (!original) return json(400, { error: 'not-impersonating' })
        const collection = collectionConfig(payload, o.usersSlug)
        const exp = new Date(Date.now() + 7 * 86_400_000)
        const restore = authCookie(payload, collection as never, original, exp)
        const clear = authCookie(payload, collection as never, '', new Date(0), `${prefix}-impersonator`)
        const open = await payload.find({ collection: IMPERSONATION_LOG_SLUG as never, where: { endedAt: { exists: false } }, sort: '-createdAt', limit: 1, depth: 0, overrideAccess: true })
        const entry = open.docs[0] as unknown as Doc | undefined
        if (entry) await payload.update({ collection: IMPERSONATION_LOG_SLUG as never, id: entry.id, data: { endedAt: new Date().toISOString() } as never, overrideAccess: true })
        return json(200, { left: true }, [restore, clear])
      },
    },
  ]
}
