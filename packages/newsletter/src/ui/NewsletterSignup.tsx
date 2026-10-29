'use client'

import { ArrowRight, Check } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'

export interface NewsletterSignupProps {
  endpoint?: string
  askName?: boolean
  labels?: { name?: string; email?: string; submit?: string; sending?: string; doneTitle?: string; doneText?: string; error?: string; invalid?: string; consent?: ReactNodeLike }
  className?: string
}
type ReactNodeLike = string

const DEFAULT = { name: 'Vor- und Nachname', email: 'E-Mail', submit: 'Anmelden', sending: 'Einen Moment …', doneTitle: 'Bitte bestätige deine E-Mail-Adresse', doneText: 'Wir haben dir eine E-Mail geschickt. Mit einem Klick auf den Link darin bist du dabei. Schau auch im Spam-Ordner nach, falls nichts ankommt.', error: 'Das hat leider nicht geklappt. Bitte versuche es gleich noch einmal.', invalid: 'Bitte gib eine gültige E-Mail-Adresse ein.' }

/**
 * Newsletter signup form (double opt-in): name and email, a hidden honeypot and the time the form was shown, no captcha.
 * The answer is always the same, whether or not the address is known. Tailwind classes use the site's `primary` / `neutral` scales.
 */
export function NewsletterSignup({ endpoint = '/api/newsletter/subscribe', askName = true, labels, className = '' }: NewsletterSignupProps) {
  const L = { ...DEFAULT, ...labels }
  const shownAt = useRef(Date.now())
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error' | 'invalid'>('idle')
  const field = 'w-full rounded-full border border-neutral-300 bg-white px-5 py-3 text-base placeholder:text-neutral-400 focus:border-primary-400 focus:outline-none focus:ring-4 focus:ring-primary-100'

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setState('sending')
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: f.get('email'), name: f.get('name') ?? undefined, website: f.get('website'), ts: shownAt.current }) })
      setState(res.status === 400 ? 'invalid' : res.ok ? 'done' : 'error')
    } catch {
      setState('error')
    }
  }

  if (state === 'done') {
    return (
      <div role="status" className={`rounded-2xl bg-white/70 p-6 ${className}`}>
        <p className="m-0 flex items-center gap-2 font-semibold text-primary-950"><Check className="h-5 w-5 text-primary-700" aria-hidden />{L.doneTitle}</p>
        <p className="m-0 mt-2 text-neutral-700">{L.doneText}</p>
      </div>
    )
  }
  return (
    <form onSubmit={submit} className={`flex flex-col gap-3 ${className}`} noValidate>
      {/* honeypot: people never see or fill it */}
      <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden"><label>Website<input name="website" type="text" tabIndex={-1} autoComplete="off" /></label></div>
      {askName && (<><label htmlFor="nl-name" className="sr-only">{L.name}</label><input id="nl-name" name="name" type="text" autoComplete="name" className={field} placeholder={L.name} /></>)}
      <label htmlFor="nl-email" className="sr-only">{L.email}</label>
      <input id="nl-email" name="email" type="email" autoComplete="email" required className={field} placeholder={L.email} aria-invalid={state === 'invalid'} />
      {state === 'invalid' && <p role="alert" className="m-0 text-sm text-primary-800">{L.invalid}</p>}
      {state === 'error' && <p role="alert" className="m-0 text-sm text-primary-800">{L.error}</p>}
      <button type="submit" disabled={state === 'sending'} className="mt-1 inline-flex items-center justify-center gap-x-2 rounded-full bg-primary-600 px-7 py-3 text-base font-medium text-white transition-colors duration-300 hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 disabled:opacity-60">
        {state === 'sending' ? L.sending : L.submit} {state !== 'sending' && <ArrowRight className="h-4 w-4" aria-hidden />}
      </button>
    </form>
  )
}
