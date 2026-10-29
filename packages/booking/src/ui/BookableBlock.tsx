import type { Payload } from 'payload'
import { bookableInfo } from '../info'
import { BookingWidget } from './BookingWidget'

/** Load and render an appointment selected by a bookable block. */
export async function BookableBlock({ payload, product, title, description, className = '', headingClassName = '', descriptionClassName = '', widgetClassName = '', overline }: {
  payload: Payload; product?: string | number | { id: string | number } | null; title?: string | null; description?: string | null
  className?: string; headingClassName?: string; descriptionClassName?: string; widgetClassName?: string; overline?: React.ReactNode
}) {
  const id = typeof product === 'object' && product ? product.id : product
  const doc = id ? await payload.findByID({ collection: 'products' as never, id, depth: 2, overrideAccess: true }).catch(() => null) : null
  const info = bookableInfo(doc as never)
  if (!info) return null
  return <div className={className}>{overline}{title && <h2 className={headingClassName}>{title}</h2>}{description && <p className={descriptionClassName}>{description}</p>}<div className={widgetClassName}><BookingWidget product={info} /></div></div>
}
