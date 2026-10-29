'use client'

import { useState } from 'react'
import { BookingOptions, type OptionInfo } from './BookingOptions'
import { euro, t, type Locale } from './i18n'
import { SlotPicker, type SlotPickerProps } from './SlotPicker'

export interface BookableProps {
  id: string | number
  title: string
  priceCents: number
  durationMinutes: number
  cancellationHours: number
  location: 'online' | 'phone' | 'inperson'
  options: OptionInfo[]
}

/** Everything a customer decides on one page: options (with live price and duration), then day and time. Reserving continues to the checkout. */
export function BookingWidget({ product, locale = 'de', className = '', ...picker }: { product: BookableProps; locale?: Locale; className?: string } & Omit<SlotPickerProps, 'productId' | 'options' | 'locale'>) {
  const L = t(locale)
  const [chosen, setChosen] = useState<string[]>([])
  const picked = product.options.filter((o) => chosen.includes(o.id))
  const price = product.priceCents + picked.reduce((n, o) => n + o.priceDeltaCents, 0)
  const minutes = product.durationMinutes + picked.reduce((n, o) => n + o.durationDeltaMinutes, 0)
  return (
    <section className={`flex flex-col gap-8 ${className}`}>
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-2">
        <div>
          <h2 className="m-0 font-display text-3xl text-primary-950">{product.title}</h2>
          <p className="m-0 mt-1 text-neutral-600">{L.duration(minutes)} · {L.location[product.location]}</p>
        </div>
        <p className="m-0 text-right"><span className="font-display text-3xl text-primary-950">{euro(price, locale)}</span> <span className="text-sm text-neutral-500">{L.priceFrom}</span></p>
      </header>
      <BookingOptions options={product.options} value={chosen} onChange={setChosen} locale={locale} />
      <SlotPicker {...picker} productId={product.id} options={chosen} locale={locale} />
      <p className="m-0 text-sm text-neutral-500">{L.cancelUntil(product.cancellationHours)}</p>
    </section>
  )
}
