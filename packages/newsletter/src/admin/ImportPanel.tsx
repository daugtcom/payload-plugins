'use client'

import { useState } from 'react'

interface Summary { total: number; new: number; existing: number; invalid: number; duplicates: number; suppressed: number; mode: string; dryRun: boolean; mailed: number; invalidSamples: string[] }
const btn = 'btn btn--style-primary btn--size-medium'
const btn2 = 'btn btn--style-secondary btn--size-medium'

/** "Liste importieren" above the subscribers list: choose a CSV, see a preview (dry run), then import. Client component. */
export function ImportPanel() {
  const [open, setOpen] = useState(false)
  const [csv, setCsv] = useState('')
  const [fileName, setFileName] = useState('')
  const [mode, setMode] = useState<'reconfirm' | 'already-consented'>('reconfirm')
  const [attest, setAttest] = useState(false)
  const [preview, setPreview] = useState<Summary | null>(null)
  const [done, setDone] = useState<Summary | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const call = async (dryRun: boolean) => {
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/newsletter/import', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ csv, mode, attest, dryRun }) })
      const data = await res.json()
      if (!res.ok) { setError(data.message ?? 'Der Import hat nicht geklappt.'); return }
      if (dryRun) setPreview(data as Summary); else { setDone(data as Summary); setPreview(null) }
    } finally { setBusy(false) }
  }
  const pick = async (f: File | undefined) => { setPreview(null); setDone(null); setError(''); if (!f) return; setFileName(f.name); setCsv(await f.text()) }
  const reset = () => { setCsv(''); setFileName(''); setPreview(null); setDone(null); setAttest(false); setError('') }

  return (
    <div style={{ margin: '0 0 var(--base)' }}>
      {!open ? <button type="button" className={btn2} onClick={() => setOpen(true)}>Liste importieren (CSV)</button> : (
        <div style={{ border: '1px solid var(--theme-elevation-150)', borderRadius: 8, padding: 'var(--base)', display: 'grid', gap: 12 }}>
          <strong>Liste importieren</strong>
          <p style={{ margin: 0, color: 'var(--theme-elevation-600)' }}>CSV-Datei mit den Spalten E-Mail und optional Name (oder Vorname und Nachname). Exporte aus ActiveCampaign oder Mailchimp passen so.</p>
          <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => void pick(e.target.files?.[0])} />
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 6 }}>
            <label><input type="radio" name="mode" checked={mode === 'reconfirm'} onChange={() => setMode('reconfirm')} /> <strong>Neu bestätigen lassen (empfohlen):</strong> Alle bekommen eine E-Mail mit Bestätigungs-Link und sind erst danach auf der Liste.</label>
            <label><input type="radio" name="mode" checked={mode === 'already-consented'} onChange={() => { setMode('already-consented'); setPreview(null) }} /> <strong>Einwilligung liegt vor:</strong> Alle gelten sofort als bestätigt.</label>
          </fieldset>
          {mode === 'already-consented' && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}><input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} style={{ marginTop: 4 }} /><span>Ich bestätige, dass alle Personen in dieser Liste dem Newsletter nachweislich zugestimmt haben (Double Opt-in oder gleichwertig). Die Bestätigung wird bei jedem Eintrag gespeichert.</span></label>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className={btn2} disabled={busy || !csv} onClick={() => call(true)}>Vorschau</button>
            <button type="button" className={btn} disabled={busy || !preview || preview.new === 0 || (mode === 'already-consented' && !attest)} onClick={() => call(false)}>{preview ? `${preview.new} importieren` : 'Importieren'}</button>
            <button type="button" className={btn2} onClick={() => { reset(); setOpen(false) }}>Schließen</button>
          </div>
          {fileName && !preview && !done && <span style={{ color: 'var(--theme-elevation-500)' }}>{fileName}</span>}
          {preview && <p style={{ margin: 0 }}><strong>Vorschau:</strong> {preview.new} neu · {preview.existing} schon vorhanden · {preview.invalid} ungültig · {preview.duplicates} doppelt{preview.suppressed ? ` · ${preview.suppressed} bereits abgemeldet (werden nie angeschrieben)` : ''}.{preview.invalidSamples.length ? ` Beispiele ungültig: ${preview.invalidSamples.join(', ')}` : ''}</p>}
          {done && <p role="status" style={{ margin: 0, color: 'var(--theme-success-600)' }}><strong>Fertig:</strong> {done.new} importiert{done.mailed ? `, ${done.mailed} Bestätigungsmails verschickt` : ''}. <a href="" onClick={(e) => { e.preventDefault(); window.location.reload() }}>Liste neu laden</a></p>}
          {error && <p role="alert" style={{ margin: 0, color: 'var(--theme-error-600)' }}>{error}</p>}
        </div>
      )}
    </div>
  )
}
