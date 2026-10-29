'use client'

import { useRef, useState } from 'react'
import { api } from './api'
import { t, type Locale } from './i18n'
import { TurnstileWidget, type TurnstileHandle } from './TurnstileWidget'

type Step = 'email' | 'code' | 'password'

export interface LoginFormProps {
  /** Where to go after login (same-site path). */
  redirect?: string
  locale?: Locale
  termsHref?: string
  privacyHref?: string
  /** Set when the plugin runs with a `captcha` option. The code request and the password login then carry the token. */
  captcha?: { provider: 'turnstile'; siteKey: string }
}

/** Email first. Members with a password enter it; everyone else gets an emailed code (new members accept the terms once). */
export function LoginForm({ redirect = '/access', locale = 'de', termsHref = '/agb', privacyHref = '/datenschutz', captcha }: LoginFormProps) {
  const L = t(locale)
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [termsRequired, setTermsRequired] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const widget = useRef<TurnstileHandle>(null)

  const go = (to: string) => window.location.assign(to.startsWith('/') && !to.startsWith('//') ? to : '/access')
  const fail = (m: string) => { setMessage(m); setBusy(false) }
  /** a token works once: after every attempt ask for the next */
  const spent = () => { setToken(null); widget.current?.reset() }
  const blocked = Boolean(captcha) && !token
  const widgetEl = captcha ? <div className="flex justify-center overflow-hidden"><TurnstileWidget ref={widget} siteKey={captcha.siteKey} onToken={setToken} language={locale} /></div> : null

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setMessage(null)
    const status = await api<{ hasPassword: boolean; termsRequired: boolean }>('/passwordless/status', { body: { email } })
    if (!status.ok) return fail(L.wrongCode)
    if (status.data.hasPassword) { setToken(null); setStep('password'); setBusy(false); return }
    setTermsRequired(status.data.termsRequired)
    if (status.data.termsRequired && !accepted) { setBusy(false); setMessage(L.acceptTerms); setStep('email'); return }
    const sent = await api('/passwordless/request-code', { body: { email, acceptTerms: accepted, redirect, ...(captcha ? { captchaToken: token } : {}) } })
    if (captcha) spent()
    if (sent.status === 400 || sent.status === 403) { if (captcha && (sent.data as { error?: string }).error?.startsWith('captcha')) return fail(L.captchaFailed) }
    if (sent.status === 422) return fail((sent.data as { error?: string }).error === 'email-not-allowed' ? L.emailNotAllowed : L.termsRequired)
    if (!sent.ok) return fail(sent.status === 429 ? L.tooMany : L.wrongCode)
    setStep('code'); setMessage(L.codeSent); setBusy(false)
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setMessage(null)
    const r = await api<{ redirect?: string; error?: string }>('/passwordless/verify', { body: { email, code } })
    if (r.ok) return go(r.data.redirect ?? redirect)
    fail(r.status === 429 ? L.tooMany : L.wrongCode)
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setMessage(null)
    const r = captcha ? await api<{ error?: string }>('/passwordless/login', { body: { email, password, captchaToken: token } }) : await api<{ error?: string }>('/users/login', { body: { email, password } })
    if (r.ok) return go(redirect)
    if (captcha) spent()
    fail(captcha && r.data.error?.startsWith('captcha') ? L.captchaFailed : L.wrongPassword)
  }

  async function forgot() {
    await api('/users/forgot-password', { body: { email } })
    setMessage(L.forgotSent)
  }

  const input = 'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-base text-neutral-900 shadow-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200'
  const button = 'w-full rounded-lg bg-primary-600 px-4 py-2.5 font-medium text-white shadow-sm hover:bg-primary-700 disabled:opacity-60'

  return (
    <div className="mx-auto w-full max-w-sm">
      {step === 'email' && (
        <form onSubmit={submitEmail} className="flex flex-col gap-5">
          <p className="text-neutral-600">{L.loginLead}</p>
          <label className="block text-sm font-medium text-neutral-700">{L.email}<input className={`${input} mt-2`} type="email" required autoFocus autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          {(termsRequired || message === L.acceptTerms) && (
            <label className="flex items-start gap-2 text-sm text-neutral-600"><input type="checkbox" className="mt-1" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
              <span>{L.acceptTerms} (<a className="underline" href={termsHref} target="_blank" rel="noreferrer">AGB</a>, <a className="underline" href={privacyHref} target="_blank" rel="noreferrer">Datenschutz</a>)</span></label>
          )}
          {widgetEl}
          <button className={button} disabled={busy || blocked} type="submit">{L.continue}</button>
        </form>
      )}
      {step === 'code' && (
        <form onSubmit={submitCode} className="flex flex-col gap-5">
          <label className="block text-sm font-medium text-neutral-700">{L.code}<input className={`${input} mt-2 text-center text-2xl tracking-[.5em]`} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={8} required autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></label>
          <button className={button} disabled={busy} type="submit">{L.login}</button>
          <button type="button" className="w-full text-sm text-neutral-500 underline" onClick={() => { setStep('email'); setMessage(null); setCode(''); setToken(null) }}>{L.back}</button>
        </form>
      )}
      {step === 'password' && (
        <form onSubmit={submitPassword} className="flex flex-col gap-5">
          <label className="block text-sm font-medium text-neutral-700">{L.password}<input className={`${input} mt-2`} type="password" required autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          {widgetEl}
          <button className={button} disabled={busy || blocked} type="submit">{L.login}</button>
          <div className="flex justify-between text-sm"><button type="button" className="text-neutral-500 underline" onClick={() => { setStep('email'); setToken(null) }}>{L.back}</button><button type="button" className="text-neutral-500 underline" onClick={forgot}>{L.forgot}</button></div>
        </form>
      )}
      {message && <p role="status" className="mt-4 rounded-lg bg-primary-50 px-3 py-2 text-sm text-primary-800">{message}</p>}
    </div>
  )
}
