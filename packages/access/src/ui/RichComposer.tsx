'use client'

import { ContentEditable } from '@payloadcms/richtext-lexical/lexical/react/LexicalContentEditable'
import { LexicalComposer } from '@payloadcms/richtext-lexical/lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@payloadcms/richtext-lexical/lexical/react/LexicalComposerContext'
import { LexicalErrorBoundary } from '@payloadcms/richtext-lexical/lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@payloadcms/richtext-lexical/lexical/react/LexicalHistoryPlugin'
import { ListPlugin } from '@payloadcms/richtext-lexical/lexical/react/LexicalListPlugin'
import { OnChangePlugin } from '@payloadcms/richtext-lexical/lexical/react/LexicalOnChangePlugin'
import { RichTextPlugin } from '@payloadcms/richtext-lexical/lexical/react/LexicalRichTextPlugin'
import { CLEAR_EDITOR_COMMAND, $getRoot, $getSelection, $isRangeSelection, FORMAT_TEXT_COMMAND } from '@payloadcms/richtext-lexical/lexical'
import { INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND, ListItemNode, ListNode } from '@payloadcms/richtext-lexical/lexical/list'
import { HeadingNode, QuoteNode } from '@payloadcms/richtext-lexical/lexical/rich-text'
import { Bold, ImagePlus, Italic, List, ListOrdered, Strikethrough, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from './api'
import { t, type Locale } from './i18n'

export interface ComposerTarget { relationTo: string; value: number | string }

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const theme = {
  paragraph: 'm-0 mb-2 last:mb-0',
  text: { bold: 'font-semibold', italic: 'italic', strikethrough: 'line-through' },
  list: { ul: 'my-1 list-disc pl-6', ol: 'my-1 list-decimal pl-6', listitem: 'my-0.5', nested: { listitem: 'list-none' } },
}
const tool = (on: boolean) => `inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors ${on ? 'bg-primary-100 text-primary-900' : 'text-neutral-600 hover:bg-neutral-100'}`

function Toolbar({ locale, imagesSlot }: { locale: Locale; imagesSlot: ReactNode }) {
  const L = t(locale)
  const [editor] = useLexicalComposerContext()
  const [fmt, setFmt] = useState({ bold: false, italic: false, strike: false })
  useEffect(
    () => editor.registerUpdateListener(({ editorState }) => editorState.read(() => {
      const s = $getSelection()
      if ($isRangeSelection(s)) setFmt({ bold: s.hasFormat('bold'), italic: s.hasFormat('italic'), strike: s.hasFormat('strikethrough') })
    })),
    [editor],
  )
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-neutral-200 px-2 py-1.5" role="toolbar" aria-label="Formatierung">
      <button type="button" className={tool(fmt.bold)} aria-pressed={fmt.bold} aria-label={L.bold} title={L.bold} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')}><Bold className="h-4 w-4" /></button>
      <button type="button" className={tool(fmt.italic)} aria-pressed={fmt.italic} aria-label={L.italic} title={L.italic} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')}><Italic className="h-4 w-4" /></button>
      <button type="button" className={tool(fmt.strike)} aria-pressed={fmt.strike} aria-label={L.strike} title={L.strike} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'strikethrough')}><Strikethrough className="h-4 w-4" /></button>
      <span aria-hidden className="mx-1 h-5 w-px bg-neutral-200" />
      <button type="button" className={tool(false)} aria-label={L.bulletList} title={L.bulletList} onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)}><List className="h-4 w-4" /></button>
      <button type="button" className={tool(false)} aria-label={L.numberedList} title={L.numberedList} onClick={() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)}><ListOrdered className="h-4 w-4" /></button>
      {imagesSlot}
    </div>
  )
}

/** Gives the form a way to empty the editor after a successful post. */
function Clearer({ registerClear }: { registerClear: (fn: () => void) => void }) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => registerClear(() => editor.dispatchCommand(CLEAR_EDITOR_COMMAND, undefined)), [editor, registerClear])
  return null
}

/**
 * The writing box of the member area: bold / italic / strikethrough / lists, up to a few pictures, anonymous posting.
 * Pictures are uploaded when the post is sent (one request each), then attached by id; the server checks everything again.
 */
export function Composer({ target, placeholder, allowAnonymous = false, allowImages = false, maxImages = 5, maxImageMB = 10, label, onDone, locale = 'de' }: { target: ComposerTarget; placeholder?: string; allowAnonymous?: boolean; allowImages?: boolean; maxImages?: number; maxImageMB?: number; label?: string; onDone?: () => void; locale?: Locale }) {
  const L = t(locale)
  const router = useRouter()
  const [state, setState] = useState<unknown>(null)
  const [empty, setEmpty] = useState(true)
  const [anonymous, setAnonymous] = useState(false)
  const [images, setImages] = useState<{ file: File; preview: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const clear = useRef<() => void>(() => {})
  const fileInput = useRef<HTMLInputElement>(null)
  const ph = placeholder ?? L.writeComment

  useEffect(() => () => images.forEach((i) => URL.revokeObjectURL(i.preview)), []) // eslint-disable-line react-hooks/exhaustive-deps

  function pick(files: FileList | null) {
    if (!files) return
    setError(null)
    const next = [...images]
    for (const f of Array.from(files)) {
      if (!IMAGE_TYPES.includes(f.type)) return setError(L.imageType(f.name))
      if (f.size > maxImageMB * 1024 * 1024) return setError(L.imageTooBig(f.name, maxImageMB))
      if (next.length >= maxImages) return setError(L.tooManyImages(maxImages))
      next.push({ file: f, preview: URL.createObjectURL(f) })
    }
    setImages(next)
    if (fileInput.current) fileInput.current.value = ''
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (empty || busy) return
    setBusy(true); setError(null)
    const media: (number | string)[] = []
    for (const img of images) {
      const fd = new FormData()
      fd.append('file', img.file)
      const res = await fetch('/api/engagement/uploads', { method: 'POST', credentials: 'include', body: fd }).catch(() => null)
      const data = (await res?.json().catch(() => ({}))) as { id?: number | string }
      if (!res?.ok || data.id === undefined) { setBusy(false); return setError(L.uploadFailed(img.file.name)) }
      media.push(data.id)
    }
    const r = await api('/engagement/comments', { body: { target, text: state, anonymous, ...(allowImages ? { media } : {}) } }).catch(() => null)
    setBusy(false)
    if (!r?.ok) return setError(L.postFailed)
    clear.current(); setAnonymous(false); images.forEach((i) => URL.revokeObjectURL(i.preview)); setImages([])
    onDone?.(); router.refresh()
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <div className="rounded-xl border border-neutral-300 bg-white focus-within:border-primary-500 focus-within:ring-2 focus-within:ring-primary-200">
        <LexicalComposer initialConfig={{ namespace: 'member-comment', onError: (err: Error) => console.error(err), nodes: [ListNode, ListItemNode, HeadingNode, QuoteNode], theme }}>
          <Toolbar locale={locale} imagesSlot={allowImages ? (
            <>
              <span aria-hidden className="mx-1 h-5 w-px bg-neutral-200" />
              <button type="button" className={tool(false)} aria-label={L.addImages} title={L.imagesHint(maxImages, maxImageMB)} onClick={() => fileInput.current?.click()}><ImagePlus className="h-4 w-4" /></button>
              <input ref={fileInput} type="file" accept={IMAGE_TYPES.join(',')} multiple hidden onChange={(e) => pick(e.target.files)} />
            </>
          ) : null} />
          <div className="relative px-4 py-3 text-[1rem] text-neutral-900">
            <RichTextPlugin
              contentEditable={<ContentEditable aria-label={ph} className="min-h-20 outline-none focus-visible:outline-none" />}
              placeholder={<div aria-hidden className="pointer-events-none absolute top-3 left-4 text-neutral-400">{ph}</div>}
              ErrorBoundary={LexicalErrorBoundary}
            />
            <HistoryPlugin />
            <ListPlugin />
            <OnChangePlugin ignoreSelectionChange onChange={(editorState) => { setState(editorState.toJSON()); editorState.read(() => setEmpty($getRoot().getTextContent().trim() === '')) }} />
            <Clearer registerClear={(fn) => { clear.current = fn; return () => {} }} />
          </div>
        </LexicalComposer>
        {images.length > 0 && (
          <ul className="m-0 flex list-none! flex-wrap gap-2 border-t border-neutral-200 p-3">
            {images.map((img, i) => (
              <li key={img.preview} className="relative m-0! h-20 w-20 overflow-hidden rounded-lg bg-neutral-100">
                <img src={img.preview} alt="" className="h-full w-full object-cover" />
                <button type="button" aria-label={L.removeImage} onClick={() => { URL.revokeObjectURL(img.preview); setImages(images.filter((_, n) => n !== i)) }} className="absolute top-1 right-1 rounded-full bg-primary-950/75 p-1 text-white hover:bg-primary-950"><X className="h-3 w-3" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {allowAnonymous ? <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-600"><input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />{L.postAnonymous}</label> : <span />}
        <button disabled={busy || empty} type="submit" className="inline-flex items-center justify-center rounded-lg bg-primary-700 px-5 py-2.5 text-[0.95rem] font-semibold text-white transition-colors hover:bg-primary-600 disabled:opacity-50">{busy ? L.sending : (label ?? L.send)}</button>
      </div>
      {error && <p role="alert" className="m-0 text-sm text-red-700">{error}</p>}
    </form>
  )
}
