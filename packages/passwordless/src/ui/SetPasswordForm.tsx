'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { api } from './api'
import { t, type Locale } from './i18n'

const input = 'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2.5'
const button = 'inline-flex items-center justify-center rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700 disabled:opacity-60'

/** The member sets a password (from then on it is used instead of the emailed code), or changes the one they have (the current one is asked for). */
export function SetPasswordForm({ hasPassword, locale = 'de', inputClassName = input, buttonClassName = button }: { hasPassword: boolean; locale?: Locale; inputClassName?: string; buttonClassName?: string }) {
  const L = t(locale)
  const router = useRouter()
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const r = await api<{ error?: string }>('/passwordless/set-password', { body: hasPassword ? { password, currentPassword: current } : { password } })
    setBusy(false)
    if (r.ok) {
      setMsg({ ok: true, text: hasPassword ? L.passwordChanged : L.saved })
      setCurrent('')
      setPassword('')
      router.refresh()
      return
    }
    const error = (r.data as { error?: string } | undefined)?.error
    setMsg({ ok: false, text: error === 'wrong-password' ? L.wrongCurrentPassword : error === 'password-too-short' ? L.passwordTooShort : L.genericError })
  }

  return (
    <form className="max-w-sm space-y-3" onSubmit={submit}>
      <p className="m-0 text-neutral-600">{hasPassword ? L.hasPassword : L.setPasswordHint}</p>
      {hasPassword && <input className={inputClassName} type="password" required autoComplete="current-password" aria-label={L.currentPassword} placeholder={L.currentPassword} value={current} onChange={(e) => setCurrent(e.target.value)} />}
      <input className={inputClassName} type="password" minLength={8} required autoComplete="new-password" aria-label={L.newPassword} placeholder={L.newPassword} value={password} onChange={(e) => setPassword(e.target.value)} />
      <button className={buttonClassName} type="submit" disabled={busy}>{hasPassword ? L.changePassword : L.setPassword}</button>
      {msg && <p role="status" className={`m-0 text-sm ${msg.ok ? 'text-green-800' : 'text-primary-700'}`}>{msg.text}</p>}
      {hasPassword && <p className="m-0 text-sm text-neutral-500">{L.forgotCurrent}</p>}
    </form>
  )
}
