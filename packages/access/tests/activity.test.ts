import { describe, expect, it } from 'vitest'
import { contentActivity, sortCoursesByActivity, sortSinglesByActivity } from '../src/activity'

const item = (id: string, publishedAt: string, updatedAt: string) => ({ id, publishedAt, updatedAt })
describe('member area ordering', () => {
  it('orders courses by the newest visible post activity, regardless of access state', () => {
    const courses = [
      { course: { id: 'older', title: 'Older' }, state: 'active', lastActivity: '2026-01-02T00:00:00Z' },
      { course: { id: 'newer', title: 'Newer' }, state: 'ended', lastActivity: '2026-02-01T00:00:00Z' },
    ]
    expect(sortCoursesByActivity(courses).map((c) => c.course.id)).toEqual(['newer', 'older'])
  })
  it('uses the latest publication or update timestamp and orders individual access items', () => {
    const older = item('older', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')
    const newer = item('newer', '2026-01-15T00:00:00Z', '2026-03-01T00:00:00Z')
    expect(contentActivity(older)).toBe(Date.parse('2026-02-01T00:00:00Z'))
    expect(sortSinglesByActivity([older, newer]).map((d) => d.id)).toEqual(['newer', 'older'])
  })
  it('puts courses without visible content after those with activity with deterministic ties', () => {
    const courses = [{ course: { id: 2, title: 'Z' }, lastActivity: null }, { course: { id: 1, title: 'A' }, lastActivity: null }, { course: { id: 3, title: 'X' }, lastActivity: '2026-01-01T00:00:00Z' }]
    expect(sortCoursesByActivity(courses).map((c) => c.course.id)).toEqual([3, 1, 2])
  })
})
