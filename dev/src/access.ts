/** Staff = members with the `admin` role. */
export const isStaff = (u: unknown): boolean => Boolean(u && ((u as { roles?: string[] }).roles ?? []).includes('admin'))
