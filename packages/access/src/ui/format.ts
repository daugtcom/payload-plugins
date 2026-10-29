/** "12. Oktober 2026" */
export const formatDate = (iso: string | null | undefined, locale = 'de-AT'): string => (iso ? new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }) : '')

/** A media document as the course pages read it. */
export interface MediaLike {
  id: number | string
  url?: string | null
  sizes?: Record<string, { url?: string | null } | undefined> | null
}

/**
 * The address of an image. With `NEXT_PUBLIC_MEDIA_PLACEHOLDER=1` a generated picture from the site's `/placeholder?seed=` route
 * stands in (for machines without the media bucket). Components take an optional `imageSrc` prop to replace this entirely.
 */
export function mediaSrc(m: MediaLike | null | undefined, size?: 'thumbnail' | 'optimized'): string | undefined {
  if (!m || typeof m !== 'object') return undefined
  if (process.env.NEXT_PUBLIC_MEDIA_PLACEHOLDER === '1') return `/placeholder?seed=${m.id}`
  return (size && m.sizes?.[size]?.url) || m.url || undefined
}
