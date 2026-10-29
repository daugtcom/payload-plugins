export type Id = string | number

/** The signed-in member as the pages need them. */
export interface AccessUser {
  id: Id
  roles?: string[] | null
}

export const isStaffUser = (u: AccessUser | null | undefined): boolean => Boolean(u?.roles?.includes('admin'))

/** Where the pages link to. Override any of them to match your routes. */
export interface Hrefs {
  /** A lesson or post. Default `/post/<slug>`. */
  post: (slug: string) => string
  /** A course section. Default `/access/course/<course>/<section>`. */
  section: (course: string, section: string) => string
  dashboard: string
  /** The dashboard's view of single purchases. Default `<dashboard>?ansicht=zugaenge`. */
  singles: string
  shop: string
  orders: string
  account: string
}

export const defaultHrefs: Hrefs = {
  post: (slug) => `/post/${slug}`,
  section: (course, section) => `/access/course/${course}/${section}`,
  dashboard: '/access',
  singles: '/access?ansicht=zugaenge',
  shop: '/shop',
  orders: '/access/orders',
  account: '/access/account',
}
