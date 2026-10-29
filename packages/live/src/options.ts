import type { CollectionSlug, Payload, PayloadRequest } from 'payload'

export type Id = string | number

export interface LiveKitOptions {
  /** Address the browser connects to, `ws://` or `wss://`. */
  url: string
  /** Address the server calls for room management, `http(s)://`. Default: `url` with the scheme swapped. */
  apiUrl?: string
  apiKey: string
  apiSecret: string
}

/** The slice of LiveKit's room API the plugin uses, so tests can bring their own. */
export interface RoomService {
  listParticipants(room: string): Promise<{ identity: string; tracks: { sid: string; type: number; muted: boolean }[]; permission?: { canPublish?: boolean } | null }[]>
  mutePublishedTrack(room: string, identity: string, trackSid: string, muted: boolean): Promise<unknown>
  removeParticipant(room: string, identity: string): Promise<unknown>
  updateParticipant(room: string, identity: string, metadata: string | undefined, permission: { canPublish: boolean; canSubscribe: boolean; canPublishData: boolean; canUpdateMetadata: boolean }): Promise<unknown>
  deleteRoom(room: string): Promise<unknown>
}

/** S3-compatible storage the recordings land in (LiveKit Egress uploads there; the plugin only reads, with short-lived signed links). */
export interface RecordingStorage {
  bucket: string
  region: string
  /** Custom endpoint for MinIO, R2, Hetzner and similar. */
  endpoint?: string
  accessKey: string
  secret: string
  forcePathStyle?: boolean
  /** Folder in the bucket. Default `recordings/`. */
  prefix?: string
}

export interface RecordingOptions {
  enabled?: boolean
  storage: RecordingStorage
  /** What Egress records: `speaker` follows the active speaker, `grid` shows everybody. Default `speaker`. */
  layout?: 'speaker' | 'grid'
  /** How long a signed playback link works, in seconds. Default 900. */
  signedUrlSeconds?: number
  /** Address Egress is reached on (the LiveKit server's API). Default: the LiveKit `apiUrl`. */
  egressApiUrl?: string
}

/** What the plugin needs from LiveKit Egress, so tests can bring their own. */
export type EgressState = 'starting' | 'active' | 'ending' | 'complete' | 'failed'
export interface EgressInfoLite {
  egressId: string
  roomName: string
  state: EgressState
  error?: string
  startedAt?: Date
  endedAt?: Date
  /** The finished file, once there is one. */
  file?: { key: string; sizeBytes?: number; durationSeconds?: number }
}
export interface EgressService {
  start(room: string, fileKey: string): Promise<EgressInfoLite>
  stop(egressId: string): Promise<EgressInfoLite | void>
  list(room: string): Promise<EgressInfoLite[]>
}
/** A playback address for a stored file. */
export type RecordingSigner = (key: string, o: { download?: boolean; filename?: string }) => Promise<string>

export interface GroupAuthContext {
  payload: Payload
  req: PayloadRequest
  user: { id: Id; email?: string; roles?: string[] }
  /** The document that holds the block, e.g. a lesson, and the block's own fields. */
  collection: string
  id: Id
  doc: Record<string, any>
  block: Record<string, any>
}

export interface LivePluginOptions {
  enabled?: boolean
  livekit: LiveKitOptions
  /** Auth collection of the members. Default `users`. */
  usersSlug?: CollectionSlug
  /** Slug of the sessions collection. Default `liveSessions`. */
  slug?: string
  /** Staff host every call and may join at any time. Default: `user.roles` includes `admin`. */
  isStaff?: (user: unknown) => boolean
  /** Collections whose rich text may hold a `liveCall` block. Default `lessons`, `posts`, `pages`. */
  sourceCollections?: string[]
  /** Rich-text field of those collections. Default `body`. */
  bodyField?: string
  /**
   * May this member join the call in this block? Wire it to the same rule that lets them read the document
   * (with payload-access: `getItemAccess(...).canView`). Without it only staff can join group calls.
   */
  authorizeGroup?: (ctx: GroupAuthContext) => boolean | Promise<boolean>
  /** Members may enter this long before the start. Default 10. */
  opensMinutesBefore?: number
  /** ... and this long after the planned end (the host can always end it earlier). Default 30. */
  closesMinutesAfter?: number
  /** Replaces the LiveKit room API (tests). */
  roomService?: RoomService
  /**
   * Recording of calls (LiveKit Egress to S3). Which calls are recorded is chosen per call (`record` on the block / direct call);
   * the host can also start and stop in the room.
   */
  recording?: RecordingOptions
  /** Replaces LiveKit Egress (tests). */
  egress?: EgressService
  /** Replaces the S3 signing of playback links (tests, or a CDN). */
  signRecording?: RecordingSigner
}

export interface ResolvedLive extends Required<Pick<LivePluginOptions, 'slug' | 'usersSlug' | 'sourceCollections' | 'bodyField' | 'opensMinutesBefore' | 'closesMinutesAfter'>> {
  livekit: LiveKitOptions
  isStaff: (user: unknown) => boolean
  authorizeGroup?: LivePluginOptions['authorizeGroup']
  roomService?: RoomService
  recording?: RecordingOptions & { enabled: boolean }
  egress?: EgressService
  signRecording?: RecordingSigner
}

export const defaultIsStaff = (user: unknown): boolean => {
  const u = user as { roles?: string[]; role?: string } | null
  return Boolean(u && (u.role === 'admin' || (Array.isArray(u.roles) && u.roles.includes('admin'))))
}

export const DEFAULT_SLUG = 'liveSessions'

export function resolve(o: LivePluginOptions): ResolvedLive {
  return {
    livekit: o.livekit,
    slug: o.slug ?? DEFAULT_SLUG,
    usersSlug: o.usersSlug ?? 'users',
    isStaff: o.isStaff ?? defaultIsStaff,
    sourceCollections: o.sourceCollections ?? ['lessons', 'posts', 'pages'],
    bodyField: o.bodyField ?? 'body',
    authorizeGroup: o.authorizeGroup,
    opensMinutesBefore: o.opensMinutesBefore ?? 10,
    closesMinutesAfter: o.closesMinutesAfter ?? 30,
    roomService: o.roomService,
    recording: o.recording ? { ...o.recording, enabled: o.recording.enabled ?? true } : undefined,
    egress: o.egress,
    signRecording: o.signRecording,
  }
}
