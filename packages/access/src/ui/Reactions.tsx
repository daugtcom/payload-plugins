'use client'

import { SmilePlus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { t, type Locale } from './i18n'

export interface ReactionTarget { relationTo: string; value: number | string }

/**
 * Emoji reactions under a post or a comment. Counts are buttons (click = react, click again = take it back);
 * "+" opens the rest of the emojis. The server's answer is the truth: the counts shown are the ones it sends back.
 */
export function Reactions({ target, summary: initial, mine: initialMine, emojis, canReact, className = '', prominent = false, locale = 'de' }: { target: ReactionTarget; summary: Record<string, number>; mine: string | null; emojis: string[]; canReact: boolean; className?: string; prominent?: boolean; locale?: Locale }) {
  const L = t(locale)
  const [summary, setSummary] = useState(initial)
  const [mine, setMine] = useState(initialMine)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => { setSummary(initial); setMine(initialMine) }, [initial, initialMine])
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])

  async function react(emoji: string) {
    if (!canReact || busy) return
    setBusy(true); setError(false); setOpen(false)
    const r = await api<{ action?: string; summary?: Record<string, number> }>('/engagement/reactions', { body: { target, emoji } }).catch(() => null)
    setBusy(false)
    if (!r?.ok || !r.data.summary) return setError(true)
    setSummary(r.data.summary)
    setMine(r.data.action === 'removed' ? null : emoji)
  }

  const shown = emojis.filter((e) => (summary[e] ?? 0) > 0)
  if (!shown.length && !canReact) return null
  return (
    <div className={`relative flex flex-wrap items-center gap-1.5 ${className}`} ref={box}>
      {shown.map((e) => (
        <button key={e} type="button" disabled={!canReact || busy} aria-pressed={mine === e} onClick={() => react(e)}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm transition-colors ${mine === e ? 'border-primary-300 bg-primary-50 text-primary-900' : 'border-neutral-200 bg-white text-neutral-700'} ${canReact ? 'hover:border-primary-300 hover:bg-primary-50' : 'cursor-default'}`}>
          <span aria-hidden>{e}</span><span className="tabular-nums">{summary[e]}</span>
        </button>
      ))}
      {canReact && (
        <>
          <button type="button" aria-expanded={open} aria-label={L.addReaction} onClick={() => setOpen((o) => !o)}
            className={`inline-flex h-8 items-center justify-center gap-2 rounded-full border border-neutral-200 bg-white text-neutral-600 transition-colors hover:border-primary-300 hover:text-primary-700 ${prominent ? 'px-4 text-[0.95rem] font-medium' : 'w-8'}`}>
            <SmilePlus className="h-4 w-4" aria-hidden />{prominent && L.react}
          </button>
          {open && (
            <div role="menu" className="absolute bottom-full left-0 z-20 mb-2 flex gap-1 rounded-full border border-neutral-200 bg-white p-1.5 shadow-lg shadow-primary-950/10">
              {emojis.map((e) => (
                <button key={e} type="button" role="menuitem" aria-label={L.reactWith(e)} onClick={() => react(e)} className={`h-9 w-9 rounded-full text-xl transition-transform hover:scale-110 hover:bg-neutral-100 ${mine === e ? 'bg-primary-50' : ''}`}>{e}</button>
              ))}
            </div>
          )}
        </>
      )}
      {error && <p role="alert" className="m-0 basis-full text-sm text-red-700">{L.actionFailed}</p>}
    </div>
  )
}
