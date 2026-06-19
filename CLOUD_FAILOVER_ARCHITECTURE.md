# Cloud Failover Streaming Architecture

## Implementation Todo

- [ ] Define paid cloud failover plans, including storage, bandwidth, cloud minutes, concurrency, and warm standby limits.
- [ ] Build per-user account, quota, billing, and stream-session tables.
- [ ] Add tenant isolation checks to every backend route, worker job, storage object, and billing event.
- [ ] Implement encrypted storage for YouTube stream keys, OAuth tokens, signed URLs, and worker job secrets.
- [ ] Add R2 object layout, lifecycle rules, signed-read policy, and per-user storage accounting.
- [ ] Add cloud-ready asset validation, normalization handoff, and copy-only compatibility blocking.
- [ ] Build DigitalOcean worker image, boot script, short-lived job token exchange, FFmpeg runner, and health heartbeat.
- [ ] Implement manual `Prepare Cloud` and `Shift to Cloud` end-to-end before automatic failover.
- [ ] Add YouTube backup ingest setup and verify `enableAutoStop: false` for Castarro-managed broadcasts.
- [ ] Add cloud stream minute metering, bandwidth accounting, quota enforcement, and automatic shutdown.
- [ ] Add audit logs for user actions, worker actions, secret access, billing events, and admin overrides.
- [ ] Add operational dashboards for startup time, worker capacity, quota pressure, failures, and YouTube health.
- [ ] Complete security review, abuse controls, privacy policy updates, support runbooks, and disaster recovery tests before public launch.

## Goal

Castarro should provide a paid cloud failover mode for copy-only YouTube Live streaming.

The system protects users when their local internet becomes unstable, or when they know an outage is coming. It moves streaming from the user's PC to a DigitalOcean Linux worker while keeping the live path copy/remux-only:

```text
compatible video asset -> FFmpeg -re -> -c copy -> FLV mux -> YouTube RTMPS
```

No live transcoding, overlays, OBS-style rendering, or cloud desktop/RDP workflow is part of this architecture.

## Final Product Shape

The cloud service has two entry paths:

- Manual planned handoff: the user clicks `Prepare Cloud` or `Shift to Cloud` before an outage or during weak connectivity.
- Automatic instability handoff: Castarro detects sustained local network instability and prepares a cloud worker before the stream fully drops.

The cloud worker is started only when needed, unless the user has a package that includes warm standby capacity.

## Non-Negotiable Rules

- Cloud streaming must remain copy-only.
- Only YouTube-compatible assets may enter cloud failover.
- The user PC must keep streaming while the cloud worker is preparing whenever possible.
- YouTube backup ingest must be used for safe handoff.
- `enableAutoStop` should be disabled for Castarro-managed YouTube broadcasts.
- Billing starts only when cloud streaming actually begins, not when video is merely stored.
- Storage and cloud hours are quota-limited per user to prevent abuse.
- RDP is not exposed to users and is not the production control model.

## User Requirements

A user can use cloud failover only when these requirements are satisfied:

- The user has an active paid plan with cloud failover enabled.
- The user is signed in to a Castarro account.
- The user has connected YouTube or provided a valid YouTube RTMPS profile.
- The target broadcast is Castarro-managed or has a known primary and backup ingest pair.
- The YouTube broadcast uses `enableAutoStop: false` when Castarro controls the broadcast.
- The video asset is already uploaded to R2 or imported into R2 from a supported source.
- The selected asset passes copy-only compatibility checks for YouTube Live.
- The user has enough remaining storage quota, cloud minutes, bandwidth allowance, and active-stream capacity.
- The user accepts cloud billing before the worker starts sending a healthy backup feed.
- The user's local app sends current playlist item, playback timestamp, and health heartbeat before handoff.

Required user-facing controls:

- `Prepare Cloud`: stage a worker without stopping local streaming.
- `Shift to Cloud`: start the backup feed and hand off when healthy.
- `Return to Local`: move back to primary ingest after a stable local connection window.
- `Stop Cloud`: stop billing and destroy or release the worker.
- Quota view: storage used, active cloud minutes used, bandwidth used, active workers, and next billing reset.
- Asset readiness view: ready, needs normalization, blocked, or missing backup-ingest compatibility.

## High-Level Architecture

```text
Castarro Desktop / Mobile
        |
        v
Castarro Backend API
        |
        +--> User database
        |
        +--> Cloudflare R2 video storage
        |
        +--> DigitalOcean worker orchestrator
                    |
                    v
             Linux FFmpeg worker
                    |
                    v
          YouTube backup RTMPS ingest
```

## Core Components

### Castarro Client

The user's installed app remains the primary local streaming controller.

Responsibilities:

- Run the normal local FFmpeg copy stream.
- Track current playlist item and playback timestamp.
- Send heartbeat and stream-health telemetry to the backend.
- Allow the user to request `Prepare Cloud` or `Shift to Cloud`.
- Keep local streaming active until the cloud worker is confirmed ready.
- Stop local streaming only after the cloud feed is healthy.

### Castarro Backend API

The backend coordinates users, storage, workers, health, and billing.

Responsibilities:

- Keep per-user account, quota, billing, and stream state.
- Store user stream profiles and YouTube ingest details securely.
- Track uploaded cloud assets and compatibility results.
- Create DigitalOcean Linux workers on demand.
- Send worker jobs with video source, stream key, playlist position, and timestamp.
- Receive worker readiness and stream-health events.
- Decide when automatic cloud shift is allowed.
- Meter active cloud stream minutes.

### Per-User Database

Each user has isolated database state.

The database tracks:

- User plan and quotas.
- Storage usage.
- Cloud stream usage.
- Video asset metadata.
- YouTube account and broadcast mapping.
- Current local stream session.
- Cloud worker session.
- Playback position checkpoints.
- Failover events and billing records.

Tenant isolation rules:

- Every mutable record must include `userId`.
- Every stream session must include `userId`, `channelId`, `broadcastId`, and `sessionId`.
- Every worker job must include `userId`, `sessionId`, `assetId`, and a unique `jobId`.
- Backend reads and writes must filter by authenticated `userId`; client-provided `userId` is never trusted.
- Admin tools must use explicit impersonation/audit mode and must never share normal user tokens.
- Cross-user queries are allowed only in internal aggregate metrics with user-identifying fields removed or access-controlled.

Recommended key database entities:

- `users`: account, billing customer id, plan, status, region preference.
- `user_quotas`: current plan limits and reset windows.
- `quota_usage`: storage bytes, import bytes, worker egress bytes, cloud minutes, operations count.
- `channels`: user-owned Castarro channel/workspace mapping.
- `stream_profiles`: encrypted ingest details and YouTube profile mapping.
- `youtube_broadcasts`: broadcast ids, primary/backup ingest ids, auto-start/auto-stop settings.
- `video_assets`: R2 object keys, compatibility state, duration, codecs, bitrate, owner user id.
- `stream_sessions`: local/cloud state machine and active handoff status.
- `worker_jobs`: assigned worker, scoped token hash, state, heartbeat, billing meter state.
- `audit_events`: user action, admin action, worker action, secret access, quota decision.

### Cloudflare R2 Storage

Cloudflare R2 is the production cloud video store.

Responsibilities:

- Store user-uploaded video assets.
- Store normalized/validated cloud-ready copies when needed.
- Serve byte-range reads to cloud workers.
- Keep storage cost predictable through per-user quotas.

Storage rules:

- Each plan includes a fixed GB quota.
- Extra storage is charged per GB-month or blocked when quota is reached.
- Old unused assets may be auto-deleted based on plan rules.
- Google Drive can remain an import/source convenience, but R2 is the preferred failover storage for production reliability.

Recommended R2 object layout:

```text
r2://castarro-cloud/{userId}/assets/{assetId}/source.ext
r2://castarro-cloud/{userId}/assets/{assetId}/normalized.ext
r2://castarro-cloud/{userId}/assets/{assetId}/probe.json
r2://castarro-cloud/{userId}/sessions/{sessionId}/worker-manifest.json
```

Storage isolation:

- Workers must not receive bucket-wide credentials.
- Workers receive a short-lived signed URL or scoped token for only the assigned object keys.
- R2 object keys should use opaque ids, not user emails, channel names, stream titles, or original filenames.
- Uploaded filenames should be stored as metadata in the database and hidden from worker logs.
- Signed URLs should expire quickly, normally 5-15 minutes, and be refreshed by the backend if needed.
- Delete requests should soft-delete in the database first, then remove R2 objects asynchronously with audit logging.

## Per-User Resource Entitlements

These are initial product limits for planning. They can be changed before launch, but the backend should treat them as enforceable quotas, not UI-only labels.

| Resource | Starter | Pro | Business |
| --- | ---: | ---: | ---: |
| Included R2 storage | 25 GB | 100 GB | 500 GB |
| Max single uploaded asset | 10 GB | 25 GB | 75 GB |
| Monthly import/upload bandwidth | 100 GB | 500 GB | 2 TB |
| Monthly worker egress to YouTube | 150 GB | 750 GB | 3 TB |
| Included active cloud minutes | 300 min | 1,500 min | 6,000 min |
| Active cloud streams per user | 1 | 2 | 5 |
| Max copy-only output bitrate | 8 Mbps | 12 Mbps | 20 Mbps |
| Warm standby | Not included | Optional add-on | Included/reserved |
| Cold-start priority | Standard | Priority | Reserved capacity |
| Retention for unused assets | 30 days | 90 days | Contract-defined |

Quota behavior:

- Storage is measured as total retained R2 bytes, including normalized copies.
- Import/upload bandwidth counts user uploads, Google Drive imports, and any future remote-source imports into R2.
- Worker egress counts bytes sent from cloud workers to YouTube RTMPS.
- Cloud minutes count only while the cloud worker is sending a healthy stream to YouTube.
- Failed worker preparation should not consume cloud minutes, but it may count worker startup attempts for abuse controls.
- Users over hard quota cannot start new cloud jobs until they upgrade, delete assets, or the billing period resets.
- Existing active cloud streams should be stopped gracefully when paid limits, payment state, or abuse policy require shutdown.

Bandwidth planning examples:

```text
6 Mbps stream  -> about 2.7 GB per cloud hour
8 Mbps stream  -> about 3.6 GB per cloud hour
12 Mbps stream -> about 5.4 GB per cloud hour
20 Mbps stream -> about 9.0 GB per cloud hour
```

The backend should meter actual bytes instead of relying only on bitrate estimates.

### DigitalOcean Linux Workers

DigitalOcean workers are short-lived Linux machines that run FFmpeg.

Responsibilities:

- Start from a prepared worker image.
- Pull job configuration from the backend.
- Read the selected video/playlist from R2.
- Seek to the correct continuation position.
- Start FFmpeg in copy/remux mode.
- Stream to YouTube RTMPS backup ingest.
- Report health and billing heartbeat.
- Shut down after cloud mode ends.

Worker sizing baseline:

```text
RAM per active stream: ~700 MB
CPU: low to moderate because there is no transcoding
Primary limits: RAM, network throughput, startup time
```

Recommended worker allocation:

| Worker shape | Target use | Max active streams | Required headroom |
| --- | --- | ---: | --- |
| Small shared worker | Starter cold jobs | 1-2 | Keep at least 1 GB free RAM |
| Medium shared worker | Pro warm/cold pool | 4-8 | Keep 20-30% RAM free |
| Dedicated worker | Business/reserved jobs | 1 user only | Keep 30% RAM and bandwidth free |

Worker rules:

- A worker process may handle multiple streams only if each job is isolated by process, token, temp directory, log file, and cgroup or equivalent resource limits.
- A Business dedicated worker should run jobs for only one user at a time.
- Shared workers must never share environment variables, temp paths, signed URLs, stream keys, or logs between jobs.
- Workers should reject any job whose `userId`, `sessionId`, `assetId`, and token claims do not match the backend assignment.
- Workers must delete temp files, manifests, and in-memory secret references after each job.

## YouTube Setup

Castarro-managed YouTube broadcasts should use:

```text
enableAutoStart: true or controlled by Castarro flow
enableAutoStop: false
primary ingest: user's local PC
backup ingest: DigitalOcean cloud worker
```

YouTube's backup ingestion address is used so the cloud worker can begin sending video before the local encoder is stopped.

The backup feed must match the primary feed as closely as possible:

- Same video codec.
- Same audio codec.
- Same resolution.
- Same frame rate.
- Same audio sample rate and channel count.
- Compatible bitrate.
- Keyframe frequency acceptable for YouTube.

## Manual Shift Flow

```text
1. User clicks Prepare Cloud or Shift to Cloud.
2. Local PC continues streaming to YouTube primary ingest.
3. Backend creates or assigns a DigitalOcean Linux worker.
4. Worker loads video source and stream job.
5. Worker seeks to the current playback timestamp.
6. Worker starts FFmpeg to YouTube backup ingest.
7. Backend confirms worker is healthy.
8. Client stops local primary stream.
9. Cloud worker continues stream from the backup ingest.
10. Billing meter starts for active cloud time.
```

Per-user operation handling:

- The backend creates a new `stream_sessions` row for each local live attempt.
- The client sends state changes using the authenticated account; backend derives the owner user id.
- `Prepare Cloud` is idempotent for the same `sessionId`; repeated clicks return the existing preparing/ready worker.
- `Shift to Cloud` must compare the client's latest playback checkpoint with the backend's latest accepted checkpoint.
- Only one active handoff operation is allowed per `sessionId`.
- A lock or compare-and-swap state transition prevents two workers from streaming the same user's same session.
- The worker cannot start unless the session is still owned by the authenticated user and still in a cloud-eligible state.
- Billing, quota, and audit events are written against the same `userId` and `sessionId` in one transaction or durable workflow step.

The UI should communicate this as a prepared migration:

```text
Preparing cloud stream...
Cloud ready
Switching to cloud
Streaming from cloud
```

The expected preparation window is 30-60 seconds.

## Automatic Instability Shift Flow

Automatic shift uses the same backend path as manual shift, but the trigger comes from local health checks.

Recommended detection inputs:

- Upload bitrate falling below required stream bitrate.
- Repeated FFmpeg reconnects or RTMPS write failures.
- Heartbeat delay from app to backend.
- Packet loss or failed network probes.
- YouTube stream health warnings if available.
- Local stream buffer starvation.

Flow:

```text
1. Castarro detects sustained instability.
2. Backend marks the session as cloud-risk.
3. Backend starts preparing a cloud worker.
4. Local PC continues streaming if still possible.
5. Worker starts sending to YouTube backup ingest.
6. If cloud worker becomes healthy, Castarro shifts to cloud.
7. If local connection recovers before shift, cloud worker can be cancelled.
```

Automatic shift should not stop the local stream until the cloud worker is confirmed healthy.

## Cold And Warm Startup Model

### Cold Start

Cold start creates a worker only when needed.

Use for:

- Normal users.
- Low-cost plans.
- Planned manual shifts.
- Users who can tolerate a 30-60 second preparation window.

Cold start behavior:

```text
request -> create worker -> boot -> install/use prepared image -> start FFmpeg -> verify backup feed -> switch
```

### Warm Pool

Warm workers are already running and waiting for jobs.

Use for:

- Premium users.
- Business users.
- High-risk periods.
- Faster automatic failover.

Warm pool behavior:

```text
request -> assign idle worker -> start FFmpeg -> verify backup feed -> switch
```

Recommended default:

- Keep a small warm pool for instant capacity.
- Burst with cold workers when concurrency rises.
- Do not reserve full 100-user concurrency unless users pay for reserved capacity.

## Concurrency Model

The main concurrency limit is RAM.

```text
active cloud streams x 700 MB = worker RAM required
```

Examples:

```text
10 concurrent streams  -> ~7 GB RAM before OS/headroom
50 concurrent streams  -> ~35 GB RAM before OS/headroom
100 concurrent streams -> ~70 GB RAM before OS/headroom
```

Workers should be packed conservatively with headroom for the OS, FFmpeg buffers, logs, and spikes.

The backend should enforce:

- Per-user active cloud stream limits.
- Per-plan priority.
- Global concurrency limits.
- Queueing when capacity is full.
- Reserved slots only for premium/business plans.

Concurrency isolation:

- Per-user concurrency is checked before worker allocation and again before FFmpeg starts.
- Global capacity is reserved with a short lease so two backend instances cannot assign the same slot.
- The lease expires if the worker does not report healthy within the allowed startup window.
- Queue order should consider plan priority, request time, abuse score, and whether the local stream is already degraded.
- Users should see a clear queued/preparing/ready/failed state instead of a generic loading state.

## Billing Model

Billing should be based on controlled meters:

- Monthly base package.
- Included storage quota.
- Extra storage GB-month.
- Active cloud streaming minutes.
- Optional warm standby or reserved capacity.
- Optional priority startup.

Cloud streaming billing starts when the worker begins sending a healthy stream to YouTube.

Cloud streaming billing stops when:

- The user shifts back to local PC.
- The user stops the broadcast.
- The worker fails and cannot continue.
- The backend force-stops the worker for quota, payment, or abuse reasons.

Billing safety:

- Metering starts only after the worker reports RTMPS connection success and the backend marks the backup feed healthy.
- Metering should use backend time, not worker time.
- Metering records should be append-only so disputes can be audited.
- Payment failures should block new cloud starts immediately, but active jobs should follow a grace or stop policy defined by plan.
- Refund/credit handling should be possible for failed handoffs where the worker was healthy but YouTube rejected the backup feed.

## Shift Back To Local PC

When the user's connection is stable again:

```text
1. Castarro verifies local upload stability for a sustained window.
2. Local PC starts streaming to YouTube primary ingest.
3. Backend confirms primary ingest is healthy.
4. Cloud worker stops backup ingest.
5. Billing stops.
6. Worker is destroyed or returned to the warm pool.
```

The app should avoid rapid bouncing by requiring a stable period before shifting back.

## Failure Handling

### Cloud Worker Not Ready

If the worker does not become healthy within the allowed preparation window:

- Keep local streaming active.
- Cancel or retry the worker.
- Do not stop the local stream.
- Show that cloud preparation failed.

### Local Internet Fully Drops Before Cloud Ready

If the local stream is already gone:

- Start the cloud worker as quickly as possible.
- Use `enableAutoStop: false` to reduce the chance that YouTube completes the broadcast.
- Attempt reconnection to the same YouTube broadcast.
- Mark the event as degraded because viewer buffering may occur.

### YouTube Rejects Backup Feed

If YouTube reports codec, resolution, bitrate, GOP, or audio mismatch:

- Do not switch away from local if local is still alive.
- Stop the failed worker job.
- Mark the asset/profile as not cloud-failover-ready.
- Ask the user to normalize or choose a compatible asset.

### Secret Or Token Exposure

If a stream key, OAuth token, signed URL, or worker job token may have been exposed:

- Immediately revoke or rotate the affected secret.
- Stop affected worker jobs.
- Invalidate active signed URLs and worker job tokens.
- Mark the incident in `audit_events`.
- Notify the user if their YouTube stream key or personal data may have been exposed.
- Preserve redacted logs for investigation.

## Security Requirements

- Store YouTube stream keys, OAuth refresh tokens, RTMPS URLs, signed URLs, and worker job secrets encrypted at rest.
- Use envelope encryption or a managed KMS so database compromise does not directly expose stream keys.
- Decrypt secrets only inside the backend service path that creates a worker job.
- Never send stream keys to the client after initial user entry or OAuth setup.
- Never expose other users' video files, stream keys, OAuth tokens, signed URLs, sessions, or logs to workers.
- Workers receive short-lived scoped job tokens with explicit `userId`, `sessionId`, `jobId`, `assetId`, expiry, and allowed operation claims.
- Workers access only the assigned user's R2 objects through signed URLs or scoped credentials.
- Workers should not keep user secrets after job completion.
- Worker logs must redact stream keys, OAuth tokens, signed URLs, authorization headers, cookies, and RTMPS URLs.
- Destroy cold workers after job completion.
- Patch worker images regularly and rebuild them from source-controlled infrastructure definitions.
- Disable inbound public SSH/RDP for production workers; use private networking, provider console access, or audited break-glass access only.
- Restrict outbound worker traffic to required destinations where possible: backend API, R2, package mirror if needed, and YouTube RTMPS.
- Require TLS for all backend, worker, and storage communication.
- Use rate limits and abuse detection for uploads, imports, prepare requests, and worker starts.
- Keep user-identifying data out of object keys, logs, metrics labels, and support screenshots when possible.
- Add least-privilege admin roles for support, billing, security, and infrastructure operations.
- Use immutable audit logs for secret access, worker assignment, admin access, quota overrides, and billing adjustments.

## Abuse And Quota Controls

Controls required before public launch:

- Per-user storage quota.
- Per-user daily/monthly cloud minutes.
- Max bitrate/profile limits.
- Max concurrent cloud streams per user.
- Payment/plan enforcement before starting cloud workers.
- Content and copyright abuse reporting path.
- Automatic worker shutdown on quota exhaustion.

Additional abuse controls:

- Limit prepare/cancel churn per user to prevent worker-start abuse.
- Rate-limit failed YouTube credentials and invalid stream-key attempts.
- Virus/malware scan uploaded files if files can later be downloaded or inspected by staff.
- Block unsupported container/codecs before upload completes when possible.
- Detect unusually high bitrate, endless playlists, repeated failed handoffs, or suspicious import sources.
- Suspend cloud access separately from the base desktop app when a user violates cloud policy.
- Provide a takedown process for illegal, copyrighted, or harmful stored content.

## Data Privacy And Retention

- Store only the minimum data required to run the stream and bill accurately.
- Let users delete cloud assets and revoke YouTube access.
- Delete R2 objects, worker manifests, and signed URL grants when a user deletes an asset.
- Keep billing records for the legally required period, but avoid storing stream keys in billing records.
- Keep operational logs short-lived unless needed for security or billing disputes.
- Redact user data in support exports by default.
- Document where cloud videos are stored, who can access them, and how deletion works.

## Operational Metrics

Track these metrics from day one:

- Worker startup time.
- Time from user request to cloud healthy.
- Time from cloud healthy to local stop.
- Cloud stream duration.
- Worker memory usage.
- Worker network throughput.
- R2 read errors.
- YouTube health status.
- Failed handoffs.
- Automatic shift triggers.
- False automatic shift triggers.
- Shift-back success rate.

Per-user metrics required for support and quota enforcement:

- Storage bytes by asset and total account usage.
- Import/upload bytes per billing period.
- Worker egress bytes per stream session.
- Active cloud minutes per billing period.
- Number of prepare attempts, successful starts, failed starts, and cancelled starts.
- Current active worker count and historical peak concurrency.
- Last secret rotation time for YouTube credentials.
- Asset readiness status and last compatibility probe result.

## Items Requiring Extra Attention

- YouTube backup ingest behavior must be tested with real scheduled/live broadcasts before public launch.
- Handoff timing may still cause viewer buffering if local internet fully drops before the cloud worker is healthy.
- Copy-only failover depends on asset compatibility; every upload/import path must run the same validation.
- Accurate playback continuation requires frequent local checkpointing and careful FFmpeg seek behavior.
- Cloud storage costs can grow quietly; lifecycle cleanup and quota alerts are mandatory.
- Worker startup time is product-critical; keep images prebuilt and avoid runtime package installs.
- Multi-tenant shared workers are cost-efficient but raise isolation risk; start with conservative process and credential boundaries.
- Automatic failover should wait until manual failover has enough metrics and support tooling.
- Legal/privacy documents must cover cloud video storage, YouTube token handling, billing meters, and deletion behavior.
- Support needs tools to diagnose a user's session without revealing stream keys or private video URLs.

## Launch Scope

The first production version should include:

- R2-backed cloud video storage.
- DigitalOcean Linux FFmpeg workers.
- Manual `Prepare Cloud` / `Shift to Cloud`.
- YouTube backup ingest handoff.
- `enableAutoStop: false` for Castarro-managed broadcasts.
- Copy-only compatibility checks.
- Per-user quotas.
- Active cloud-minute billing.
- Basic cold start.
- Small warm pool for premium users or internal safety.

Automatic instability shift should be added after the manual flow is reliable and measured.
