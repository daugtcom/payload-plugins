/** Where the resolved options live in `config.custom`, for server components and endpoints. */
export const NEWSLETTER_CUSTOM_KEY = 'daugtNewsletter'

export const SUBSCRIBER_STATUSES = ['pending', 'confirmed', 'unsubscribed', 'bounced', 'complained'] as const
export type SubscriberStatus = (typeof SUBSCRIBER_STATUSES)[number]

export const NEWSLETTER_STATUSES = ['draft', 'scheduled', 'sending', 'sent'] as const
export type NewsletterStatus = (typeof NEWSLETTER_STATUSES)[number]

export const DELIVERY_STATUSES = ['queued', 'sending', 'sent', 'failed'] as const
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number]

export const CONSENT_SOURCES = ['form', 'import', 'manual'] as const
export type ConsentSource = (typeof CONSENT_SOURCES)[number]
