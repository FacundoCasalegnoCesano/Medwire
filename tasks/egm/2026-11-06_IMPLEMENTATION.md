# Implementation record: approved product improvements

**Source:** [2026-11-06_IMPROVEMENTS.md](2026-11-06_IMPROVEMENTS.md)
**Branch:** `codex/egm-improvements`
**Status:** implementation and verification complete.

## Scope

1. **Analysis budget:** check the cooperative deadline during finding comparisons, retain at most 80 evidence items, and report partial coverage when work stops early.
2. **Check history:** add cursor pagination and a “load earlier runs” action while preserving workspace isolation and run summaries.
3. **Worker diagnostics:** report allowlisted operation and failure codes for missing database configuration, refused database connections, and other queue failures. Keep raw error messages, connection strings, and job payloads out of logs. Handle missing `DATABASE_URL` before importing the database client so startup failures reach the safe diagnostic.
4. **Monitor listing:** resolve workspace entitlement once per list request. Capture monitor rows, query count, and elapsed time in the integration fixture before considering pagination or broader query batching.

## Acceptance and progress

- [x] Analysis timeout stops inside the finding loop, excludes the incomplete file, marks partial coverage, and bounds retained evidence at 80.
- [x] History pages are ordered, complete, duplicate-free, and workspace-scoped.
- [x] Worker diagnostics distinguish configuration, refused connection, and queue failures without exposing error contents or secrets; the entrypoint test proves missing configuration is caught before database imports.
- [x] Monitor listing resolves entitlement once for the request; the existing workspace filter and view fields remain covered by unit tests.
- [x] Integration fixture reports row count, counted ORM calls, and elapsed milliseconds for one authenticated list request. This is local fixture evidence, not production latency or exact SQL count.

## Verification results

- Unit suite: **137/137 passed**. Full disposable-database integration suite: **27/27 passed**, including the v3 retry case. After the history empty-cursor fix, focused history and monitor integration: **13/13 passed**, including empty-cursor HTTP 400 and cross-workspace isolation.
- Root lint, typecheck, and final production build passed. The build was rerun after the deterministic latest-run tie-break fix.
- The analyzer budget probe with a 1,500 ms fake clock returned at 1,500 ms with 0 files analyzed, 1 skipped, the time-limit reason present, and partial coverage. This is controlled fake-clock evidence, not a production timing claim.
- The monitor-list fixture measured **1 row, 5 ORM calls, 23.92 ms**. The ORM count excludes authentication work and does not represent exact SQL statements; elapsed time is from the local disposable fixture, not production.
- Running the actual worker entrypoint against the closed loopback port `127.0.0.1:1` exited with status 1 and emitted exactly `Monitoring worker-start failed [DATABASE_CONNECTION_REFUSED].` Missing-configuration startup is separately covered by the child-process test.
- Browser history verification passed: initial page showed 50 runs; loading older history and polling reached all 53 runs. Mobile showed all 53 with no horizontal overflow. Console errors and page errors were both empty. The verification reported zero remaining browser-created users.
- Screenshots and report: [desktop](../../.cache/egm-improvements/history-desktop.png), [mobile](../../.cache/egm-improvements/history-mobile.png), [report JSON](../../.cache/egm-improvements/history-report.json). The initial failed attempt artifacts remain available separately.
- Tied `queuedAt` values exposed an SSR/API ordering mismatch. `latestRun` now uses the same `queuedAt DESC, id DESC` order as the history API; its focused integration assertion passed 1/1. A fresh scoped code review passed after the fix.
- The v3 default-only migration was applied only to the disposable loopback `_test` database; no production migration was applied. No new public Git worker QA was performed, and this work did not complete or claim the formal five-stage EGM review.
- Preview port 3100 and disposable PostgreSQL port 55432 were verified stopped. No production deployment was performed.

## Focused verification

Run unit tests with a writable temporary directory if Windows reports `EPERM`:

```powershell
$env:TEMP = (Resolve-Path .cache/verification-temp).Path
$env:TMP = $env:TEMP
npm test -- --run src/lib/monitor-worker-diagnostics.test.ts src/lib/monitor-worker-entrypoint.test.ts src/lib/monitors.test.ts
```

Run the monitor integration fixture against a dedicated loopback database whose name ends in `_test`:

```powershell
$env:AUTH_TEST_DATABASE_URL = 'postgresql://postgres@127.0.0.1:55432/mendwire_roadmap32_test?schema=public'
npm run test:integration -- src/lib/monitors.integration.test.ts
```

The integration test spies on the Prisma model methods used by monitor listing around one `GET /api/monitors`, then prints `[monitor-list-baseline] rows=… orm_calls=… elapsed_ms=…`. The captured run was `rows=1 orm_calls=5 elapsed_ms=23.92`. This counts ORM calls made by listing, not authentication SQL or exact SQL statements, and measures a disposable local fixture rather than production. The fixture exercises one listed monitor; add data only through the dedicated `_test` database setup.
