# @daugtcom/payload-passwordless

Emailed one-time code + magic link login, optional password, terms acceptance, staff impersonation, and an optional captcha.

## Captcha

```ts
payloadPasswordless({
  captcha: { provider: 'turnstile', secretKey: process.env.TURNSTILE_SECRET_KEY! },
  // or any provider: captcha: { verify: async (token, req) => boolean }
})
```

With `captcha` set, `POST /api/passwordless/request-code` and `POST /api/passwordless/login` (password login) need `captchaToken` in the body:
missing → `400 captcha-required`, invalid → `403 captcha-failed`. Verification fails closed (a Cloudflare outage blocks logins).
`/passwordless/status` stays open. Without the option nothing changes.

Payload's own `/api/users/login` is not gated (the admin panel uses it and cannot send a token). Rely on Payload's `maxLoginAttempts` / `lockTime`
on the users collection for that route.

Cloudflare's test keys: site `1x00000000000000000000AA` / secret `1x0000000000000000000000000000000AA` always pass;
`2x00000000000000000000AB` / `2x0000000000000000000000000000000AA` always fail.

## UI (`@daugtcom/payload-passwordless/ui`)

Page bodies only, no layout. Styled with Tailwind v4 utility classes using the tokens `primary-*` and `neutral-*`: define them in your theme and add
`@source "../node_modules/@daugtcom/payload-passwordless/src/ui";` to your CSS so the classes are generated. Copy a component into your project to restyle it.

| Export | Kind | Props |
| --- | --- | --- |
| `LoginForm` | client | `redirect = '/access'`, `locale = 'de'`, `termsHref = '/agb'`, `privacyHref = '/datenschutz'`, `captcha?: { provider: 'turnstile'; siteKey }` |
| `SetPasswordForm` | client | `hasPassword`, `locale` |
| `ProfileForm` | client | `user: { name, fullName, email, avatarUrl }`, `locale = 'de'`, `hasAvatarUpload = false`, `avatarMaxMB = 10` |
| `TermsGate` | client | `locale`, `termsHref`, `privacyHref` |
| `TurnstileWidget` | client | `siteKey`, `onToken(token \| null)`, `language`, `ref` (`{ reset() }`) |
| `getSessionUser(payload)` | server | the logged-in member or `null` |
| `requireMember(payload, path, { termsVersion?, loginPath = '/login' })` | server | redirects to `/login?redirect=<path>`; returns `{ user, termsRequired }` (render `<TermsGate />` when true) |

Pass `captcha={{ provider: 'turnstile', siteKey: process.env.TURNSTILE_SITE_KEY! }}` to `LoginForm` when the plugin has `captcha`. When the prop is set, the
password step posts to `/api/passwordless/login` instead of `/api/users/login`.

## Keeping junk registrations out

An account is only created once the emailed code (or link) was used, so a typo or a stranger's address never makes a user. What remains is mail sent to addresses nobody owns. Three layers, all on by default except the captcha:

- `captcha`: Turnstile (or your own `verify`) on `request-code` and the password login.
- `newEmails` (default on): for an address we have not seen, refuse throwaway providers (the maintained [`mailchecker`](https://github.com/FGRibreau/mailchecker) list, 55k+ domains, updated by bumping the package; add `blockedDomains` / `allowedDomains` to adjust), domains without a mail server (DNS MX check; a DNS timeout lets it through), and anything your own `check(email)` refuses. Existing members are never checked. The login form shows a friendly message (422 `email-not-allowed`). `newEmails: false` switches it off.
- `maxRequestsPerIP` (default 20 per `rateWindowMinutes`) on top of the per-address limit. The IP is read from `cf-connecting-ip` / `x-forwarded-for`, so run behind a proxy that sets them.

If accounts should only come from purchases or imports, use `allowRegistration: false`: unknown addresses get the same "sent" answer but no email.

## Member profile

```ts
payloadPasswordless({ profile: { mediaSlug: 'media', avatarMaxMB: 10 } })
```

The plugin adds `fullName` (text) to the users collection. With `profile.mediaSlug` it also adds `avatar` (upload to that collection) and enables the avatar endpoints; without it nothing about avatars changes.
`renderEmailChange({ email, code, ttlMinutes })` customises the "confirm your new address" mail (default: German + English text).

All endpoints need a session and only touch the signed-in member's own `name`, `fullName`, `avatar` and (after a code) `email`/`emailVerifiedAt`; `roles`, `hasPassword` and the terms fields are never writable here.

| Endpoint | Body | Answer |
| --- | --- | --- |
| `POST /api/passwordless/profile` | `{ name, fullName? }` (trimmed, max 120, `name` required) | `{ user }` or 422 `name-required` / `too-long` |
| `POST /api/passwordless/profile/avatar` | multipart, field `file` (jpeg/png/webp/gif, magic bytes checked, max `avatarMaxMB`) | `{ avatarUrl, user }` or 400 `file-required`, 413 `file-too-large`, 415 `unsupported-type`, 403 `upload-forbidden`, 404 `avatar-disabled` |
| `POST /api/passwordless/profile/avatar/remove` | - | `{ avatarUrl: null, user }` |
| `POST /api/passwordless/email/request` | `{ email }` | `{ sent: true }`; 409 `email-taken`, 422 `email-not-allowed` (disposable / no MX, via `newEmails`), 400 `email-unchanged` / `email-required`, 429 |
| `POST /api/passwordless/email/confirm` | `{ code }` | `{ user, exp }` and a fresh auth cookie; 400 `invalid-code`, 429 `too-many-attempts` |

`user` is `{ id, email, name, fullName, avatarUrl }`. The avatar is created through the Local API with `overrideAccess: false` as the member, so the media collection's own access
rules decide (a refusal is 403 `upload-forbidden`). If the media collection has `userUpload` / `uploadedBy` fields they are set to `true` / the member id. The previous avatar is deleted
best-effort, only when its `uploadedBy` is that member. Changing the address is disabled while impersonating. The captcha is not applied to these (already signed-in) endpoints.

```tsx
<ProfileForm user={{ name, fullName, email, avatarUrl }} locale="de" hasAvatarUpload />
```
