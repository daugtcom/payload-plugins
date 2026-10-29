type Content = { publishedAt?: unknown; updatedAt?: unknown }
type Course = { course: { id: string | number; title?: unknown }; lastActivity: string | null }

/** Publication or most recent edit of a published item; invalid and missing dates sort last. */
export function contentActivity(item: Content): number {
  const timestamp = (value: unknown) => typeof value === 'string' ? Date.parse(value) : NaN
  return Math.max(timestamp(item.publishedAt) || 0, timestamp(item.updatedAt) || 0)
}

export function sortCoursesByActivity<T extends Course>(courses: T[]): T[] {
  return courses.sort((a, b) => (Date.parse(b.lastActivity ?? '') || 0) - (Date.parse(a.lastActivity ?? '') || 0) || String(a.course.title ?? '').localeCompare(String(b.course.title ?? '')) || String(a.course.id).localeCompare(String(b.course.id)))
}

export function sortSinglesByActivity<T extends Content & { id: string | number }>(items: T[]): T[] {
  return items.sort((a, b) => contentActivity(b) - contentActivity(a) || String(a.id).localeCompare(String(b.id)))
}
