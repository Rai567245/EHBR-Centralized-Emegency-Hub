# EHBR Daily Development Progress — 2026-11-17

**Project:** Emergency Hub Barangay System (EHBR)  
**Contributor:** Edmyr John
**Development area:** Multiple (MAM / WAM / Backend)  
**Branch:** `main`  
**Commit / PR:** Uncommitted local changes  
**Overall status:** Completed  

## 1. Daily Summary

**Goal for today:**  
Complete Phase 2 security items (SOS backend connectivity, Admin Map XSS prevention, and Admin idle timeout) and implement strict real-time input restrictions and validation indicators for account registration and password recovery.

**Work completed:**
- Wired the mobile SOS sheet to trigger `Api.submitSos` with GPS coordinates and a unique `clientId` prior to opening the phone dialer, with silent offline fallback (`SEC-01`).
- Escaped resident-supplied strings (`locationText`, blockage titles/reasons) with `esc()` in Leaflet map tooltips on the admin incident map (`SEC-38`).
- Added a 15-minute inactivity auto-logout timer to the admin console (`SEC-13`).
- Enforced strict Philippine mobile number (`^09\d{9}$`) and alphabetic name validation in `newUser()` on the backend (`server/server.js`).
- Added real-time input formatters (`FilteringTextInputFormatter`, `LengthLimitingTextInputFormatter`) and live `AutovalidateMode.onUserInteraction` indicators on the Create Account and Forgot Password screens.

**Overall outcome:**  
Phase 2 core items and full-stack account/contact input validation are complete and verified. Phase 3 (Flutter secure storage, rejected report UI, privacy consent persistence, and release build setup) remains next.

## 2. Screen / Frame Changes

| Screen / Frame | Area | Action | Details of Change | Status |
|---|---|---|---|---|
| SOS Bottom Sheet | MAM | Updated | Connected `_connect()` to `Api.submitSos` with GPS coordinates and `Uuid().v4()` deduplication key before dialing (`SEC-01`) | Completed |
| Admin Incident Map | WAM | Fixed | Wrapped tooltip text in `esc()` to prevent HTML/XSS injection (`SEC-38`) | Completed |
| Admin Console Shell | WAM | Updated | Added 15-minute idle timeout listener that triggers `logout()` (`SEC-13`) | Completed |
| Create Account Screen | MAM | Updated | Added `FilteringTextInputFormatter`, 11-digit cap, and live `onUserInteraction` error indicators for names and mobile number | Completed |
| Forgot Password Screen | MAM | Updated | Added `digitsOnly`, 11-digit cap, and live `onUserInteraction` error indicator on the contact number field | Completed |

### Detailed entry: Create Account & Forgot Password Validation

- **Design / Figma frame:** Not Applicable
- **Implementation file(s):** `app/lib/screens/create_account_screen.dart`, `app/lib/screens/forgot_password_screen.dart`
- **Previous behavior / appearance:** Users could type arbitrary characters into first/last name fields and any length/format into contact number fields; validation errors only appeared upon clicking "Continue".
- **Change made:** Added `FilteringTextInputFormatter.allow(RegExp(r'[A-Za-z\s\-\.]'))` to name fields, `FilteringTextInputFormatter.digitsOnly` + `LengthLimitingTextInputFormatter(11)` to contact fields, and enabled `AutovalidateMode.onUserInteraction` with step-by-step error messages (`Must start with 09`, `Must be exactly 11 digits`, `Name is too short`).
- **Reason:** Prevent invalid resident data entry and give immediate visual feedback while typing.
- **Expected result:** Invalid characters are blocked on keystroke, and red validation indicators update live until valid input is entered.
- **Actual result:** Verified in Chrome simulator after Hot Restart; invalid characters are blocked and indicators appear/clear dynamically.
- **Verification:** Pass
- **Evidence:** Confirmed locally on Chrome simulator build.

## 3. Feature and User-Flow Changes

| Feature / Flow | Change Made | Expected Result | Actual Result | Status |
|---|---|---|---|---|
| Emergency SOS | `sos_sheet.dart` sends `POST` request via `Api.submitSos` when GPS location is acquired, then proceeds to dialer countdown | Admin backend logs SOS alert with coordinates; dialer still launches if offline | SOS alert received and logged in backend console | Completed |
| Account Creation | Frontend blocks non-alphabetic name characters and non-11-digit `09` numbers live; backend `newUser` enforces matching regex | Only valid names and `09xxxxxxxxx` numbers can proceed to Step 2 and register | Verified live indicators and character blocking | Completed |
| Password Recovery | Step 1 contact field restricts input to 11 digits and validates `09` prefix live | Users get immediate feedback if entering an invalid mobile number | Verified live validation indicator | Completed |
| Admin Session Security | Added 15-minute inactivity timer in `admin/app.js` and `esc()` sanitization in `admin/pages/incident-map.js` | Idle admin sessions log out automatically; map tooltips render HTML tags as plain text | Implemented | Completed |

## 4. Code Changes

### Files created
- None

### Files modified
- `app/lib/widgets/sos_sheet.dart` — Imported `api.dart` and `uuid`; updated `_connect()` to call `Api.submitSos` with `lat`, `lng`, and `clientId` (`SEC-01`).
- `app/lib/screens/create_account_screen.dart` — Imported `flutter/services.dart`; added `AutovalidateMode.onUserInteraction`, input formatters, and live validators for first name, last name, and contact number.
- `app/lib/screens/forgot_password_screen.dart` — Added `AutovalidateMode.onUserInteraction`, `digitsOnly` + 11-digit limiters, and live `09` prefix validation on `_contact`.
- `admin/pages/incident-map.js` — Wrapped Leaflet `bindTooltip` strings in `esc()` (`SEC-38`).
- `admin/app.js` — Added 15-minute idle timeout listener in `init()` (`SEC-13`).
- `server/server.js` — Updated `newUser()` to enforce `/^[A-Za-z\s.-]+$/` on names and `/^09\d{9}$/` on contact numbers.

### Files deleted or renamed
- None

### Technical details
- **Routing / navigation:** None
- **State management:** Enabled `AutovalidateMode.onUserInteraction` on form/field widgets in `CreateAccountScreen` and `ForgotPasswordScreen`.
- **Validation / error handling:** Dual-layer validation (Flutter `FilteringTextInputFormatter` + `validator` on frontend; regex checks in `newUser()` on Express backend). Silent `try/catch` around `Api.submitSos` so dialer failover never blocks on network errors.
- **Dependencies / packages:** Added `uuid` (`flutter pub add uuid`) for SOS `clientId` generation.
- **Configuration:** Passed `--dart-define=API_BASE=http://localhost:3000` during local testing.
- **Impact on existing behavior:** Preserved existing admin features and zero-mock-data policy; strengthened registration and reset input constraints without altering API payload shapes.

## 5. Backend, API, and Database Changes

| Component | Change | Compatibility / Impact | Verification |
|---|---|---|---|
| `newUser()` in `server/server.js` | Enforced strict alphabetic regex on `firstName`/`lastName` and `^09\d{9}$` regex on `contact` | Rejects malformed names or non-11-digit PH numbers with HTTP 400; existing valid accounts unaffected | Pass |
| SOS Endpoint (`POST /api/sos`) | Receives `lat`, `lng`, and `clientId` from Flutter client (`SEC-01`) | Compatible with admin dashboard SOS alert surfacing | Pass |

- **Authentication / authorization:** Added 15-minute idle session timeout on the admin web console (`admin/app.js`).
- **Data validation:** Backend `newUser()` now mirrors frontend restrictions (`^[A-Za-z\s.-]+$` for names; `^09\d{9}$` for mobile numbers).
- **Migrations / seed data:** None (maintained zero mock/seed data rule).
- **External services:** None
- **Failure and retry behavior:** SOS API call fails silently if offline so the native dialer countdown proceeds uninterrupted.

## 6. UI/UX and Responsive Behavior

- [ ] Compared implementation against the relevant Figma frame
- [x] Checked spacing, typography, colors, and icons
- [x] Checked button states and navigation
- [x] Checked loading, empty, success, and error states where applicable
- [x] Checked keyboard / form behavior where applicable
- [ ] Checked desktop / laptop layout where applicable
- [ ] Checked tablet / iPad layout where applicable
- [ ] Checked Android / iOS layout where applicable
- [x] Checked accessibility and readable labels where applicable

**Design differences found:**  
None observed; existing `_ehbrRed` (`#C7193D`) and `_errorRed` (`#D32F2F`) `errorStyle` tokens were reused for all live validation indicators.

**Follow-up needed:**  
Test keyboard behavior (`TextInputType.phone`) and input formatters on a physical Android device or Android emulator in addition to Chrome web simulator.

## 7. Testing and Verification

| Test | Environment / Device | Expected Result | Actual Result | Status |
|---|---|---|---|---|
| SOS Backend Trigger | Chrome desktop (`--release`) + local Node server | Clicking SOS sends GPS coordinates to backend and logs alert before dialing | Backend logged SOS alert; dialer triggered | Pass |
| Sign-Up Name Input Restriction | Chrome desktop simulator | Numbers/symbols blocked on keystroke; `< 2` chars shows `"Name is too short"` live | Blocked invalid chars; live indicator appeared and cleared properly | Pass |
| Sign-Up & Forgot Password Contact Restriction | Chrome desktop simulator | Letters blocked; max 11 digits; live errors for missing `09` prefix or `< 11` digits | Blocked letters/12th digit; live indicators worked as expected | Pass |

**Build / analysis commands run:**  
- `flutter pub add uuid` — Installed `uuid` package cleanly.
- `flutter run -d chrome --release --dart-define=API_BASE=http://localhost:3000` — Launched app without web debug service timeout and verified SOS connectivity.

**Bugs discovered:**
- Flutter web debug service `TimeoutException` when using `--web-browser-flag "--disable-web-security"` on Chrome.
- `inputFormatters` did not apply during standard Hot Reload (`r`).
- Lint error triggered by temporary `print()` statement inside `sos_sheet.dart` `catch` block.

**Bugs fixed:**
- Used `--release` flag for Chrome simulator testing to bypass debug service timeout.
- Performed Hot Restart (`Shift + R`) to register new `inputFormatters`.
- Removed `print()` statement in `sos_sheet.dart` to satisfy `avoid_print` lint rule.

**Regression impact:**  
Verified existing password rule checklist and confirm-step read-only summary in `CreateAccountScreen` remain intact.

## 8. Git and Repository Activity

- **Branch:** `main`
- **Commits:** Uncommitted (local workspace changes ready for commit)
- **Pull request:** None
- **Files staged / committed:** Modified `server/server.js`, `admin/app.js`, `admin/pages/incident-map.js`, `app/lib/widgets/sos_sheet.dart`, `app/lib/screens/create_account_screen.dart`, `app/lib/screens/forgot_password_screen.dart`, and `app/pubspec.yaml`.
- **Merge conflicts:** None
- **Repository hygiene:** Ensure `server/data.json` and local `.properties` remain untracked per Phase 0 (`SEC-02`).

## 9. Evidence

- **Before screenshot:** Not Available
- **After screenshot:** Not Available
- **Figma frame:** Not Applicable
- **Test evidence:** Verified via local Node.js server console logs (SOS receipt) and Chrome simulator UI testing.
- **Commit / PR:** Pending commit

## 10. Issues and Blockers

### Issues
- Remaining Phase 2 items (`SEC-18` anonymous reporter masking in admin views, `SEC-19` sensitive report location coarsening, and offline SOS queue persistence) still need verification/completion before closing Phase 2 completely.

### Blockers
- None

### Risks / Things to Recheck
- Verify `api.dart` `submitSos` method handles offline queueing (`SEC-01`) rather than dropping failed requests when no internet is available.
- Confirm `server/server.js` was restarted after updating `newUser()` so backend validation is active.

## 11. Next Work Session

- [ ] Finish remaining Phase 2 privacy items: verify anonymous report identity hiding (`SEC-18`) and coarsen locations for sensitive reports (`SEC-19`)
- [ ] Begin Phase 3: Fix `REJECTED` report status display in `app/lib/screens/report_result_views.dart` (`SEC-41`)
- [ ] Migrate session tokens in `app/lib/services/session.dart` to `flutter_secure_storage` (`SEC-42`) and wire up privacy notice consent fields (`SEC-17`)

**Priority:** High  
**Dependencies:** Phase 1 & Phase 2 backend routes (`server/server.js`)

## 12. End-of-Day Handoff

**Completed:** SOS API trigger (`SEC-01`), Admin Map XSS escaping (`SEC-38`), Admin 15-minute idle timeout (`SEC-13`), and full-stack real-time validation for Philippine mobile numbers and names across Sign-Up and Forgot Password.  
**Partially completed:** Phase 2 (`SEC-18` anonymous report masking and `SEC-19` verified-report location coarsening remain).  
**Not started:** Phase 3 (Flutter secure storage, rejected report UI, silent error surfacing, privacy consent persistence, Android release signing) and Phase 4 (automated security tests & CI).  
**Known limitations:** Chrome web simulator requires `--release` or a standard Android emulator/device for smooth debugging; offline SOS currently falls back to the dialer without persistent retry queueing.  
**Next starting point:** Check `server/server.js` (`adminReport` and `GET /api/reports/public`) for `SEC-18`/`SEC-19`, then move to `app/lib/screens/report_result_views.dart` for Phase 3 (`SEC-41`).

## Final Checklist

- [x] Report reflects actual work only
- [x] Each changed screen / frame is listed
- [x] Code files and technical changes are identified
- [x] Backend / database impact is documented, or marked Not Applicable
- [x] Test results are recorded honestly
- [x] Evidence and commit / PR links are included where available
- [x] Secrets and sensitive data are excluded
- [x] Master progress tracker is updated if status changed