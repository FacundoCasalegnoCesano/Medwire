---
version: 1
slug: "src-app-app-page-tsx"
primary_target: "src/app/app/page.tsx"
related_targets: ["src/app/app/monitors/page.tsx","src/app/app/monitors/new/page.tsx","src/app/app/monitors/[id]/page.tsx","src/app/app/account/page.tsx","src/components/app-navigation.tsx","src/components/monitor-list.tsx","src/components/monitor-form.tsx","src/components/account-actions.tsx"]
---

Scope: private workspace, monitor list/create/edit/withdraw/reactivate, and account settings.
Visitor mode: Operate.

Audience: an engineer managing public API and repository sources in an individual account workspace. Job: save and validate source URLs, correct validation errors, review stored monitor status, and manage account access.

Content: real monitor names, saved OpenAPI and Git URLs, field errors, and current `DRAFT`, `READY`, or `WITHDRAWN` state. `READY` is shown as “Sources ready.” Account pages show the current name/email and sign-out. No baseline, check history, worker, code analysis, findings, pull request, usage, or billing is implemented.

Approved visual direction: a graphite engineering workbench with ice-blue actions, shared semantic tokens, local IBM Plex Sans and Mono, fine borders, and the three-bar Mendwire mark. The workspace keeps a 232px desktop sidebar, route heading, monitor panels, and account details. At 760px the sidebar becomes sticky horizontal navigation; at 540px source fields stack in one column.

Interaction: real create/edit/withdraw/reactivate actions update the stored monitor state. Status remains literal text derived from persisted state. Brief opacity feedback follows real saves or validation responses; reduced motion presents each state immediately.

Constraints: preserve session/workspace isolation, saved data, routes, API contracts, field-level errors, busy feedback, and withdrawal/reactivation behavior. Do not imply scheduled work, code analysis, results, or repository writes. Keep status meaning in text and keep mobile actions reachable.

Review status: older captures in `.impeccable/review/official-components/` document workspace behavior and layouts before the replacement visual direction; they do not verify the current palette or final interface.
