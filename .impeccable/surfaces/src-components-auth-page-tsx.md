---
version: 1
slug: "src-components-auth-page-tsx"
primary_target: "src/components/auth-page.tsx"
related_targets: ["src/app/sign-in/page.tsx","src/app/sign-up/page.tsx","src/app/forgot-password/page.tsx","src/app/reset-password/page.tsx","src/components/auth-form.tsx"]
---

Scope: sign-up, sign-in, password-recovery, and password-reset routes.
Visitor mode: Operate.

Audience: existing and prospective account holders. Job: create or access a private workspace, or recover account access. Actions: register, sign in, request a reset link, and set a new password.

Content: current email/password flows, validation, neutral reset-request response, missing or expired token, pending, success, and error states. Keep the form primary. Supporting context explains existing source management without implying an operation happened.

Approved visual direction: a graphite engineering workbench with ice-blue actions, local IBM Plex Sans and Mono, fine borders, restrained 4px corners, and the three-bar Mendwire mark. Account-access routes share the palette and HeroUI v3 control tokens used by the rest of the interface.

Interaction: retain route-specific form actions and links. Validation stays beside its field, recovery feedback stays neutral, and pending/success/error feedback remains visible. Keyboard focus and reduced-motion preferences are supported.

Constraints: preserve auth calls/routes, neutral recovery feedback, focus and error associations, keyboard flow, success/error feedback, and reduced-motion behavior. Keep the form first on mobile and avoid decorative delay.

Review status: the approved graphite and ice-blue replacement is implemented with shared typography and control tokens. Sign-up, sign-in, neutral recovery, missing-token, and reduced-motion states passed final browser review. See `.impeccable/review/graphite-ui/verification.md`. Earlier captures refer to the previous paper direction and do not verify this replacement.
