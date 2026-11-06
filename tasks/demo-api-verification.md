# Demo API verification

The local demo API is disabled unless its revision is explicitly configured. It serves fictional read-only widget data and a stable OpenAPI endpoint. The `breaking` revision returns HTTP 410 from the widget route and removes that operation from the OpenAPI document.

## Completed checks

- Focused Vitest suite: 4/4 passed (`src/lib/demo-api.test.ts`), including disabled and invalid revisions, baseline response/spec agreement, no-store headers, stable route behavior, breaking removal, and malformed origin rejection.
- Full unit suite: 141/141 passed; full lint, typecheck, and production build passed.
- Built app HTTP checks on port 3100 passed for all modes: disabled returned 404 for widgets/spec; baseline returned 200 with two fictional rows and a GET operation in the spec; breaking returned 410 and removed the operation while keeping the spec URL available. POST returned 405 in all modes, GET responses sent `Cache-Control: no-store`, and baseline/breaking contract hashes differed.
- Targeted ESLint for the new routes, helper, test, and verifier passed. `git diff --check` passed.
- The HTTP check report is at ignored `.cache/demo-api/http-report.json`; it is local verification evidence and is not part of the change.
- The demo remains disabled by default, uses fictional data, and performs no database writes.

## Pending root verification

- `npm run demo:verify` after the consumer source is committed. It must report the real pinned oasdiff breaking code and local analyzer evidence, with coverage marked `PARTIAL` because only the declared demo client file is scanned.

The CLI proof is local-only. It does not download a public Git repository, publish a repository, or establish a public deployment. A real monitor run needs a public HTTPS OpenAPI file and public Git source on the repository's default branch; impact analysis also needs the consumer file on that default branch. The API server may stay local because the monitor fetches the OpenAPI document, not the API server.
