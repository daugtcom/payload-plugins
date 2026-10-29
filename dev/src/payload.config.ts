import { commerceAccessBridge } from '@daugtcom/payload-commerce/access'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { resendAdapter } from '@payloadcms/email-resend'
import { s3Storage } from '@payloadcms/storage-s3'
import { buildConfig, type Field } from 'payload'
import sharp from 'sharp'
import { createEngagement, createNotifications, createSeries, createSingle, payloadAccess } from '@daugtcom/payload-access'
import { createCoursePolicy } from '@daugtcom/payload-access/recipes/course-policy-payload'
import { payloadCommerce } from '@daugtcom/payload-commerce'
import { payloadPasswordless } from '@daugtcom/payload-passwordless'
import { TERMS_VERSION } from './site/constants'
import { siteEditor } from './blocks/editor'
import { blog, blogCategories, pages } from './collections/content'
import { media } from './collections/media'
import { users } from './collections/users'
import { navigation } from './globals/navigation'
import { siteSettings } from './globals/siteSettings'

/** The client sites add the importer's `legacyId` fields here; the test bench has none. */
const legacy: Field[] = []

const dir = path.dirname(fileURLToPath(import.meta.url))
const env = process.env
const serverURL = env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:3100'

const { collections: seriesCollections, series } = createSeries({
  parent: 'courses',
  items: 'lessons',
  categories: 'sections',
  parentFields: [
    { name: 'backgroundImage', type: 'upload', relationTo: 'media' },
    { name: 'allowMemberComments', type: 'checkbox', defaultValue: true },
    { name: 'allowMemberReactions', type: 'checkbox', defaultValue: true },
    ...legacy,
  ],
  itemFields: [
    { name: 'image', type: 'upload', relationTo: 'media' },
    { name: 'freeForAll', type: 'checkbox', defaultValue: false, admin: { description: 'Open to everyone with any access to the course, whatever their window.' } },
    { name: 'template', type: 'text' },
    ...legacy,
  ],
  categoryFields: [{ name: 'allowMemberPosts', type: 'checkbox', defaultValue: false }, ...legacy],
})
const posts = createSingle({ slug: 'posts', fields: [{ name: 'image', type: 'upload', relationTo: 'media' }, { name: 'template', type: 'text' }, ...legacy] })
const engagement = createEngagement({ targets: ['lessons', 'posts', 'blog', 'pages', 'sections'], mediaSlug: 'media', commentFields: [...legacy] })
const notifications = createNotifications({ targets: ['lessons', 'posts', 'blog', 'pages'], subscriptionTargets: ['courses'], logFields: legacy, subscriptionFields: legacy })

const s3 = env.S3_BUCKET
  ? s3Storage({
      collections: { media: { prefix: 'media' } }, // old keys are media/<name>.<ext>, so existing files are found as they are
      bucket: env.S3_BUCKET,
      config: {
        region: env.S3_REGION ?? 'auto',
        ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true } : {}),
        credentials: { accessKeyId: env.S3_ACCESS_KEY_ID ?? '', secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '' },
      },
    })
  : null

export default buildConfig({
  secret: env.PAYLOAD_SECRET ?? 'dev-only-change-me-dev-only-change-me',
  serverURL,
  db: postgresAdapter({ pool: { connectionString: env.DATABASE_URI } }),
  editor: siteEditor(),
  sharp,
  ...(env.RESEND_API_KEY ? { email: resendAdapter({ defaultFromAddress: env.EMAIL_FROM ?? 'noreply@example.com', defaultFromName: env.EMAIL_FROM_NAME ?? 'Demo', apiKey: env.RESEND_API_KEY }) } : {}),
  admin: { user: 'users', importMap: { baseDir: dir } },
  typescript: { outputFile: path.resolve(dir, 'payload-types.ts') },
  collections: [users(legacy), media(legacy, dir), pages(legacy), blog(legacy), blogCategories(legacy), ...seriesCollections, posts, ...engagement.collections, ...notifications.collections],
  globals: [navigation, siteSettings],
  plugins: [
    payloadAccess({
      targetCollections: ['courses', 'lessons', 'posts'],
      series: [series],
      extraFields: legacy,
      policies: createCoursePolicy(),
      memberArea: { coursesSlug: 'courses', lessonsSlug: 'lessons', singlesSlug: 'posts' },
    }),
    payloadCommerce({
      accessBridge: commerceAccessBridge, accessTargets: ['courses', 'lessons', 'posts'],
      shippingDefaults: { mode: 'dynamic', flatRate: 5, method: 'sum', allowedCountries: ['AT', 'DE', 'CH'] },
      productFields: [{ type: 'row', fields: [{ name: 'legacyStripeProductID', type: 'text', index: true }, { name: 'legacyStripePriceID', type: 'text' }] }, ...legacy],
      orderFields: legacy,
      invoiceFields: legacy,
      shopCategoryFields: legacy,
      invoiceFileUrl: env.S3_PUBLIC_URL ? (key) => `${env.S3_PUBLIC_URL!.replace(/\/$/, '')}/${key}` : undefined,
      stripe: env.STRIPE_SECRET_KEY
        ? {
            secretKey: env.STRIPE_SECRET_KEY,
            webhookSecret: env.STRIPE_WEBHOOK_SECRET,
            successUrl: `${serverURL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
            cancelUrl: `${serverURL}/shop`,
            billingPortalReturnUrl: `${serverURL}/access`,
          }
        : undefined,
    }),
    payloadPasswordless({
      terms: { version: TERMS_VERSION },
      serverURL,
      ...(env.TURNSTILE_SECRET_KEY ? { captcha: { provider: 'turnstile' as const, secretKey: env.TURNSTILE_SECRET_KEY } } : {}),
    }),
    ...(s3 ? [s3] : []),
  ],
})
