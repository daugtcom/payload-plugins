type Row = { egressId: string; status: string; startedAt?: string | null; durationSeconds?: number | null }
type Props = { rowData?: Record<string, any>; data?: Record<string, any> }

const href = (sessionId: unknown, egressId: string) => `/api/live/recording/${sessionId}/${egressId}`
const mins = (s?: number | null) => (s ? ` · ${Math.max(1, Math.round(s / 60))} Min.` : '')

/**
 * Recordings of a live session as links in the Payload admin: in the list ("Aufnahmen" column) and on the session itself.
 * A finished one opens the video (a short-lived signed link, checked like the member view); a running one says so.
 * Server component, plain links.
 */
export function RecordingLinks({ rowData, data }: Props) {
  const s = rowData ?? data
  const rows = ((s?.recordings ?? []) as Row[]).filter(Boolean)
  if (!s || rows.length === 0) return null
  const day = (r: Row) => (r.startedAt ? new Date(r.startedAt).toLocaleString('de-AT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Aufnahme')
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6 }}>
      {rows.map((r) =>
        r.status === 'ready' ? (
          <a key={r.egressId} href={href(s.id, r.egressId)} target="_blank" rel="noreferrer" className="btn btn--style-primary btn--size-small" style={{ margin: 0, textDecoration: 'none' }}>
            <span className="btn__content"><span className="btn__label">▶ {day(r)}{mins(r.durationSeconds)}</span></span>
          </a>
        ) : (
          <span key={r.egressId} style={{ fontSize: 12, opacity: 0.75 }}>{r.status === 'failed' ? 'Aufnahme fehlgeschlagen' : r.status === 'processing' ? 'Wird verarbeitet …' : '● Aufnahme läuft'}</span>
        ),
      )}
    </span>
  )
}
