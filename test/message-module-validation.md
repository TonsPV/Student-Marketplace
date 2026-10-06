# Message v1.2 validation — 2026-10-06

## Result

Backend build and the implemented test scenarios pass on the configured Supabase
and R2 services. Migration is applied to `public`; the application booted against
that schema with `synchronize=false`. This does **not** certify every item in the
spec's full frontend/deployment DoD matrix.

| Check                                      | Executed result                                                     |
| ------------------------------------------ | ------------------------------------------------------------------- |
| `npm run build`                            | PASS                                                                |
| Unit Jest                                  | 45/45, 7 suites                                                     |
| PostgreSQL integration                     | 17/17, 3 suites                                                     |
| Automated HTTP/WS/R2 E2E                   | 6/6                                                                 |
| Native in-app browser smoke                | PASS: presign → PUT → send → signed GET, 68 bytes                   |
| Migration legacy up/down/up                | PASS in isolated schemas, including read gaps and image-key mapping |
| `npm run migration:run` / `migration:show` | Applied `MessageModule1760000000000` to `public`                    |
| Compiled app DI/schema boot on `public`    | PASS, four chat tables, synchronization disabled                    |
| Formatting                                 | Modified message/config/test files pass Prettier                    |
| `git diff --check`                         | PASS                                                                |

## Corrected findings

- TypeORM's raw `UPDATE ... RETURNING` returns `[rows, affectedCount]`, unlike
  SELECT/INSERT. Read and notification mutation queries now return rows through
  a CTE SELECT. Repeated reads correctly return `updated: 0`, preserve version
  and emit no mutation events.
- Sending by conversation checks participant authorization before storage IO.
- Notification list snapshots use batched queries; tested with three
  conversations and a bounded SELECT query count.
- Automatic schema synchronization is disabled by default and requires an
  explicit development/test opt-in. App and migration CLI share schema and
  search-path configuration, including Supabase's extension schema.
- Message and notification timestamps are `timestamptz`. Legacy message
  timestamps migrate under the verified UTC database assumption.
- Migration constraint/type checks are schema-scoped; legacy URL images block
  migration; previews preserve truncation/emoji and mapped image-only messages.
- Placeholder environment-only integration/E2E checks were replaced by real DB,
  HTTP, WS and R2 assertions. Fixtures own unique schemas; cleanup cannot target
  an unowned schema.
- R2 was initially public and browser PUT was blocked by CORS. After the user's
  bucket configuration change, the configured public URL denies object reads,
  CORS preflight succeeds, and native browser PUT/GET succeeds.
- Signed GET expiry is tested with a one-second URL: it initially works, expires
  with 403, and authorized history supplies a fresh usable URL.
- The S3 client closes with the Nest module; E2E drains fetch bodies and clears
  timers. The final ordinary Jest run exits successfully without open-handle
  warnings.

## Concurrency and fault evidence

Real PostgreSQL tests exercise concurrent first sends, contiguous sequences,
correct latest metadata, parallel same-client retries (including images),
payload conflicts, duplicate image-key rollback, partial/repeated reads,
message/notification reconciliation, independent manual notification reads,
multiple-conversation read-all lock ordering, and concurrent send/read/manual
notification mutations. Injected notification/signing failures leave no committed
message; injected WS emit failure preserves committed success.

History pagination is verified with a latest five-image message, two-message
pages, newer arrivals between requests, invalid cursors and empty pages.
Historical deleted post/user headers expose only public fields. Actual WS tests
verify invalid JWTs, invalid bodies, foreign joins, typing false, leave behavior,
room delivery, user-room updates without joining, two tabs, replay without a new
message event and read receipts.

Storage metadata is mocked for DB concurrency/fault tests. R2 E2E uses real
presigned uploads, HEAD, downloaded bytes, missing objects, ownership guards,
conflicts, wrong content type, unsigned/public reads, preflight and expiry.

## Cleanup and retained data

Existing `public` records were compared with count and row fingerprints around
migration/testing: 2 users, 1 post, 1 category, 10 refresh tokens; original app
tables otherwise have no records. They were retained unchanged. No test user,
post, message or notification was created in `public`.

Test schemas and recorded R2 objects were removed. The final audit shows zero
`message_test_*` schemas and an empty R2 bucket. Retained database additions are
the message module schema/indexes and its migration history entry.

## Remaining scope

- R7: FE reducer behavior for reordered/duplicate events and delayed unread
  snapshots needs verification in the actual frontend. Backend delivery order
  is not guaranteed; the FE guide specifies independent version gates.
- A deployment with multiple API processes/hosts and sustained load has not been
  tested. Concurrent transactions/connections within this harness passed;
  those results do not replace distributed/load verification.

Frontend contracts, retry rules, upload/CORS configuration and commands are in
`src/modules/messages/README.md`. No credentials or human-account JWTs are stored
in this report.
