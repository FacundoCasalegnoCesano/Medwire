# Monitoring implementation progress

This ledger records the coordinated implementation of roadmap tasks 3.1 and 6.1, with the first-baseline onboarding work from 5.1. The source of requirements remains `tasks/plan.md` and `tasks/todo.md`.

## Completion status

Root review is complete for the implemented scope of 3.1, 6.1 and the first-baseline portion of 5.1. Final verification passed: 74/74 unit tests, 13/13 PostgreSQL integration checks via `scripts/test-auth-integration.ps1` against loopback `mendwire_test`, typecheck, lint and production build. Root's independent live UI and desktop/mobile screenshot review found no blocking issue. Evidence and the queued-response `firstRunOutcome: null` detail are recorded in [`monitoring-verification.md`](monitoring-verification.md).

The 6.1 policy defines bounded limits and trusted entitlement gates; durable usage-ledger/reservation enforcement, atomic counters and recovery remain 6.2. Repository impact analysis remains 3.2. No status here claims those future tasks are complete.

## Scope and ownership

- `monitoring_engine`: persisted contract baseline and execution/history DTOs, protected routes, manual and scheduled checks, real execution state, and worker/runtime instructions.
- `beta_policy`: versioned beta entitlement and usage policy, with server-side `runCheck` capability resolution.
- `monitoring_ui`: monitor execution detail/history, manual check controls, first-baseline onboarding and source-error recovery links; queue wrapper and worker entrypoint added by explicit handoff.
- `root`: integration, repository-wide verification and completion status.

## UI contract agreed

- Monitor details expose `monitoringStatus` as `READY`, `QUEUED`, `RUNNING` or `PAUSED`; `pauseReason` distinguishes withdrawn from entitlement denial.
- Monitor details expose a real `baseline` (`revisionId`, `savedAt`), latest run, last successful check, next check, and `manualCheck.allowed/reason` from server policy.
- `GET /api/monitors/:id/checks` returns `{ runs: CheckRunSummary[] }`; `POST` to the same path requests a manual check with an `Idempotency-Key` and returns `{ run }`.
- Run outcomes include `BASELINE_SAVED`, `UNCHANGED`, `NO_CHANGES`, `CHANGES_FOUND`; first baseline is success without a finding.
- Beta permits manual checks subject to the server-provided gate and a configurable 300 second manual cooldown. Scheduled checks use a 24 hour frequency. The UI consumes the server gate and does not calculate entitlements or usage locally.
- Detail route is `/app/monitors/:id`; source editing moves to `/app/monitors/:id/edit` so execution state and history have a persistent home.
- pg-boss queue names are `monitor-check` with payload `{ runId }` and `monitor-dispatch` with an every-minute dispatcher. The worker delegates run and dispatch processing to `monitor-checks.ts`; persisted run rows provide business idempotency.

## Baseline and verification

- Before code changes, a SHA-256 file snapshot was created at `.cache/phase-31-baseline` (257 source/config/documentation files plus `manifest.csv`). It excludes environment files, Git data, dependencies, build output, caches and temporary data. A verified custom-format `pg_dump` for loopback `mendwire` was saved there (`pg_restore --list` confirms the archive; 14,589 bytes).
- Checkout is `master` with no commit/HEAD. The additive migration `20261103000000_monitor_checks` was applied to loopback databases `mendwire_test` and `mendwire` after backup. Protected counts remained unchanged: test DB User/Workspace/Monitor = 0/0/0; app DB = 2/2/0. No reset or deletion occurred.
- The monitor detail/edit routes, status/history panel, manual check action, source-error field links and first-baseline onboarding are implemented. `npm run lint`, `npm run typecheck`, and root's production build passed. The app and worker ran locally against the migrated database.
- `.cache/phase31-browser.mjs` uses the existing Playwright runtime, a disposable identity, verified public Petstore sources, loopback app URL, and exact-account cleanup restricted to local `mendwire`. Report: `.cache/browser-artifacts/phase31-2026-11-03T19-26-46-126Z-report.json`. It records a manual POST (202), successful queued run with DB trigger `MANUAL`, actual baseline saved, history and baseline visible after reload, and no console/page errors. The run's first POST response was `QUEUED`; completion and `BASELINE_SAVED` were confirmed in history and the persisted baseline.
- Browser evidence includes desktop 1440×960 and mobile 390×844 screenshots. Keyboard navigation reached the manual-check and Edit sources controls; mobile reported no horizontal overflow. The first baseline SHA-256 revision was `371bf7809f1aa3ac786fbadb5331254ad6c6b74e5d67028e779858bc8d279780`.
- Root independently reviewed the desktop/mobile captures and live browser flow with no blocking issue.
- Follow-up UI review fixes: queued runs continue polling even when the server-rendered monitor prop is still READY; manual cooldown availability refreshes at the server-supplied `manualCheck.availableAt`; `CHANGES_FOUND` is called “Breaking changes found” only when a `BREAKING` finding exists and “Changes need review” for `POTENTIAL` findings; failed history fetches display “History is unavailable right now.” Targeted ESLint for owned UI/worker files passes.
- `server-only@0.0.1` is installed. The worker entrypoint loads local environment configuration through Node's env-file option and uses the React server condition for server-only modules; it started successfully and processed the real check.
- Root confirmed final verification: 74/74 unit tests, 13/13 database integration tests through `scripts/test-auth-integration.ps1`, typecheck, lint and production build passed; independent desktop/mobile browser review passed. `tasks/todo.md`, `tasks/beta-policy-verification.md` and `tasks/monitoring-verification.md` record the verified portions of 3.1, 6.1 and 5.1. No evidence here establishes consumer-code analysis, repair proposals, pull requests, billing, owner administration or production deployment.
