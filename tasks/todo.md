# Mendwire — Product roadmap tasks

Planning date: 2 November 2026.

These tasks extend roadmap outcomes 3–6 supplied by the user. They are proposed work, not a record of completed features. Outcomes 1 and 2 remain prerequisites. Architectural recommendations, proposed source limits, implementation order and additional roadmap suggestions are in [plan.md](plan.md).

Every task must preserve account/workspace isolation, the public landing identity and truthful product states. Dependencies refer to task identifiers below, not the order in which the commercial roadmap is displayed.

**2026-11-06 follow-up verification:** The four approved improvement items are implemented and verified in [the improvement report](egm/2026-11-06_IMPROVEMENTS.md) and [the implementation record](egm/2026-11-06_IMPLEMENTATION.md). Unit tests passed 137/137; disposable-database integration passed 27/27; focused history and monitor integration passed 13/13 after the empty-cursor fix; and the focused deterministic-order integration passed 1/1. Lint, typecheck, final production build, and desktop/mobile browser checks passed. Browser evidence and local measurement limits are recorded in the implementation record. Preview and disposable database ports were verified stopped. No production migration or deployment occurred. These records do not change the status of unrelated roadmap tasks.

**2026-11-06 demo API verification:** The disabled-by-default local demo API was added at commit `592478a`. Its committed-source proof reports the pinned oasdiff breaking removal and one confirmed fetch usage with `PARTIAL` coverage. The API and proof are local-only; the verification record documents the default-branch and public-source requirements for a later real monitor run: [demo API verification](demo-api-verification.md).

**2026-11-06 existing API proof:** A focused local contract and simulated removal proof now cover the existing read-only check-history GET and its real UI caller. The analyzer correctly reports a dynamic-path candidate with partial, one-file coverage; the endpoint remains unchanged. The CLI, exact local steps, and pending raw-contract publication requirements are recorded in [the proof note](egm/2026-11-06_REAL_API_PROOF.md) and [the user guide](../docs/real-api-test.md). This does not change the historical verification counts above.

**2026-11-06 consumer-selection follow-up:** Commit `6c0502d6ad9b581138ba2a66bb988d41cd03bab9` adds deterministic path-based source priorities, syntax-safe origin handling, and analyzer v4 provenance while preserving the 30-file/time/byte limits and partial-coverage reporting. Final checks passed: 153/153 unit tests, 27/27 disposable-database integration tests, lint, typecheck, two immutable-revision harness cases, and the committed-source offline CLI proof. The independent code review reported no findings; the formal multi-stage EGM review was not run. The v4 default migration was applied and checked only on `mendwire_roadmap32_test`; that disposable server was stopped. No fresh browser or production build check was run. The decision, trade-offs and coverage limits are in [the consumer-selection record](egm/2026-11-06_CONSUMER_SELECTION.md).

## 3. Show breaking API changes, affected code, and a proposed pull request

An engineer can compare real contract revisions, inspect evidence from a specific code revision, review a proposed repair and open a draft pull request in an authorized GitHub repository. The product distinguishes a detected contract change, demonstrated code impact and an unverified repair proposal.

### 3.1 — Detect breaking changes against a saved contract baseline

- [x] Implement this task.

**Description:** Extend a ready monitor with real scheduled and manual checks. Save the first valid contract as a baseline, compare subsequent valid revisions and persist a readable history. Show the actual execution state, last successful check and next scheduled check.

**Acceptance criteria:**

- [x] The first successful check creates a baseline without inventing a change. Subsequent checks persist old/new revision identifiers and classify breaking changes with the affected method, path or schema and an explanation; unchanged or documentation-only revisions do not create breaking findings.
- [x] A failed or unsupported fetch is recorded as a failed check and preserves the last valid baseline. Checks continue without an open browser; duplicate delivery, worker restarts and overlapping requests do not create duplicate runs or findings. Every valid transition is retained so an unsuccessful downstream analysis can be retried without losing it.
- [x] The server verifies monitor ownership and state for manual and scheduled runs. Withdrawing the monitor stops future scheduling and prevents pending jobs from beginning new work.

**Verification record:** Full unit suite 74/74, database integration suite 13/13, typecheck, lint and production build passed. The real browser run saved the first baseline and reloaded it with history intact; report and desktop/mobile captures are listed in [`tasks/monitoring-verification.md`](monitoring-verification.md). Root's independent browser review passed.

**Verification:** Use controlled OpenAPI 3.0 and 3.1 JSON/YAML revisions with endpoint removal, a new required request property, a compatible addition and description-only edits. Check initial baseline, invalid source, worker restart, duplicate delivery and a second account attempting access.

**Dependencies:** Outcomes 1 and 2, including safe source fetching; task 6.1 for the beta execution policy.

### 3.2 — Trace a breaking change to evidence in the affected codebase

**Implementation status:** The UI, API, and worker flow predated this refresh. Analyzer v4 adds bounded deterministic path priorities and safer dynamic-origin evidence while retaining its existing API, authorization, and immutable-revision contracts. Earlier browser and public-worker QA remain historical results in [`impact-analysis-verification.md`](impact-analysis-verification.md); the latest verification is recorded above and in the [consumer-selection record](egm/2026-11-06_CONSUMER_SELECTION.md).

- [x] Implement this task.

**Description:** Analyze an immutable revision of the monitor's repository and connect a breaking contract change to supported JavaScript/TypeScript fetch or Axios usages. Make coverage and uncertainty visible.

**Acceptance criteria:**

- [x] Each demonstrated impact includes repository, commit SHA, file, line, relevant code and the contract element that justifies the match. The file link points to the analyzed commit. A match requires evidence connecting the request to the monitored API, rather than a coincidental path string.
- [x] Results distinguish supported usages with evidence, candidate usages requiring review, and unsupported or unanalyzed code. No match is reported as “no supported usage found,” with coverage information, rather than a guarantee that the integration is safe.
- [x] Repository processing applies size/time/file limits, treats contents as untrusted data, executes no repository scripts and persists private results only in the authorized workspace. Failures remain retryable against the original contract transition and commit.

**Verification record:** Fresh 2026-11-06 checks passed: 130/130 unit tests, 26/26 disposable-database integration tests, lint, typecheck, and production build. The 26-test suite completed after correcting a synthetic analyzer fixture to use the actual oasdiff operation-removal code; a separate monitor-baseline enqueue failure passed on isolated replay and full-suite rerun without runtime changes, so its first occurrence remains unexplained. Browser and public-repository QA are historical 2026-11-04 results and were not repeated for this refresh. Full provenance and v2 coverage boundaries are in [`impact-analysis-verification.md`](impact-analysis-verification.md).

**Verification:** Analyze a controlled repository with confirmed fetch/Axios usages, another API using the same path, a dynamic URL, unsupported code and a changed head commit. Verify precise evidence, coverage messaging and cross-account denial.

**Dependencies:** 3.1.

### 3.3 — Authorize a GitHub repository for publishing proposed fixes

- [ ] Implement this task.

**Description:** Let the signed-in engineer connect a GitHub App installation through private product setup and select a repository they are authorized to use. Link it to a matching monitor without adding another Mendwire sign-in flow.

**Acceptance criteria:**

- [ ] Setup explains and requests only the permissions needed to read selected repository content, publish proposal branches, create PRs and read their check status. Installation callbacks validate state, account association and repository identity on the server; knowing an installation identifier cannot claim it.
- [ ] A publicly readable repository remains analyzable without write authorization. Publishing is unavailable with a clear setup path until the selected GitHub repository is authorized; other Git hosts receive a clear unsupported-publishing explanation.
- [ ] Disconnecting, removing a repository or revoking the installation prevents further repository actions and pending publication. Credentials remain private, use the provider's scoped token flow and never appear in URLs, browser storage, proposals or logs.

**Verification:** Connect a controlled installation; attempt callback replay, installation substitution and an unauthorized repository. Revoke access before a queued publication and confirm that the public monitor can still explain its read-only state.

**Dependencies:** Outcomes 1 and 2. Can proceed in parallel with 3.1–3.2 after those foundations exist.

### 3.4 — Review an evidence-backed proposed repair

- [ ] Implement this task.

**Description:** From a demonstrated impact, let the engineer request a narrowly scoped repair proposal and inspect the patch, rationale, assumptions and validation status before publication. Start with supported transformations that can be justified from the available evidence.

**Acceptance criteria:**

- [ ] The proposal is attached to the exact contract transition and code commit, presents a file diff and explains how each edit addresses the finding. If a required replacement or new value is unknown, report that human input is required instead of inventing an API, mapping or business value.
- [ ] Generated changes stay within the supported source scope, pass available syntax and patch-applicability checks and disclose what was checked. Test results are shown only when actually observed; missing or failing tests never become a verified-fix claim.
- [ ] The engineer can discard or regenerate a proposal. Any model integration treats repository text as untrusted input, sends only the permitted context under a disclosed data policy, receives no secrets or unrestricted tools, and has bounded time, output and cost. Failures produce actionable states and preserve the finding.

**Verification:** Use a repairable fixture, an endpoint removal without a known replacement, malformed generated output, a repository containing hostile instructions and a provider timeout. Review the actual diff and verify that unsupported repairs are withheld.

**Dependencies:** 3.2 and 6.1; model provider/data-policy configuration if model-assisted generation is enabled.

### 3.5 — Publish a reviewed proposal as a draft pull request

- [ ] Implement this task.

**Description:** Let an authorized engineer explicitly publish the current proposal to a new branch and draft PR, then follow its actual repository status from Mendwire.

**Acceptance criteria:**

- [ ] Publication revalidates workspace permission, repository authorization, entitlement and the proposal's base revision. A stale or conflicting proposal requires refresh/review before publication; unrelated changes are not overwritten.
- [ ] A successful request produces a draft PR with a useful title, explanation, finding reference, patch scope and honest validation status. Repeated clicks, retries or a crash after remote creation resolve to the same publication; the product never merges the PR.
- [ ] Mendwire persists the real PR URL and shows open, merged or closed status plus observed CI states, including unavailable or not configured. Publication errors show a recovery path. The UI explains that opening the PR may trigger the repository's existing workflows.

**Verification:** Publish to a controlled repository, replay the request, simulate a response lost after remote creation, advance the base branch and revoke installation access. Observe pending, failed, successful and absent CI without relabeling them.

**Dependencies:** 3.3 and 3.4. Requires 6.2–6.3 before public paid availability.

### 3.6 — Notify engineers when a new breaking finding needs attention

- [ ] Implement this task.

**Description:** Surface new findings in the workspace and provide optional email notifications that lead directly to the protected finding. Keep monitoring useful when the engineer is away from the product.

**Acceptance criteria:**

- [ ] Each new breaking finding creates one workspace notification with the monitor, a concise explanation and a protected detail link. Repeated successful checks do not send the same finding again.
- [ ] Engineers can enable or disable email delivery to a verified notification address. This verification does not block registration or workspace access. Email contains minimal metadata and no source-code excerpts, credentials or sensitive contract payloads.
- [ ] Sending failures are retried with deduplication and remain distinguishable from analysis failure. A signed-out recipient signs in before viewing the authorized finding; another account cannot open it through the link.

**Verification:** Deliver one controlled finding twice, retry a failed delivery, disable email, and open the link signed out and under another account. Confirm that monitoring and registration work without notification-email verification.

**Dependencies:** 3.1, the account area from outcome 1 and a configured transactional email provider.

## 4. Make the offer purchasable and apply paid access

A customer understands the initial offer, completes a real provider checkout and receives the correct workspace access after trusted payment confirmation. Subscription management is available from Account.

### 4.1 — Present the implemented offer and start a secure checkout

- [ ] Implement this task.

**Description:** Present one initial recurring offer based on implemented capabilities and measurable limits. A signed-in customer can start checkout for their own workspace through the selected payment provider.

**Acceptance criteria:**

- [ ] The offer states price, currency, billing interval, included capabilities, limits and cancellation terms. Values are approved commercial configuration; unsupported features, fabricated savings and implied unlimited usage are excluded.
- [ ] The server maps an allowed plan to the provider price and workspace using trusted configuration. Client-supplied price, customer, workspace or return URLs cannot alter the purchase or another account's subscription. Repeated requests reuse a valid checkout or reconcile an existing subscription.
- [ ] Success, cancellation and failure return to clear product states. The return page can show confirmation pending but cannot grant access by itself. Live checkout remains disabled until the seller account, offer, policy and access checks are ready.

**Verification:** In provider sandbox, start, cancel and complete checkout; change submitted identifiers and replay the success URL without payment. Verify that no unpaid redirect grants paid access.

**Dependencies:** Outcome 1, 6.1 and selection/configuration of a provider the business can actually use. Public live sales depend on 4.2 and 6.2–6.3.

### 4.2 — Apply subscription access from verified provider events

- [ ] Implement this task.

**Description:** Synchronize trusted payment/subscription state to workspace entitlements and show the effective plan in Account. Handle confirmation delays and event retries without duplicate grants or incorrect access.

**Acceptance criteria:**

- [ ] Signed provider events are verified and stored durably with unique event identifiers before processing. Customer, subscription and workspace associations come from trusted purchase records. Invalid signatures and unknown associations grant no access.
- [ ] Duplicate, concurrent and out-of-order events converge on authoritative subscription state. A stale event cannot restore expired access; missed or uncertain delivery can be reconciled with the provider. Purchase confirmation, renewal and access loss apply the approved policy from 6.1.
- [ ] Account shows the actual plan, effective access, billing period and pending/error state. The trusted owner has a separate auditable product-access entitlement with bounded usage, producing neither a paid transaction nor access to a customer's workspace.

**Verification:** Exercise sandbox purchase, renewal, scheduled cancellation, expired access, duplicate events, reversed event order, concurrent delivery and reconciliation after a missed event. Check independent workspace associations and owner access.

**Dependencies:** 4.1 and 6.1. Release together with 6.2–6.3.

### 4.3 — Manage the subscription from Account

- [ ] Implement this task.

**Description:** Let the authorized customer reach the provider's subscription management and billing records from Account, then see the synchronized result in Mendwire.

**Acceptance criteria:**

- [ ] Only the workspace's authorized billing account can create its provider portal session. Session targets and return paths are chosen on the server; another customer's billing information is inaccessible.
- [ ] The customer can review available invoices/receipts, update payment details through the provider and request cancellation. Mendwire explains the actual cancellation effective date and remaining access according to 6.1.
- [ ] Returning from the portal refreshes or reconciles status. Delays, provider failure and missing billing records have honest recovery states; they do not fabricate a successful cancellation or payment.

**Verification:** Open the portal for two isolated sandbox customers, update a payment method and cancel one subscription. Verify the effective date, synchronization delay and denial of customer substitution.

**Dependencies:** 4.2.

## 5. Give customers a direct path to their first useful result

A new engineer can reach a real baseline and understand what happens next, then return directly to a genuine finding when a contract changes. Waiting for an upstream change is an honest product state.

### 5.1 — Guide a new engineer to the first valid monitor baseline

- [x] Implement this task.

**Description:** Use the existing workspace and monitor screens to guide account creation, source selection, validation and the first check. Progress follows persisted product data and resumes after refresh or sign-in.

**Acceptance criteria:**

- [x] A fresh account receives concise guidance for supported sources and reaches monitor creation without existing data. Progress is derived from the actual saved monitor and execution state; no example monitor is seeded.
- [x] Before checks are implemented, the outcome is “sources ready.” After 3.1 is available, the engineer can request the first permitted check, observe progress and reach “baseline saved, waiting for a new contract revision.” An initial baseline is not presented as a detected breaking change.
- [x] Source errors link back to the appropriate editable field. A missing GitHub write connection is explained when relevant to publishing and does not prevent a permitted public-source baseline. Progress remains usable by keyboard and on mobile.

**Verification record:** Existing source-validation browser evidence is in [`tasks/monitors-verification.md`](monitors-verification.md). The live first-baseline run, reload/history check, keyboard access to manual check and Edit sources, and 1440×960 desktop and 390×844 mobile viewports are recorded in [`tasks/monitoring-verification.md`](monitoring-verification.md).

**Verification:** Walk through a fresh account, unsupported contract, inaccessible repository, refresh midway and successful baseline. Verify that displayed progress follows records and that the sources-ready stage works before 3.1 ships.

**Dependencies:** Outcomes 1 and 2. The first-check portion additionally depends on 3.1 and the applicable 6.1 policy.

### 5.2 — Lead the engineer from a real finding to the next useful action

- [ ] Implement this task.

**Description:** Provide a direct route from the workspace or notification to the first genuine finding, its code evidence and the next available action. Instrument the journey to learn where users get stuck.

**Acceptance criteria:**

- [ ] A finding page connects contract change, impact evidence and next step: review code, resolve unsupported coverage, request a proposal or open an authorized draft PR. Actions appear only when their prerequisite states exist.
- [ ] Successful checks without breaking findings show the last real check and next check. Empty, pending, failed and partially analyzed states explain what is known and how to continue; a new user is never shown a fake result.
- [ ] Record first monitor saved, baseline completed, first real finding viewed, proposal reviewed and PR created with timestamps and internal identifiers. Product telemetry excludes source-code contents, secrets and raw contracts, and is used to calculate time to first useful result.

**Verification:** Follow a controlled change from ingestion to finding and supported next action. Repeat with no change, an unsupported usage, a failed analysis and no publishing authorization; inspect the recorded events for accuracy and data minimization.

**Dependencies:** 3.1 and 3.2. Proposal/PR actions depend on 3.4–3.5; notification entry depends on 3.6.

## 6. Apply the access and limits customers paid for

Every costly or privileged action follows one workspace entitlement policy, regardless of whether it starts in the browser, a scheduled job or a retry. Customers can understand usage and preserve their saved configuration when access changes.

### 6.1 — Define one entitlement and usage policy for beta and paid access

- [x] Implement the shared versioned server-side access policy for the bounded beta and the current paid-state mapping.

**Description:** Establish the shared server-side policy used by the offer, billing, workspace actions and worker. Define bounded beta and owner access before enabling expensive processing.

**Acceptance criteria:**

- [x] A versioned plan configuration defines active-monitor limit, check frequency, analysis/proposal allowance, publishing availability and usage period. Published limits have explicit units; source size and timeout budgets are separately bounded operational controls.
- [x] Define and document usage consumption, retry/failure accounting, and reservation expiry semantics; implementing atomic counters and reservation recovery remains assigned to 6.2. Every currently modeled workspace state maps to one effective access policy.
- [x] Entitlements are resolved from trusted workspace records. Client role/plan claims cannot grant access. Staff status alone grants no customer-data access; owner testing uses a separate bounded entitlement. The initial beta policy does not imply an approved final commercial price.

**Verification record:** `npm test` passed 74/74, including versioned policy cases for beta, paid, canceling, overdue, expired, unknown, workspace ownership, forged client claims and bounded owner access. Database integration passed 13/13; see [`tasks/monitoring-verification.md`](monitoring-verification.md). Monthly usage-ledger/reservation enforcement remains 6.2 work.

**Verification:** Review a table of beta, paid, canceling, overdue, expired and owner cases with expected permissions and counters. Exercise the policy through server calls using forged plan claims and unrelated workspace identifiers.

**Dependencies:** Outcome 1. Quota values must be configured before the corresponding action is enabled; finalize the commercial offer before 4.1 is public.

### 6.2 — Enforce limits across browser actions, scheduled checks and retries

- [ ] Implement this task.

**Description:** Apply the entitlement policy when work is requested and when it executes. Reserve and consume usage atomically so simultaneous requests cannot bypass limits or count one logical operation multiple times.

**Acceptance criteria:**

- [ ] Server routes/actions and workers enforce account permission, capability and remaining usage. Disabled UI controls are explanatory; direct requests and scheduled jobs encounter the same policy. Browser identifiers cannot switch the billed workspace.
- [ ] A durable usage ledger/reservation records one logical action under its idempotency key. Concurrent requests respect the configured limit; retried jobs do not double-count, and failures release or consume reservations exactly according to 6.1. Reconciliation resolves abandoned reservations after crashes.
- [ ] The workspace shows actual consumption, remaining allowance, reset time and a useful limit-reached explanation. Operational size/time/model budgets also stop runaway processing without reporting a completed result.

**Verification:** Race two requests for one remaining allowance, repeat job delivery, restart a worker after reservation and invoke a disabled capability directly. Reconcile the final counter and verify that the rejected operation produced no external effect.

**Dependencies:** 6.1 and the applicable operation from outcome 2 or 3. Billing-fed entitlements additionally depend on 4.2; beta entitlements allow earlier verification.

### 6.3 — Handle access loss and recovery without losing saved configuration

- [ ] Implement this task.

**Description:** Make subscription changes, exhausted limits, withdrawn monitors and disconnected providers take effect consistently, including while work is queued. Preserve an honest recovery route.

**Acceptance criteria:**

- [ ] Before each expensive stage or external write, recheck effective access, monitor state and provider authorization. Access lost while a job is queued prevents new disallowed work. An already-created remote PR is reconciled and recorded without repeating publication.
- [ ] For the initial policy, an expired subscription preserves saved monitors and historical results in a private read-only state for the configured retention period. New analysis and publication pause. Exhausted usage pauses the affected capability and shows its reset or recovery path; stored data follows the disclosed deletion policy.
- [ ] After valid renewal, usage reset or authorized reconnection, eligible work can resume without recreating the monitor. Recovery does not replay withdrawn work, duplicate a finding/PR or silently exceed active-monitor limits.

**Verification:** Expire access and revoke GitHub authorization between enqueue and execution; repeat during proposal/publication stages. Restore access and reconcile interrupted work. Verify preserved private records, bounded resumption and no duplicate external action.

**Dependencies:** 6.1–6.2 and the relevant monitor/provider operations. Subscription-event scenarios require 4.2.

## Release checkpoints

- [ ] **Foundations:** Outcomes 1 and 2 verified with fresh accounts, password recovery, owner verification, safe downloads and cross-workspace access attempts. Sources ready is clearly distinct from monitoring running.
- [ ] **Detection:** 6.1, 3.1 and 3.2 verified against controlled contracts and repositories, including no-change, partial coverage and worker failure.
- [ ] **Proposal and delivery:** 3.3–3.6 and 5.1–5.2 verified through a real controlled GitHub installation and draft PR, with accurate CI/notification states.
- [ ] **Paid release:** 4.1–4.3 and 6.1–6.3 verified together in provider sandbox, including concurrent usage, duplicate/out-of-order webhooks, cancellation and revocation during queued work. Seller setup and approved commercial values are present before live billing.

These are acceptance checks for future implementation. 3.2's recorded verification is in [`impact-analysis-verification.md`](impact-analysis-verification.md). No live checkout, customer notification, proposal publication, or repository write was performed.
