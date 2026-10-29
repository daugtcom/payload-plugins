import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BookingOptions, BookingWidget, SlotPicker, bookableInfo } from '../src/ui'

describe('booking UI renders on the server', () => {
  const product = { id: 7, title: 'Telefonische Sitzung', priceCents: 9000, durationMinutes: 60, cancellationHours: 48, location: 'online' as const, options: [{ id: 'plus30', label: '30 Minuten länger', priceDeltaCents: 4500, durationDeltaMinutes: 30 }] }

  it('BookingWidget shows title, duration, price and the options', () => {
    const html = renderToStaticMarkup(createElement(BookingWidget, { product }))
    expect(html).toContain('Telefonische Sitzung')
    expect(html).toContain('60 Minuten')
    expect(html).toContain('90,00')
    expect(html).toContain('30 Minuten länger')
    expect(html).toContain('+30 min')
    expect(html).toContain('Kostenlos stornierbar bis 48 Stunden vorher.')
  })

  it('SlotPicker draws a German calendar with the site classes and lets a site override them', () => {
    const html = renderToStaticMarkup(createElement(SlotPicker, { productId: 7, classNames: { day_button: 'my-day' } }))
    expect(html).toMatch(/Montag|Mo/)
    expect(html).toContain('font-display') // month caption from the default classes
    expect(html).toContain('my-day')
    expect(html).not.toContain('mx-auto flex h-10 w-10') // replaced by the override
  })

  it('BookingOptions renders nothing without options, and English on request', () => {
    expect(renderToStaticMarkup(createElement(BookingOptions, { options: [], value: [], onChange: () => {} }))).toBe('')
    expect(renderToStaticMarkup(createElement(BookingOptions, { options: product.options, value: [], onChange: () => {}, locale: 'en' }))).toContain('Options')
  })

  it('bookableInfo reads a product document', () => {
    expect(bookableInfo({ id: 1, title: 'X', priceInEUR: 5000, _status: 'published', booking: { enabled: true, durationMinutes: 45 } })).toMatchObject({ id: 1, priceCents: 5000, durationMinutes: 45, location: 'online', cancellationHours: 48 })
    expect(bookableInfo({ id: 1, title: 'X', booking: { enabled: false } })).toBeNull()
    expect(bookableInfo({ id: 1, title: 'X', _status: 'draft', booking: { enabled: true } })).toBeNull()
  })
})
