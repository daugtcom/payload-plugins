'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState } from 'react'
import { api, upload } from './api'
import { t, type Locale } from './i18n'

export interface ProfileFormProps {
  user: { name?: string | null; fullName?: string | null; email: string; avatarUrl?: string | null }
  locale?: Locale
  /** Show the avatar section (the plugin needs `profile.mediaSlug`). */
  hasAvatarUpload?: boolean
  /** Must match the plugin's `profile.avatarMaxMB`. Default 10. */
  avatarMaxMB?: number
}

type Msg = { kind: 'ok' | 'error'; text: string } | null

const field = 'mt-1.5 w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-[1rem] text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200'
const primary = 'rounded-lg bg-primary-700 px-5 py-2.5 text-[0.95rem] font-semibold text-white hover:bg-primary-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-200 disabled:opacity-50'
const secondary = 'rounded-lg border border-neutral-300 px-4 py-2.5 text-[0.95rem] font-medium text-neutral-700 hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-200 disabled:opacity-50'
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

/** Always renders a (possibly empty) live region so messages do not shift the layout when they appear. */
function Message({ msg }: { msg: Msg }) {
  return (
    <p role={msg?.kind === 'error' ? 'alert' : 'status'} aria-live="polite" className={`m-0 min-h-[1.25rem] text-sm ${msg?.kind === 'error' ? 'text-red-700' : 'text-green-800'}`}>
      {msg?.text ?? ''}
    </p>
  )
}

/** Profile page body: avatar, username + full name, and a two-step email change (code to the new address). */
export function ProfileForm({ user, locale = 'de', hasAvatarUpload = false, avatarMaxMB = 10 }: ProfileFormProps) {
  const L = t(locale)
  const router = useRouter()
  const id = useId()
  const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''))
  const errorText = (code?: string, status?: number): string => {
    switch (code) {
      case 'name-required': return L.nameRequired
      case 'too-long': return L.tooLong
      case 'login-required': return L.loginRequired
      case 'file-too-large': return fill(L.avatarTooBig, { max: avatarMaxMB })
      case 'unsupported-type': case 'file-required': return L.avatarWrongType
      case 'upload-forbidden': return L.avatarForbidden
      case 'upload-failed': return L.avatarFailed
      case 'email-taken': return L.emailTaken
      case 'email-unchanged': return L.emailUnchanged
      case 'email-required': return L.emailInvalid
      case 'email-not-allowed': return L.emailNotAllowed
      case 'too-many-requests': case 'too-many-attempts': return L.tooManyRequests
      case 'invalid-code': return L.codeExpired
      case 'impersonating': return L.impersonating
      default: return status === 429 ? L.tooManyRequests : L.genericError
    }
  }

  // ---- avatar
  const [avatar, setAvatar] = useState<string | null>(user.avatarUrl ?? null)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarMsg, setAvatarMsg] = useState<Msg>(null)
  const preview = useRef<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  useEffect(() => { setAvatar(user.avatarUrl ?? null) }, [user.avatarUrl])
  useEffect(() => () => { if (preview.current) URL.revokeObjectURL(preview.current) }, [])
  const initial = (user.name || user.fullName || user.email || '?').trim().charAt(0).toUpperCase()

  const pickFile = async (file: File | undefined) => {
    if (!file) return
    setAvatarMsg(null)
    if (!IMAGE_TYPES.includes(file.type)) return setAvatarMsg({ kind: 'error', text: L.avatarWrongType })
    if (file.size > avatarMaxMB * 1024 * 1024) return setAvatarMsg({ kind: 'error', text: fill(L.avatarTooBig, { max: avatarMaxMB }) })
    const before = avatar
    if (preview.current) URL.revokeObjectURL(preview.current)
    preview.current = URL.createObjectURL(file)
    setAvatar(preview.current)
    setAvatarBusy(true)
    const form = new FormData()
    form.set('file', file)
    const r = await upload('/passwordless/profile/avatar', form)
    setAvatarBusy(false)
    if (fileInput.current) fileInput.current.value = ''
    if (!r.ok) { setAvatar(before); return setAvatarMsg({ kind: 'error', text: errorText(r.data?.error, r.status) }) }
    setAvatar(r.data.avatarUrl ?? null)
    setAvatarMsg({ kind: 'ok', text: L.saved })
    router.refresh()
  }
  const removeAvatar = async () => {
    setAvatarBusy(true); setAvatarMsg(null)
    const r = await api('/passwordless/profile/avatar/remove', { body: {} })
    setAvatarBusy(false)
    if (!r.ok) return setAvatarMsg({ kind: 'error', text: errorText(r.data?.error, r.status) })
    setAvatar(null)
    setAvatarMsg({ kind: 'ok', text: L.saved })
    router.refresh()
  }

  // ---- names
  const [name, setName] = useState(user.name ?? '')
  const [fullName, setFullName] = useState(user.fullName ?? '')
  const [saving, setSaving] = useState(false)
  const [nameMsg, setNameMsg] = useState<Msg>(null)
  const saveNames = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true); setNameMsg(null)
    const r = await api('/passwordless/profile', { body: { name, fullName } })
    setSaving(false)
    if (!r.ok) return setNameMsg({ kind: 'error', text: errorText(r.data?.error, r.status) })
    setNameMsg({ kind: 'ok', text: L.saved })
    router.refresh()
  }

  // ---- email change
  const [email, setEmail] = useState(user.email)
  const [step, setStep] = useState<'idle' | 'code'>('idle')
  const [newEmail, setNewEmail] = useState('')
  const [code, setCode] = useState('')
  const [mailBusy, setMailBusy] = useState(false)
  const [mailMsg, setMailMsg] = useState<Msg>(null)
  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setMailBusy(true); setMailMsg(null)
    const r = await api('/passwordless/email/request', { body: { email: newEmail } })
    setMailBusy(false)
    if (!r.ok) return setMailMsg({ kind: 'error', text: errorText(r.data?.error, r.status) })
    setStep('code'); setCode('')
    setMailMsg({ kind: 'ok', text: fill(L.emailCodeSent, { email: newEmail.trim() }) })
  }
  const confirmCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setMailBusy(true); setMailMsg(null)
    const r = await api('/passwordless/email/confirm', { body: { code } })
    setMailBusy(false)
    if (!r.ok) return setMailMsg({ kind: 'error', text: r.data?.error === 'invalid-code' && typeof r.data.attemptsLeft === 'number' ? L.wrongCode : errorText(r.data?.error, r.status) })
    setEmail(r.data.user?.email ?? newEmail)
    setStep('idle'); setNewEmail(''); setCode('')
    setMailMsg({ kind: 'ok', text: L.emailChanged })
    router.refresh()
  }

  return (
    <div className="space-y-10">
      {hasAvatarUpload && (
        <section aria-labelledby={`${id}-avatar`} className="space-y-3">
          <h2 id={`${id}-avatar`} className="font-display text-xl font-semibold text-neutral-900">{L.profileAvatar}</h2>
          <div className="flex items-center gap-5">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} alt="" className="size-20 shrink-0 rounded-full object-cover" />
            ) : (
              <span aria-hidden="true" className="flex size-20 shrink-0 items-center justify-center rounded-full bg-primary-100 font-display text-3xl font-semibold text-primary-800">{initial}</span>
            )}
            <div className="space-y-2">
              <div className="flex flex-wrap gap-3">
                <input ref={fileInput} id={`${id}-file`} type="file" accept={IMAGE_TYPES.join(',')} className="sr-only" disabled={avatarBusy} onChange={(e) => void pickFile(e.target.files?.[0])} />
                <label htmlFor={`${id}-file`} className={`${secondary} cursor-pointer focus-within:ring-2 ${avatarBusy ? 'pointer-events-none opacity-50' : ''}`}>{avatarBusy ? L.saving : L.changeAvatar}</label>
                {avatar && <button type="button" className={secondary} disabled={avatarBusy} onClick={removeAvatar}>{L.removeAvatar}</button>}
              </div>
              <p className="m-0 text-sm text-neutral-500">{fill(L.avatarHint, { max: avatarMaxMB })}</p>
            </div>
          </div>
          <Message msg={avatarMsg} />
        </section>
      )}

      <form onSubmit={saveNames} className="space-y-5" noValidate>
        <label className="block text-[0.95rem] font-medium text-neutral-800">
          {L.userName}
          <input className={field} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoComplete="nickname" required aria-required="true" />
        </label>
        <label className="block text-[0.95rem] font-medium text-neutral-800">
          {L.fullName}
          <input className={field} value={fullName} maxLength={120} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
        </label>
        <div className="flex items-center gap-4">
          <button type="submit" className={primary} disabled={saving || !name.trim()}>{saving ? L.saving : L.save}</button>
          <Message msg={nameMsg} />
        </div>
      </form>

      <section aria-labelledby={`${id}-mail`} className="space-y-4">
        <h2 id={`${id}-mail`} className="font-display text-xl font-semibold text-neutral-900">{L.changeEmail}</h2>
        <p className="m-0 text-[0.95rem] text-neutral-600">{L.currentEmail}: <strong className="font-semibold text-neutral-900">{email}</strong></p>
        {step === 'idle' ? (
          <form onSubmit={requestCode} className="space-y-4">
            <label className="block text-[0.95rem] font-medium text-neutral-800">
              {L.newEmail}
              <input className={field} type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} autoComplete="email" required />
            </label>
            <div className="flex items-center gap-4">
              <button type="submit" className={primary} disabled={mailBusy || !newEmail.trim()}>{mailBusy ? L.sending : L.sendCode}</button>
              <Message msg={mailMsg} />
            </div>
          </form>
        ) : (
          <form onSubmit={confirmCode} className="space-y-4">
            <p className="m-0 text-[0.95rem] text-neutral-600">{fill(L.emailCodeSent, { email: newEmail.trim() })}</p>
            <label className="block text-[0.95rem] font-medium text-neutral-800">
              {L.codeLabel}
              <input className={`${field} max-w-[12rem] text-center font-mono tracking-[0.4em]`} inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required autoFocus />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" className={primary} disabled={mailBusy || code.length < 4}>{mailBusy ? L.confirming : L.confirmCode}</button>
              <button type="button" className={secondary} disabled={mailBusy} onClick={() => { setStep('idle'); setCode(''); setMailMsg(null) }}>{L.cancel}</button>
              <Message msg={mailMsg?.kind === 'error' ? mailMsg : null} />
            </div>
          </form>
        )}
      </section>
    </div>
  )
}
