'use client'

import { loadStripe } from '@stripe/stripe-js'
import { CheckoutForm, CheckoutFormProvider, useCheckoutForm } from '@stripe/react-stripe-js/checkout'
import { useEffect, useMemo, useRef, useState } from 'react'
import { t, type Locale } from './i18n'
import { api } from './api'
import { useCart, usePayments } from '@payloadcms/plugin-ecommerce/client/react'
import { useCommerceSession } from './CommerceProvider'

interface Session { clientSecret: string; sessionID: string }

/** Stripe's appearance object (variables and rules), as accepted by the checkout form. */
export type CheckoutAppearance = { theme?: 'stripe' | 'night' | 'flat'; variables?: Record<string, string>; rules?: Record<string, Record<string, string>>; labels?: 'above' | 'floating' }

/** Stripe renders in an iframe and needs literal colors: resolve a CSS color (hex, oklch, var()) to `rgb(...)` via a canvas. */
function resolveColor(value: string, fallback: string): string {
  try {
    const probe = document.createElement('span')
    probe.style.color = value
    document.body.appendChild(probe)
    const computed = getComputedStyle(probe).color
    probe.remove()
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    if (!ctx || !computed) return fallback
    ctx.fillStyle = '#000'
    ctx.fillStyle = computed
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    return a === 255 ? `rgb(${r}, ${g}, ${b})` : fallback
  } catch { return fallback }
}

/**
 * The site's own look: primary color, text color, background, font and radius come from the client's theme tokens
 * (`--color-primary-600`, `--color-neutral-*`, the body font), so every client gets its checkout themed without extra config.
 * An explicit `appearance` prop wins over these defaults.
 */
function themeAppearance(override?: CheckoutAppearance): CheckoutAppearance {
  if (typeof document === 'undefined') return override ?? {}
  const body = getComputedStyle(document.body)
  const color = (token: string, fallback: string) => resolveColor(`var(${token}, ${fallback})`, fallback)
  const variables: Record<string, string> = {
    colorPrimary: color('--color-primary-600', '#0f766e'),
    colorText: color('--color-neutral-800', '#262626'),
    colorBackground: resolveColor(body.backgroundColor === 'rgba(0, 0, 0, 0)' ? '#ffffff' : body.backgroundColor, '#ffffff'),
    colorDanger: '#b91c1c',
    fontFamily: body.fontFamily || 'system-ui, sans-serif',
    borderRadius: '8px',
  }
  return { ...override, variables: { ...variables, ...override?.variables } }
}

/** Prices the shipping for the address the buyer entered, then lets Stripe refresh the totals. */
function Form({ sessionID, locale }: { sessionID: string; locale: Locale }) {
  const L = t(locale)
  const checkoutState = useCheckoutForm()
  const done = useRef(false)
  const [error, setError] = useState<string | null>(null)

  if (checkoutState.type === 'error') return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{checkoutState.error.message}</p>

  const priceShipping = async (event: { value: { shippingAddress?: unknown }; status: { shippingAddress?: { complete?: boolean } } }) => {
    if (checkoutState.type !== 'success') return
    const complete = Boolean(event.status.shippingAddress?.complete)
    if (!complete) { done.current = false; return }
    if (done.current) return
    done.current = true
    try {
      setError(null)
      await checkoutState.checkout.runServerUpdate(async () => {
        const r = await api<{ type: string; message?: string }>('/payments/stripe-checkout/shipping', { body: { sessionID, shippingDetails: event.value.shippingAddress } })
        if (!r.ok || r.data.type === 'error') throw new Error(r.data.message ?? L.shippingFailed)
        return r.data
      })
    } catch (e) {
      done.current = false
      setError((e as Error).message)
    }
  }

  const confirm = async (event: unknown) => {
    if (checkoutState.type !== 'success') return
    setError(null)
    const result = await checkoutState.checkout.confirm({ formConfirmEvent: event as never })
    if (result.type === 'error') setError(result.error.message)
  }

  return (
    <>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <CheckoutForm onChange={priceShipping as never} onConfirm={confirm as never} />
    </>
  )
}

/** The checkout page body: creates the Checkout Session for the open cart and mounts Stripe's embedded form. */
export function CheckoutPage({ publishableKey, loggedIn, locale = 'de', loginHref = '/login', shopHref = '/shop', appearance }: { publishableKey: string; loggedIn: boolean; locale?: Locale; loginHref?: string; shopHref?: string; appearance?: CheckoutAppearance }) {
  const L = t(locale)
  const [session, setSession] = useState<Session | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { cart } = useCart()
  const { initiatePayment } = usePayments()
  const { ready } = useCommerceSession()
  const empty = ready && !cart?.items?.length
  const started = useRef(false)
  const stripe = useMemo(() => (publishableKey ? loadStripe(publishableKey) : null), [publishableKey])

  useEffect(() => {
    if (!loggedIn || !ready || !cart?.items?.length || started.current) return
    started.current = true
    void (async () => {
      try {
        const result = await initiatePayment('stripe-checkout', { additionalData: { billingAddress: {} } }) as Partial<Session>
        if (!result.clientSecret || !result.sessionID) throw new Error(L.checkoutFailed)
        setSession({ clientSecret: result.clientSecret, sessionID: result.sessionID })
      } catch (e) { setError((e as Error).message || L.checkoutFailed) }
    })()
  }, [loggedIn, ready, cart, initiatePayment, L.checkoutFailed])

  if (!loggedIn) return <p className="text-center text-neutral-600"><a className="font-medium text-primary-600 underline" href={`${loginHref}?redirect=/checkout`}>{L.login}</a></p>
  if (empty) return <p className="text-center text-neutral-600">{L.cartEmpty} <a className="font-medium text-primary-600 underline" href={shopHref}>{L.shop}</a></p>
  if (error) return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
  if (!session || !stripe) return <p className="text-center text-neutral-500">…</p>
  return (
    <CheckoutFormProvider stripe={stripe} options={{ clientSecret: session.clientSecret, appearance: themeAppearance(appearance) } as never}>
      <Form sessionID={session.sessionID} locale={locale} />
    </CheckoutFormProvider>
  )
}
