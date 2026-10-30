# @daugtcom/payload-commerce

Subscriptions, shipping, invoices and the entitlement bridge on top of `@payloadcms/plugin-ecommerce`.

## Optional access integration

Commerce runs without payload-access. To grant access on purchase, install payload-access and pass the explicit bridge after registering payloadAccess:

```ts
import { commerceAccessBridge } from '@daugtcom/payload-commerce/access'

payloadCommerce({ accessTargets: ['courses', 'lessons'], accessBridge: commerceAccessBridge })
```

Paid order entitlements retain their original access windows when a product or order is edited. A paid order's buyer, purchased products and payment date cannot be changed while access integration is enabled. New entitlements record the purchased product so subscription cancellation can end its grants even after the product's access rules change. Existing entitlements without this provenance use their product's current rules for cancellation; review older subscriptions whose rules have been removed. Deployments using database migrations must add the new nullable `purchasedProduct` relationship to the entitlements collection before enabling this version.

The booking plugin extends commerce products, carts, and orders and therefore requires commerce. Its live-call integration is a separate optional bridge.

## UI (`@daugtcom/payload-commerce/ui`)

Optional React components for a Next.js site. They render page bodies only: the layout, headings and design of the page are the site's.

- **Styling:** Tailwind v4 utility classes using the tokens `primary-*`, `secondary-*` and `neutral-*`. Define those tokens in your theme and let Tailwind scan the components: `@source "../../node_modules/@daugtcom/payload-commerce/src/ui";` (adjust the path to your CSS file). Each component with a `className` prop lets you replace its button styling.
- **Text:** `locale` (`'de' | 'en'`, default `'de'`) on every component.
- **Peers:** `next`, `react`; the checkout uses `@stripe/react-stripe-js` and `@stripe/stripe-js` (installed with the plugin). It needs the plugin's `stripe` option (embedded form is the default, `uiMode: 'hosted'` switches back).

| Export | Kind | Props |
| --- | --- | --- |
| `CommerceProvider` | client | `userID: string \| number \| null`, `children`; wrap the site layout once |
| `CartButton` | client | `loggedIn`, `locale?`, `className?`, `children?` (the icon), `loginHref?='/login'`, `checkoutHref?='/checkout'`, `productHref?(slug)` |
| `AddToCartButton` | client | `productID`, `loggedIn`, `external?` (link instead of cart), `locale?`, `className?`, `label?`, `loginHref?` |
| `CheckoutPage` | client | `publishableKey`, `loggedIn`, `locale?`, `loginHref?`, `shopHref?`, `appearance?` (Stripe appearance; defaults come from the site's theme tokens `--color-primary-600`, `--color-neutral-800`, body background and font); mounts Stripe's embedded form and prices shipping for the entered address |
| `ConfirmOrder` | client | `locale?`; place it on the success page (reads `session_id`) |
| `BillingPortalButton` | client | `locale?`, `className?`, `children?` |
| `OrdersView` | server | `payload`, `user: { id }`, `locale?`, `usersSlug?='users'`, `entitlementsSlug?='entitlements'`, `hrefs?: { shop, course(slug), post(slug), product(slug) }` (defaults `/shop`, `/access/course/<slug>/all`, `/post/<slug>`, `/shop/<slug>`), `showBillingButton?`, `invoiceHref?(id)`, `page?` (the `?page=` value), `pageHref?(n)`; 20 orders per page |
| `OrdersList` | server | alias of `OrdersView` |
| `RecentOrders` | server | `payload`, `user: { id }`, `locale?`, `usersSlug?`, `hrefs?: { orders }` (default `/access/orders`), `limit?=5`; dashboard card, pass it into the member dashboard as a slot |
| `productPriceLabel(product, locale?)`, `euro(cents, locale?)`, `formatDate(iso, locale?)` | helpers | |
| `CART_EVENT`, `notifyCart()` | helpers | presentation event that opens the cart drawer |

A site composes them: the checkout route renders `<CheckoutPage publishableKey={process.env.STRIPE_PUBLISHABLE_KEY!} loggedIn locale />`, the success route `<ConfirmOrder />`, the orders route `<OrdersView payload={payload} user={user} page={searchParams.page} />`.

`OrdersView` reads orders and invoices with the member's own rights (`overrideAccess: false`), and entitlements only for that member's fetched orders. Each order card has status, total and a `<details>` with addresses (`shippingAddress`, `billingAddress`), items, what a paid order unlocked (entitlement target and `validityStart`/`validityEnd`) and invoices. Invoices with a `stripeInvoiceID` link to Stripe's `hosted_invoice_url` (3 s timeout); without Stripe, on error or for uploaded legacy invoices the link is `/api/commerce/invoices/<id>/pdf`.

Wrap the site layout in `<CommerceProvider userID={user?.id ?? null}>`. The shared provider configures EUR, populated product metadata and the `stripe-checkout` payment descriptor. Payload's `useCart` owns all cart reads and mutations; remove buttons use cart row IDs. Guest buying stays disabled in the UI and on the server.

The provider restores the member's latest unpurchased cart through the customer `cart` join. It disables browser cart-ID persistence so a reload cannot restore another user's cart or a purchased cart. Changing `userID` replaces the provider. Passwordless login navigates to a fresh page, which restores the authenticated cart; logout controls call `useCommerceSession().logout()` before navigating. Window focus restores the server's active cart, including purchases completed in another tab. After confirmation, `restore()` discards provider references and restores the current active cart without editing the order's purchased cart.

Checkout uses `usePayments().initiatePayment`. The return page calls the confirmation endpoint with the session identifier directly because Payload's payment hook requires and injects the current active cart. The authenticated endpoint resolves the original transaction cart from `session_id`, including delayed returns after the active cart changes. No cart cookie or browser cart mirror is needed.
