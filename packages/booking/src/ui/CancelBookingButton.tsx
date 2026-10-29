'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { api } from './api'
import { t, type Locale } from './i18n'

export function CancelBookingButton({ bookingID, locale = 'de', className = '' }: { bookingID: string | number; locale?: Locale; className?: string }) {
  const L = t(locale)
  const router = useRouter()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  async function cancel() {
    setBusy(true)
    const r = await api<{ error?: string }>('/booking/cancel', { body: { bookingID } })
    setBusy(false)
    if (r.ok) { setMsg(L.cancelled); router.refresh(); return }
    setMsg(r.data?.error === 'too-late' ? L.tooLate : 'Das hat nicht geklappt.')
    setAsking(false)
  }
  if (msg) return <p role="status" className="m-0 text-sm text-neutral-700">{msg}</p>
  if (!asking) return <button type="button" onClick={() => setAsking(true)} className={`rounded-full border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:border-primary-400 hover:bg-primary-50 ${className}`}>{L.cancel}</button>
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-sm">
      <span className="text-neutral-700">{L.cancelConfirm}</span>
      <button type="button" disabled={busy} onClick={cancel} className="rounded-full bg-primary-700 px-4 py-2 font-medium text-white hover:bg-primary-600 disabled:opacity-60">{L.cancelYes}</button>
      <button type="button" onClick={() => setAsking(false)} className="rounded-full border border-neutral-300 px-4 py-2 font-medium text-neutral-700 hover:bg-neutral-100">{L.cancelNo}</button>
    </span>
  )
}
