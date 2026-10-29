import type { CollectionConfig, Field, GlobalConfig } from 'payload'
import { isHHMM } from './slots'
import type { ResolvedBookingOptions } from './options'

const hhmm = (v: unknown) => (v == null || v === '' || isHHMM(v) ? true : 'Bitte als HH:MM angeben, z. B. 09:30.')

const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'].map((label, i) => ({ label, value: String(i + 1) }))

/** The `booking` group on products. Weekdays are ISO numbers (1 = Monday … 7 = Sunday) stored as text so the select works everywhere. */
export const bookingProductFields: Field = {
  name: 'booking',
  type: 'group',
  label: 'Terminbuchung',
  admin: { description: 'Macht aus dem Produkt einen buchbaren Termin: Kund:innen wählen einen freien Zeitpunkt und bezahlen wie gewohnt im Shop.' },
  fields: [
    { name: 'enabled', type: 'checkbox', label: 'Buchbarer Termin', defaultValue: false },
    {
      type: 'collapsible',
      label: 'Termin-Einstellungen',
      admin: { condition: (_, s) => Boolean(s?.enabled) },
      fields: [
        { type: 'row', fields: [
          { name: 'durationMinutes', type: 'number', label: 'Dauer (Minuten)', defaultValue: 60, min: 5, required: true },
          { name: 'stepMinutes', type: 'number', label: 'Abstand der Startzeiten (Minuten)', defaultValue: 30, min: 5 },
        ] },
        { type: 'row', fields: [
          { name: 'bufferBeforeMinutes', type: 'number', label: 'Pause davor (Min.)', defaultValue: 0, min: 0 },
          { name: 'bufferAfterMinutes', type: 'number', label: 'Pause danach (Min.)', defaultValue: 0, min: 0 },
        ] },
        { type: 'row', fields: [
          { name: 'minNoticeHours', type: 'number', label: 'Frühestens in … Stunden buchbar', defaultValue: 24, min: 0 },
          { name: 'maxAdvanceDays', type: 'number', label: 'Höchstens … Tage im Voraus', defaultValue: 60, min: 1 },
          { name: 'cancellationHours', type: 'number', label: 'Kostenlos stornierbar bis … Stunden vorher', defaultValue: 48, min: 0 },
        ] },
        { type: 'row', fields: [
          { name: 'location', type: 'select', label: 'Art', defaultValue: 'online', options: [{ label: 'Online (Videoanruf im Mitgliederbereich)', value: 'online' }, { label: 'Telefon', value: 'phone' }, { label: 'Vor Ort', value: 'inperson' }] },
          { name: 'resource', type: 'text', label: 'Kalender', defaultValue: 'default', admin: { description: 'Termine mit demselben Kalender blockieren einander. Nur ändern, wenn eine andere Person die Termine hält.' } },
        ] },
        {
          name: 'weekly',
          type: 'array',
          label: 'Wöchentliche Zeiten',
          labels: { singular: 'Zeitfenster', plural: 'Zeitfenster' },
          admin: { description: 'Wann bist du buchbar? Mehrere Fenster pro Tag sind möglich (Mittagspause).' },
          fields: [
            { type: 'row', fields: [
              { name: 'weekday', type: 'select', options: WEEKDAYS, required: true },
              { name: 'from', type: 'text', label: 'Von', required: true, validate: hhmm, admin: { placeholder: '09:00' } },
              { name: 'to', type: 'text', label: 'Bis', required: true, validate: hhmm, admin: { placeholder: '17:00' } },
            ] },
          ],
        },
        {
          name: 'exceptions',
          type: 'array',
          label: 'Ausnahmen',
          labels: { singular: 'Ausnahme', plural: 'Ausnahmen' },
          admin: { description: 'Ein einzelner Tag, der von den wöchentlichen Zeiten abweicht: geschlossen, oder andere Zeiten.' },
          fields: [
            { type: 'row', fields: [
              { name: 'date', type: 'text', label: 'Datum (JJJJ-MM-TT)', required: true, validate: (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? true : 'Bitte als JJJJ-MM-TT angeben, z. B. 2026-12-24.') },
              { name: 'closed', type: 'checkbox', label: 'Geschlossen', defaultValue: true },
              { name: 'from', type: 'text', label: 'Von', validate: hhmm, admin: { condition: (_, s) => !s?.closed } },
              { name: 'to', type: 'text', label: 'Bis', validate: hhmm, admin: { condition: (_, s) => !s?.closed } },
            ] },
          ],
        },
        {
          name: 'options',
          type: 'array',
          label: 'Auswahl für Kund:innen',
          labels: { singular: 'Option', plural: 'Optionen' },
          admin: { description: 'Zusätze zur Auswahl, z. B. „Verlängerung um 30 Minuten" oder „Aufzeichnung". Preis und Dauer kommen zum Grundpreis dazu.' },
          fields: [
            { type: 'row', fields: [
              { name: 'id', type: 'text', label: 'Kennung', required: true, admin: { description: 'Kurz, ohne Leerzeichen, z. B. verlaengerung.' } },
              { name: 'label', type: 'text', label: 'Bezeichnung', required: true },
            ] },
            { type: 'row', fields: [
              { name: 'priceDeltaCents', type: 'number', label: 'Aufpreis (Cent)', defaultValue: 0 },
              { name: 'durationDeltaMinutes', type: 'number', label: 'Zusätzliche Dauer (Min.)', defaultValue: 0, min: 0 },
            ] },
            { name: 'recording', type: 'checkbox', label: 'Enthält die Aufzeichnung des Videoanrufs', defaultValue: false, admin: { description: 'Wer das wählt, bekommt den Anruf aufgezeichnet (automatisch, ohne weiteres Zutun) und findet die Aufnahme danach im Mitgliederbereich unter „Aufnahmen“. Beide sehen im Raum, dass aufgenommen wird.' } },
          ],
        },
      ],
    },
  ],
}

export const BOOKING_STATUSES = ['held', 'confirmed', 'cancelled', 'completed', 'no_show', 'expired'] as const
export type BookingStatus = (typeof BOOKING_STATUSES)[number]

export function bookingsCollection(o: ResolvedBookingOptions): CollectionConfig {
  const staff = (user: unknown) => Boolean(user && o.isStaff(user))
  const staffOnly = ({ req }: { req: { user?: unknown } }) => staff(req.user)
  return {
    slug: o.bookingsSlug,
    labels: { singular: 'Termin', plural: 'Termine' },
    admin: { useAsTitle: 'title', defaultColumns: ['title', 'start', 'status', 'customer', 'join'], group: 'Shop' },
    timestamps: true,
    access: {
      read: ({ req }) => (staff(req.user) ? true : req.user ? { customer: { equals: (req.user as { id: string | number }).id } } : false),
      create: staffOnly,
      update: staffOnly,
      delete: staffOnly,
    },
    hooks: {
      beforeChange: [
        // bookings made by staff in the admin: take title and blocked time from the product
        async ({ data, req }) => {
          if (!data.product || !data.start || !data.end) return data
          if (data.blockStart && data.blockEnd && data.title) return data
          const p = (await req.payload.findByID({ collection: o.productsSlug as never, id: data.product, depth: 0, overrideAccess: true, req }).catch(() => null)) as { title?: string; booking?: { bufferBeforeMinutes?: number; bufferAfterMinutes?: number; resource?: string } } | null
          const before = p?.booking?.bufferBeforeMinutes ?? 0
          const after = p?.booking?.bufferAfterMinutes ?? 0
          return {
            ...data,
            title: data.title ?? p?.title,
            resource: data.resource ?? p?.booking?.resource ?? 'default',
            blockStart: data.blockStart ?? new Date(new Date(data.start).getTime() - before * 60_000).toISOString(),
            blockEnd: data.blockEnd ?? new Date(new Date(data.end).getTime() + after * 60_000).toISOString(),
          }
        },
      ],
    },
    fields: [
      { name: 'title', type: 'text', admin: { readOnly: true, description: 'Name des Termins zum Zeitpunkt der Buchung.' } },
      { type: 'row', fields: [
        { name: 'product', type: 'relationship', relationTo: o.productsSlug as never, required: true, index: true },
        { name: 'customer', type: 'relationship', relationTo: o.usersSlug as never, required: true, index: true },
      ] },
      { type: 'row', fields: [
        { name: 'start', type: 'date', required: true, index: true, admin: { date: { pickerAppearance: 'dayAndTime' } } },
        { name: 'end', type: 'date', required: true, admin: { date: { pickerAppearance: 'dayAndTime' } } },
      ] },
      {
        type: 'row',
        fields: [
          { name: 'blockStart', type: 'date', required: true, admin: { readOnly: true, date: { pickerAppearance: 'dayAndTime' }, description: 'Belegter Zeitraum: Termin plus Pausen. Darauf wacht die Datenbank, damit sich nichts überschneidet.' } },
          { name: 'blockEnd', type: 'date', required: true, admin: { readOnly: true, date: { pickerAppearance: 'dayAndTime' } } },
        ],
      },
      { name: 'resource', type: 'text', defaultValue: 'default', required: true, index: true },
      { name: 'status', type: 'select', defaultValue: 'held', required: true, index: true, options: BOOKING_STATUSES.map((s) => ({ label: s, value: s })), admin: { position: 'sidebar' } },
      { name: 'holdExpiresAt', type: 'date', admin: { position: 'sidebar', date: { pickerAppearance: 'dayAndTime' } } },
      { name: 'location', type: 'text', admin: { position: 'sidebar', readOnly: true } },
      { name: 'priceCents', type: 'number', admin: { position: 'sidebar' } },
      { name: 'options', type: 'json', admin: { description: 'Gewählte Optionen (Kennungen).' } },
      { type: 'row', fields: [
        { name: 'cart', type: 'relationship', relationTo: 'carts' as never, admin: { readOnly: true } },
        { name: 'order', type: 'relationship', relationTo: 'orders' as never, admin: { readOnly: true } },
      ] },
      { name: 'liveSession', type: 'text', admin: { readOnly: true, description: 'Videoanruf zu diesem Termin (Kennung aus dem Video-Plugin).' } },
      { name: 'join', type: 'ui', label: 'Videoanruf', admin: { components: { Cell: '@daugtcom/payload-booking/admin#JoinButton', Field: '@daugtcom/payload-booking/admin#JoinButton' } } },
      { type: 'row', fields: [
        { name: 'needsAttention', type: 'checkbox', defaultValue: false, admin: { description: 'Bezahlt, aber der Termin ist inzwischen vergeben oder wurde nicht bestätigt. Bitte melden.' } },
        { name: 'refundNeeded', type: 'checkbox', defaultValue: false, admin: { description: 'Storniert nach Zahlung: Rückerstattung im Stripe-Dashboard veranlassen.' } },
      ] },
      { name: 'cancelledAt', type: 'date' },
      { name: 'remindersSent', type: 'json', admin: { hidden: true }, access: { read: ({ req }) => staff(req.user), create: () => false, update: () => false } },
      { name: 'cancelToken', type: 'text', index: true, access: { read: ({ req }) => staff(req.user), create: () => false, update: () => false }, admin: { hidden: true } },
    ],
  }
}

/** Calendars the owner manages in the admin: a Google/Apple "secret address in iCal format". */
export function bookingSettingsGlobal(o: ResolvedBookingOptions): GlobalConfig {
  const staff = ({ req }: { req: { user?: unknown } }) => Boolean(req.user && o.isStaff(req.user))
  return {
    slug: o.settingsSlug,
    label: 'Terminkalender',
    admin: { group: 'Shop', description: 'Verbinde deinen Kalender mit der Terminbuchung. Er wird nur gelesen, nichts wird dort eingetragen.' },
    access: { read: staff, update: staff },
    fields: [
      {
        name: 'calendars',
        type: 'array',
        label: 'Kalender',
        labels: { singular: 'Kalender', plural: 'Kalender' },
        admin: { initCollapsed: false },
        fields: [
          { name: 'name', type: 'text', label: 'Name', admin: { placeholder: 'z. B. Mein Google-Kalender' } },
          {
            name: 'url',
            type: 'text',
            required: true,
            label: 'Kalender-Adresse (iCal)',
            admin: { description: 'Google Kalender: Einstellungen → deinen Kalender wählen → „Geheime Adresse im iCal-Format“. Apple: Kalender teilen → „Öffentlicher Kalender“-Link (webcal:// funktioniert, https:// auch).' },
            validate: (v: unknown) => (typeof v === 'string' && /^(https?|webcal|file):\/\//i.test(v.trim()) ? true : 'Bitte eine Adresse, die mit https:// oder webcal:// beginnt.'),
          },
          {
            name: 'mode',
            type: 'radio',
            defaultValue: 'busy',
            required: true,
            label: 'Was bedeuten die Einträge?',
            options: [
              { label: 'Belegt: Alles, was im Kalender steht, ist nicht buchbar. Frei ist, was in den wöchentlichen Zeiten liegt.', value: 'busy' },
              { label: 'Verfügbar: Nur was im Kalender eingetragen ist, ist buchbar (die wöchentlichen Zeiten der Produkte werden dann nicht verwendet).', value: 'available' },
            ],
          },
        ],
      },
    ],
  }
}
