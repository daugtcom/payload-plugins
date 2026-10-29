'use client'

import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { useCommerceSession } from './CommerceProvider'
import { t, type Locale } from './i18n'

/** After Stripe: settles the order for this buyer (the webhook does the same if they close the tab). */
export function ConfirmOrder({ locale = 'de' }: { locale?: Locale }) {
  const L = t(locale)
  const [state, setState] = useState<'working' | 'done' | 'later'>('working')
  const { ready, restore } = useCommerceSession()
  const started = useRef(false)
  useEffect(() => {
    if (!ready || started.current) return
    started.current = true
    const sessionID = new URLSearchParams(window.location.search).get('session_id')
    if (!sessionID) { setState('later'); return }
    void (async () => {
      try {
        const additionalData = { sessionID }
        // Payload's hook requires an active cart and injects its ID. A delayed return
        // must settle the original transaction instead, resolved securely by session ID.
        const result = await api('/payments/stripe-checkout/confirm-order', { body: additionalData })
        if (!result.ok) throw new Error('Order confirmation failed')
        setState('done')
        await restore().catch(() => {})
      } catch { setState('later') }
    })()
  }, [ready, restore])
  return <p role="status" className="text-lg text-neutral-700">{state === 'working' ? L.confirming : state === 'done' ? L.confirmed : L.confirmFailed}</p>
}
