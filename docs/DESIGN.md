# Vantage web design system

This document defines the visual system for the React app. Keep presentation
styles in `apps/web/src/styles/tokens.css` and reuse these tokens. Visual work
must not change application behaviour, routes, data or API contracts.

## Colour tokens

Vantage uses a light-only theme. Define these values on `:root` in
`styles/tokens.css`:

| Token | Value | Use |
| --- | --- | --- |
| `--page-bg` | `#F6F8FB` | Pale blue-grey page background |
| `--surface` | `#FFFFFF` | Cards, panels and top bar |
| `--surface-raised` | `#F1F5F9` | Hover and secondary surfaces |
| `--border` | `#D8E1EC` | Hairline borders and dividers |
| `--text-primary` | `#0B1B33` | Main text |
| `--text-secondary` | `#475569` | Supporting text and metadata |
| `--text-muted` | `#64748B` | Quiet secondary detail |
| `--accent` | `#1D4ED8` | Primary actions, links, focus and active states |
| `--accent-hover` | `#1E40AF` | Hover and pressed blue |
| `--score` | `#1D4ED8` | Numeric scores and bars, always shown with their value |
| `--accent-soft` | `#EFF6FF` | Subtle active blue background |
| `--success` | `#15803D` | Completed states only |
| `--warning` | `#A16207` | Warnings only |
| `--danger` | `#B91C1C` | Errors and rejected states |
| `--shadow-soft` | `0 1px 2px rgb(15 23 42 / 5%)` | Single soft elevation level |

Use restrained tinted backgrounds for labels and statuses, with readable text
labels that make meaning clear without color. Amber and red are reserved for
warnings and errors; green is reserved for completed states. Keep all text at
WCAG AA contrast or better.

## Typography

- Interface: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- Monospace: system monospace stack for scores, timestamps, IDs and URLs; use
  tabular numerals for values that need to align.
- Page title: 28px, weight 650, line-height 1.2, tight letter spacing.
- Section heading: 18px, weight 600, line-height 1.3.
- Body: 15px, weight 400, line-height 1.6. Keep long text near 70 characters
  per line.
- Labels and metadata: 12px, weight 500; prefer sentence case except for
  compact eyebrow labels.

## Layout and components

- Use a slim, white top bar with the Vantage mark, a small set of tabs and the
  current run context on the right. Do not use a sidebar.
- Centre main content in a column up to 1120px wide with responsive gutters.
- Spacing uses a 4px base grid: 4, 8, 12, 16, 20, 24, 32, 40, and 48px.
- Cards use white surfaces, a 1px hairline border, 8-10px corners and generous
  spacing. Apply only the soft shadow token and only where it improves grouping.
- Ranked signal score bars are 80px wide, paired with a monospace value.
- Table headers stay visible while scrolling; rows are at least 44px tall and
  hover with `--surface-raised`. Wide tables scroll inside their container.
- Primary buttons use blue with white text; secondary buttons use a white
  surface and border. Both have clear hover, pressed, disabled and focus states.
- Every classification and score should have a visible explanation. Signal
  detail evidence quotes link to the original post where the source is real.

## Motion and accessibility

- Use CSS only. Hover, press and focus transitions last 150-250ms with
  `cubic-bezier(.2,.8,.2,1)`.
- Pages fade and rise briefly with a short stagger; route changes fade. Signal
  rows may stagger, and score values/bars may ease into their displayed values.
- Pipeline stages fill smoothly when complete, the active stage pulses subtly,
  and graph lines draw in once on load.
- Loading content uses skeletons, not spinning indicators.
- `prefers-reduced-motion: reduce` disables animation and transitions entirely.
- Keep a visible 2px blue focus ring with offset on every interactive control.
- Preserve semantic headings, labels, keyboard access and text alternatives.
- Verify text and control contrast against WCAG AA; do not soften text until it
  becomes difficult to read.

## Print

The Report page is a clean document on white paper: black text, 11pt body size,
no app navigation or action buttons, and signal cards and tables avoid page
breaks. Keep synthetic-data notices visible when printing and show source URLs
after external links.
