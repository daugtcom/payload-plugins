import { ArrowRight } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Payload } from 'payload'
import { AutoRefresh } from './controls'
import { formatDate, mediaSrc, type MediaLike } from './format'
import { t, type Locale } from './i18n'
import { loadDashboard, type MemberSlugs } from './member'
import { MemberShell, type MemberNavItem } from './Shell'
import { defaultHrefs, type AccessUser, type Hrefs } from './types'

type Doc = Record<string, any>
/** Only courses that are not simply running carry a label: "running" is what everyone expects. */
const chip = { upcoming: 'bg-secondary-100 text-secondary-900', ended: 'bg-neutral-200 text-neutral-800' } as const

/** `?ansicht=zugaenge` shows the single purchases instead of the courses. */
export const DASHBOARD_VIEW_PARAM = 'ansicht'
export type DashboardView = 'courses' | 'singles'
export const parseDashboardView = (v: string | string[] | undefined): DashboardView | undefined => ((Array.isArray(v) ? v[0] : v) === 'zugaenge' ? 'singles' : undefined)

/**
 * The member area start page. Two views behind bubbles in the header, one click apart: the courses (cards with picture, state, "all posts"
 * and the sections) and the single purchases (the posts and downloads the member can open). Next to them the profile.
 * `aside` is a slot under the profile, e.g. the commerce package's `<RecentOrders/>`. `view` comes from the page's `?ansicht=` (see `parseDashboardView`);
 * without it the courses show, or the single purchases when there are no courses.
 */
export async function MemberDashboard({ payload, user, locale = 'de', singlesSlug, hrefs, aside, slugs, containerClass, refreshSeconds = 10, imageSrc = mediaSrc, view, extraNav }: { payload: Payload; user: AccessUser & { name?: string | null; email?: string }; locale?: Locale; singlesSlug?: string; hrefs?: Partial<Hrefs>; aside?: ReactNode; slugs?: Partial<MemberSlugs>; containerClass?: string; refreshSeconds?: number; imageSrc?: (m: MediaLike | null | undefined, size?: 'thumbnail' | 'optimized') => string | undefined; view?: DashboardView; extraNav?: MemberNavItem[] }) {
  const L = t(locale)
  const h = { ...defaultHrefs, ...hrefs }
  const data = await loadDashboard(payload, user, { slugs: { ...(singlesSlug ? { singles: singlesSlug } : {}), ...slugs }, newest: 0 })
  // the profile as it is stored now (the session may carry an older name or no picture)
  const me = ((await payload.findByID({ collection: 'users', id: user.id, depth: 1, overrideAccess: true }).catch(() => null)) ?? user) as typeof user & { avatar?: unknown }
  const first = me.name?.trim().split(/\s+/)[0]
  const date = (iso: string | null | undefined) => formatDate(iso, locale === 'de' ? 'de-AT' : 'en-GB')
  const hasSingles = data.singles.length > 0
  const current: DashboardView = view === 'singles' && hasSingles ? 'singles' : view === 'courses' ? 'courses' : data.courses.length === 0 && hasSingles ? 'singles' : 'courses'
  const nav: MemberNavItem[] = [
    { key: 'courses', label: L.courses, href: h.dashboard, current: current === 'courses', count: data.courses.length },
    ...(hasSingles ? [{ key: 'singles', label: L.singles, href: h.singles, current: current === 'singles', count: data.singles.length }] : []),
    { key: 'orders', label: L.orders, href: h.orders },
    ...(extraNav ?? []),
    { key: 'account', label: L.account, href: h.account },
  ]
  return (
    <MemberShell active="courses" nav={nav} title={L.welcome(first)} lead={L.welcomeLead} locale={locale} hrefs={hrefs} containerClass={containerClass}>
      {refreshSeconds > 0 && <AutoRefresh seconds={refreshSeconds} />}
      <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
        <section aria-labelledby="member-main" className="lg:col-span-8">
          <h2 id="member-main" className="sr-only">{current === 'singles' ? L.singles : L.courses}</h2>
          {current === 'courses' ? (
            data.courses.length === 0 ? (
              <p className="m-0 rounded-2xl border border-dashed border-neutral-300 p-8 text-neutral-600">{L.noCourses} <a href={h.shop} className="font-semibold text-primary-700">{L.toShop}</a></p>
            ) : (
              <ul className="m-0 grid list-none! gap-5 p-0!">
                {data.courses.map(({ course, state, visibleLessons, sections, startsAt }) => {
                  const img = imageSrc((course.backgroundImage ?? course.image) as MediaLike | null, 'thumbnail')
                  return (
                    <li key={course.id} className={`m-0! overflow-hidden rounded-2xl border border-neutral-200 bg-white ${img ? 'sm:grid sm:grid-cols-[14rem_1fr]' : ''}`}>
                      {img ? (
                        <a href={h.section(course.slug, 'all')} tabIndex={-1} aria-hidden className="block aspect-[16/10] bg-primary-100 sm:aspect-auto"><img src={img} alt="" loading="lazy" className="h-full w-full object-cover" /></a>
                      ) : (
                        <div aria-hidden className="h-2 w-full bg-gradient-to-r from-primary-600 via-primary-400 to-secondary-400" />
                      )}
                      <div className="p-5 sm:p-6">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <h3 className="m-0 font-display text-3xl leading-none font-semibold text-primary-950">{course.title}</h3>
                          {state !== 'active' && <span className={`rounded-full px-3 py-1 text-sm font-medium ${chip[state]}`}>{L[state]}</span>}
                        </div>
                        <p className="m-0 mt-2 text-[0.95rem] text-neutral-600">{state === 'upcoming' && startsAt ? L.startsOn(date(startsAt)) : L.lessonsOpen(visibleLessons)}</p>
                        <div className="mt-5 flex flex-wrap items-center gap-2">
                          <a href={h.section(course.slug, 'all')} className="inline-flex items-center gap-2 rounded-full bg-primary-700 px-4 py-2.5 text-[0.95rem] font-semibold text-white no-underline hover:bg-primary-600">{L.allPosts} <ArrowRight className="h-4 w-4" aria-hidden /></a>
                          {sections.map((s: Doc) => <a key={s.id} href={h.section(course.slug, s.slug)} className="rounded-full bg-neutral-100 px-3.5 py-2 text-[0.9rem] text-neutral-700 no-underline hover:bg-primary-50 hover:text-primary-800">{s.title}</a>)}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )
          ) : (
            <ul className="m-0 grid list-none! gap-5 p-0! sm:grid-cols-2">
              {data.singles.map((s: Doc) => {
                const img = imageSrc(s.image as MediaLike | null, 'thumbnail')
                return (
                  <li key={s.id} className="group relative m-0! overflow-hidden rounded-2xl border border-neutral-200 bg-white transition-shadow focus-within:shadow-lg hover:shadow-lg hover:shadow-primary-950/10">
                    {img ? (
                      <div className="aspect-[16/10] overflow-hidden bg-primary-100"><img src={img} alt="" loading="lazy" className="h-full w-full object-cover transition duration-700 ease-out group-hover:scale-105" /></div>
                    ) : (
                      <div aria-hidden className="h-2 w-full bg-gradient-to-r from-primary-600 via-primary-400 to-secondary-400" />
                    )}
                    <div className="p-5">
                      {s.publishedAt && <p className="m-0 text-sm text-neutral-500">{date(s.publishedAt)}</p>}
                      <h3 className="m-0 mt-1 font-display text-2xl leading-tight font-semibold text-primary-950"><a href={h.post(s.slug)} className="text-inherit no-underline after:absolute after:inset-0 after:content-[''] group-hover:text-primary-700">{s.title}</a></h3>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <aside className="space-y-8 lg:col-span-4">
          <section aria-labelledby="member-profile" className="rounded-2xl border border-neutral-200 bg-white p-6">
            <h2 id="member-profile" className="sr-only">{L.yourProfile}</h2>
            <div className="flex items-center gap-4">
              <Avatar user={me} imageSrc={imageSrc} />
              <div className="min-w-0">
                <p className="m-0 truncate text-lg font-semibold text-primary-950">{me.name || L.nameMissing}</p>
                <p className="m-0 truncate text-sm text-neutral-600">{me.email}</p>
              </div>
            </div>
            <a href={h.account} className="mt-4 inline-block text-[0.95rem] font-semibold text-primary-700 no-underline hover:text-primary-500">{L.editProfile}</a>
          </section>
          {aside}
        </aside>
      </div>
    </MemberShell>
  )
}

function Avatar({ user, imageSrc }: { user: AccessUser & { name?: string | null; email?: string; avatar?: unknown }; imageSrc: (m: MediaLike | null | undefined, size?: 'thumbnail' | 'optimized') => string | undefined }) {
  const src = user.avatar && typeof user.avatar === 'object' ? imageSrc(user.avatar as MediaLike, 'thumbnail') : undefined
  if (src) return <img src={src} alt="" className="h-14 w-14 shrink-0 rounded-full object-cover" />
  return <span aria-hidden className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary-100 font-display text-2xl font-semibold text-primary-800">{(user.name || user.email || '?').charAt(0).toUpperCase()}</span>
}
