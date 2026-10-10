# Password reset (backend)

## Configuration and deployment

Set `EMAIL_HOST`, `EMAIL_PORT` (default 465), `EMAIL_SECURE` (true for 465,
false for STARTTLS on 587), `EMAIL_USER`, `EMAIL_PASSWORD` and `MAIL_FROM`.
SMTP authentication and the From address must be permitted by the provider.
For Gmail password authentication, use an App Password when supported by the
account, rather than the normal account password.

Set a **separate random** `PASSWORD_RESET_SECRET` of at least 32 bytes, e.g.
generate it using `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
Do not commit credentials. Startup fails when required mail/reset settings are
missing. Preview is disabled, including in production. Configuration does not
send a test email or contact SMTP at startup.

Run `npm run migration:run` against the deployment database before starting the
updated application. The new migration only creates `password_reset_challenges`
and its indexes; it does not alter user accounts. Use `npm run build` to include
both Handlebars templates in `dist/modules/mailer/templates`.
The adapter also resolves that asset directory when TypeScript emits JavaScript
under `dist/src` because additional TypeScript scripts are present in the checkout.

## API

All routes are public POST requests under `/api/v1/auth`. Responses use
`{ statusCode, message, data }`. No login tokens/cookies are issued by reset.

1. `/forgot-password`: `{ "email": "student@example.com" }`.
   Returns HTTP 200 with `data: { "requested": true }` even for unknown, locked,
   deleted accounts, cooldown/quota suppression, or SMTP failure. This confirms
   request processing, **not email delivery**. Email whitespace is trimmed;
   lookup preserves the existing case-sensitive authentication behavior.
2. `/verify-reset-otp`: `{ "email": "student@example.com", "otp": "012345" }`.
   Returns `data: { "resetToken": "...", "expiresAt": "..." }`. OTP must be a
   six-digit string. Unknown, expired, used and incorrect codes share one error.
3. `/reset-password`: `{ "resetToken": "...", "newPassword": "...", "confirmPassword": "..." }`.
   Passwords must match, contain at least 8 characters and not exceed 72 UTF-8
   bytes. Returns `data: { "changed": true }`. Log in normally afterward.

Google-created accounts may also establish a password using this flow. Locked
and deleted accounts cannot verify or reset, including when they become
ineligible after the OTP was sent.

## Lifetime, storage and concurrency

- OTP: cryptographically random 6 digits, 10-minute expiry, at most 5 wrong
  attempts. Database stores HMAC-SHA256 keyed by `PASSWORD_RESET_SECRET` and
  bound to the challenge ID. Plain OTP exists only in memory and the email.
- Successful verification consumes OTP and issues a 32-byte random token,
  valid for 5 minutes and one reset. Only SHA-256 of this high-entropy token
  is stored. It is not a JWT and cannot authenticate normal API requests.
- At most one usable challenge per user through serialized user-row locks.
  Accepted resend invalidates older OTPs and reset tokens. SMTP runs after the
  challenge transaction commits; only accepted recipients activate a pending
  challenge. Failed/timed-out sends cannot later activate it. No automatic retry.
- Cooldown: 60 seconds; quota: 5 created challenges per user per hour, including
  SMTP failures. Suppression does not invalidate the current challenge.
- Password update, token consumption, challenge invalidation and revocation of
  **all refresh tokens** commit atomically. Existing access JWTs and WebSocket
  sessions still follow their current expiration behavior. Immediate access
  token revocation is outside this change.
- A confirmation email is attempted after commit. Failure never rolls back a
  successful password change. SMTP credentials, OTPs, passwords and reset
  tokens are not written to application logs.

Cleanup runs at **02:00 Asia/Ho_Chi_Minh every day**, retaining rows for at least
24 hours. Expired OTP rows with a still-valid reset token are retained. Expiry
is checked on every request; cleanup is not responsible for validity.

## Operational limits

Nodemailer sends directly during the HTTP request with bounded timeouts.
Consistent response bodies hide eligibility; SMTP timing can still disclose a
difference between eligible and ineligible addresses. A durable queue/worker is
the next step if timing resistance or automatic retries are required.

Route-level `@nestjs/throttler` limits per IP/minute: request 10, verify 30,
reset 10. Its default memory storage assumes **one API instance** and resets on
restart. User cooldown/quota and attempts persist in PostgreSQL. For multiple
instances, use shared throttler storage or enforce IP limits at the gateway.
Behind a proxy, configure Express `trust proxy` for the actual trusted proxy
addresses/hops; do not blindly trust caller-supplied `X-Forwarded-For`.

## Verification

`npm test -- --runInBand` covers crypto, UTF-8 limits, templates, mail failures
and the public HTTP contract with guards/rate limiting. No automated test sends
real email. Run PostgreSQL suites with explicit `TEST_POSTGRES_HOST`,
`TEST_POSTGRES_PORT`, `TEST_POSTGRES_USER`, `TEST_POSTGRES_PASSWORD`, and
`TEST_POSTGRES_DB`:

`npm run test:integration -- --runInBand password-reset`

`npm run test:e2e -- --runInBand password-reset` boots the full application and
checks login, reset, refresh-token rejection, public guards and cron registration.
It replaces mail calls with test doubles and uses fake R2/Google credentials;
only the explicitly configured PostgreSQL test database is contacted.

These suites create/drop only owned temporary schemas. They check migration
up/down, persistence, expiry, concurrent verify/resend/reset, transactional
rollback and refresh revocation. Without dedicated test DB settings, they
fail clearly instead of silently using the configured application database.

Before deployment, smoke-test a real email to an address you control, verify
the OTP, reset, then confirm old-password login and old refresh tokens fail.
SMTP acceptance alone does not prove inbox delivery.
