import type { ReactNode } from 'react'
import { ImpersonationBanner } from './controls'
import { t, type Locale } from './i18n'
import { defaultHrefs, type Hrefs } from './types'

/** `dashboard` is the same as `courses`; it stays for older callers. */
export type MemberTab = 'dashboard' | 'courses' | 'singles' | 'orders' | 'account'

/** One bubble in the header: a page of the member area, or an area of a course. */
export interface MemberNavItem {
  key: string
  label: string
  href: string
  current?: boolean
  /** a small number behind the label */
  count?: number
}

const bubble = (on: boolean) => `inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-[0.95rem] font-medium no-underline transition-colors ${on ? 'bg-primary-700 text-white' : 'bg-white text-neutral-700 ring-1 ring-inset ring-neutral-200 hover:bg-primary-50 hover:text-primary-800'}`

/**
 * The frame of every member page: who is looking, where am I, how do I get to the other member pages. Heading and bubbles are the plugin's;
 * the page frame (navigation, footer) is the site's.
 *
 * The bubbles under the heading are the member area's pages, unless the page passes its own `nav` (a course shows its areas there)
 * or `nav={null}` for none. A page with a `back` link and no `nav` has no bubbles.
 */
export function MemberShell({ active, title, lead, back, actions, nav, singles, extraNav, children, locale = 'de', hrefs, containerClass = 'mx-auto w-full max-w-[1240px] px-5' }: { active?: MemberTab; title: string; lead?: ReactNode; back?: { href: string; label: string }; actions?: ReactNode; nav?: MemberNavItem[] | null; /** how many single purchases the member has (`countSingles`); with some, "my accesses" is one of the bubbles */ singles?: number; /** more bubbles of the site's own (e.g. "Termine"), placed before "Konto" */ extraNav?: MemberNavItem[]; children: ReactNode; locale?: Locale; hrefs?: Partial<Hrefs>; containerClass?: string }) {
  const L = t(locale)
  const h = { ...defaultHrefs, ...hrefs }
  const here = active === 'dashboard' ? 'courses' : active
  const pages: MemberNavItem[] = [
    { key: 'courses', label: L.courses, href: h.dashboard, current: here === 'courses' },
    ...(singles ? [{ key: 'singles', label: L.singles, href: h.singles, current: here === 'singles', count: singles }] : []),
    { key: 'orders', label: L.orders, href: h.orders, current: here === 'orders' },
    ...(extraNav ?? []),
    { key: 'account', label: L.account, href: h.account, current: here === 'account' },
  ]
  const items = nav === undefined ? (back ? null : pages) : nav
  return (
    <main>
      <ImpersonationBanner locale={locale} home={h.dashboard} />
      <div className="border-b border-neutral-200 bg-neutral-50">
        <div className={`${containerClass} pb-6 pt-8`}>
          {back && <a href={back.href} className="mb-3 inline-block text-[0.95rem] font-medium text-primary-700 no-underline hover:text-primary-500">← {back.label}</a>}
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <h1 className="m-0 font-display text-[clamp(2.25rem,5vw,3.5rem)] leading-[1] font-semibold text-primary-950 text-balance">{title}</h1>
              {lead && <p className="m-0 mt-3 max-w-2xl text-lg text-neutral-600">{lead}</p>}
            </div>
            {actions}
          </div>
          {items && items.length > 0 && (
            <nav aria-label={L.memberArea} className="mt-6 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
              {items.map((i) => (
                <a key={i.key} href={i.href} aria-current={i.current ? 'page' : undefined} className={bubble(Boolean(i.current))}>
                  {i.label}
                  {i.count != null && <span className={`rounded-full px-2 text-xs tabular-nums ${i.current ? 'bg-white/20' : 'bg-neutral-100 text-neutral-600'}`}>{i.count}</span>}
                </a>
              ))}
            </nav>
          )}
        </div>
      </div>
      <div className={`${containerClass} py-10 sm:py-14`}>{children}</div>
    </main>
  )
}
