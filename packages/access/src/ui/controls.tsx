'use client'

import { Bell, BellOff, Search, X } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { t, type Locale } from './i18n'

/** "E-Mail bei neuen Beiträgen" of one course: on = a mail when new posts are published. */
export function SubscribeToggle({ courseId, subscribed, locale = 'de' }: { courseId: number | string; subscribed: boolean; locale?: Locale }) {
  const L = t(locale)
  const [on, setOn] = useState(subscribed)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  return (
    <div className="flex flex-col items-start gap-1">
      <button type="button" role="switch" aria-checked={on} disabled={busy}
        onClick={async () => {
          setBusy(true); setError(false)
          const r = await api<{ subscribed?: boolean }>('/access/notifications/subscribe', { body: { courseId } }).catch(() => null)
          setBusy(false)
          if (r?.ok && typeof r.data.subscribed === 'boolean') setOn(r.data.subscribed); else setError(true)
        }}
        className={`inline-flex items-center gap-2.5 rounded-full border px-4 py-2 text-[0.95rem] font-medium transition-colors disabled:opacity-60 ${on ? 'border-primary-300 bg-primary-50 text-primary-900' : 'border-neutral-300 bg-white text-neutral-700 hover:border-primary-300'}`}>
        {on ? <Bell className="h-4 w-4" aria-hidden /> : <BellOff className="h-4 w-4" aria-hidden />}
        {on ? L.emailOn : L.emailOff}
      </button>
      {error && <p role="alert" className="m-0 text-sm text-red-700">{L.actionFailed}</p>}
    </div>
  )
}

/** Searches the posts of the course while typing (`?q=`); a new search starts at page 1. */
export function SearchBox({ locale = 'de' }: { locale?: Locale }) {
  const L = t(locale)
  const router = useRouter()
  const path = usePathname()
  const params = useSearchParams()
  const [value, setValue] = useState(params.get('q') ?? '')
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString())
      if (value.trim()) next.set('q', value.trim()); else next.delete('q')
      next.delete('page')
      router.replace(next.size ? `${path}?${next}` : path, { scroll: false })
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden />
      <input type="search" value={value} onChange={(e) => setValue(e.target.value)} placeholder={L.searchPosts} aria-label={L.searchPosts}
        className="w-full rounded-xl border border-neutral-300 bg-white py-2.5 pr-10 pl-10 text-[1rem] text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200 [&::-webkit-search-cancel-button]:hidden" />
      {value && <button type="button" aria-label={L.clearSearch} onClick={() => setValue('')} className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-full p-1 text-neutral-400 hover:text-neutral-700"><X className="h-4 w-4" /></button>}
    </div>
  )
}

/** Shown to staff who look at the member area as a member: says so, and leads back. */
export function ImpersonationBanner({ locale = 'de', home = '/access' }: { locale?: Locale; home?: string }) {
  const L = t(locale)
  const [name, setName] = useState<string | null>(null)
  useEffect(() => {
    api<{ impersonating?: boolean; user?: { name?: string | null; email?: string } }>('/passwordless/me')
      .then((r) => { if (r.ok && r.data.impersonating) setName(r.data.user?.name || r.data.user?.email || '…') })
      .catch(() => {})
  }, [])
  if (!name) return null
  return (
    <div role="status" className="border-b border-secondary-300 bg-secondary-100 px-5 py-2.5 text-center text-[0.95rem] text-secondary-950">
      {L.viewingAs} <strong>{name}</strong>.{' '}
      <button type="button" className="font-semibold underline underline-offset-2 hover:text-secondary-800" onClick={async () => { await api('/passwordless/impersonate/leave', { body: {} }); window.location.assign(home) }}>{L.endView}</button>
    </div>
  )
}

/**
 * Keeps a page current (the old member area refreshed every 10 seconds): re-reads the server data while the tab is visible,
 * but never while someone is typing, so a half-written comment is safe.
 */
export function AutoRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter()
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      const a = document.activeElement
      if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT' || (a as HTMLElement).isContentEditable)) return
      router.refresh()
    }, seconds * 1000)
    return () => clearInterval(id)
  }, [router, seconds])
  return null
}
