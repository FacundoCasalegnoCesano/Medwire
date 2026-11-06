# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Software engineers who maintain APIs and the applications that consume them. In the current product, one account has a private workspace to register, sign in, manage API monitors, and validate public source URLs.

## Product Purpose

The current application provides account access and a private place to save API contract and repository sources. It checks those sources, saves contract baselines, reports breaking changes, and can queue impact analysis for eligible breaking-change runs. The initial impact-analysis coverage is restricted to public GitHub JavaScript/TypeScript `fetch` and Axios usage, with coverage limits shown in the result.

The current product helps an engineer understand a breaking API change and trace supported usage in a public GitHub consumer repository to commit-pinned evidence. Reviewing a proposed repair before any repository write remains roadmap work.

## Positioning

Current: connect a breaking contract change to demonstrable, commit-pinned evidence in supported public GitHub JavaScript/TypeScript `fetch` and Axios usage, with candidates and coverage limits visible. Planned: propose a narrowly scoped repair for human review before any repository write.

## Operating Context

The current web interface is in English. Users register or sign in, then manage an individual private workspace. They add a named monitor with a public OpenAPI contract URL and a public Git repository URL. The app checks both sources; users can edit, withdraw, or reactivate a monitor. Account settings show the account name and email and allow sign-out. Password recovery uses a one-time reset link.

## Capabilities and Constraints

- Current authentication supports email and password, account creation without mandatory email verification, sign-in, sign-out, and one-time password reset links. A live email provider is not configured in the local app.
- Current monitor management supports create, list, edit, withdraw, and reactivate. Accepted contracts use OpenAPI 3.0 or 3.1 in JSON or YAML; accepted source URLs use public HTTPS. Public Git access is read-only.
- `DRAFT` means a monitor was saved but needs source attention. `READY` means “Sources ready” only. `WITHDRAWN` preserves the monitor and its saved data; reactivation checks both sources again.
- Source errors remain attached to their relevant fields. Source responses are treated as data; current checks do not clone or execute repository content.
- Monitors save a contract baseline and support queued manual checks, background execution, run history, and scheduled checks. The first check saves the baseline without reporting a change. Contract comparison can report API changes. The implemented 3.2 impact-analysis flow can be requested for successful breaking-change runs and pins processing to a public GitHub commit. Its initial coverage is JavaScript/TypeScript `fetch` and Axios; it displays confirmed evidence, candidates, and partial coverage rather than claiming that no match means no impact. QA includes real worker runs and controlled analyzer evidence fixtures, recorded separately in [`tasks/impact-analysis-verification.md`](tasks/impact-analysis-verification.md). Browser QA verified persisted completion after reload and deterministic UTC timestamps in a new tab. Repair proposals, pull requests, billing, and owner administration remain future work. Public repository access does not authorize writes.
- The workspace is private to one account. Team membership is a later roadmap item.
- Preserve existing behavior, saved data, account and workspace boundaries, and truthful source states during interface changes. Do not change backend behavior or data contracts as part of visual redesign.
- Preserve keyboard access, visible focus, semantic and assistive-technology feedback, responsive use, and reduced-motion support. Keep effects bounded and avoid delaying essential content.

## Brand Commitments

Keep the Mendwire name and its existing three-bar mark across public, access, and private surfaces. Use the approved graphite and ice-blue engineering workbench across the full interface, with IBM Plex Sans and IBM Plex Mono loaded locally. Explanatory copy uses 14px, technical labels stay at least 10px, and interactive targets provide at least 44px of hit area. The shared palette, component rules, and theme tokens are recorded in `DESIGN.md`.

## Evidence on Hand

- `README.md` documents the implemented account, workspace, authentication, and monitor capabilities.
- `tasks/monitors-verification.md` records monitor behavior, source constraints, and local verification.
- `tasks/plan.md` and `tasks/todo.md` describe product goals and completion status. The 3.2 scope and QA provenance are tracked in `tasks/impact-analysis-verification.md`; repair proposals, pull requests, billing, and owner administration remain future work.
- The landing page contains an explicitly illustrative contract-to-impact-to-proposal flow. QA runs against public repositories and controlled analyzer fixtures are not customer results or production scans.

## Product Principles

- Show what the system has actually checked and what remains for a later step.
- Keep people in control of repository changes.
- Preserve private workspace boundaries and saved configuration.
- Tie future impact and repair claims to inspectable evidence.
