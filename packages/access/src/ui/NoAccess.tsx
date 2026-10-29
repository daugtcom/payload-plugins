import { t, type Locale } from './i18n'
import { defaultHrefs } from './types'

/** The notice for members without access to a lesson, post or course. */
export function NoAccess({ locale = 'de', shopHref = defaultHrefs.shop }: { locale?: Locale; shopHref?: string }) {
  const L = t(locale)
  return (
    <div className="py-16 text-center">
      <h1 className="text-3xl font-semibold text-neutral-900">{L.noAccessTitle}</h1>
      <p className="mx-auto mt-3 max-w-md text-neutral-600">{L.noAccessText}</p>
      <p className="mt-6"><a className="rounded-lg bg-primary-600 px-5 py-2.5 font-medium text-white hover:bg-primary-700" href={shopHref}>{L.toShop}</a></p>
    </div>
  )
}
