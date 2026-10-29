# @daugtcom/payload-live

Live video calls for Payload sites: a scheduled room on [LiveKit](https://livekit.io), joined with a token the server only hands out after an access check, and a call UI that takes the site's own look (Tailwind tokens `primary-*`, `neutral-*`, `font-display`). No LiveKit stylesheet is used.

Two ways into a call, one engine:

| | Group call | Direct call (1:1) |
|---|---|---|
| Created by | a `liveCall` block in a document's rich text | `getLive(payload).createDirectSession(...)`, e.g. from a booking |
| Who may join | whoever `authorizeGroup` allows (wire it to the document's access rules), staff always | the listed participants, hosts, staff |
| Who talks | `allowSpeak`: everyone / hand-raise / host only | both |
| Where | inside the post | a page of your choice (`/live/[id]` in the Margaretha site) |

## Setup

```ts
// payload.config.ts
import { getAccess } from '@daugtcom/payload-access'
import { payloadLive } from '@daugtcom/payload-live'

payloadLive({
  livekit: { url: env.LIVEKIT_URL /* ws(s)://… */, apiKey: env.LIVEKIT_API_KEY, apiSecret: env.LIVEKIT_API_SECRET },
  sourceCollections: ['lessons', 'posts'],            // collections whose rich text may hold the block
  authorizeGroup: ({ payload, user, collection, id }) => getAccess(payload).can('view', user, { relationTo: collection, value: id }),
})
```

Add the block to the site's rich-text editor: `import { liveCallBlock } from '@daugtcom/payload-live'`.

Render it (client component; the room itself loads lazily after joining):

```tsx
import { LiveCall } from '@daugtcom/payload-live/ui'
// in the block renderer: the block needs to know its document
<LiveCall source={{ collection, id, blockId: fields.id }} title={fields.title} description={fields.description} startsAt={iso} endsAt={iso} isHost={isStaff} />
// a direct call
<LiveCall source={{ sessionId }} title=… startsAt=… endsAt=… />
```

Tailwind: add `@source "…/node_modules/@daugtcom/payload-live/src/ui";` to the site's CSS and `@daugtcom/payload-live` to `transpilePackages`.

## What the server does

- `POST /api/live/join` `{ source }` or `{ sessionId }`: login → access rule → time window (members enter `opensMinutesBefore` (10) before the start until `closesMinutesAfter` (30) after the planned end, staff/hosts any time) → capacity → a signed LiveKit token. Group sessions are created (and kept in step with the block's title/time) on the first join.
- `POST /api/live/moderate` `{ sessionId, identity, action }`: hosts only: `mute`, `remove`, `allow-speak`, `revoke-speak`, `end`.
- Collection `liveSessions` (title, kind, status, times, room, hosts, participants, source, `record`, `recordings`). Members can read the sessions they take part in.
- Recording, see below: `POST /api/live/record`, `POST /api/live/webhook`, `GET /api/live/recording/:sessionId/:egressId`, and the moderate actions `record-start`, `record-stop`, `sync`.

## Develop locally

```sh
docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp livekit/livekit-server --dev --bind 0.0.0.0 --node-ip 127.0.0.1
# LIVEKIT_URL=ws://localhost:7880  LIVEKIT_API_KEY=devkey  LIVEKIT_API_SECRET=secret
```

Tests (`npx vitest run`) use the scratch Postgres and a fake room service; no LiveKit server needed. For a real call test open two browsers (Chrome with `--use-fake-device-for-media-stream`).

## Recordings

LiveKit **Egress** records the room (an MP4 of the whole call, layout `speaker` or `grid`) and uploads it to an S3-compatible bucket (AWS S3, Cloudflare R2, Hetzner, MinIO). The plugin starts it, keeps track of it on the session, and hands members a short-lived signed link, so the bucket stays private.

```ts
payloadLive({
  livekit: { … },
  recording: { storage: { bucket, region, endpoint /* R2, Hetzner, MinIO */, accessKey, secret }, layout: 'speaker', signedUrlSeconds: 900 },
})
```

- **Which calls are recorded:** the `Aufzeichnen` checkbox on the `liveCall` block (default off), or `createDirectSession({ …, record: true })` / `liveBookingBridge({ record: true })` for 1:1 calls. The host can also start and stop in the room (record button next to the microphone).
- **Everybody knows:** while the room is recorded everybody sees a red `Aufnahme` label, and the lobby of a recorded call says so before joining (`LiveCall` prop `record`).
- **How it starts:** the first person in starts it. Either LiveKit's `participant_joined` webhook does it, or the room itself asks (`/api/live/record`, once connected), whichever comes first; one file however many ask. Egress needs the room to exist, so it never starts before somebody is in.
- **Status:** each recording is a row in `liveSessions.recordings` (`starting → recording → processing → ready | failed`, plus start/end, duration, size, file key). Egress reports through the webhook. Without a webhook (local development) the status is pulled whenever somebody opens the overview, the player or the stream link, and with the host's `sync` action.
- **Who may watch:** exactly who may join: staff and hosts, the participants of a 1:1 call, and for group calls whoever `authorizeGroup` lets read the lesson. The check runs on every playback link request.
- **Admin:** the `Live-Termine` list has an `Aufnahmen` column with a play button per finished recording; the same on the session.
- **Members:** `import { LiveRecordings, RecordingPlayer, canWatchRecording } from '@daugtcom/payload-live/ui'`. `<LiveRecordings payload user watchHref />` lists the recordings a member may see (server component); `<RecordingPlayer sessionId egressId />` is a plain video element; call `canWatchRecording` first on a player page. Margaretha's site: `/access/aufnahmen` and `/access/aufnahmen/[sessionId]/[egressId]`.
- **Admin import map:** the admin column is a component (`@daugtcom/payload-live/admin#RecordingLinks`), so run `payload generate:importmap` once after adding the plugin.

### Server setup

1. **Webhook:** point LiveKit at the site: `webhook: { api_key, urls: ['https://your-site/api/live/webhook'] }` in the LiveKit server config (LiveKit Cloud: Settings → Webhooks). The request is signed with the API secret; the plugin verifies it.
2. **Egress** (self-hosted): a `livekit/egress` container next to the LiveKit server, both on the same Redis. See `docker/livekit.yaml`, `docker/egress.yaml` and `docker/docker-compose.recording.yml` (LiveKit + Redis + Egress + MinIO for local tests). Egress needs `SYS_ADMIN` and `shm_size: 1gb`, and roughly 2 CPU cores per recording at 1080p. LiveKit Cloud has Egress built in (billed by minute); then only the bucket and the webhook are needed.
3. **Bucket:** private; the plugin only reads it (signed links), Egress writes it with the same key. Files land under `<prefix><room>/<time>.mp4` (prefix default `recordings/`).
4. **Consent:** the plugin shows the notice and the indicator; the privacy policy of the site should mention recordings and how long they are kept (there is no automatic deletion yet).

Margaretha's site reads `LIVEKIT_RECORDING_BUCKET / _REGION / _ENDPOINT / _ACCESS_KEY / _SECRET` (and optionally `LIVEKIT_EGRESS_URL`); no bucket = no recording.

## Not yet

Replay as a lesson, automatic deletion after N days, recording only the screen share, breakout rooms, polls, waiting room, reminders by email.
