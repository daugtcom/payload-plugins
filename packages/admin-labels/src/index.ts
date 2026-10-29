import type { CollectionConfig, GlobalConfig, Plugin } from 'payload'

type Labels = NonNullable<CollectionConfig['labels']>
type Label = NonNullable<GlobalConfig['label']>
const names = (de: string, dePlural: string, en: string, enPlural: string): Labels => ({ singular: { de, en }, plural: { de: dePlural, en: enPlural } })
const collections: Record<string, Labels> = {
  users: names('Benutzer', 'Benutzer', 'User', 'Users'), media: names('Medium', 'Medien', 'Media item', 'Media'),
  pages: names('Seite', 'Seiten', 'Page', 'Pages'), blog: names('Blogbeitrag', 'Blogbeiträge', 'Blog post', 'Blog posts'), blogCategories: names('Blogkategorie', 'Blogkategorien', 'Blog category', 'Blog categories'),
  courses: names('Kurs', 'Kurse', 'Course', 'Courses'), lessons: names('Beitrag', 'Beiträge', 'Post', 'Posts'), posts: names('Beitrag', 'Beiträge', 'Post', 'Posts'), sections: names('Abschnitt', 'Abschnitte', 'Section', 'Sections'),
  comments: names('Kommentar', 'Kommentare', 'Comment', 'Comments'), reactions: names('Reaktion', 'Reaktionen', 'Reaction', 'Reactions'), notificationLog: names('Benachrichtigung', 'Benachrichtigungen', 'Notification', 'Notifications'), notificationSubscriptions: names('Benachrichtigungsabo', 'Benachrichtigungsabos', 'Notification subscription', 'Notification subscriptions'), entitlements: names('Zugang', 'Zugänge', 'Entitlement', 'Entitlements'),
  products: names('Produkt', 'Produkte', 'Product', 'Products'), carts: names('Warenkorb', 'Warenkörbe', 'Cart', 'Carts'), orders: names('Bestellung', 'Bestellungen', 'Order', 'Orders'), transactions: names('Transaktion', 'Transaktionen', 'Transaction', 'Transactions'), addresses: names('Adresse', 'Adressen', 'Address', 'Addresses'), variants: names('Variante', 'Varianten', 'Variant', 'Variants'), variantTypes: names('Variantenart', 'Variantenarten', 'Variant type', 'Variant types'), variantOptions: names('Variantenoption', 'Variantenoptionen', 'Variant option', 'Variant options'),
  shippingSizes: names('Versandgröße', 'Versandgrößen', 'Shipping size', 'Shipping sizes'), shopCategories: names('Shopkategorie', 'Shopkategorien', 'Shop category', 'Shop categories'), invoices: names('Rechnung', 'Rechnungen', 'Invoice', 'Invoices'), invoiceExports: names('Rechnungsexport', 'Rechnungsexporte', 'Invoice export', 'Invoice exports'),
  bookings: names('Termin', 'Termine', 'Appointment', 'Appointments'), liveSessions: names('Live-Termin', 'Live-Termine', 'Live session', 'Live sessions'), newsletters: names('Newsletter', 'Newsletter', 'Newsletter', 'Newsletters'), newsletterSubscribers: names('Abonnent:in', 'Abonnent:innen', 'Subscriber', 'Subscribers'), newsletterDeliveries: names('Zustellung', 'Zustellungen', 'Delivery', 'Deliveries'),
  impersonationLog: names('Anmeldung als Mitglied', 'Anmeldungen als Mitglied', 'Impersonation', 'Impersonations'), loginChallenges: names('Anmeldeanfrage', 'Anmeldeanfragen', 'Login challenge', 'Login challenges'),
}
const globals: Record<string, Label> = { navigation: { de: 'Navigation', en: 'Navigation' }, siteSettings: { de: 'Website-Einstellungen', en: 'Site settings' }, commerceSettings: { de: 'Shop-Einstellungen', en: 'Shop settings' }, bookingSettings: { de: 'Termineinstellungen', en: 'Booking settings' } }
const groups: Record<string, Label> = { Content: { de: 'Inhalte', en: 'Content' }, Courses: { de: 'Kurse', en: 'Courses' }, Access: { de: 'Zugang', en: 'Access' }, Engagement: { de: 'Kommunikation', en: 'Engagement' }, Ecommerce: { de: 'Shop', en: 'Shop' } }

/** Apply after other plugins. Override names for custom slugs or site terminology. */
export const adminLabels = (options: { collections?: Record<string, Labels>; globals?: Record<string, Label>; groups?: Record<string, Label> } = {}): Plugin => (config) => {
  const collectionNames = { ...collections, ...options.collections }
  const globalNames = { ...globals, ...options.globals }
  const groupNames = { ...groups, ...options.groups }
  const group = (value: unknown) => typeof value === 'string' ? groupNames[value] ?? value : value
  return {
    ...config,
    collections: config.collections?.map((c) => ({ ...c, ...(collectionNames[c.slug] ? { labels: collectionNames[c.slug] } : {}), ...(c.admin ? { admin: { ...c.admin, group: group(c.admin.group) as typeof c.admin.group } } : {}) })),
    globals: config.globals?.map((g) => ({ ...g, ...(globalNames[g.slug] ? { label: globalNames[g.slug] } : {}), ...(g.admin ? { admin: { ...g.admin, group: group(g.admin.group) as typeof g.admin.group } } : {}) })),
  }
}
