# Monitoring checks verification (3.1)

This document records the backend monitoring-check implementation for roadmap task 3.1, its dependency on the beta entitlement contract in 6.1, and the first-baseline portion of onboarding task 5.1. The recorded local database and browser checks below have passed; this does not claim production deployment.

## Runtime shape

A monitor is eligible for checks only when its saved sources are `READY`. The first successful worker run stores the canonical OpenAPI document and revision hash as a baseline and reports `BASELINE_SAVED` without findings. Later valid documents are compared with oasdiff 1.35.0. The service stores a snapshot before comparison and links it to the run; if comparison fails, it keeps the previous baseline and allows a new idempotency key to retry that exact saved transition. Equal canonical documents produce `UNCHANGED`; compatible or documentation-only revisions produce `NO_CHANGES`; detected issues produce `CHANGES_FOUND` with method/path or schema location, summary, code, and severity.

The fetcher reuses the monitor source safeguards: public HTTPS only, address validation and pinned DNS, bounded redirects/time/bytes, JSON or YAML parsing, and internal references only. The diff runs as the pinned external CLI with external refs disabled, bounded execution/output, temporary private files, and cleanup. OpenAPI 3.0 and 3.1 are supported. The bundled engine documents incomplete comparison of `$dynamicRef`/`$dynamicAnchor` and component `pathItems`; the validator rejects dynamic refs and keeps remote refs unsupported.

PostgreSQL stores `ContractSnapshot` and `CheckRun` history, current revision, contract version, scheduling timestamps, policy state, and worker lease/claim token. `pg-boss` stores durable jobs in the same database. A queued run and its pg-boss job are written through the same Prisma transaction adapter. Worker claims use expiring leases and tokens; snapshot writes and completion require the active token and the original ready monitor/configuration. The recurring dispatcher checks due monitors and recovers expired claims. Duplicate requests use an `Idempotency-Key`; an active-run index permits at most one queued/running check per monitor. Retiring or editing a monitor prevents a pending or stale job from committing success against the old configuration.

The checks API is `GET` and `POST /api/monitors/:id/checks`. It derives the workspace from the authenticated session, scopes monitor lookups by that workspace, and ignores any workspace, plan, or role sent by a client. POST requires allowed Origin, JSON body `{}`, and `Idempotency-Key`. Run history is private to the owning workspace. The worker derives ownership from the persisted monitor/workspace relation and rechecks entitlement and monitor state at execution time.

`MonitorView` exposes `monitoringStatus`, `pauseReason`, `manualCheck` including server-computed cooldown availability, `baseline`, `lastRun`, `lastSuccessfulCheckAt`, and `nextCheckAt`. Scheduled intervals and manual cooldown come from the versioned beta policy. The policy defaults to three active monitors, 24-hour checks, and 300 seconds between manual requests. Creating or reactivating a monitor enforces the active-monitor cap under a workspace lock. No usage ledger, analysis allowance consumption, or proposal execution is included here.

## Local commands

Install dependencies with `npm install`, generate the Prisma client, apply the additive migration to the intended local database, install the pinned oasdiff binary, then run the app and worker separately:

```powershell
npm run db:generate
npm run db:migrate
npm run install:oasdiff
npm run dev
# separate terminal, same DATABASE_URL
npm run worker:monitoring
```

The local worker entrypoint loads `.env` and sets Node's `react-server` condition so the React `server-only` marker resolves in Node. The binary installer downloads oasdiff 1.35.0 and verifies the release asset SHA-256; `OASDIFF_PATH` can point to an already audited matching binary.

Unit checks:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

The database integration suite requires a dedicated local loopback database ending in `_test`. `scripts/test-auth-integration.ps1` loads the ignored local test URL and runs the integration suite without printing it. Tests create uniquely named accounts and only delete those test users through cascading relations.

## Verification record

- [x] Prisma Client generated from the updated schema.
- [x] TypeScript typecheck passed after DTO, service, route, queue, and UI integration.
- [x] ESLint passed for the current tree.
- [x] Full unit suite passed (74 tests); focused monitor/source/diff tests passed (53 tests).
- [x] `scripts/test-auth-integration.ps1` passed against the dedicated loopback `mendwire_test` database (13/13), including persistence, duplicate delivery, worker restart/lease recovery, withdrawal/edit races, policy cap and cross-workspace checks.
- [x] Oasdiff 1.35.0 was checked against controlled removed-endpoint, compatible-addition, description-only, and newly-required-property fixtures by the integration agent.
- [x] The additive migration was applied to local `mendwire_test` and `mendwire`; the operator reported preserved counts (`mendwire_test`: zero existing auth/workspace/monitor rows; `mendwire`: 2 users, 2 workspaces, 0 monitors).
- [x] The standalone worker started against the local app database and created the pg-boss schema.
- [x] The app and worker ran together. Browser verification created a fresh monitor from verified public Petstore OpenAPI and Git sources, requested a manual run (HTTP 202), observed the persisted run and real baseline, reloaded the page, and confirmed baseline/history remained visible. The run trigger was `MANUAL`; the POST response itself correctly recorded the initial `QUEUED` state.
- [x] Keyboard navigation reached the manual-check and Edit sources controls. At 390×844, the page had no horizontal overflow. Console and page errors were empty. Root's independent CUA review of the live app and desktop/mobile captures passed. The final browser report records 1440×960 and 390×844 viewports, successful history, and no page or console errors.

Browser evidence: [report JSON](../.cache/browser-artifacts/phase31-2026-11-03T19-26-46-126Z-report.json), [desktop baseline screenshot](../.cache/browser-artifacts/phase31-2026-11-03T19-26-46-126Z-baseline-desktop.png), and [mobile baseline screenshot](../.cache/browser-artifacts/phase31-2026-11-03T19-26-46-126Z-baseline-mobile.png). The report's `firstRunOutcome` is null because it captured the initial queued POST response; terminal `BASELINE_SAVED`, trigger, and revision persistence were confirmed in run history/database and after page reload.

The shared entitlement policy is versioned (`beta-2026-11-v1`), resolves from trusted workspace records, and maps beta/paid/canceling/overdue/expired/unknown states to bounded capabilities. Defaults are three active monitors, 24-hour scheduled checks, and a 300-second manual cooldown. Paid access has no approved commercial price; monthly usage ledger and reservation enforcement remain 6.2 work.

The monitoring database migration is additive: it adds workspace entitlement columns and enum, monitor revision/schedule fields, snapshots and check-run tables, indexes, foreign keys, and initializes `nextCheckAt` for ready monitors. The local database migration, integration suite, and browser evidence are recorded above; no production database was migrated.
