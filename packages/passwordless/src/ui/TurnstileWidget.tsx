'use client'

import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'

interface TurnstileApi {
  render: (el: HTMLElement, o: Record<string, unknown>) => string
  reset: (id?: string) => void
  remove: (id?: string) => void
}
declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let loading: Promise<TurnstileApi> | null = null
/** Loads Cloudflare's script once per page. */
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    s.async = true
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile missing')))
    s.onerror = () => { loading = null; reject(new Error('turnstile failed to load')) }
    document.head.appendChild(s)
  })
  return loading
}

export interface TurnstileHandle {
  /** A token works once. Call this after every submit to get the next one. */
  reset: () => void
}

/** Cloudflare Turnstile. `onToken(null)` when the token expired, errored or was reset. */
export function TurnstileWidget({ siteKey, onToken, language = 'de', ref }: { siteKey: string; onToken: (token: string | null) => void; language?: string; ref?: Ref<TurnstileHandle> }) {
  const box = useRef<HTMLDivElement>(null)
  const id = useRef<string | undefined>(undefined)
  const cb = useRef(onToken)
  cb.current = onToken

  useImperativeHandle(ref, () => ({ reset: () => { cb.current(null); if (id.current) window.turnstile?.reset(id.current) } }), [])

  useEffect(() => {
    let gone = false
    void loadTurnstile().then((api) => {
      if (gone || !box.current) return
      // Render once: removing/recreating a challenge while it initializes can
      // strand the widget. The compact layout also fits a wider container.
      id.current = api.render(box.current, {
        sitekey: siteKey,
        size: box.current.clientWidth < 300 ? 'compact' : 'normal',
        language,
        callback: (token: string) => cb.current(token),
        'expired-callback': () => cb.current(null),
        'error-callback': () => cb.current(null),
      })
    }).catch(() => cb.current(null))
    return () => { gone = true; if (id.current) window.turnstile?.remove(id.current); id.current = undefined }
  }, [siteKey, language])

  return <div ref={box} className="flex w-full justify-center" />
}
