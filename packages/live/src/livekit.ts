import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { AccessToken, EgressClient, EgressStatus, EncodedFileOutput, EncodedFileType, RoomServiceClient, S3Upload, type EgressInfo } from 'livekit-server-sdk'
import type { EgressInfoLite, EgressService, EgressState, LiveKitOptions, RecordingOptions, RecordingSigner, RoomService } from './options'

const apiUrl = (o: LiveKitOptions) => o.apiUrl ?? o.url.replace(/^ws/, 'http')

export function roomServiceFor(o: LiveKitOptions): RoomService {
  const c = new RoomServiceClient(apiUrl(o), o.apiKey, o.apiSecret)
  return {
    listParticipants: (room) => c.listParticipants(room) as never,
    mutePublishedTrack: (room, identity, sid, muted) => c.mutePublishedTrack(room, identity, sid, muted),
    removeParticipant: (room, identity) => c.removeParticipant(room, identity),
    updateParticipant: (room, identity, metadata, permission) => c.updateParticipant(room, identity, metadata, permission),
    deleteRoom: (room) => c.deleteRoom(room),
  }
}

export interface JoinGrant { room: string; identity: string; name: string; role: 'host' | 'guest' | 'viewer'; canPublish: boolean; ttlSeconds: number }

/** A signed join token. Nothing goes over the network; LiveKit checks the signature when the browser connects. */
export async function mintToken(o: LiveKitOptions, g: JoinGrant): Promise<string> {
  const at = new AccessToken(o.apiKey, o.apiSecret, { identity: g.identity, name: g.name, ttl: g.ttlSeconds, metadata: JSON.stringify({ role: g.role }) })
  at.addGrant({ roomJoin: true, room: g.room, canSubscribe: true, canPublish: g.canPublish, canPublishData: true, canUpdateOwnMetadata: true })
  return at.toJwt()
}

const cap = (b: bigint | number | undefined | null) => (b === undefined || b === null ? undefined : Number(b))
const stateOf = (status: number): EgressState => (status === EgressStatus.EGRESS_STARTING ? 'starting' : status === EgressStatus.EGRESS_ACTIVE ? 'active' : status === EgressStatus.EGRESS_ENDING ? 'ending' : status === EgressStatus.EGRESS_COMPLETE ? 'complete' : 'failed')
const nsToDate = (ns: bigint | number | undefined | null) => (ns ? new Date(Number(BigInt(ns) / 1_000_000n)) : undefined)

/** LiveKit's egress report in the plugin's own words (used by the REST calls and by the webhook). */
export function egressInfoLite(i: EgressInfo): EgressInfoLite {
  const f = i.fileResults?.[0] ?? (i.result?.case === 'file' ? i.result.value : undefined)
  const dur = cap(f?.duration)
  return {
    egressId: i.egressId,
    roomName: i.roomName,
    state: stateOf(i.status),
    error: i.error || undefined,
    startedAt: nsToDate(i.startedAt),
    endedAt: nsToDate(i.endedAt),
    file: f && f.filename ? { key: f.filename, sizeBytes: cap(f.size), durationSeconds: dur ? Math.round(dur / 1e9) : undefined } : undefined,
  }
}

/** Starts and stops a room-composite recording (MP4) that Egress uploads straight to the configured S3 bucket. */
export function egressServiceFor(lk: LiveKitOptions, r: RecordingOptions): EgressService {
  const c = new EgressClient(r.egressApiUrl ?? apiUrl(lk), lk.apiKey, lk.apiSecret)
  const s3 = new S3Upload({ accessKey: r.storage.accessKey, secret: r.storage.secret, region: r.storage.region, bucket: r.storage.bucket, endpoint: r.storage.endpoint ?? '', forcePathStyle: r.storage.forcePathStyle ?? Boolean(r.storage.endpoint) })
  return {
    start: async (room, key) => egressInfoLite(await c.startRoomCompositeEgress(room, new EncodedFileOutput({ fileType: EncodedFileType.MP4, filepath: key, output: { case: 's3', value: s3 } }), { layout: r.layout ?? 'speaker' })),
    stop: async (id) => egressInfoLite(await c.stopEgress(id)),
    list: async (room) => (await c.listEgress({ roomName: room })).map(egressInfoLite),
  }
}

/** A short-lived link to a recording in the bucket. */
export function s3Signer(r: RecordingOptions): RecordingSigner {
  const client = new S3Client({ region: r.storage.region, endpoint: r.storage.endpoint, forcePathStyle: r.storage.forcePathStyle ?? Boolean(r.storage.endpoint), credentials: { accessKeyId: r.storage.accessKey, secretAccessKey: r.storage.secret } })
  return (key, o) =>
    getSignedUrl(client, new GetObjectCommand({ Bucket: r.storage.bucket, Key: key, ResponseContentType: 'video/mp4', ResponseContentDisposition: o.download ? `attachment; filename="${(o.filename ?? 'aufnahme').replace(/[^\w.-]+/g, '-')}.mp4"` : 'inline' }), { expiresIn: r.signedUrlSeconds ?? 900 })
}
