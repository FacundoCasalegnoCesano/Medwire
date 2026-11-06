---
version: 1
slug: "src-app-app-layout-tsx"
primary_target: "src/app/app/layout.tsx"
related_targets: ["src/app/app/page.tsx","src/app/app/monitors/page.tsx","src/components/workspace.module.css","src/components/monitor-list.tsx","src/components/monitor-form.tsx"]
---

Scope: authenticated workspace routes, monitor list and forms, and account settings.
Visitor mode: Operate.

Audience: engineers managing a private set of API source monitors. Job: inspect saved contract and repository URLs, see their latest source-validation state, and make deliberate changes to that configuration.

Content: preserve the current account boundary, monitor actions, field-level source errors, `DRAFT`, `READY`, and `WITHDRAWN` meanings, loading, empty, and failure states. `READY` means sources passed checks; it never means that code impact was analyzed or a repair was prepared.

Approved visual direction: a graphite engineering workbench with ice-blue actions, compact technical metadata in local IBM Plex Mono, readable interface copy in local IBM Plex Sans, fine borders, and the three-bar Mendwire mark. Use the shared semantic palette from `DESIGN.md` and HeroUI v3 for applicable controls.

Interaction: preserve create, list, edit, withdraw, reactivate, account, and sign-out flows. Retain accessible feedback, keyboard operation, visible focus, and reduced-motion support. Keep monitor names and source states scannable without hiding essential actions behind hover.

Constraints: preserve all current data, routes, backend contracts, account and workspace boundaries, and source validation behavior. Public source reads remain read-only. Fit forms and monitor information to narrow screens without horizontal overflow.

Review status: the approved graphite and ice-blue replacement is implemented with shared typography and control tokens. Workspace guard, monitor create/edit/withdraw/reactivate, account, validation, mobile, and reduced-motion states passed final browser review. See `.impeccable/review/graphite-ui/verification.md`. Earlier review captures refer to the previous visual direction and do not verify this replacement.
