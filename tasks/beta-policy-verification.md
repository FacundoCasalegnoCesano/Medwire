# Beta access and usage policy — 6.1

Version: `beta-2026-11-v1`. Limits in this document are provisional technical caps for a closed beta. They do not define a price or an approved commercial offer. The server reads workspace entitlement state from its database and derives access from that record plus the authenticated user's identity. Requests cannot submit a plan, role, owner flag, or usage allowance. Missing or unknown states fail closed. The exact owner test allowlist is server-only configuration and applies only to the allowlisted user's own workspace.

## Configured limits

| Limit | Default | Unit and meaning |
| --- | ---: | --- |
| Active monitors | 3 | Per workspace; every non-withdrawn monitor occupies a slot, including a draft whose sources need attention. |
| Check frequency | 24 | Hours between scheduled checks for each eligible monitor. |
| Manual check cooldown | 300 | Seconds after an accepted manual request. A workspace may have at most one active run per monitor. |
| Analyses | 10 | Completed logical analyses per UTC calendar month and workspace. |
| Proposals | 5 | Completed logical repair proposals per UTC calendar month and workspace. |
| Publishing | Disabled | Draft PR creation is unavailable for every current policy. |

These values have named environment overrides in `.env.example`; `policyVersion` identifies the versioned defaults. An operator changing a cap must update the policy version and this record. Paid access currently uses the same conservative technical caps as beta until commercial limits are approved. No price or checkout is configured.

## Operational bounds

The existing source validation path limits an OpenAPI contract to 1 MiB, a Git smart-HTTP response to 2 MiB, and each source fetch to 5 seconds. These are transport bounds for validation, not a repository checkout allowance or model budget. The current product has no analysis worker, repository clone, model provider, or publishing integration. CPU, repository checkout size, analysis timeout, model tokens, and model cost are therefore not represented as available budgets. Any future execution adapter must add separate hard limits before it can run customer code or send source content to a model.

## Usage counting and retries

- A scheduled or accepted manual baseline/check does not consume the analysis or proposal allowances. Scheduled checks follow the plan frequency; accepted manual requests start the cooldown. Repeated requests while the cooldown or an active run exists are rejected before starting more work.
- One successful logical analysis consumes one analysis allowance when its result is durably recorded. One successfully completed proposal consumes one proposal allowance when its proposal is durably recorded.
- A failed or canceled analysis/proposal consumes no allowance. Internal retries belong to the same logical operation and consume at most once. A caller retry after a completed operation must resolve to that existing result rather than create another charge.
- The durable reservation ledger, idempotency key, reservation expiry, recovery of abandoned jobs, and atomic enforcement at concurrency boundaries belong to 6.2. The policy module defines the counters but does not implement or report them as enforced yet. The 6.2 ledger must expire unstarted reservations after 15 minutes and reconcile them before permitting further work.
- Monthly allowances reset at 00:00 UTC on the first day of each calendar month, independent of billing renewal date. Until 6.2 exists, the application must not claim a live remaining allowance or reset countdown.

## Effective access matrix

`View` means the owner can read private data in that owner's workspace. An allowlisted product owner still receives access only to their own workspace; a staff flag or client role grants no customer-data access.

| Trusted workspace state | Effective policy | View | Manage monitors | Run check | Analyze / propose | Publish | Counter behavior |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `BETA` | `beta` | Yes | Yes | Yes, within run limits | Yes, within monthly caps | No | 10 analyses / 5 proposals per UTC month |
| `PAID` with trusted `entitlementUntil` in the future | `paid` | Yes | Yes | Yes, within run limits | Yes, within the same provisional caps | No | Same caps as beta until approved paid terms exist |
| `PAID` with missing or elapsed `entitlementUntil` | `expired` | Yes | No | No | No | No | Missing or elapsed period end fails closed |
| `CANCELING` before trusted `entitlementUntil` | `canceling` | Yes | Yes | Yes through period end | Yes through period end | No | Existing period counters continue until end; no premature reset |
| `CANCELING` at or after `entitlementUntil` | `expired` | Yes | No | No | No | No | No new use; historical data remains private |
| `OVERDUE` | `overdue` | Yes | No | No | No | No | No grace period is configured; no new work |
| `EXPIRED` | `expired` | Yes | No | No | No | No | No new work; historical data remains private |
| Allowlisted owner, on own workspace only | `owner` | Yes | Yes | Yes, within beta caps | Yes, within beta caps | No | Same bounded counters as beta; not a paid transaction |
| Missing/unknown state or missing workspace | `unknown` / denied | No for missing workspace; read-only resolution for an unknown persisted state | No | No | No | No | No access is granted |

`PAID` and `CANCELING` are active only while the trusted database record has a future `entitlementUntil`; a missing or elapsed end time resolves to `expired`. Neither state is set by a browser callback, redirect, or submitted claim; billing does not exist yet. `OVERDUE` pauses new work immediately. Expired subscriptions retain saved monitors and historical results privately while a future retention/deletion policy is implemented. This task does not run a data deletion job.

## Server integration

`resolveWorkspaceEntitlement({ workspaceId, actorUserId })` loads the workspace from the database and confirms `actorUserId === ownerId`; it accepts no plan or role input. Route handlers pass the ID from the authenticated session. Workers must load the monitor's workspace and pass its trusted `ownerId`, never an owner/workspace claim carried in the job payload. `assertWorkspaceCapability` is the shared gate for `manage-monitors`, `run-check`, `analysis`, `proposal`, and `publish`. Publication remains disabled.

## Verification record

Final verification passed: `npm test` (74/74), including versioned policy cases for beta, paid, canceling, overdue, expired, unknown, workspace ownership, forged client claims and bounded owner access; `scripts/test-auth-integration.ps1` passed 13/13 against loopback `mendwire_test`. Typecheck, lint and production build also passed. Browser evidence for the live monitor gate and manual check is linked from [`monitoring-verification.md`](monitoring-verification.md). These checks do not establish the 6.2 usage ledger or its reservation/concurrency enforcement.

### Acceptance checklist

- [x] Versioned plan defaults and bounded overrides are explicit and validated.
- [x] Beta, paid, canceling, overdue, expired, owner, forged claims, and unrelated workspace cases pass server policy tests.
- [x] Current monitor routes and 3.1 checks consult the shared trusted-workspace policy before allowing the corresponding operation.
- [x] Usage failure/retry/reservation semantics and limits are documented; atomic counters and reservation recovery remain assigned to 6.2.
