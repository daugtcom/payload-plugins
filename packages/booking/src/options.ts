export type Id = string | number

/** What the bridge may need to do its work (the Payload instance of the running site). */
export interface LiveBridgeContext { payload: import('payload').Payload }

/** What booking needs from a video plugin, so it never imports one. `payload-live` provides a ready implementation. */
export interface BookingLiveBridge {
  /** An online appointment was confirmed: create the room-with-schedule for it. */
  createSession(args: { title: string; startsAt: Date; endsAt: Date; hostUserIds: Id[]; participantUserIds: Id[]; /** The customer chose an option that includes the recording. */ record?: boolean; source: { kind: 'booking'; id: Id } }, ctx: LiveBridgeContext): Promise<{ id: Id }>
  /** The appointment moved. */
  updateSession?(id: Id, args: { startsAt: Date; endsAt: Date }, ctx: LiveBridgeContext): Promise<void>
  /** The appointment was cancelled. */
  cancelSession?(id: Id, ctx: LiveBridgeContext): Promise<void>
  /** Where a participant joins (shown in emails and the member area). Default `/access/live/<id>`. */
  joinHref?: (sessionId: Id) => string
  /** Finished recordings of these sessions (for "Watch recording" on past appointments). */
  recordings?(sessionIds: Id[], ctx: LiveBridgeContext): Promise<Record<string, { egressId: string; durationSeconds?: number | null }[]>>
  /** Where a recording is watched. */
  recordingHref?: (sessionId: Id, egressId: string) => string
}

export interface BookingPluginOptions {
  enabled?: boolean
  /** Customers' auth collection. Default `users`. */
  usersSlug?: string
  /** The commerce products collection. Default `products`. */
  productsSlug?: string
  bookingsSlug?: string
  isStaff?: (user: unknown) => boolean
  /** Opening hours, exceptions and slots are in this time zone. Default `Europe/Vienna`. */
  timezone?: string
  /** How long a chosen slot is reserved for the buyer. At least 30 (Stripe Checkout sessions cannot expire sooner). Default 35. */
  holdMinutes?: number
  /** Read-only iCalendar addresses (Google/Apple "secret address", or `file:` in development). Anything busy there blocks slots. */
  busyCalendars?: { url: string; name?: string }[]
  /** Slug of the settings global where staff add calendars in the admin (busy or available). Default `bookingSettings`. */
  settingsSlug?: string
  /** How long a fetched calendar is reused. Default 300. */
  busyCacheSeconds?: number
  live?: BookingLiveBridge
  /** Who hosts online appointments and is told about bookings. Default: users with the `admin` role. */
  hostUserIds?: (payload: import('payload').Payload) => Promise<Id[]>
  /** Send emails (confirmation with .ics, cancellation, note to the host). Default true. */
  email?: boolean
  /** Used in emails and links. Default: the Payload `serverURL`. */
  serverURL?: string
  /** Name in email signatures. Default `Margaretha Brunner` is NOT assumed: falls back to the server host. */
  siteName?: string
  /** Optional shared site theme for the built-in email template. */
  mailTheme?: import('@daugtcom/payload-mail').MailTheme
  /** Turns an email's content into branded HTML + text. Pass `mailLayout(theme)` from `@daugtcom/payload-mail`. Defaults to the shared React Email template. */
  mailLayout?: import('./email').MailLayout
  /** Hours before the start at which a reminder is mailed. Default `[24, 1]`; `[]` turns reminders off. */
  reminderHours?: number[]
}

export interface ResolvedBookingOptions {
  usersSlug: string
  productsSlug: string
  bookingsSlug: string
  isStaff: (user: unknown) => boolean
  timezone: string
  holdMinutes: number
  busyCalendars: { url: string; name?: string }[]
  settingsSlug: string
  busyCacheSeconds: number
  live?: BookingLiveBridge
  hostUserIds?: BookingPluginOptions['hostUserIds']
  email: boolean
  serverURL?: string
  siteName?: string
  mailTheme?: BookingPluginOptions['mailTheme']
  mailLayout?: BookingPluginOptions['mailLayout']
  reminderHours: number[]
}
