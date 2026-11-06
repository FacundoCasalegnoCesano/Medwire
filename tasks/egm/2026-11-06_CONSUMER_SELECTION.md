# Contract consumer selection and confidence

**Status:** implemented in `6c0502d6ad9b581138ba2a66bb988d41cd03bab9`; verification passed. EGM workflow review remains pending.
**Date:** 2026-11-06

## Problem

The impact analyzer can miss a real consumer when its bounded file selection
spends the 30-file budget on unrelated code before reaching the integration.
Dynamic request URLs also need careful handling: a variable path alone cannot
prove that a contracted operation is consumed, while a fixed origin can prove
that a request belongs to a different API. In the user's successful breaking
analysis pinned to commit `cafb211b040fbabe87a06cf9d62863c6ff67ce0c`, 30 of
101 files were analyzed and an unrelated download candidate surfaced. That
observation motivated review of file selection and confidence rules; it does
not establish complete coverage.

## Decision

Select source files with bounded, generic priority tiers. Use path-based hints
for likely API source directories and shallower paths, then preserve
deterministic ordering within each tier. These hints do not inspect HTTP
behavior and cannot guarantee that every real consumer is selected. Keep the
existing hard limits of 30 files, the time budget, response byte budget,
authorization checks, and immutable commit SHA. If a budget stops the scan,
retain partial coverage and explain which work was skipped.

For dynamic request paths, use only syntax-safe evidence. A fixed request
origin may suppress a candidate only when it is demonstrably different from
the contract origin. Unknown origins and paths remain candidates when other
evidence supports the match. Dynamic paths must never become confirmed solely
because their method matches.

The analysis version advances from `impact-ts-v3` to `impact-ts-v4`. A
default-only database migration changes which version new rows receive and
leaves historical rows intact. Existing successful analyses remain immutable
and idempotent when requested again; users get a new analysis only from a new
breaking check run. Do not add an endpoint that reanalyzes a prior run.

The offline proof uses a committed baseline fixture containing the actual
pre-change contract. It must not derive its baseline from the current working
contract, because that document may represent a later published revision.

## Acceptance

- Selection uses deterministic path-based priorities while retaining the
  30-file cap; those priorities cannot guarantee every real consumer is read.
- Scanning remains bounded by the existing file, time, and byte limits.
- Dynamic paths remain candidates unless evidence proves their fixed origin
  differs from the contract origin; no dynamic path is falsely confirmed.
- Partial or skipped scans are visible in coverage and do not imply complete
  repository coverage.
- Authorization and immutable-SHA pinning remain in force.
- New analysis rows record `impact-ts-v4`; existing rows and successful retry
  responses retain their saved result and historical version.
- The local proof compares against a checked-in immutable baseline fixture.

## Review and verification

The independent code review reported no findings. The formal multi-stage EGM
review workflow was not run, so this document does not claim an EGM review.

The orchestrator verified 153/153 unit tests, 27/27 disposable-database
integration tests, lint, typecheck, two immutable-revision harness cases, and
the offline CLI proof. The local immutable-revision harness used commit
`cafb211b040fbabe87a06cf9d62863c6ff67ce0c`, selected 30 of 101 files with 71
skipped, included the real monitor-check panel, and asserted candidate evidence
for its GET request. It excluded the installer from selection and separately
asserted no installer evidence when that blob was analyzed. This harness
mocked GitHub transport with local commit blobs; it was not a live worker run.
The committed-source CLI proof on `Desarrollo` identified the dynamic call at
line 82 as `CANDIDATE`, reported `PARTIAL` coverage (1 analyzed, 0 skipped),
and marked the result `LOCAL_ONLY`. Migration
`20261106000200_impact_analyzer_v4` was applied only to the disposable
`mendwire_roadmap32_test` database; its default was checked as `impact-ts-v4`,
and the service was stopped afterward. No fresh browser or production build
check was run for this backend-focused change.
