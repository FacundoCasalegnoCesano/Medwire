# EGM drift report

Scope: static source review of current product claims in the root `README.md` and `PRODUCT.md`, compared with checked-in implementation. No rendered or browser measurements were made; computed CSS and actual hit areas were not measured. Local and production environment configuration claims were outside scope; no environment secrets were read.

README comparison source set: `src/lib/auth.ts`, `src/lib/workspace.ts`, `src/lib/monitors.ts`, `src/lib/monitor-sources.ts`, `src/lib/monitor-checks.ts`, `src/lib/beta-policy.ts`, `src/lib/impact-analysis.ts`, and `src/components/monitor-impact-panel.tsx`.

Source revision: `cafb211b040fbabe87a06cf9d62863c6ff67ce0c`
EGM version: `0.1.0` (`6a8001ea31ccf72430ba0603a467ec6df9f69dd7`)
Run date: 2026-11-06

## README.md

- The README says monthly analysis enforcement belongs to later work, but impact analysis already counts each workspace's records from the start of the current UTC calendar month and enforces the configured [analysis limit](../../src/lib/beta-policy.ts#L53) with a 429 response in [impact-analysis.ts](../../src/lib/impact-analysis.ts#L160), [impact-analysis.ts](../../src/lib/impact-analysis.ts#L216), and [impact-analysis.ts](../../src/lib/impact-analysis.ts#L219). It rechecks the limit inside the transaction at [impact-analysis.ts](../../src/lib/impact-analysis.ts#L247). Durable usage ledgers and proposal-limit enforcement remain future work, so the README should distinguish those from the existing analysis count guard; the relevant claim is in [README.md](../../README.md#L19).

## PRODUCT.md

- [The brand commitment](../../PRODUCT.md#L40) says explanatory copy uses 14px. Workspace `.lede` text is declared at 13px in [workspace.module.css](../../src/components/workspace.module.css#L75) and used for the workspace page description in [app/page.tsx](../../src/app/app/page.tsx#L15). Account sign-out explanatory text is declared at 12px by `.accountSession p` in [workspace.module.css](../../src/components/workspace.module.css#L91) and used in [account/page.tsx](../../src/app/app/account/page.tsx#L17).
