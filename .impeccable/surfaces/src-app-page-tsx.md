---
version: 1
slug: "src-app-page-tsx"
primary_target: "src/app/page.tsx"
related_targets: []
---

Scope: public landing page at `/`.
Visitor mode: Persuade.

Audience: engineers maintaining APIs and the applications that consume them. Job: understand what Mendwire checks today and what the planned contract-to-code workflow aims to add. Primary action: create an account.

Proof and content: the current product validates public OpenAPI and Git sources and preserves monitor state. The contract-change, code-impact, and repair sequence is explicitly illustrative. Do not imply a live scan, customer result, production finding, baseline, or pull request.

Approved visual direction: a graphite engineering workbench with ice-blue actions, local IBM Plex Sans and Mono, compact technical metadata, and the three-bar Mendwire mark. Public pages use the same dark tokens and component language as account access and the private workspace. Compose the first viewport around the actual product action and a clearly labeled source example.

Signature component: the original Iconiq UI CodeBlock from `https://iconiqui.com/r/code-block.json`, archived with its registry JSON, source, and hash under `.cache/ui-redesign/upstream/iconiq/`. Adapt its shell to shared tokens through consumer CSS; keep all example code labeled as illustrative.

Interaction: links and actions route to existing account flows and provide at least 44px hit areas. File items, editor tabs, and copy remain keyboard-operable. The code block keeps its own horizontal scroll area and readable 12px code on mobile. Any motion is secondary, honors reduced-motion preferences, and never implies that a source check or repair occurred.

Constraints: keep English copy and current sign-in/sign-up routes. Explanatory body copy uses 14px; concise technical labels and source metadata stay at least 10px. The code panel uses example URLs and explicitly states it is not a live scan. Preserve keyboard focus, keep copy and panel readable at narrow widths, and retain semantic heading order.

Review status: the approved graphite and ice-blue direction, responsive typography, and 44px landing hit areas are implemented and passed final browser review at desktop and 390px mobile widths, including reduced motion. See `.impeccable/review/graphite-ui/verification.md`. Captures in earlier review folders show the previous visual direction and do not verify this replacement.
