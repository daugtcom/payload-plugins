'use client'

import { useEffect, useRef, useState } from 'react'
import { t, type Locale } from './i18n'

/** A PDF in a full-screen dialog, drawn page by page onto a canvas (no browser PDF toolbar, so no download button). */
export function PdfViewerButton({ src, label, className, locale = 'de' }: { src: string; label?: string; className?: string; locale?: Locale }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{label ?? t(locale).show}</button>
      {open && <PdfDialog src={src} locale={locale} onClose={() => setOpen(false)} />}
    </>
  )
}

function PdfDialog({ src, locale, onClose }: { src: string; locale: Locale; onClose: () => void }) {
  const L = t(locale)
  const dialog = useRef<HTMLDialogElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const pdf = useRef<{ numPages: number; getPage: (n: number) => Promise<any> } | null>(null)
  const task = useRef<{ cancel: () => void } | null>(null)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(0)
  const [error, setError] = useState(false)

  useEffect(() => {
    dialog.current?.showModal()
    let dead = false
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
        const doc = await pdfjs.getDocument({ url: src }).promise
        if (dead) return
        pdf.current = doc as never
        setPages(doc.numPages)
      } catch { if (!dead) setError(true) }
    })()
    return () => { dead = true; task.current?.cancel() }
  }, [src])

  useEffect(() => {
    const doc = pdf.current
    const el = canvas.current
    if (!doc || !el || pages === 0) return
    let dead = false
    void doc.getPage(page).then((p) => {
      if (dead) return
      const viewport = p.getViewport({ scale: 1.5 })
      const ratio = window.devicePixelRatio || 1
      el.width = Math.floor(viewport.width * ratio)
      el.height = Math.floor(viewport.height * ratio)
      task.current?.cancel()
      const render = p.render({ canvasContext: el.getContext('2d')!, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined })
      task.current = render
      render.promise.catch(() => undefined)
    })
    return () => { dead = true }
  }, [page, pages])

  const btn = 'rounded-full bg-neutral-900/80 px-4 py-2 text-white hover:bg-neutral-900'
  return (
    <dialog ref={dialog} className="h-full max-h-none w-full max-w-none bg-transparent backdrop:bg-black/60" onCancel={onClose} onContextMenu={(e) => e.preventDefault()}>
      <div className="relative flex h-full w-full items-center justify-center">
        {error ? <p className="rounded-lg bg-white px-4 py-3 text-neutral-700">{L.pdfFailed}</p> : <canvas ref={canvas} className="max-h-full max-w-full bg-white shadow-2xl" />}
        {pages > 1 && (
          <div className="absolute bottom-3 inline-flex items-center gap-x-2">
            <button type="button" aria-label={L.previous} className={btn} onClick={() => setPage((p) => (p <= 1 ? pages : p - 1))}>‹</button>
            <span className="rounded-full bg-neutral-900/80 px-3 py-2 text-sm text-white">{page} / {pages}</span>
            <button type="button" aria-label={L.next} className={btn} onClick={() => setPage((p) => (p >= pages ? 1 : p + 1))}>›</button>
          </div>
        )}
        <button type="button" aria-label={L.close} className={`${btn} fixed right-2 top-2`} onClick={onClose}>×</button>
      </div>
    </dialog>
  )
}
