'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { DefaultDocumentIDType } from 'payload'
import { useCart } from '@payloadcms/plugin-ecommerce/client/react'
import { useCommerceSession } from './CommerceProvider'
import { euro } from './format'
import { t, type Locale } from './i18n'
import { CART_EVENT, notifyCart } from './api'

interface Product { id: number | string; title: string; slug: string; gallery?: { url?: string; alt?: string; sizes?: { thumbnail?: { url?: string } } }[]; priceInEUR?: number; commerce?: { billingType?: string; intervalCount?: number; intervalUnit?: string } }

/** Payload 3.91 resolves rejected mutations without throwing. Observe its committed cart
 * reference after the operation, rather than claiming success from that resolved Promise. */
function useCartMutation() {
  const { cart, isLoading } = useCart()
  const operation = useRef<{ before: unknown; onSuccess?: () => void } | null>(null)
  const [pending, setPending] = useState(false)
  const [settled, setSettled] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!settled || isLoading || !operation.current) return
    const previous = operation.current
    operation.current = null
    setSettled(false)
    setPending(false)
    if (cart && cart !== previous.before) previous.onSuccess?.()
    else setFailed(true)
  }, [cart, settled, isLoading])

  async function run(mutate: () => Promise<void>, onSuccess?: () => void) {
    if (operation.current) return
    operation.current = { before: cart, onSuccess }
    setFailed(false)
    setPending(true)
    try { await mutate() } catch {} finally { setSettled(true) }
  }
  return { run, pending, failed }
}

/** The cart icon with a count, and the drawer behind it. `children` is the icon (the site brings its own). */
export function CartButton({ loggedIn, locale = 'de', className, children, loginHref = '/login', checkoutHref = '/checkout', productHref = (slug) => `/shop/${slug}` }: { loggedIn: boolean; locale?: Locale; className?: string; children?: ReactNode; loginHref?: string; checkoutHref?: string; productHref?: (slug: string) => string }) {
  const L = t(locale)
  const pathname = usePathname() || '/shop'
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const { cart, removeItem, isLoading } = useCart()
  const { ready } = useCommerceSession()
  const mutation = useCartMutation()
  const lines = (cart?.items ?? []).flatMap((item) => typeof item.product === 'object' && item.product ? [{ id: item.id!, product: item.product as unknown as Product, quantity: item.quantity }] : [])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onChange = () => setOpen(true)
    window.addEventListener(CART_EVENT, onChange)
    return () => window.removeEventListener(CART_EVENT, onChange)
  }, [])

  useEffect(() => {
    if (!open || !dialog.current) return
    dialog.current.showModal()
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous; opener.current?.focus() }
  }, [open])

  const count = loggedIn && ready ? lines.reduce((n, l) => n + l.quantity, 0) : 0

  function checkout() {
    setBusy(true)
    window.location.assign(checkoutHref)
  }

  return (
    <>
      <button ref={opener} type="button" aria-label={L.cart} className={`relative ${className ?? ''}`} onClick={() => setOpen(true)}>
        {children ?? <span>🛒</span>}
        {count > 0 && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-secondary-500 px-1 text-xs font-semibold text-white">{count}</span>}
      </button>
      {open && (
        <dialog ref={dialog} onCancel={() => setOpen(false)} onClose={() => setOpen(false)} className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-transparent p-0 text-left text-neutral-800 open:flex open:justify-end backdrop:bg-black/40" aria-label={L.cart}>
          <button type="button" aria-label={locale === 'de' ? 'Schließen' : 'Close'} className="absolute inset-0 cursor-default" tabIndex={-1} onClick={() => setOpen(false)} />
          <aside className="relative flex h-full w-full max-w-md flex-col bg-white px-5 py-6 font-sans shadow-2xl sm:px-8 sm:py-8">
            <div className="flex items-center justify-between gap-4 border-b border-neutral-200 pb-5"><h2 className="text-xl font-semibold text-neutral-900">{L.cart}</h2><button type="button" autoFocus className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-2xl leading-none text-neutral-500 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-primary-600" onClick={() => setOpen(false)} aria-label={locale === 'de' ? 'Schließen' : 'Close'}>×</button></div>
            {mutation.failed && <p role="alert" className="mt-3 text-sm text-red-700">{L.cartFailed}</p>}
            {!loggedIn ? (
              <p className="mt-6 text-neutral-600"><a className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary-600 px-5 py-3 font-medium text-white hover:bg-primary-700" href={`${loginHref}?redirect=${encodeURIComponent(pathname)}`}>{L.login}</a></p>
            ) : !ready ? (
              <p className="mt-6 text-neutral-600">…</p>
            ) : lines.length === 0 ? (
              <p className="mt-6 text-neutral-600">{L.cartEmpty}</p>
            ) : (
              <>
                <ul className="mt-4 flex-1 divide-y divide-neutral-200 overflow-y-auto">
                  {lines.map((l) => (
                    <li key={l.id} className="flex items-start justify-between gap-3 py-3">
                      {l.product.gallery?.[0]?.url && <img src={l.product.gallery?.[0].sizes?.thumbnail?.url || l.product.gallery?.[0].url} alt={l.product.gallery?.[0].alt ?? ''} className="h-16 w-16 shrink-0 rounded-md object-cover" />}
                      <div className="min-w-0 flex-1"><a className="font-medium break-words text-neutral-900 hover:underline" href={productHref(l.product.slug)}>{l.product.title}</a>
                        <div className="text-sm text-neutral-500">{l.quantity > 1 ? `${l.quantity} × ` : ''}{euro(l.product.priceInEUR ?? 0, locale)} {l.product.commerce?.billingType === 'recurring' ? (l.product.commerce?.intervalCount && l.product.commerce?.intervalCount > 1 ? L.everyN(l.product.commerce?.intervalCount, l.product.commerce?.intervalUnit ?? '') : L.monthly) : ''}</div></div>
                      <button type="button" className="min-h-11 shrink-0 text-sm text-neutral-600 underline underline-offset-2 hover:text-primary-700" disabled={isLoading || mutation.pending || !ready} onClick={() => mutation.run(() => removeItem(l.id))}>{L.remove}</button>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex items-baseline justify-between border-t border-neutral-200 pt-4"><span className="text-neutral-600">{L.total} <span className="text-xs">({L.vatIncluded})</span></span><span className="text-xl font-semibold text-neutral-900">{euro(cart?.subtotal ?? 0, locale)}</span></div>
                <button type="button" disabled={busy || mutation.pending || isLoading || !ready} className="mt-4 w-full rounded-lg bg-primary-600 px-4 py-3 font-medium text-white hover:bg-primary-700 disabled:opacity-60" onClick={checkout}>{L.checkout}</button>
              </>
            )}
          </aside>
        </dialog>
      )}
    </>
  )
}

/** "Add to cart" (or the external link, or the login detour). */
export function AddToCartButton({ productID, loggedIn, external, locale = 'de', className, label, loginHref = '/login' }: { productID: number | string; loggedIn: boolean; external?: string | null; locale?: Locale; className?: string; label?: string; loginHref?: string }) {
  const L = t(locale)
  const { addItem, isLoading } = useCart()
  const { ready } = useCommerceSession()
  const mutation = useCartMutation()
  const pathname = usePathname() || '/shop'
  const cls = className ?? 'inline-flex items-center justify-center rounded-lg bg-primary-600 px-5 py-2.5 font-medium text-white hover:bg-primary-700 disabled:opacity-60'
  if (external) return <a className={cls} href={external} target="_blank" rel="noreferrer">{label ?? L.moreInfo}</a>
  if (!loggedIn) return <a className={cls} href={`${loginHref}?redirect=${encodeURIComponent(pathname)}`}>{label ?? L.addToCart}</a>
  return (
    <>
      <button type="button" disabled={mutation.pending || isLoading || !ready} className={cls} onClick={() => mutation.run(() => addItem({ product: productID as DefaultDocumentIDType }, 1), notifyCart)}>
        {label ?? L.addToCart}
      </button>
      {mutation.failed && <span role="alert" className="block text-sm text-red-700">{L.cartFailed}</span>}
    </>
  )
}
