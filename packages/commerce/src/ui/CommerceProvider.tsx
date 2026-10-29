'use client'

import { EcommerceProvider, useEcommerce } from '@payloadcms/plugin-ecommerce/client/react'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type ComponentProps } from 'react'

const currenciesConfig = { defaultCurrency: 'EUR', supportedCurrencies: [{ code: 'EUR', decimals: 2, label: 'Euro', symbol: '€' }] }
const paymentMethods = [{ name: 'stripe-checkout', label: 'Stripe', initiatePayment: true, confirmOrder: true }]
const api: NonNullable<ComponentProps<typeof EcommerceProvider>['api']> = {
  cartsFetchQuery: {
    depth: 2,
    select: { items: true, subtotal: true, purchasedAt: true },
    populate: { products: { title: true, slug: true, gallery: true, commerce: true, priceInEUR: true } },
  },
}

const SessionContext = createContext({ ready: false, restore: async () => {}, logout: () => {} })
export const useCommerceSession = () => useContext(SessionContext)

/** Member cart persistence lives in Payload's active-cart join, never a browser cart ID. */
export function CommerceProvider({ children, userID }: { children: ReactNode; userID: string | number | null }) {
  return <EcommerceProvider key={userID ?? 'guest'} currenciesConfig={currenciesConfig} paymentMethods={paymentMethods} api={api} syncLocalStorage={false}>
    <MemberSession userID={userID}>{children}</MemberSession>
  </EcommerceProvider>
}

function MemberSession({ children, userID }: { children: ReactNode; userID: string | number | null }) {
  const { onLogin, onLogout, cart } = useEcommerce()
  const [ready, setReady] = useState(false)
  const callbacks = useRef({ onLogin, onLogout })
  callbacks.current = { onLogin, onLogout }
  const pending = useRef<Promise<void> | null>(null)
  const restore = useCallback(() => {
    if (pending.current) return pending.current
    setReady(false)
    // Clearing the session only drops provider references. It never edits a purchased cart.
    callbacks.current.onLogout()
    pending.current = (userID === null ? Promise.resolve() : callbacks.current.onLogin())
      .finally(() => { pending.current = null; setReady(true) })
    return pending.current
  }, [userID])

  useEffect(() => {
    // Remove references left by the pre-provider storefront or an earlier guest-enabled setup.
    try { localStorage.removeItem('cart'); localStorage.removeItem('cart_secret') } catch {}
    document.cookie = 'site-cart=; path=/; max-age=0; samesite=lax'
    void restore().catch(() => {})
    const focus = () => { void restore().catch(() => {}) }
    window.addEventListener('focus', focus)
    return () => window.removeEventListener('focus', focus)
  }, [restore])

  useEffect(() => {
    if (cart?.purchasedAt) void restore().catch(() => {})
  }, [cart?.purchasedAt, restore])

  return <SessionContext value={{ ready, restore, logout: onLogout }}>{children}</SessionContext>
}
