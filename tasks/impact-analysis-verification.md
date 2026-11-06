# Task 3.2 impact-analysis UI verification

## 2026-11-06 refresh

The feature was already implemented before this refresh. A focused review found coverage and classification gaps, which have been corrected in analyzer v2. Fresh unit, integration, lint, typecheck, and build checks passed on 2026-11-06. Browser and public-worker checks were not repeated; results below remain historical evidence for those checks.

Analyzer v2 now treats Axios defaults, interceptors, custom instances/configuration, and invalid named or namespace imports conservatively; uncertain Axios use stays a candidate instead of becoming confirmed. It resolves relative OpenAPI server URLs against the contract document URL. Breaking endpoint removals, including path-item removals and unresolved references in the next contract, are handled as candidates when the analyzer cannot prove the affected request. Git submodules are explicitly counted as skipped coverage. Analysis uses a cooperative 1.5-second budget; this is a cooperative bound, not a hard interrupt for synchronous work.

New and successfully reprocessed analyses are stamped `impact-ts-v2`. The forward migration updates the database default for new rows; existing v1 rows retain their original version until reprocessed. The retry integration case checks that an old queued analysis is labeled v2 after successful processing.

Fresh check results for the 2026-11-06 refresh:

- `npm test`: 130/130 passed; lint, typecheck, and production build passed. `npm run db:generate` passed after the Prisma version-default change.
- Disposable PostgreSQL integration suite: 26/26 passed across 4 files against the isolated `mendwire_roadmap32_test` fixture on loopback port 55432. The focused real-analyzer persistence case passed after its fixture used the actual `api-path-removed-without-deprecation` finding code. The retry regression confirmed a legacy v1 row is stamped v2 after successful reprocessing.
- The first full integration attempt reported two failures. The real-analyzer failure came from a synthetic `endpoint-removed` fixture code that v2 correctly did not treat as a proven removal; correcting it to the actual oasdiff code fixed the case. The monitor baseline enqueue failure passed on isolated replay and on the full rerun without runtime changes; its first 503 did not reproduce, so its cause remains undetermined.
- This refresh did not repeat browser QA or public GitHub worker runs. Their 2026-11-04 evidence remains historical and is listed below.

## Status

The UI, API, and worker are integrated and the 2026-11-06 source changes pass fresh automated checks. Browser and public GitHub worker verification remains at the historical 2026-11-04 scope below. The support boundary and provenance remain explicit.

## Feature behavior to verify

Evidence combines automated tests, code review, and browser QA: integration tests cover workspace isolation and retries; review covers polling cleanup and accessible status semantics; browser QA covers the request-to-worker-result flow, persistence, keyboard navigation, mobile layout, and dates. No screen-reader session was performed.

- [x] An action appears only for a successful `CHANGES_FOUND` check with at least one `BREAKING` finding.
- [x] Analyze sends an empty JSON object, a browser `Origin`, and a UUID `Idempotency-Key`. A successful request stores and displays the returned analysis summary.
- [x] `QUEUED` and `RUNNING` update every 2.5 seconds. Leaving the monitor view stops polling. Status and the pinned commit SHA remain visible.
- [x] `SUCCESS` shows analyzed/discovered/skipped counts, coverage status and reasons, plus separate supported, candidate, and unsupported evidence sections.
- [x] Evidence shows repository, file and line, request method/path, contract change, reason and bounded snippet. Links open the exact analyzed GitHub commit; invalid or mismatched repository/SHA data produces no link.
- [x] `FAILURE` offers Retry on the same run and analysis. It does not imply a no-impact result.
- [x] An analysis with no confirmed evidence displays “No supported usage found in the analyzed coverage” and does not imply that the integration is safe.
- [x] The initial support boundary is visible: public GitHub JavaScript/TypeScript `fetch` and Axios. Partial or unsupported coverage remains explicit.
- [x] Keyboard use, visible focus, a narrow mobile viewport, and accessible status semantics are verified without clipped evidence or horizontal page overflow. The status semantics were reviewed in code; no screen-reader session was performed.
- [x] A second account cannot read the first account's analysis. API denial is visible without exposing another workspace's data.

## QA provenance

Use the disposable local fixture described in [`.cache/phase32/test-env.md`](../.cache/phase32/test-env.md) for isolated API/integration tests. UI evidence shown from the controlled JavaScript source fixture was persisted from the real analyzer (two confirmed examples and one candidate); that source was in memory and did not come from a GitHub repository. Keep it distinct from the public GitHub worker runs below. Do not inject mock DTOs. Record whether a repository tree/blob was actually downloaded. A local database fixture proves UI rendering and persistence only; it does not by itself prove real GitHub download behavior.

## Historical QA (2026-11-04)

The following results document the earlier implementation and browser QA. They predate analyzer v2 and do not verify the 2026-11-06 refresh.

- Unit tests: 113/113 passed. Disposable-database integration tests: 26/26 passed. Lint passed. The production build after the final UTC date-rendering edit passed with exit code 0.
- The root applied local migrations to `127.0.0.1:5432/mendwire`. Before/after record counts were unchanged: users 2, workspaces 2, monitors 1, snapshots 1, and checks 2. These counts describe the local database only.
- Real public GitHub worker run against `swagger-api/swagger-petstore` at commit `5cb909fc7780bc708151bce0014939acba8b212a` completed `SUCCESS` with partial coverage: 33 repository files discovered, all 33 omitted by language/extension, and zero analyzable JavaScript/TypeScript files. It reported no confirmed impact. This is a real worker/download result, not the source of the UI example evidence.
- A separate public GitHub smoke against `is-number` at commit `98e8ff1da1a89f93d1397a24d7413ed15421c139` found 6 files, downloaded and SHA-1-verified 4 blobs for analysis, and omitted 2. This confirms source retrieval and hash verification only; it does not establish a real usage finding.
- The UI evidence examples came from the real analyzer applied to the declared in-memory source fixture and showed two confirmed matches and one candidate. They must not be described as findings from either public repository.
- Browser QA checked a 390×844 viewport, keyboard use, no horizontal overflow, and persisted results after reload. After rebuilding the UTC formatter, a new tab and reload showed both analyses in `COMPLETE`, timestamps as `2026-11-04 19:41 UTC`, and no console warnings or errors. Desktop width was 1270/1270; mobile was 380/380 at a 390×844 viewport. Tab navigation from `src/api-client.ts:2` reached `src/api-client.ts:6`. Final captures are [`desktop`](../.cache/phase32/browser-final-desktop.jpg) and [`mobile`](../.cache/phase32/browser-final-mobile.jpg).
- Independent review findings were corrected and closed. No proposal generation, GitHub write authorization, pull request, or 3.3–3.6 work is claimed complete.

## Historical final checks (2026-11-04)

- `npm test`: 113/113 passed.
- Disposable PostgreSQL integration suite: 26/26 passed.
- Lint: passed with no warnings.
- Production build after deterministic UTC formatting: passed (exit code 0).
- Root stopped the QA app on port 3100 and the disposable fixture service on port 55432 after verification. The existing local app/database services on ports 3000/5432 remain running.

## Local verification procedure

After any Prisma schema or migration change, set `DATABASE_URL` to the intended local database, run `npm run db:generate`, verify the target, and run `npm run db:migrate`. Then restart both the app and the worker against that same database; the worker command is `npm run worker:monitoring`. Keep the app at the QA URL configured for the browser session.

In the app, use a monitor with a public HTTPS GitHub repository and OpenAPI contract. Trigger a manual check that produces a `SUCCESS` `CheckRun` with `CHANGES_FOUND` and a `BREAKING` finding. Choose **Analyze impact** on that run, then verify the queued/running state and persisted result after the worker finishes. The first supported source scope is public GitHub JavaScript/TypeScript `fetch` and Axios. Axios configuration or import patterns that cannot be resolved confidently remain candidates; repository submodules are omitted with explicit coverage. Other languages and transports are outside this initial coverage; partial coverage and zero matches are not a guarantee of no impact.
