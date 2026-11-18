# Installation and Local Development Setup Guide

**Repository:**
https://github.com/Rai567245/EHBR-Centralized-Emegency-Hub/tree/main

**Workflow:** GitHub website for repository management; VS Code terminal
for local setup and development.

> **Important:** This guide is based on the supplied project notes.
> Verify commands, paths, scripts, and features against the current
> repository before running them. Source code and current manifests take
> precedence over older documentation.

## 1. System overview

| Component   | Purpose                      | Technology described in supplied notes                    |
| ----------- | ---------------------------- | --------------------------------------------------------- |
| **MAM**     | Resident mobile application  | Flutter                                                   |
| **WAM**     | Barangay admin console       | Plain HTML, CSS, and JavaScript served by the server      |
| **Backend** | API and application services | Node.js                                                   |
| **Storage** | Application data             | `server/data.json` by default; PostgreSQL when configured |

The backend is the central source of data. Admin-managed information
should flow to residents through backend APIs. Resident reports should
flow to the backend and become available to authorized administrators.
Empty databases must produce honest empty states---not dummy residents,
reports, announcements, contacts, or other fabricated official content.

## 2. Install and verify development tools

Install as required:

-   VS Code: https://code.visualstudio.com/
-   Node.js 18+: https://nodejs.org/
-   Flutter SDK: https://docs.flutter.dev/get-started/install
-   Android Studio / Android SDK for Android development:
    https://developer.android.com/studio
-   Chrome for Flutter web testing, if the web platform is configured.
-   PostgreSQL and pgAdmin only if using PostgreSQL:
    https://www.postgresql.org/download/

Open VS Code → **Terminal → New Terminal** (PowerShell) and check:

``` powershell
node --version
npm --version
flutter --version
dart --version
java -version
flutter doctor -v
```

Resolve the required Flutter/Android toolchain issues before attempting
Android builds. Use a Java version compatible with the project's Android
Gradle Plugin.

## 3. Download the project from GitHub

This workflow does not require manually running Git commands:

1.  Open https://github.com/Rai567245/EHBR-Emegency-Hub-Barangay-Rizal
2.  Select **Code → Download ZIP**.
3.  Extract the archive to your development folder.
4.  In VS Code, choose **File → Open Folder** and open the extracted
    repository root.
5.  Confirm the actual project structure.

GitHub does not automatically synchronize the extracted ZIP with your
local files. After editing and testing, upload selected changed files
through the GitHub website using **Add file → Upload files**, preserve
their folder paths, review the changes, and commit through the website.

GitHub uses Git internally, but this guide avoids Git terminal commands.
GitHub Desktop is an optional graphical alternative:
https://desktop.github.com/

## 4. Inspect before installing

At the repository root, open a PowerShell terminal:

``` powershell
Get-Location
Get-ChildItem -Force
Get-ChildItem -Recurse -File -Include pubspec.yaml,package.json,package-lock.json,pnpm-lock.yaml,yarn.lock,server.js,README.md,.env.example
```

Read the actual README files, manifests, lockfiles, and scripts in each
application directory.

Do not run project-generation commands, dependency upgrades, or database
setup just because they appear in older instructions. Confirm that the
relevant files and requirements exist first.

## 5. Start the backend and WAM

The supplied notes describe a Node.js server serving the admin console
and API on port `3000`.

``` powershell
cd server
Get-ChildItem -Force
```

If `server.js` exists and current documentation confirms direct startup:

``` powershell
node server.js
```

If the project has a `package.json`, inspect its available scripts:

``` powershell
npm run
```

Use only a script that actually exists, such as `npm start` if defined.
Do not assume `npm run dev` exists.

If startup succeeds and the server confirms port `3000`, open:

http://localhost:3000/admin/

Use the administrator account creation/login instructions in the current
server code or documentation. Do not assume a default password. Keep
generated credentials private.

The supplied notes say the first run creates `server/data.json` for JSON
storage. Verify this in the current implementation. Treat this file as
sensitive application data; never upload it to GitHub.

## 6. Configure genuine barangay information

After signing in to WAM, configure the sections that actually exist:

| Admin section          | Configure                                            | Resident-side use          |
| ---------------------- | ---------------------------------------------------- | -------------------------- |
| **Barangay profile**   | Official name, locality, hotline, map center         | App identity and contacts  |
| **SOS settings**       | Approved dial number and behavior                    | SOS action                 |
| **Emergency contacts** | Verified police, fire, medical, and utility contacts | Contacts and quick actions |
| **Zones / Puroks**     | Actual zones                                         | Registration and records   |
| **Evacuation centers** | Official name, status, capacity, coordinates         | Home and map               |
| **Announcements**      | Approved advisories and notices                      | News and home feed         |

Do not create invented records to make the app look populated. Empty
sections must display appropriate empty states.

## 7. Set up MAM Flutter dependencies

Open a new terminal from the repository root:

``` powershell
cd app
Test-Path pubspec.yaml
```

If the manifest exists:

``` powershell
flutter pub get
flutter analyze
flutter test
flutter devices
```

Run on Chrome if web is configured:

``` powershell
flutter run -d chrome
```

Or run on an available emulator/device:

``` powershell
flutter run
```

Useful commands:

  Command               Purpose
  --------------------- ------------------------------
  `flutter pub get`     Resolve/install dependencies
  `flutter analyze`     Static analysis
  `flutter test`        Run existing tests
  `flutter devices`     List available devices
  `flutter doctor -v`   Diagnose SDK/toolchain

Avoid routine `flutter pub upgrade` and `flutter clean`. Upgrade
dependencies only as a planned task; clean only when troubleshooting a
specific build-cache issue.

### Platform scaffolding warning

Older notes proposed:

``` powershell
flutter create . --org ph.barangay --project-name ehbr_app --platforms=web,android,ios
```

Do not run this routinely. Use it only if required platform folders are
genuinely missing, after inspecting the project and backing up existing
configuration. It can generate or alter platform files.

Older notes also mention:

``` powershell
dart run tool/patch_platforms.dart
```

Run this only if that exact script exists, has been reviewed, and is
still required.

## 8. Configure API connectivity

The supplied notes describe port `3000` and an `API_BASE` Dart define.
Confirm the current Flutter source supports this configuration.

  Runtime                          Address described in supplied notes
  -------------------------------- -------------------------------------
  Chrome on development computer   `http://localhost:3000`
  Android emulator                 `http://10.0.2.2:3000`
  Physical phone                   `http://<computer-LAN-IP>:3000`

Example for a physical phone (replace with the computer's actual LAN
IP):

``` powershell
flutter run --dart-define=API_BASE=http://192.168.1.20:3000
```

The phone and computer generally need the same network, and the firewall
must permit the connection. Do not hardcode a developer's LAN address
into production configuration. Use HTTPS and secure deployment
configuration before handling real resident data outside local
development.

## 9. Database setup

### Option A --- JSON-file storage

The supplied notes describe `server/data.json` as the default when
`DATABASE_URL` is not set. Verify this behavior in the current backend.

-   Keep the file private and back it up securely.
-   Never commit it to GitHub.
-   Do not manually edit it while the server is running.
-   Do not put real resident data into development tests.

### Option B --- PostgreSQL

The supplied notes describe PostgreSQL support when `DATABASE_URL` is
configured, with JSON-file fallback.

Before enabling it, inspect the current server code, package manifest,
schema initialization, and import/migration behavior. Confirm whether
the `pg` package is already declared.

For an npm project with a committed `package-lock.json`, install its
declared dependencies using:

``` powershell
npm ci
```

Do not blindly run `npm install pg`; adding a dependency changes
manifests and lockfiles and should be an approved change.

Example connection variable (use a local development database and your
own credentials):

``` powershell
$env:DATABASE_URL = "postgres://postgres:YOUR_PASSWORD@localhost:5432/ehbr"
```

Follow current code for any SSL setting required by hosted PostgreSQL.

**Database safety:** back up before migration/import; never use
production credentials; do not run destructive SQL or migrations without
explicit approval; do not run multiple server instances against one
database unless supported.

## 10. Optional Firebase push notifications

The supplied notes describe in-app notifications separately from
optional Firebase Cloud Messaging (FCM) push notifications. Inspect the
current Firebase implementation before configuring it.

The notes list these optional tools:

``` powershell
npm install -g firebase-tools
firebase login
dart pub global activate flutterfire_cli
```

Then, if the current Flutter app supports FlutterFire:

``` powershell
cd app
flutterfire configure
```

Choose the correct Firebase project and supported platforms.

The supplied notes refer to `server/firebase-service-account.json`.
Treat service-account files as secrets: never upload, share, or commit
them. Ensure they are excluded from GitHub and use secure secret
management for hosted deployments.

If push is not configured, the app must not claim a push notification
was delivered. Verify that in-app notification behavior remains distinct
and functional.

## 11. End-to-end local verification

Use separate VS Code terminals for backend and MAM:

1.  Start the backend with its verified command.
2.  Confirm WAM loads at the documented local URL.
3.  Confirm the configured storage initializes safely.
4.  Enter only genuine, authorized barangay information.
5.  Start MAM on Chrome or an emulator.
6.  Verify MAM retrieves admin-managed information through the backend.
7.  Submit a clearly identified synthetic test report in the development
    environment.
8.  Confirm it is persisted and visible to authorized administrators.
9.  Update its status in WAM.
10. Confirm the status is reflected in the resident app.
11. Test offline queue behavior in a controlled development environment.
12. Verify loading, empty, API-error, offline, and recovery states.

Do not claim an SOS reached responders, a report was delivered, or a
notification was received without actual delivery/acknowledgment
evidence.

## 12. Troubleshooting commands

Check project files:

``` powershell
Get-ChildItem -Force
```

Check environment-file names without printing their contents:

``` powershell
Get-ChildItem -Force -Name .env*
```

Inspect whether port 3000 is in use:

``` powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen
```

Identify the process before stopping anything. Do not terminate an
unknown process.

## 13. Security and GitHub upload rules

Never upload:

-   `.env` files or credentials
-   Firebase service-account JSON or private keys
-   Database files/backups containing personal data
-   Resident records, report attachments, or private logs
-   Tokens, passwords, or production connection strings

Review `.gitignore` before uploading. Exclude local data, uploads
containing personal information, build outputs, caches, and secrets. Use
HTTPS for deployed environments and enforce authorization on the
backend---not merely by hiding admin controls in the UI.

## 14. Older feature notes that need re-verification

The supplied project notes contain potentially outdated or contradictory
statements about report photo uploads, SOS confirmation, SMS, automatic
escalation, password reset, multiple admin accounts, and role
management.

Treat these as audit leads, not confirmed current limitations. Inspect
the current Figma, MAM, WAM, backend, and database before updating the
roadmap.

## 15. Setup checklist

-   [ ] Install VS Code, Node.js, Flutter, and Android Studio as needed.
-   [ ] Verify versions and run `flutter doctor -v`.
-   [ ] Download and extract the GitHub ZIP.
-   [ ] Open the repository root in VS Code.
-   [ ] Inspect actual manifests, lockfiles, scripts, and documentation.
-   [ ] Start the backend using its verified command.
-   [ ] Confirm WAM loads.
-   [ ] Configure only genuine barangay information.
-   [ ] Run `flutter pub get` in the existing MAM project.
-   [ ] Run `flutter analyze` and `flutter test`.
-   [ ] Start MAM on the intended device.
-   [ ] Verify API connectivity.
-   [ ] Verify persistence and admin/resident synchronization.
-   [ ] Test empty, loading, offline, and error states.
-   [ ] Check `.gitignore` for secrets and private data.
-   [ ] Review changed files before manually uploading them to GitHub.

## 16. Development rule

This guide covers local environment setup. It does not authorize broad
code changes, migrations, production deployment, or feature
implementation.

For development tasks, follow:

**Inspect → Analyze → Plan → Obtain approval → Implement → Test → Review
→ Document.**

Work on one bounded screen, workflow, or backend change at a time.
Preserve existing architecture and working features. Keep Figma, MAM,
WAM, backend, and database aligned through evidence-based verification.
