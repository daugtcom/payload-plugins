// Manual end-to-end check against a real LiveKit + Egress + MinIO (docker, see docker/docker-compose.recording.yml). Not part of `vitest run`.
import { execFileSync } from 'node:child_process'
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { createServer } from 'node:http'
import { handleEndpoints } from 'payload'
import { RoomServiceClient } from 'livekit-server-sdk'
import { egressServiceFor, s3Signer } from '../src/livekit'
import { getLive, payloadLive } from '../src'
import { boot } from './harness'

const lk = { url: 'ws://localhost:7890', apiUrl: 'http://localhost:7890', apiKey: 'devkey', apiSecret: 'secret-secret-secret-secret-secret' }
const base = { bucket: 'recordings', region: 'us-east-1', accessKey: 'minioadmin', secret: 'minioadmin', forcePathStyle: true }
const forEgress = { storage: { ...base, endpoint: 'http://minio:9000' } } // reached from inside Docker
const forHost = { storage: { ...base, endpoint: 'http://localhost:19000' } } // reached from here

const s3 = new S3Client({ region: base.region, endpoint: forHost.storage.endpoint, forcePathStyle: true, credentials: { accessKeyId: base.accessKey, secretAccessKey: base.secret } })
await s3.send(new CreateBucketCommand({ Bucket: base.bucket })).catch((e) => console.log('bucket:', e.name))

const b = await boot({
  collections: [],
  plugins: [payloadLive({ livekit: lk, recording: forEgress, egress: egressServiceFor(lk, forEgress), signRecording: s3Signer(forHost) })],
})
// LiveKit's webhooks (docker/livekit.yaml points them at host.docker.internal:3299) go straight into the plugin's endpoint
const hooks: string[] = []
const web = createServer(async (rq, rs) => {
  const chunks: Buffer[] = []
  for await (const c of rq) chunks.push(c as Buffer)
  const raw = Buffer.concat(chunks).toString()
  try { hooks.push(`${JSON.parse(raw).event}`) } catch { /* ignore */ }
  const res = await handleEndpoints({ config: b.payload.config, request: new Request('http://localhost/api/live/webhook', { method: 'POST', headers: { 'content-type': 'application/webhook+json', authorization: String(rq.headers.authorization ?? '') }, body: raw }) })
  rs.statusCode = res.status
  rs.end(await res.text())
})
await new Promise<void>((r) => web.listen(3299, r))
try {
  const live = getLive(b.payload)
  const host = await b.payload.create({ collection: 'users', data: { email: 'h@example.com', password: 'pw-pw-pw-1', roles: ['admin'] } as never })
  let s = await live.createDirectSession({ title: 'E2E', startsAt: new Date(), endsAt: new Date(Date.now() + 3600_000), hostUserIds: [host.id], participantUserIds: [], record: true })
  await new RoomServiceClient(lk.apiUrl, lk.apiKey, lk.apiSecret).createRoom({ name: s.room, emptyTimeout: 120 })
  // Egress's recorder waits for somebody who publishes: a bot (lk CLI) joins from inside the compose network with a demo camera + microphone
  execFileSync('docker', ['rm', '-f', 'rec-bot'], { stdio: 'ignore' })
  execFileSync('docker', ['run', '-d', '--name', 'rec-bot', '--network', 'rectest_default', 'livekit/livekit-cli', 'room', 'join', '--url', 'ws://livekit:7880', '--api-key', lk.apiKey, '--api-secret', lk.apiSecret, '--identity', 'bot', '--publish-demo', s.room])
  await new Promise((r) => setTimeout(r, 4000))
  s = await live.startRecording(s)
  console.log('started', s.recordings)
  for (let i = 0; i < 40 && s.recordings?.[0]?.status !== 'recording'; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    s = await live.syncRecordings(s)
  }
  console.log('status before stop:', s.recordings?.map((r) => r.status))
  await new Promise((r) => setTimeout(r, 8000)) // some footage
  s = await live.stopRecording(s)
  // from here on only the webhook may move the status (no sync calls)
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    s = (await live.byId(s.id))!
    if ((s.recordings ?? []).every((r) => r.status === 'ready' || r.status === 'failed')) break
  }
  console.log('webhook events received:', hooks.join(', '))
  const r = s.recordings![0]!
  console.log('final', r)
  if (r.status === 'ready') {
    const url = await live.signer(r.fileKey!, {})
    const res = await fetch(url)
    const buf = Buffer.from(await res.arrayBuffer())
    console.log('signed fetch', res.status, res.headers.get('content-type'), buf.length, 'bytes; ftyp:', buf.subarray(4, 8).toString())
  }
} finally {
  execFileSync('docker', ['rm', '-f', 'rec-bot'], { stdio: 'ignore' })
  web.close()
  await b.close()
}
process.exit(0)
