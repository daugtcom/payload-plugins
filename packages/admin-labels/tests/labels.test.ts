import { describe, expect, it } from 'vitest'
import { adminLabels } from '../src/index'

describe('admin entity labels', () => {
  it('provides German and English names and leaves unknown entities alone', async () => {
    const result = await adminLabels()({ collections: [{ slug: 'courses', fields: [] }, { slug: 'custom', fields: [] }], globals: [{ slug: 'bookingSettings', fields: [] }] })
    expect(result.collections?.[0]?.labels).toEqual({ singular: { de: 'Kurs', en: 'Course' }, plural: { de: 'Kurse', en: 'Courses' } })
    expect(result.collections?.[1]?.labels).toBeUndefined()
    expect(result.globals?.[0]?.label).toEqual({ de: 'Termineinstellungen', en: 'Booking settings' })
  })
})

it('supports site-specific terminology and custom slugs', async () => {
  const labels = { singular: { de: 'Lektion', en: 'Lesson' }, plural: { de: 'Lektionen', en: 'Lessons' } }
  const result = await adminLabels({ collections: { customLessons: labels } })({ collections: [{ slug: 'customLessons', fields: [] }] })
  expect(result.collections?.[0]?.labels).toEqual(labels)
})
