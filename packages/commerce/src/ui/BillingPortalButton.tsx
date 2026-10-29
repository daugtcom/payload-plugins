'use client'

import { useState, type ReactNode } from 'react'
import { api } from './api'
import { t, type Locale } from './i18n'

/** Opens Stripe's billing portal (payment methods, subscriptions, invoices) for the signed-in member. */
export function BillingPortalButton({ locale = 'de', className, children }: { locale?: Locale; className?: string; children?: ReactNode }) {
  const L = t(locale)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <span className="inline-flex flex-col items-start gap-2">
      <button
        type="button"
        disabled={busy}
        className={className ?? 'inline-flex items-center justify-center rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700 disabled:opacity-60'}
        onClick={async () => {
          setBusy(true); setFailed(false)
          const r = await api<{ url?: string }>('/commerce/billing-portal', { body: {} })
          if (r.ok && r.data.url) window.location.assign(r.data.url)
          else { setFailed(true); setBusy(false) }
        }}
      >
        {children ?? L.manageBilling}
      </button>
      {failed && <span role="alert" className="text-sm text-primary-700">{L.billingFailed}</span>}
    </span>
  )
}
