# @daugtcom/payload-access

Entitlements, series (courses → sections → lessons), policies and engagement (comments, reactions) for Payload. See `ARCHITECTURE.md` in the repository root for the data model.

## UI (`@daugtcom/payload-access/ui`)

Page **bodies** for the member area and course pages. No shell, no theme: your site wraps them in its own layout.

- Styled with Tailwind v4 utility classes using the tokens `primary-*`, `secondary-*` and `neutral-*`. Define those tokens in your theme and let Tailwind see the plugin, e.g. in your CSS: `@source "../node_modules/@daugtcom/payload-access/src/ui";`. Add `@daugtcom/payload-access` to `transpilePackages` in `next.config`.
- `locale` (`'de' | 'en'`, default `'de'`) on every component. Link targets are overridable through `hrefs` (defaults: `/post/<slug>`, `/access/course/<course>/<section>`, `/access`, `/shop`, `/access/orders`, `/access/account`).
- Images use `mediaSrc` (set `NEXT_PUBLIC_MEDIA_PLACEHOLDER=1` to get generated pictures from your `/placeholder?seed=` route); pass `imageSrc` to replace it.

| Export | Kind | Props / use |
| --- | --- | --- |
| `MemberDashboard` | server | `{ payload, user, locale?, singlesSlug?, hrefs?, aside?, slugs?, containerClass?, refreshSeconds?, imageSrc? }` the start page incl. heading and tabs: courses as cards (picture, state, "all posts", sections, newest posts), single purchases, profile card. `aside` is a slot under the profile, e.g. `<RecentOrders/>` of the commerce package. Staff see every published course. |
| `CourseSection` | server | `{ payload, user, courseSlug, sectionSlug, page?, q?, locale?, emojis?, hrefs?, imageSrc?, slugs?, containerClass?, refreshSeconds? }` one course: `sectionSlug="all"` lists all posts, newest first; tabs, search (`q`), the course email switch, the participants' posts mixed in (with a writing box in sections that allow them), paging (`?page=`). Calls `notFound()` for unknown course/section, shows `NoAccess` without an entitlement window. |
| `PostFooter` | server | `{ payload, user, target, course?, emojis?, locale?, hrefs? }` what belongs under a post: reactions to the post, the way back to the course, the discussion. |
| `MemberShell` | server | `{ active?, title, lead?, back?, actions?, children, locale?, hrefs?, containerClass? }` heading + tabs (Übersicht / Bestellungen / Konto) for member pages the site builds itself (orders, account). |
| `NoAccess` | server | `{ locale?, shopHref? }` |
| `loadDashboard`, `loadCourseFeed`, `loadReactionState` | server | the data behind the pages, for sites that want their own layout |
| `loadComments` | server | `(payload, target, user, { staff?, usersSlug?, renderBody? })` comment tree (with pictures and blanked comments) |
| `getItemAccess` | server | `(payload, user, target)` → `{ canView, canComment, canReact }` |
| `CommentSection` | client | `{ target, comments, canComment, canReact, emojis, locale?, title?, allowAnonymous?, allowImages? }` count, writing box, thread (replies, reactions, pictures with lightbox, delete with confirmation) |
| `CommentThread`, `Reactions` (`ReactionBar`), `Composer` | client | the parts of the above: `Composer` is the editor (bold / italic / strikethrough / lists, up to 5 pictures, anonymous) |
| `SearchBox`, `SubscribeToggle`, `ImpersonationBanner`, `AutoRefresh` | client | search field, course email switch, banner for staff viewing as a member, 10 s refresh that never interrupts typing |
| `PlyrPlayer` | client | `{ kind: 'video' \| 'audio', src, maxHeight?, noDownload?, className? }` |
| `PdfViewerButton` | client | `{ src, label?, className?, locale? }` canvas viewer (pdfjs), no download button |
| `formatDate`, `mediaSrc`, `isStaffUser`, `defaultHrefs` | helpers | |

Peer dependencies of the UI: `lucide-react`, `@payloadcms/richtext-lexical` (the editor uses its Lexical re-exports).

## Engagement endpoints

Enabled by `payloadAccess({ engagement: { emojis, mediaSlug?, maxImages?, maxImageMB? } })`. **Without the `engagement` option none of these exist and every call answers 404.**

| Endpoint | |
| --- | --- |
| `POST /api/engagement/comments` | `{ target, text, anonymous?, media? }`. `text` is rebuilt from an allow-list (paragraphs, line breaks, bold / italic / strikethrough, lists; ≤ 10 000 characters), links and uploads are dropped. `media` ids must be the member's own uploads (`userUpload`, `uploadedBy`), at most `maxImages` (5). |
| `POST /api/engagement/uploads` | multipart `file`: JPG / PNG / GIF / WebP up to `maxImageMB` (10), type checked on the real bytes, stored in `mediaSlug` (default `media`, needs the fields `userUpload` and `uploadedBy`) with the member's own rights, so a protected media collection simply refuses; 30 per hour. |
| `DELETE /api/engagement/comments/:id` | author or staff. A comment with replies is blanked (`deleted: true`, text and pictures removed, replies stay); one without disappears with its reactions and the member's pictures. |
| `POST /api/engagement/reactions` | `{ target, emoji }` toggles / replaces, answers with the new counts. |
| `POST /api/access/notifications/subscribe` | `{ courseId, subscribed? }` the course email switch; needs access to the course. |

**Where members' pictures go:** into the site's media collection (`mediaSlug`), flagged `userUpload: true` and `uploadedBy`, and into the bucket folder `user-uploads` (`engagement.uploadPrefix`; only when the collection has a `prefix` field, as with the S3 adapter). Avatars (passwordless `profile.mediaSlug`) are stored the same way. To keep them out of the picture pickers for pages, products and settings while they stay in the media list, add `hideMemberUploads()` as the last plugin (it sets `filterOptions: MEMBER_UPLOADS_FILTER` on every upload field that points to the media collection, except `avatar`); give upload fields inside rich-text blocks `filterOptions: MEMBER_UPLOADS_FILTER` yourself.

Schema additions: `comments.deleted` (checkbox). Sites on an existing database need that column (Payload's dev push adds it; production needs a migration).

`user` is the signed-in member (`{ id, roles? }`); `isStaff` defaults to `roles` including `admin`.
