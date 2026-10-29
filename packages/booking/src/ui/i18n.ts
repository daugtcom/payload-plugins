export type Locale = 'de' | 'en'

const dict = {
  de: {
    pickDay: 'Tag wählen', pickTime: 'Uhrzeit wählen', times: 'Freie Zeiten', timesIn: (tz: string) => `Alle Zeiten in deiner Zeitzone (${tz})`,
    loading: 'Freie Termine werden geladen …', noSlotsMonth: 'In diesem Monat ist nichts mehr frei.', noSlotsAtAll: 'Aktuell sind keine Termine frei. Schreib mir gern kurz, dann finden wir einen.', chooseDay: 'Wähle links einen Tag, an dem noch etwas frei ist.',
    reserve: 'Termin reservieren', reserving: 'Wird reserviert …', reservedHint: 'Der Termin ist für dich reserviert, du bezahlst im nächsten Schritt.', loginToReserve: 'Zum Reservieren anmelden',
    options: 'Auswahl', duration: (m: number) => `${m} Minuten`, total: 'Gesamt', priceFrom: 'inkl. MwSt.', free: 'kostenlos',
    errTaken: 'Dieser Termin wurde gerade vergeben. Bitte wähle einen anderen.', errTooMany: 'Du hast schon mehrere Reservierungen offen. Bitte schließe zuerst eine Buchung ab oder entferne sie aus dem Warenkorb.', errGeneric: 'Das hat nicht geklappt. Bitte versuche es noch einmal.',
    location: { online: 'Online, per Video im Mitgliederbereich', phone: 'Telefon', inperson: 'Vor Ort' },
    cancelUntil: (h: number) => `Kostenlos stornierbar bis ${h} Stunden vorher.`,
    myBookings: 'Meine Termine', upcoming: 'Anstehend', past: 'Vergangen', none: 'Du hast noch keine Termine.', bookOne: 'Zum Shop',
    status: { held: 'Reserviert, noch nicht bezahlt', confirmed: 'Bestätigt', cancelled: 'Abgesagt', completed: 'Stattgefunden', no_show: 'Nicht wahrgenommen', expired: 'Abgelaufen' },
    join: 'Zum Videoanruf', watchRecording: 'Aufnahme ansehen', toCheckout: 'Zur Kasse', cancel: 'Absagen', cancelConfirm: 'Termin wirklich absagen?', cancelYes: 'Ja, absagen', cancelNo: 'Behalten', cancelled: 'Der Termin ist abgesagt.', tooLate: 'Eine kostenlose Absage ist nicht mehr möglich. Bitte schreib mir direkt.',
    needsAttention: 'Bei diesem Termin müssen wir noch etwas klären. Wir melden uns bei dir.', refund: 'Die Rückerstattung veranlassen wir in Kürze.',
  },
  en: {
    pickDay: 'Pick a day', pickTime: 'Pick a time', times: 'Free times', timesIn: (tz: string) => `All times in your time zone (${tz})`,
    loading: 'Loading free slots …', noSlotsMonth: 'Nothing is free this month.', noSlotsAtAll: 'There are no free slots right now. Drop me a line and we will find one.', chooseDay: 'Choose a day that still has free times.',
    reserve: 'Reserve appointment', reserving: 'Reserving …', reservedHint: 'The slot is reserved for you, you pay in the next step.', loginToReserve: 'Log in to reserve',
    options: 'Options', duration: (m: number) => `${m} minutes`, total: 'Total', priceFrom: 'incl. VAT', free: 'free',
    errTaken: 'That slot was just taken. Please choose another.', errTooMany: 'You already have several reservations open. Please finish one booking first or remove it from your cart.', errGeneric: 'That did not work. Please try again.',
    location: { online: 'Online, by video in the member area', phone: 'Phone', inperson: 'In person' },
    cancelUntil: (h: number) => `Free cancellation up to ${h} hours before.`,
    myBookings: 'My appointments', upcoming: 'Upcoming', past: 'Past', none: 'You have no appointments yet.', bookOne: 'Go to the shop',
    status: { held: 'Reserved, not paid yet', confirmed: 'Confirmed', cancelled: 'Cancelled', completed: 'Completed', no_show: 'No show', expired: 'Expired' },
    join: 'Join the video call', watchRecording: 'Watch recording', toCheckout: 'Go to checkout', cancel: 'Cancel', cancelConfirm: 'Cancel this appointment?', cancelYes: 'Yes, cancel', cancelNo: 'Keep it', cancelled: 'The appointment was cancelled.', tooLate: 'Free cancellation is no longer possible. Please contact me directly.',
    needsAttention: 'We still have to sort something out for this appointment. We will get in touch.', refund: 'We will arrange the refund shortly.',
  },
} as const

export const t = (locale: Locale = 'de') => dict[locale]
export const euro = (cents: number, locale: Locale = 'de') => new Intl.NumberFormat(locale === 'de' ? 'de-AT' : 'en-GB', { style: 'currency', currency: 'EUR' }).format(cents / 100)
