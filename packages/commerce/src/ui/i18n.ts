export type Locale = 'de' | 'en'

const dict = {
  de: {
    cartFailed: 'Der Warenkorb konnte nicht aktualisiert werden. Bitte versuche es erneut.',
    login: 'Anmelden', cart: 'Warenkorb', cartEmpty: 'Dein Warenkorb ist leer.', remove: 'Entfernen', checkout: 'Zur Kasse', addToCart: 'In den Warenkorb', moreInfo: 'Mehr Infos',
    shippingFailed: 'Versand konnte nicht berechnet werden.', checkoutFailed: 'Die Kasse konnte nicht gestartet werden.', total: 'Zwischensumme', vatIncluded: 'inkl. MwSt.', monthly: 'pro Monat', everyN: (n: number, u: string) => `alle ${n} ${u}`,
    shop: 'Shop', orderNumber: 'Bestellung', invoice: 'Rechnung', shipping: 'Versand', manageBilling: 'Zahlungen & Abos verwalten', billingFailed: 'Das Abrechnungsportal ist gerade nicht erreichbar. Bitte versuche es später noch einmal.', noOrders: 'Noch keine Bestellungen.',
    confirming: 'Wir bestätigen deine Bestellung …', confirmed: 'Deine Bestellung ist bestätigt.', confirmFailed: 'Wir bestätigen deine Bestellung gerade. Das kann einen Moment dauern, du bekommst eine E-Mail.',
    ordersTitle: 'Bestellungen', billingNotice: 'Zahlungsmittel, Abos, Rechnungsdaten und Lieferadressen verwaltest du im Abrechnungsportal von Stripe.', noOrdersTitle: 'Noch keine Bestellungen', toShop: 'Zum Shop',
    showDetails: 'Details anzeigen', hideDetails: 'Details ausblenden', inclVat: 'inkl. MwSt.', orderedOn: 'Bestellt am', detailsOf: (n: string) => `Details zur Bestellung ${n}`,
    statusPaid: 'bezahlt', statusPending: 'Zahlung ausstehend', statusFailed: 'Zahlung fehlgeschlagen', statusCancelled: 'storniert', statusRefunded: 'erstattet',
    deliveryAddress: 'Lieferadresse', billingAddress: 'Rechnungsadresse', items: 'Bestellte Artikel', quantity: 'Menge', subscription: 'Abonnement, wiederkehrende Zahlung', subscriptionManage: 'Abonnement, du verwaltest es im Abrechnungsportal',
    shipPending: 'Versand ausstehend', shipProcessing: 'Wird verpackt', shipShipped: 'Versendet', shipDelivered: 'Zugestellt',
    unlocked: 'Freigeschaltet', unlockedPending: 'Der Zugang wird freigeschaltet, sobald die Zahlung eingegangen ist', unlimited: 'unbegrenzt', untilDate: (d: string) => `bis ${d}`, fromDate: (d: string) => `ab ${d}`, unlockedIcon: 'freigeschaltet',
    invoices: 'Rechnungen', invoiceNumber: (n: string | number) => `Rechnung #${n}`, viewInvoice: 'Anzeigen', viewInvoiceLabel: (n: string | number) => `Rechnung ${n} anzeigen (neuer Tab)`,
    olderOrders: 'Ältere Bestellungen', newerOrders: 'Neuere Bestellungen', pagination: 'Seitennavigation', recentOrders: 'Letzte Bestellungen', noRecentOrders: 'Du hast noch keine Bestellung aufgegeben.', allOrders: 'Alle Bestellungen', billingPortalRegion: 'Abrechnungsportal', ordersListLabel: 'Deine Bestellungen',
  },
  en: {
    cartFailed: 'The cart could not be updated. Please try again.',
    login: 'Log in', cart: 'Cart', cartEmpty: 'Your cart is empty.', remove: 'Remove', checkout: 'Checkout', addToCart: 'Add to cart', moreInfo: 'More info',
    shippingFailed: 'Shipping could not be calculated.', checkoutFailed: 'Checkout could not be started.', total: 'Subtotal', vatIncluded: 'incl. VAT', monthly: 'per month', everyN: (n: number, u: string) => `every ${n} ${u}`,
    shop: 'Shop', orderNumber: 'Order', invoice: 'Invoice', shipping: 'Shipping', manageBilling: 'Manage payments & subscriptions', billingFailed: 'The billing portal is not available right now. Please try again later.', noOrders: 'No orders yet.',
    confirming: 'Confirming your order …', confirmed: 'Your order is confirmed.', confirmFailed: 'We are still confirming your order. This can take a moment, you will get an email.',
    ordersTitle: 'Orders', billingNotice: 'Manage subscriptions, payment methods and delivery addresses in the billing portal.', noOrdersTitle: 'No orders yet', toShop: 'Go to the shop',
    showDetails: 'Show details', hideDetails: 'Hide details', inclVat: 'incl. VAT', orderedOn: 'Ordered on', detailsOf: (n: string) => `Details of order ${n}`,
    statusPaid: 'paid', statusPending: 'Payment pending', statusFailed: 'Payment failed', statusCancelled: 'cancelled', statusRefunded: 'refunded',
    deliveryAddress: 'Delivery address', billingAddress: 'Billing address', items: 'Items', quantity: 'Quantity', subscription: 'Subscription, recurring payment', subscriptionManage: 'Subscription, manage it in the billing portal',
    shipPending: 'Shipping pending', shipProcessing: 'Being packed', shipShipped: 'Shipped', shipDelivered: 'Delivered',
    unlocked: 'Unlocked', unlockedPending: 'Access is unlocked as soon as the payment has arrived', unlimited: 'unlimited', untilDate: (d: string) => `until ${d}`, fromDate: (d: string) => `from ${d}`, unlockedIcon: 'unlocked',
    invoices: 'Invoices', invoiceNumber: (n: string | number) => `Invoice #${n}`, viewInvoice: 'View', viewInvoiceLabel: (n: string | number) => `View invoice ${n} (new tab)`,
    olderOrders: 'Older orders', newerOrders: 'Newer orders', pagination: 'Pagination', recentOrders: 'Recent orders', noRecentOrders: 'You have not placed an order yet.', allOrders: 'All orders', billingPortalRegion: 'Billing portal', ordersListLabel: 'Your orders',
  },
} as const

export const t = (locale: Locale = 'de') => dict[locale]
