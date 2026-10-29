'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { api } from './api'
import { t, type Locale } from './i18n'

/** Shown once to members who have not accepted the current terms (all imported members). */
export function TermsGate({ locale = 'de', termsHref = '/agb', privacyHref = '/datenschutz' }: { locale?: Locale; termsHref?: string; privacyHref?: string }) {
  const L = t(locale)
  const router = useRouter()
  const [ok, setOk] = useState(false)
  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
      <h1 className="text-2xl font-semibold text-neutral-900">{L.termsGateTitle}</h1>
      <p className="mt-3 text-neutral-600">{L.termsGateText}</p>
      <label className="mt-5 flex items-start justify-center gap-2 text-left text-sm text-neutral-600"><input type="checkbox" className="mt-1" checked={ok} onChange={(e) => setOk(e.target.checked)} /><span>{L.acceptTerms} (<a className="underline" href={termsHref} target="_blank" rel="noreferrer">AGB</a>, <a className="underline" href={privacyHref} target="_blank" rel="noreferrer">Datenschutz</a>)</span></label>
      <button className="mt-5 inline-flex items-center justify-center rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700 disabled:opacity-60" disabled={!ok} onClick={async () => { await api('/passwordless/accept-terms', { body: {} }); router.refresh() }}>{L.accept}</button>
    </div>
  )
}
