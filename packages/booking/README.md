# @daugtcom/payload-booking

Appointment booking for a Payload shop (`payload-commerce`). A product becomes a bookable appointment; the customer picks options and a free slot, the slot is held and put into the cart, the normal Stripe checkout pays for it, and the paid order confirms the booking. Online appointments get a video session through a small bridge (see `payload-live`).

## Wiring

```ts
// payload.config.ts: AFTER payloadAccess() and payloadCommerce(), it extends products, carts and orders
import { payloadBooking } from '@daugtcom/payload-booking'

plugins: [
  payloadAccess({ … }),
  payloadCommerce({ … }),
  payloadBooking({
    timezone: 'Europe/Vienna',
    busyCalendars: env.BUSY_ICS_URL ? [{ url: env.BUSY_ICS_URL }] : [],   // Google/Apple "secret address", or file:///… in development
    live: liveBridge,                                                    // optional, see below
    siteName: 'Margaretha Brunner',                                      // signature in emails
  }),
]
```

For page builders, use the exported `bookableBlock` schema and the `/ui` `BookableBlock` server component; the site supplies the styling. The block keeps the existing `bookable` slug and fields.

Then, in the admin, open a product and tick **Terminbuchung → Buchbarer Termin**: duration, pauses, notice, horizon, weekly opening hours (several windows a day are fine), exceptions (closed days or other hours) and options with price and duration deltas.

Storefront page (server component) and member area:

```tsx
import { bookableInfo } from '@daugtcom/payload-booking'
import { BookingWidget, MyBookings } from '@daugtcom/payload-booking/ui'

// product page / "Einzelsitzungen"
const info = bookableInfo(productDoc)          // null if the product is not an enabled, published appointment
{info && <BookingWidget product={info} checkoutHref="/checkout" loginHref="/login" loginRedirectParam="redirect" />}

// member area, e.g. /access/termine (the confirmation emails link there)
<MyBookings payload={payload} user={user} />
```

Tailwind must see the plugin's classes: `@source "…/node_modules/@daugtcom/payload-booking/src/ui";` in the site's CSS. The look comes from the theme tokens (`primary-*`, `neutral-*`, `font-display`); the calendar is react-day-picker v9 styled only through `classNames` (`SlotPicker` takes a `classNames` prop to override single keys, `calendarClassNames` holds the defaults).

## How it works

- **Slots** are computed on the server (`computeSlots`, pure): opening hours in the plugin time zone (DST safe), minus busy calendar time, minus other bookings. The appointment must fit into an opening window; its pauses may stick out. Pauses count as occupied time, so neighbours can never sit closer than the pause.
- **Busy calendars**: read-only ICS (`https:` or `file:`), cached 5 minutes. Recurring events (RRULE, EXDATE, moved occurrences), all-day events and zones the file does not define are handled; cancelled and "free" events do not block. A failing calendar counts as "nothing busy" and logs a warning.
- **Hold**: `POST /api/booking/hold` checks the slot again, computes the price from the product and the options (never from the client), creates a `held` booking for `holdMinutes` (default 35) and adds a cart line `{ product, quantity: 1, meta: { bookingID } }` server-side. Choosing another time for the same service replaces the first choice; at most three other holds per member.
- **No double booking**: a Postgres exclusion constraint on `(resource, tstzrange(block_start, block_end))` for `held`/`confirmed` bookings. `onInit` applies it idempotently (it needs the `btree_gist` extension, which a database owner can create). With migrations, add `exclusionConstraintSql('bookings')` to a migration as well.
- **Checkout**: commerce asks line resolvers to price a cart line. Booking registers one (via `config.custom.daugtCommerceLineResolvers`), so the Stripe line carries the booking's price, a title with the date, and `product_data.metadata.bookingID`. Starting checkout re-takes an expired hold if the slot is still free and extends it by another `holdMinutes`; if somebody else has the slot, checkout fails with a clear message.
- **Paid**: an `afterChange` hook on `orders` confirms the bookings that are lines of the paid cart (idempotent), creates the video session for online appointments (once), and sends the confirmation (with `.ics`) and a note to the host. A payment that arrives after the hold ran out is honoured if the slot is still free; otherwise the booking is flagged `needsAttention` and the host is told. The order itself never fails because of a booking.
- **Cancel / reschedule**: free until `cancellationHours` before the start (staff always). Cancelling a paid booking sets `refundNeeded`; the refund itself is done by hand in Stripe.

## Options

| Option | Default | |
|---|---|---|
| `usersSlug` / `productsSlug` / `bookingsSlug` | `users` / `products` / `bookings` | |
| `isStaff` | `roles` includes `admin` | |
| `timezone` | `Europe/Vienna` | opening hours, exceptions and emails |
| `holdMinutes` | 35 (minimum 30) | Stripe sessions cannot expire sooner |
| `busyCalendars` | `[]` | `{ url, name? }[]`: fixed "busy" calendars from code. Owners can also add calendars in the admin (global "Terminkalender", `settingsSlug`), each as **busy** (events block, weekly hours decide) or **available** (only the events are bookable; weekly hours are ignored; "free"-marked events count too) |
| `busyCacheSeconds` | 300 | |
| `live` | none | `{ createSession, updateSession?, cancelSession?, joinHref? }` |
| `hostUserIds` | users with the `admin` role | hosts of online appointments, recipients of notes |
| `email` | `true` | confirmation, cancellation, host notes through `payload.sendEmail` |
| `serverURL`, `siteName` | Payload `serverURL`, none | links and signature in emails |

## Endpoints

| | |
|---|---|
| `GET /api/booking/slots?product&from&to&options` | public, free starts (max. 62 days) |
| `POST /api/booking/hold` `{ product, start, options? }` | login; reserves and puts into the cart |
| `POST /api/booking/release` `{ bookingID }` | login; drops an unpaid hold and its cart line |
| `POST /api/booking/cancel` `{ bookingID }` or `{ cancelToken }` | |
| `POST /api/booking/reschedule` `{ bookingID \| cancelToken, start }` | |
| `GET /api/booking/mine` | login |

Errors are `{ error: code }`: `login-required` 401, `slot-taken` / `slot-unavailable` 409, `too-many-holds` 429, `too-late` 403, `not-bookable` / `not-found` 404, `unknown-option` 400.

## Exported API

`payloadBooking(options)`, `bookableInfo(doc)`, `bookableOf(doc)`, `priceOf(bookable, optionIds)`, `computeSlots(input)`, `blockOf(...)`, `parseBusy(ics, from, to, zone)`, `loadBusy`, `fetchIcs`, `buildIcs(event)`, `exclusionConstraintSql(table)`, `applyExclusionConstraint(payload, slug)`, `availableSlots`, `holdSlot`, `releaseHold`, `cancelBooking`, `rescheduleBooking`, `confirmForOrder`, `ensureHeld`, `BookingError`. UI (`/ui`): `BookingWidget`, `SlotPicker`, `BookingOptions`, `MyBookings`, `CancelBookingButton`, `calendarClassNames`.

## Development fixture

`fixtures/busy.ics` is a fake calendar: every Tuesday 10:00–12:00 (Europe/Vienna), Thursdays 14:00–15:00 (except 15 Jan 2026), a doctor's appointment on 4 Nov 2026, an all-day holiday on 26 Nov 2026 and a "free" event that does not block. Use it with `busyCalendars: [{ url: pathToFileURL('…/fixtures/busy.ics').href }]`.

## Limits (first version)

- One person per appointment (no group capacity), one calendar per `resource`.
- Busy time is read from ICS only; no write-back to Google Calendar (that needs OAuth).
- Refunds are manual; the booking is flagged.
- The cart drawer shows the product's base price for an appointment line; the checkout (Stripe) and the order use the real price including options.
- Reminders are not sent yet (use the jobs queue; `bookings.start` and `status` are indexed for it).
