---
name: Mendwire
description: A graphite engineering workbench for managing API contract and repository sources.
colors:
  background: "#0c1017"
  surface: "#131b26"
  surface-elevated: "#192433"
  foreground: "#e8eef5"
  muted: "#a6b4c5"
  border: "#2b394b"
  accent: "#9ac9ff"
  accent-foreground: "#0b1728"
  success: "#90d5b5"
  danger: "#ffb4ab"
typography:
  body:
    fontFamily: "IBM Plex Sans Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  technical:
    fontFamily: "IBM Plex Mono, ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  control: "4px"
  mark: "5px"
---

# Design System: Mendwire

## Overview

Mendwire is a private API source management tool for engineers. Its interface takes cues from code editors and engineering workbenches: a graphite canvas, compact technical labels, clear source boundaries, and ice-blue actions. Every page, including public and account-access pages, shares this dark visual world.

Keep the Mendwire name and its three-bar mark. IBM Plex Sans serves interface copy; IBM Plex Mono identifies code, URLs, dates, and technical metadata. Both font families load locally. Use the same semantic tokens across routes so public, access, and private surfaces read as one product.

## Color tokens

| Token | Value | Use |
| --- | --- | --- |
| `--background` | `#0c1017` | Page canvas and deep code surface |
| `--surface` / `--surface-raised` | `#131b26` | Panels, inputs, and grouped content |
| `--surface-elevated` | `#192433` | Navigation, selected surfaces, and raised detail |
| `--foreground` | `#e8eef5` | Main text |
| `--muted` | `#a6b4c5` | Secondary text and placeholders |
| `--border` | `#2b394b` | Panel and secondary rules |
| `--field-border` | `#5a6e86` | Input boundary contrast on dark surfaces |
| `--glitch-slate-1` | `#2b394b` | Dark slate glyphs in low-opacity access backgrounds |
| `--glitch-slate-2` | `#3a4d66` | Mid slate glyphs in low-opacity access backgrounds |
| `--glitch-slate-3` | `#5a6e86` | Light slate glyphs in low-opacity access backgrounds |
| `--glitch-ice` | `#9ac9ff` | Occasional ice glyphs and the landing hero glow |
| `--accent` | `#9ac9ff` | Primary action, focus, and navigation emphasis |
| `--accent-foreground` | `#0b1728` | Text on the ice-blue accent |
| `--success` | `#90d5b5` | Successful source check |
| `--danger` | `#ffb4ab` | Errors and destructive actions |
| `--warning` | `#f2c879` | Contract changes that need attention; mapped to HeroUI's semantic warning token |

HeroUI v3 theme variables map directly to these tokens in `src/app/globals.css`. Keep foreground/background pairs legible; status must include text or another cue beyond color.

## Typography and shape

Use IBM Plex Sans for explanatory copy and controls. Use IBM Plex Mono for code, hostnames, paths, dates, and concise technical labels, not long paragraphs. Keep headings direct and sized by their content hierarchy. Explanatory body copy uses 14px as its practical floor; concise IDE labels and source metadata remain at least 10px. On narrow screens, code stays at 12px inside its own horizontal scroll area. Keep compact metadata separated from explanatory text.

Panels use flat tonal surfaces and fine one-pixel borders. Controls and cards use restrained 4px corners; the three-bar mark uses a 5px frame. Avoid decorative gradients, glass, oversized rounded cards, and shadows without a clear purpose. Prefer a denser editor-like composition with useful source and state information visible together.

Se permite un fondo de matriz de caracteres de baja opacidad en la landing y en las páginas de acceso, y un resplandor radial mínimo detrás del hero. El cierre de la landing reutiliza esa matriz a menor opacidad, con el centro despejado detrás del contenido. El workspace usa el fondo de puntos estático descrito en Components and behavior.

## Components and behavior

- En la landing, lo que existe hoy usa bordes sólidos y lo que es roadmap usa bordes punteados, texto atenuado y un chip PLANNED. Cualquier código ilustrativo se rotula como ejemplo.
- El workspace usa un fondo de puntos estático y de muy baja opacidad, sin animación. Los pasos del estado vacío son informativos y reflejan estados reales.
- Use HeroUI v3 controls from `@heroui/react`, styled through HeroUI's semantic theme variables. Import `@heroui/styles` after Tailwind in the root stylesheet.
- Preserve the three-bar wordmark and recognizable navigation across landing, account access, and the workspace.
- Show source states literally. `READY` means that saved public sources passed their checks; it does not mean code analysis or a repair exists.
- Use these labels and semantic colors for monitor and check status:

  | State | Label | Color | Meaning |
  | --- | --- | --- | --- |
  | `DRAFT` | Needs source attention | `--warning` | A saved source needs review. |
  | `READY` | Sources ready | `--success` | Saved sources passed their checks; this does not imply code analysis. |
  | `WITHDRAWN` | Withdrawn | `--muted` | The monitor is retained and withdrawn. |
  | Queued or running check | Check queued / Check running | `--accent` | A real check is waiting or executing. |
  | Breaking contract changes | Breaking changes found | `--warning` | The contract check reported breaking findings. |

- Label any illustrative code or workflow as an example. Do not present it as a live scan, customer result, or production finding.
- Keep forms keyboard accessible, associate labels and field errors, show visible focus, and preserve route-specific behavior.
- Give interactive controls and links a minimum 44px hit area, including landing file items, editor tabs, copy, and navigation.
- Honor `prefers-reduced-motion`; essential content and status never depend on animation.
- Keep layouts usable at narrow widths. Stack related information in reading order and avoid horizontal overflow.

## Product truth

The current application supports account access, private workspaces, and management of monitors for public OpenAPI contracts and Git repositories. Source validation is read-only. Baselines, scheduled analysis, code impact findings, repair proposals, and repository writes remain roadmap items.
