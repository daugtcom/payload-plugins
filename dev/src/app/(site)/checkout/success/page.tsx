'use client'

import { useEffect, useState } from 'react'

export default function Success() {
  const [state, setState] = useState<string>('Confirming your order…')

  useEffect(() => {
    const sessionID = new URLSearchParams(location.search).get('session_id')
    const cartID = document.cookie.split('; ').find((c) => c.startsWith('dev-cart='))?.split('=')[1]
    fetch('/api/payments/stripe-checkout/confirm-order', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionID, cartID }),
    })
      .then(async (r) => setState(r.ok ? `Order confirmed: ${JSON.stringify(await r.json())}` : `Could not confirm (${r.status}), the webhook will settle it.`))
      .catch((e) => setState(String(e)))
  }, [])

  return (
    <main>
      <h1>Thank you</h1>
      <p id="result">{state}</p>
      <a href="/">Back to the shop</a>
    </main>
  )
}
