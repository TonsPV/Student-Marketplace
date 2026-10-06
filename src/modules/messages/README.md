# Message v1.2: frontend integration and verification

HTTP base: `/api/v1`. REST responses wrap the payload in `data`.
Use an access JWT in `Authorization: Bearer ...`. Socket.IO namespace: `/ws`,
handshake `auth: { token: accessJwt }`.

## Send, upload and retry

1. Generate one `clientId` for each intended message (e.g. `crypto.randomUUID()`).
2. For each image, `POST /uploads/presign` with
   `{ purpose: "message", contentType: "image/png", size: file.size }`.
   Allowed types: JPEG, PNG, WebP; default limit: 5 MiB, at most 5 images.
3. PUT the file directly to `data.uploadUrl` with the exact `Content-Type`.
   Store the returned `key`; the server verifies actual size/type with HEAD.
4. `POST /messages` with exactly one of `postId` / `conversationId`,
   `clientId`, optional trimmed `content`, optional ordered `images: [key, ...]`.
   At least text or one image is required. The response contains signed GET URLs
   in `images` and their earliest ISO expiry in `imagesExpireAt`.
5. If a network timeout or retryable 5xx leaves the outcome unknown, retry with
   the same `clientId`, logical target, content and ordered keys. Use bounded
   exponential backoff. The original message ID/sequence is returned, without
   repeated notification or WS events. Changed payload with the same ID returns
   409; resolve that conflict instead of silently allocating a new ID.

`POST /conversations/:id/messages` is the deprecated alias. Its body only accepts
`content`, `images`, optional `clientId`; target fields in the body return 400.
Always supply `clientId` for retry safety, including when using the alias.

Never store signed URLs as permanent image identifiers. After their expiry,
refetch authorized history for fresh URLs. An uploaded key can belong to only one
message; retrying the same message is allowed. Missing uploads, foreign owner
keys, unsupported metadata and malformed keys fail before a message commits.

## History and reads

- `GET /conversations`, `GET /conversations/:id`: public post/counterpart header,
  role, absolute unread count, sequence/version strings and read watermarks.
- `GET /conversations/:id/messages?limit=30&before=<messageId>`: newest first,
  `items`, `hasMore`, `nextCursor`. Cursor must belong to that conversation.
  Images do not consume pagination slots. Deduplicate IDs when merging pages.
- `PATCH /conversations/:id/read` with `{ throughMessageId }`: use the newest
  message actually rendered. It marks incoming messages through that sequence,
  keeps later arrivals unread and returns `updated`, `unreadCount`,
  `readThroughSequence`, `stateVersion`. Repeated reads are no-ops.
- `GET /messages/unread-count`: `{ total, conversations }`.
- `GET /notifications`: `{ items, meta, snapshots }`.
- `GET /notifications/unread-count`: `{ total }`.
- `PATCH /notifications/:id/read` and `PATCH /notifications/read-all`: manual
  notification reads only affect notifications, not message read state.

## Socket state reconciliation

`chat:join` / `chat:leave`: `{ conversationId }`, ack `{ ok: true }` or
`{ ok: false, error: "BAD_REQUEST" | "FORBIDDEN" | "INTERNAL_ERROR" }`.
`chat:typing`: `{ conversationId, isTyping: boolean }`, requires a successful
join. Debounce true every 2–3 seconds, send false on inactivity, and use a local
TTL so a lost event does not leave typing stuck.

| Event                       | Delivery                        | Apply                                                                                         |
| --------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------- |
| `chat:message:new`          | Joined conversation             | Deduplicate ID; reconcile optimistic `clientId`; order by `BigInt(sequence)`                  |
| `chat:conversation:updated` | Participant user room, all tabs | Replace absolute state for a strictly newer `stateVersion`                                    |
| `notification:changed`      | Participant user room, all tabs | Replace active unread notification with `unreadNotification` or null; merge `changed` history |
| `chat:read`                 | Joined conversation             | Advance that reader's watermark monotonically                                                 |
| `chat:typing`               | Other joined sockets            | Update transient typing TTL                                                                   |

Keep **separate** conversation-snapshot and notification-snapshot version gates
per conversation: both events can carry the same version and update different
state. Treat equal versions within the same stream as duplicates. Use the wrapper
`stateVersion` for notification snapshots; a historical row's
`conversationVersion` is not the current snapshot version. Do not increment a
badge for each event. Derive it from current active unread entries / REST counts.

Always merge a previously unseen message ID even if a newer conversation
snapshot already arrived. A delayed message's `isRead: false` must not override
known read watermarks. Use `BigInt` internally for sequence/version comparisons;
keep their JSON representation as strings.

After reconnect: refetch conversation/list/history, notification list and unread
counts, reapply version gates, then rejoin the visible conversation. REST restores
commits whose best-effort WS delivery was lost. A tab not joined to a conversation
still receives user-room snapshots, but no `chat:message:new` from that room.

## Database and R2 configuration

`POSTGRES_SYNCHRONIZE=false` is the default. Run `npm run migration:run` for the
existing scaffold schema; `migration:show` checks migration history. Synchronize
requires explicit opt-in plus `NODE_ENV=development` or `test`. Migration assumes
legacy timestamp values were stored in UTC; deployments using another historical
timezone must adjust the conversion before running it. Legacy `message_images.url`
blocks migration until an explicit private-key mapping is reviewed.

Keep R2 Public Development URL and custom domains disabled for this chat bucket.
CORS is independent of object access. Development CORS (add explicit deployed FE
origins when needed):

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

## Running tests without touching existing records

```powershell
npm test -- --runInBand
$env:TEST_USE_CONFIGURED_SERVICES='true'
npm run test:integration
npm run test:e2e
```

Explicit opt-in above uses `.env` services. Alternatively provide all
`TEST_POSTGRES_HOST/PORT/USER/PASSWORD/DB` for a separate database. Each run creates
and owns a unique `message_test_<uuid>` schema. Cleanup refuses any other schema,
drops only its own schema and deletes only recorded R2 test keys. E2E boots the
real app, creates fixture users and signs their test JWTs; it does not require an
already-running API or human account JWTs.

For the native browser case, set `TEST_BROWSER_SMOKE=true` before `test:e2e`, then
open the printed `http://localhost:3000/message-browser-test` when ready. Port 3000
must be available. The page exercises cross-origin presign → PUT → send → GET.
Without that flag the native browser case is not registered; ordinary E2E still
checks R2 PUT/GET and CORS preflight. An interrupted test process may require
manual cleanup of the exact schema/test keys created by that process.

See `test/integration/messages.spec.ts`, `migration.spec.ts`, `test/e2e/chat.spec.ts`
and unit suites for executable assertions. FE reducer behavior under synthetic
event reordering (R7) and multi-host/load testing require separate FE/deployment
verification; backend pass results do not prove those scenarios.
