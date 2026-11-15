# EHBR Security Flaws and Required Changes

Based on a read-only review of `EHBR-Centralized-Emegency-Hub-main.zip` (13–15 November 2026). Nothing was run, installed or tested, so every item comes from reading source code, not from runtime behavior. No secret values appear here.

**Status labels**

- **Confirmed** – seen directly in the code.
- **Verify** – likely, but needs a check on your side (git, runtime, deployment).
- **Recommended** – not a bug in the code; a protection the system should have.

**Priorities:** P0 critical safety or security, P1 major, P2 moderate, P3 minor.

**Decision recorded:** password reset codes stay at 6 digits. The fixes in SEC-11 rely on stricter limits instead of longer codes.

## Progress Tracker

Tick a box (`- [x]`) when a fix is built **and** checked by a test or a manual run. State as of the review: nothing below has been fixed yet, and the protections listed under "Already implemented" were found in the code. Update the counter as you go.

**Fixed: 0 of 51**

### Already implemented (found in the code, not yet tested at runtime)

- [x] scrypt password hashing with random salts, timing-safe comparisons
- [x] Generic login errors; no number enumeration on forgot-password
- [x] Login attempt limits per IP and per number
- [x] One-time reset codes with 5 tries and an expiry; a reset logs out old sessions
- [x] Password check before changing the contact number
- [x] 10-character strong-password rule for admin password changes
- [x] Input length limits and enum checks on report fields; photo type check by magic bytes; photo size limits
- [x] Path-traversal protection for static files; strict CSP on admin pages
- [x] Admin console escapes text with `esc()`
- [x] CSV export neutralizes spreadsheet formulas and masks reporter names
- [x] Audited reveal of a resident's contact number
- [x] Secrets and the data file listed in `.gitignore` (but see SEC-02)
- [x] Offline report queue with duplicate protection (`clientId`)

### To do: P0 (critical)

- [ ] SEC-01 SOS does not reach the server
- [ ] SEC-02 Account data inside the repository archive (verify in git first)

### To do: P1 (major)

- [ ] SEC-03 Session tokens are weak
- [ ] SEC-04 Password rule is only enforced in the app
- [ ] SEC-05 Admin login is too easy to attack
- [ ] SEC-06 Reports can be lost after the server says "received"
- [ ] SEC-17 Privacy notice is an unfinished draft; consent not recorded
- [ ] SEC-25 The audit log is not reliable (partly done: contact reveals are logged)
- [ ] SEC-29 No HTTPS and cleartext is enabled
- [ ] SEC-43 Android release build is not ready; no `ios/` folder
- [ ] SEC-51 No runtime verification or penetration test yet

### To do: P2 (moderate)

- [ ] SEC-07 First admin password is not checked (partly done: rule applies on later changes)
- [ ] SEC-08 One admin account and one role
- [ ] SEC-09 No second step (2FA) for admins
- [ ] SEC-10 Rate limits reset on restart
- [ ] SEC-11 Password reset can be abused (codes stay 6 digits)
- [ ] SEC-12 Wrong-app logins leave a live session
- [ ] SEC-13 Admin browser session handling
- [ ] SEC-14 Registration is unverified and reveals numbers
- [ ] SEC-18 Anonymous reports may not be anonymous (verify)
- [ ] SEC-19 Verified-report alerts expose locations
- [ ] SEC-20 No retention, deletion or export policy
- [ ] SEC-21 Personal data is stored unprotected
- [ ] SEC-22 Photos keep their hidden metadata
- [ ] SEC-23 Photo storage is local and unprotected
- [ ] SEC-26 No monitoring or alerts
- [ ] SEC-27 Log hygiene (verify)
- [ ] SEC-28 No incident response plan
- [ ] SEC-32 Client IP trust (verify)
- [ ] SEC-34 Database connection and permissions
- [ ] SEC-35 Admin console is open to the internet
- [ ] SEC-37 Any report status can become any other
- [ ] SEC-38 HTML injection in the admin map
- [ ] SEC-39 Abuse controls for SOS and reports
- [ ] SEC-41 Rejected reports look "just received" in the app
- [ ] SEC-42 Token and queued photos in plain storage
- [ ] SEC-47 Dependencies and builds are not checked; no CI
- [ ] SEC-48 Secrets handling (verify)
- [ ] SEC-49 Missing security tests
- [ ] SEC-50 Setup documents are out of date

### To do: P3 (minor)

- [ ] SEC-15 No way to suspend an abusive account
- [ ] SEC-16 No security alerts to residents
- [ ] SEC-24 Push notifications may show sensitive details on the lock screen
- [ ] SEC-30 CORS defaults to any origin
- [ ] SEC-31 Security headers on every response (verify; partly done: CSP on admin pages)
- [ ] SEC-33 Explicit server timeouts
- [ ] SEC-36 Single-instance design
- [ ] SEC-40 Report export is not role-restricted (partly done: masking and formula protection)
- [ ] SEC-44 App backups and code protection (verify)
- [ ] SEC-45 Errors are silently ignored
- [ ] SEC-46 Third-party services see resident location

## A. Critical (before any real resident uses it)

### SEC-01 · P0 · SOS does not reach the server
- **Status:** Confirmed
- **Where:** `app/lib/widgets/sos_sheet.dart`; no SOS route in `server/server.js`
- **Problem:** The SOS screen says location is shared and responders are alerted, but it only opens the phone dialer or an SMS. No record reaches the barangay.
- **Fix:** Change the screen text to match behavior now. Then add an authenticated SOS endpoint (coordinates plus a `clientId` so retries don't duplicate), call it alongside the dialer, queue it offline, and pin SOS items at the top of the admin dashboard.
- **Done when:** One SOS creates exactly one server record with coordinates, offline SOS is delivered on reconnect, and the admin sees it first.

### SEC-02 · P0 (if tracked in GitHub) · Account data inside the repository archive
- **Status:** Confirmed in the ZIP; Verify whether GitHub tracks it
- **Where:** `server/data.json` (password hashes, live session tokens, emails, names, addresses), `app/android/local.properties`, `app/android/gradle.properties.backup`; all are listed in `.gitignore`
- **Problem:** Anyone with the repo could take over accounts and read personal data.
- **Fix:** Run `git ls-files server/data.json` and `git log --all -- server/data.json`. If tracked, remove from the index, purge history (for example `git filter-repo`), end all sessions, reset the admin password, and force resident resets.
- **Done when:** The files are absent from `git ls-files` and history, and old sessions no longer work.

### SEC-03 · P1 · Session tokens are weak
- **Status:** Confirmed
- **Where:** `server/server.js` (`issueToken`, `userFromReq`, `/api/me/password`), `server/store.js` (`sessions` table)
- **Problem:** Tokens are stored as plain text, last 30 days (admin too), expired ones are only removed when reused, and changing a password does not log out other devices.
- **Fix:** Store a SHA-256 hash of each token, use a shorter admin lifetime, add scheduled cleanup, and revoke all other sessions on password change.
- **Done when:** A database copy cannot be replayed as a token, and old tokens fail after a password change.

### SEC-04 · P1 · Password rule is only enforced in the app
- **Status:** Confirmed
- **Where:** `app/lib/widgets/password_rules.dart` (8+ characters, upper and lower case, digit, symbol) versus the server, which only checks length 8–100
- **Problem:** Calling the API directly allows weak passwords such as `12345678`.
- **Fix:** Enforce the same rule on the server and reject common passwords and passwords equal to the contact number.
- **Done when:** The server rejects weak passwords with a clear error, covered by tests.

### SEC-05 · P1 · Admin login is too easy to attack
- **Status:** Confirmed
- **Where:** `server/ratelimit.js` (limits), login route in `server/server.js`, `admin/pages/login.js`
- **Problem:** The admin name is always `admin`. 50 failed tries per 15 minutes per number is loose for the most powerful account, and the same limit lets an attacker lock the real admin out on purpose.
- **Fix:** Admin-specific limits (for example 5 failures, then a growing delay), alerts to other admins, trusted-IP allowlist or device-bound lock, and lockout counters that survive restarts.
- **Done when:** Guessing is slowed sharply, and an outsider cannot block a correct admin login.

### SEC-06 · P1 · Reports can be lost after the server says "received"
- **Status:** Confirmed
- **Where:** `server/server.js` `save()`; `server/store.js` (`schedule`, `run`, `flushNow`)
- **Problem:** With PostgreSQL the reply is sent about 25 ms before the data is written, and failed writes are only logged. A crash loses acknowledged reports. File mode rewrites the whole file on every change.
- **Fix:** Wait for the write before replying to report creation and status changes, retry failures with alerts, and return 503 if the database is down.
- **Done when:** Killing the process right after a 200 loses nothing.

---

## B. Authentication and accounts

### SEC-07 · P2 · First admin password is not checked
- **Status:** Confirmed
- **Where:** `ensureAdmin` in `server/server.js`
- **Problem:** The 10-character strength rule applies only when the admin changes the password later. A weak `ADMIN_PASSWORD` environment value is accepted, and a generated password is printed to the console, where logs may keep it.
- **Fix:** Apply the same rule at startup and never print the password to logs.
- **Done when:** A weak value stops startup with a clear message.

### SEC-08 · P2 · One admin account and one role
- **Status:** Confirmed (the README says so too)
- **Problem:** No named accounts, so actions cannot be traced to a person, and every admin can do everything.
- **Fix:** Named admin accounts with roles (for example viewer, dispatcher, super admin), and role checks on every `/api/admin/*` route.
- **Done when:** Each logged action names a person, and a viewer cannot change reports or settings.

### SEC-09 · P2 · No second step for admins
- **Status:** Recommended
- **Fix:** Two-factor authentication (authenticator app) for admin sign-in, with recovery codes.
- **Done when:** An admin password alone cannot open the console.

### SEC-10 · P2 · Rate limits reset on restart
- **Status:** Confirmed (`server/ratelimit.js` is in memory)
- **Fix:** Persist counters in the database, or document that the server runs as a single instance.
- **Done when:** Restarting does not clear lockouts.

### SEC-11 · P2 · Password reset can be abused (codes stay 6 digits)
- **Status:** Confirmed behavior; guessing risk is low but not zero
- **Where:** `/api/auth/forgot`, `/api/auth/reset`, `/api/auth/reset/verify`
- **Problem:** Each new request issues a fresh code and resets the 5-try counter, so an attacker targeting one number gets roughly 15 guesses an hour. Five wrong tries on a pending staff-issued code also lock the resident out.
- **Fix:** Do not reset the counter on a new request, lower the hourly request limit per number, lock the code after repeated failures, and notify the resident of each reset request.
- **Done when:** A series of wrong guesses cannot continue indefinitely.

### SEC-12 · P2 · Wrong-app logins leave a live session
- **Status:** Confirmed
- **Where:** `Session.signIn` in the app; `admin/pages/login.js`
- **Problem:** An admin signing in on the resident app, or a resident on the admin page, is rejected by the client after the server has already issued a 30-day token that is never revoked.
- **Fix:** Check the role on the server for each client type, or log the token out immediately.
- **Done when:** A rejected sign-in leaves no usable token.

### SEC-13 · P2 · Admin session handling in the browser
- **Status:** Confirmed
- **Where:** `admin/app.js`, `admin/pages/login.js`
- **Problem:** The token is always kept in `localStorage`, there is no inactivity timeout, and the login page redirects to the dashboard without checking the token with the server.
- **Fix:** Add an idle timeout, validate the token on page load, and keep admin tokens short-lived.
- **Done when:** An idle console signs out, and an expired token never shows the dashboard.

### SEC-14 · P2 · Registration is unverified and reveals numbers
- **Status:** Confirmed
- **Where:** `POST /api/auth/register`
- **Problem:** Anyone can register any phone number, which blocks the real owner. The "already registered" error confirms which numbers exist.
- **Fix:** OTP or staff verification, and a generic error message.
- **Done when:** An unverified number cannot hold an account, and errors do not reveal registrations.

### SEC-15 · P3 · No way to suspend an abusive account
- **Status:** Recommended (I did not find such a control in the code I read)
- **Fix:** An admin action to suspend or block a resident, with a reason, logged and reversible.
- **Done when:** A suspended account cannot sign in or submit reports.

### SEC-16 · P3 · No security alerts to residents
- **Status:** Recommended
- **Fix:** Notify residents when their password or contact number changes, when a reset is requested, and when a new device signs in.
- **Done when:** Each of those events creates a notification.

## C. Data protection and privacy

### SEC-17 · P1 · Privacy notice is an unfinished draft and consent is not recorded
- **Status:** Confirmed
- **Where:** `_PrivacyNoticeSheet` in `app/lib/screens/create_account_screen.dart`; the register request in `Api.register`
- **Problem:** The notice has blanks for the data controller, the privacy officer's contact details and the retention period. The server stores no agreement flag, version or date.
- **Fix:** Have the barangay approve the final notice, then store a consent version and timestamp on each account.
- **Done when:** No placeholders remain, and each account shows when and to which notice version it agreed.

### SEC-18 · P2 · Anonymous reports may not be anonymous
- **Status:** Verify
- **Where:** `adminReport` in `server/server.js`
- **Problem:** The server still returns the reporter's name and zone to the admin console, and I did not confirm that the admin screens hide it.
- **Fix:** Hide identity from the admin view for anonymous reports unless a super admin explicitly reveals it (and log that).
- **Done when:** An anonymous report shows no name in any admin screen or export.

### SEC-19 · P2 · Verified-report alerts expose locations
- **Status:** Confirmed
- **Where:** the verify notification in `PATCH /api/admin/reports/:id`; `GET /api/reports/public`
- **Problem:** The alert to all residents includes the report type and `locationText`, and the public endpoint returns lat/lng to every logged-in user, including medical and crime reports.
- **Fix:** Hide or coarsen locations for sensitive types.
- **Done when:** Sensitive reports show only a general area.

### SEC-20 · P2 · No retention, deletion or export policy
- **Status:** Confirmed
- **Where:** `DELETE /api/admin/residents/:id`
- **Problem:** Deleting a resident leaves their reports and notifications behind. There is no export or erasure request flow for data-subject rights under RA 10173.
- **Fix:** Decide what to anonymize or remove, add export and erase options, and set a retention period.
- **Done when:** A resident's personal data can be exported and removed on request.

### SEC-21 · P2 · Personal data is stored unprotected
- **Status:** Recommended
- **Problem:** Names, phone numbers and addresses are plain JSON in `data.json` or JSONB in PostgreSQL. Backups are not described anywhere.
- **Fix:** Restrict file permissions, use database and disk encryption, encrypt backups, and consider field-level encryption for contact numbers.
- **Done when:** A stolen disk or backup does not expose readable personal data.

### SEC-22 · P2 · Photos keep their hidden metadata
- **Status:** Recommended (the server checks only the file type by magic bytes)
- **Where:** photo upload in `POST /api/reports`
- **Problem:** Phone photos usually carry GPS and device details that could expose a resident's location.
- **Fix:** Re-encode uploaded images and strip metadata.
- **Done when:** Stored photos contain no EXIF data.

### SEC-23 · P2 · Photo storage is local and unprotected
- **Status:** Confirmed
- **Where:** `UPLOAD_DIR` in `server/server.js`
- **Problem:** Photos live on local disk with synchronous writes, are written before the database save (failed saves leave orphans), and disappear on hosts that reset the disk.
- **Fix:** Object storage or a persistent encrypted volume with backups, and clean up orphan files.
- **Done when:** Photos survive a redeploy and are removed with their report.

### SEC-24 · P3 · Push notifications may show sensitive details on the lock screen
- **Status:** Recommended
- **Fix:** Keep push text generic and show details only after the app is opened.
- **Done when:** No notification shows an address or report detail.

## D. Logging, monitoring and response

### SEC-25 · P1 · The audit log is not reliable
- **Status:** Confirmed
- **Where:** `db.activity` in `server/server.js`; `/api/admin/access-log`; `admin/pages/reports.js` (`/admin/log-export`)
- **Problem:** It keeps only the last 200 events in memory, successful and failed logins are not logged, viewing reports and photos is not logged, and the export log is sent by the browser after download and its errors are ignored.
- **Fix:** A durable, append-only audit table written by the server, covering logins, views, exports, status changes and setting changes, with a retention rule.
- **Done when:** A restart keeps the history, and an export cannot happen without a server log entry.

### SEC-26 · P2 · No monitoring or alerts
- **Status:** Recommended
- **Fix:** Alerts for spikes in failed logins, repeated 5xx errors, failed saves, and SOS or report submissions that fail.
- **Done when:** Someone is told within minutes when these happen.

### SEC-27 · P2 · Log hygiene
- **Status:** Verify
- **Fix:** Make sure logs never contain passwords, reset codes, session tokens, contact numbers or full addresses, and set log rotation and access limits.
- **Done when:** A log review finds none of these.

### SEC-28 · P2 · No incident response plan
- **Status:** Recommended
- **Fix:** A short written runbook: who is told, how sessions are revoked, how data exposure is assessed, and when the National Privacy Commission needs notice. Have the barangay's privacy officer review it; this is not legal advice.
- **Done when:** The plan exists and has been rehearsed once.

## E. Server and transport hardening

### SEC-29 · P1 · No HTTPS and cleartext is enabled
- **Status:** Confirmed
- **Where:** `server/server.js` speaks plain HTTP; `app/tool/patch_platforms.dart` enables cleartext traffic
- **Fix:** Require HTTPS in production (reverse proxy), add HSTS, and disable cleartext in release builds.
- **Done when:** The release app refuses to talk to an `http://` server.

### SEC-30 · P3 · CORS defaults to any origin
- **Status:** Confirmed (`CORS_ORIGIN` defaults to `*`)
- **Fix:** Require an explicit origin in production.
- **Done when:** Startup fails in production without it.

### SEC-31 · P3 · Security headers on every response
- **Status:** Verify (a CSP is set for the admin pages)
- **Fix:** Confirm `X-Content-Type-Options: nosniff`, `Referrer-Policy` and frame protection on API, static and photo responses, and send photos with a fixed content type.
- **Done when:** A header check shows them on all responses.

### SEC-32 · P2 · Client IP trust
- **Status:** Verify
- **Where:** `ipOf` in `server/server.js`
- **Problem:** If the server is reachable directly, a forged `X-Forwarded-For` header could dodge per-IP limits.
- **Fix:** Trust that header only from your own proxy.
- **Done when:** Spoofed headers do not change the IP used for limits.

### SEC-33 · P3 · Explicit timeouts
- **Status:** Recommended
- **Fix:** Set request, header and keep-alive timeouts and connection limits on the Node server, and matching limits at the proxy.
- **Done when:** Slow or stalled connections are cut off.

### SEC-34 · P2 · Database connection and permissions
- **Status:** Confirmed for TLS
- **Where:** `server/store.js` sets `rejectUnauthorized: false` when `DATABASE_SSL` is on
- **Fix:** Verify the database certificate by default, and use a database user that can only read and write the app's tables.
- **Done when:** A bad certificate fails the connection.

### SEC-35 · P2 · Admin console is open to the internet
- **Status:** Confirmed (it is served by the same server)
- **Fix:** Put `/admin/` behind a VPN or an IP allowlist.
- **Done when:** The login page is not reachable from outside.

### SEC-36 · P3 · Single-instance design
- **Status:** Confirmed
- **Problem:** Sessions, limits and the report counter live in one process; two instances would collide on `EH-xxxx` IDs.
- **Fix:** Document single-instance use or move this state into the database.
- **Done when:** Deployment notes say which, or the state is shared.

## F. Application logic

### SEC-37 · P2 · Any report status can become any other
- **Status:** Confirmed
- **Where:** `PATCH /api/admin/reports/:id`
- **Fix:** A transition table, a required reason to reopen, and `assignedTo` and `team` checked against `settings.teams`.
- **Done when:** Invalid changes return 400.

### SEC-38 · P2 · HTML injection in the admin map
- **Status:** Confirmed (inline scripts are blocked by the CSP)
- **Where:** `admin/pages/incident-map.js` lines 32, 35, 39; `admin/pages/dashboard.js` line 50 (`bindTooltip` with resident-supplied `locationText`)
- **Fix:** Escape with `esc()` or pass a DOM node.
- **Done when:** A location like `<b>x</b>` shows as plain text.

### SEC-39 · P2 · Abuse controls for SOS and reports
- **Status:** Recommended (applies once SEC-01 is built)
- **Fix:** Per-user limits that never block a genuine emergency, a false-alarm flag admins can set, and review of repeat offenders.
- **Done when:** Spam cannot hide a real SOS, and repeat abusers are visible.

### SEC-40 · P3 · Reports have no least-privilege export
- **Status:** Recommended
- **Fix:** Restrict CSV export to a role, and keep the existing formula protection and masking.
- **Done when:** Only authorized roles can export.

### SEC-41 · P2 · Rejected reports look "just received" in the app
- **Status:** Confirmed
- **Where:** `app/lib/screens/report_result_views.dart` (`_progress[report.status] ?? 1`)
- **Fix:** Show an explicit rejected state with the reason.
- **Done when:** A REJECTED report is never shown as received.

## G. Mobile app

### SEC-42 · P2 · Token and queued photos in plain storage
- **Status:** Confirmed
- **Where:** `app/lib/services/session.dart`, `report_queue.dart` (SharedPreferences)
- **Fix:** Keep the token in the Android Keystore or iOS Keychain (secure storage) and limit what the queue stores on the device.
- **Done when:** The token is no longer readable from app preferences.

### SEC-43 · P1 · Release build is not ready
- **Status:** Confirmed
- **Where:** `app/android/app/src/main/AndroidManifest.xml`, `build.gradle.kts`, `tool/patch_platforms.dart`
- **Problem:** The committed manifest has no INTERNET, location or notification permissions, release builds use debug signing, the app ID is `com.example.ehbr_app`, and there is no `ios/` folder.
- **Fix:** Commit the permissions, a real application ID and a release signing setup that keeps keys out of the repo, and generate `ios/`.
- **Done when:** A signed release build installs, reaches an HTTPS server, and asks for permissions.

### SEC-44 · P3 · App backups and code protection
- **Status:** Verify
- **Fix:** Check `android:allowBackup` so tokens and queued reports are not copied to cloud backups, and build releases with `--obfuscate --split-debug-info`.
- **Done when:** Backup is off or limited, and release builds are obfuscated.

### SEC-45 · P3 · Errors are silently ignored
- **Status:** Confirmed (18 `catch (_)` blocks, for example in `report_screen.dart`, `notifications_screen.dart`, `sos_sheet.dart`)
- **Fix:** Show or log failures in safety-related flows so a failed report or location lookup is not hidden.
- **Done when:** A failed action tells the user or is recorded.

### SEC-46 · P3 · Third-party services see resident location
- **Status:** Recommended
- **Where:** `map_screen.dart` (public OpenStreetMap tiles), `phone.dart` and the SOS text (Google Maps links)
- **Fix:** Use a barangay-approved tile provider and describe these services in the privacy notice.
- **Done when:** The notice names the services that receive location data.

## H. Process and supply chain

### SEC-47 · P2 · Dependencies and builds are not checked
- **Status:** Confirmed (no CI found)
- **Fix:** Commit lock files, run `npm audit` and Flutter dependency checks, enable automated dependency updates, and set a CI workflow that runs the tests on each push. Declare the real Node version (`npm start` uses `--env-file-if-exists`, which probably needs a newer Node than the declared 18).
- **Done when:** CI runs and blocks known-vulnerable dependencies.

### SEC-48 · P2 · Secrets handling
- **Status:** Verify
- **Where:** `ADMIN_PASSWORD`, SMTP credentials, the Firebase service-account file, `DATABASE_URL`
- **Fix:** Keep these in a secret store or protected environment, confirm none were ever committed, and rotate any that were.
- **Done when:** A history scan finds no secrets, and rotation steps are documented.

### SEC-49 · P2 · Missing security tests
- **Status:** Confirmed
- **Problem:** Server tests cover rate limits, login, resets and some admin-only checks, but not the full admin permission matrix, photo access by non-owners, the PostgreSQL store, push, failed saves, or anything in the app and admin console.
- **Fix:** Add tests for each fix in this file.
- **Done when:** Each item above has at least one test that fails without the fix.

### SEC-50 · P2 · Setup documents are out of date
- **Status:** Confirmed
- **Problem:** The README still says photo upload and the SOS screen are not built and that `data.json` is the database; the server header says "zero dependencies" but `pg` is used.
- **Fix:** Update the docs and add a short production security checklist.
- **Done when:** The README matches the code.

### SEC-51 · P1 · No runtime verification yet
- **Status:** Confirmed limitation of this review
- **Fix:** Before go-live, run the app, admin console and server against each item here, and have an independent penetration test done on the deployed system.
- **Done when:** Every "Verify" item is resolved and a test report exists.

## What is already in place

- scrypt password hashing with random salts, and timing-safe comparisons
- Generic login errors and no number enumeration on forgot-password
- Login attempt limits per IP and per number
- One-time reset codes with 5 tries and an expiry; a reset logs out old sessions
- A password check before changing the contact number
- A 10-character strong-password rule for admin password changes
- Input length limits and enum checks on report fields; photo type check by magic bytes; size limits
- Path-traversal protection for static files, and a strict CSP on admin pages
- Admin console escapes text with `esc()`; CSV export neutralizes spreadsheet formulas and masks reporter names
- Audited reveal of a resident's contact number
- Secrets and the data file listed in `.gitignore`
- Offline report queue with duplicate protection (`clientId`)
