'use client'

import { useAllFormFields, useDocumentInfo } from '@payloadcms/ui'
import { reduceFieldsToValues } from 'payload/shared'
import { useEffect, useMemo, useState } from 'react'

const api = async (path: string, init?: RequestInit) => {
  const res = await fetch(`/api${path}`, { credentials: 'include', headers: { 'content-type': 'application/json' }, ...init })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, data }
}
const btn = 'btn btn--style-primary btn--size-medium'
const btn2 = 'btn btn--style-secondary btn--size-medium'

/**
 * Editor tools for sending, scheduling and sending a test mail.
 */
export function NewsletterTools() {
  const { id } = useDocumentInfo()
  const [fields] = useAllFormFields()
  const data = useMemo(() => reduceFieldsToValues(fields, true), [fields])
  const status = (data.status as string | undefined) ?? 'draft'
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)
  const [recipients, setRecipients] = useState<number | null>(null)
  const [at, setAt] = useState('')
  const [confirming, setConfirming] = useState<'now' | 'schedule' | null>(null)

  useEffect(() => {
    if (!id) return
    void api(`/newsletter/audience?id=${id}`).then((r) => r.ok && setRecipients(r.data.recipients as number))
  }, [id, status])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setNote(null)
    try { await fn() } finally { setBusy(false); setConfirming(null) }
  }
  const test = () => run(async () => {
    const r = await api('/newsletter/test', { method: 'POST', body: JSON.stringify({ id, data: { subject: data.subject, preheader: data.preheader, blocks: data.blocks } }) })
    setNote(r.ok ? { tone: 'ok', text: `Testmail an ${r.data.to} gesendet.` } : { tone: 'err', text: 'Die Testmail konnte nicht gesendet werden.' })
  })
  const send = (schedule: boolean) => run(async () => {
    const r = await api('/newsletter/send', { method: 'POST', body: JSON.stringify({ id, ...(schedule && at ? { at: new Date(at).toISOString() } : {}) }) })
    if (r.ok) { setNote({ tone: 'ok', text: r.data.status === 'scheduled' ? `Geplant für ${r.data.recipients} Empfänger:innen.` : `Versand gestartet für ${r.data.recipients} Empfänger:innen.` }); setTimeout(() => window.location.reload(), 1200) }
    else setNote({ tone: 'err', text: (r.data.message as string) ?? 'Das hat nicht geklappt.' })
  })
  const cancel = () => run(async () => {
    const r = await api('/newsletter/cancel', { method: 'POST', body: JSON.stringify({ id }) })
    if (r.ok) window.location.reload(); else setNote({ tone: 'err', text: (r.data.message as string) ?? 'Das hat nicht geklappt.' })
  })

  return (
    <div style={{ margin: '0 0 var(--base)', display: 'grid', gap: 'var(--base)' }}>
      <section style={{ border: '1px solid var(--theme-elevation-150)', borderRadius: 8, padding: 'var(--base)' }}>
        <h4 style={{ margin: '0 0 8px' }}>Senden</h4>
        {!id && <p style={{ margin: 0 }}>Speichere den Newsletter zuerst, dann kannst du ihn senden.</p>}
        {id && status === 'sent' && <p style={{ margin: 0 }}>Dieser Newsletter wurde gesendet.</p>}
        {id && status === 'sending' && <p style={{ margin: 0 }}>Der Versand läuft. Die Zahlen rechts aktualisieren sich beim Neuladen.</p>}
        {id && (status === 'draft' || status === 'scheduled') && (
          <>
            <p style={{ margin: '0 0 12px' }}>{recipients == null ? 'Empfänger:innen werden gezählt …' : <>Geht an <strong>{recipients}</strong> bestätigte Abonnent:innen.</>}{status === 'scheduled' && data.scheduledAt ? <> Geplant für <strong>{new Date(String(data.scheduledAt)).toLocaleString('de-AT')}</strong>.</> : null}</p>
            {confirming ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <strong>{confirming === 'now' ? `Jetzt an ${recipients ?? '?'} Personen senden?` : `Für ${new Date(at).toLocaleString('de-AT')} planen?`}</strong>
                <button type="button" className={btn} disabled={busy} onClick={() => send(confirming === 'schedule')}>Ja, {confirming === 'now' ? 'senden' : 'planen'}</button>
                <button type="button" className={btn2} disabled={busy} onClick={() => setConfirming(null)}>Abbrechen</button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button type="button" className={btn2} disabled={busy} onClick={test}>Testmail an mich</button>
                <button type="button" className={btn} disabled={busy || !recipients} onClick={() => setConfirming('now')}>Jetzt senden</button>
                <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} aria-label="Zeitpunkt" style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--theme-elevation-250)' }} />
                <button type="button" className={btn2} disabled={busy || !at || !recipients} onClick={() => setConfirming('schedule')}>Planen</button>
                {status === 'scheduled' && <button type="button" className={btn2} disabled={busy} onClick={cancel}>Planung aufheben</button>}
              </div>
            )}
            <p style={{ margin: '10px 0 0', color: 'var(--theme-elevation-500)', fontSize: 13 }}>Änderungen erst speichern, dann senden: gesendet wird die gespeicherte Fassung.</p>
          </>
        )}
        {note && <p role="status" style={{ margin: '12px 0 0', color: note.tone === 'ok' ? 'var(--theme-success-600)' : 'var(--theme-error-600)' }}>{note.text}</p>}
      </section>
    </div>
  )
}
