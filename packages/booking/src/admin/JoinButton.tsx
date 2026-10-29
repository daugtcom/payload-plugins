import { BOOKING_CUSTOM_KEY } from '../constants'
import type { ResolvedBookingOptions } from '../options'

type Props = { rowData?: Record<string, any>; data?: Record<string, any>; payload?: { config: { serverURL?: string; custom?: Record<string, any> } } }

/**
 * "Beitreten" button for the Payload admin: in the bookings list (Cell) and on the booking itself (Field). A plain link styled with
 * the admin's own button classes; shown for confirmed online appointments that are not over yet. Server component, no client code.
 */
export function JoinButton({ rowData, data, payload }: Props) {
  const b = rowData ?? data
  if (!b?.liveSession || b.status !== 'confirmed' || new Date(b.end).getTime() < Date.now()) return null
  const o = payload?.config.custom?.[BOOKING_CUSTOM_KEY]?.options as ResolvedBookingOptions | undefined
  const path = o?.live?.joinHref?.(b.liveSession) ?? `/access/live/${b.liveSession}`
  const base = (o?.serverURL ?? payload?.config.serverURL ?? '').replace(/\/$/, '')
  const href = /^https?:/.test(path) ? path : `${base}${path}`
  return (
    <a href={href} target="_blank" rel="noreferrer" className="btn btn--style-primary btn--size-small" style={{ margin: 0, textDecoration: 'none' }}>
      <span className="btn__content"><span className="btn__label">Beitreten</span></span>
    </a>
  )
}
