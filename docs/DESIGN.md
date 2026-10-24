# Vantage web design system

This document records the visual tokens and layout rules used by the React web
app. Keep page and component styling in `apps/web/src/styles/tokens.css` and
reuse these values when adding presentation changes.

## Colour tokens

The app uses a dark theme. These values are defined on `:root`:

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#0B0F14` | App background |
| `--surface` | `#121821` | Cards and panels |
| `--surface-raised` | `#1A2230` | Hover and raised surfaces |
| `--border` | `#243041` | Borders and dividers |
| `--text-primary` | `#E6EDF3` | Main text |
| `--text-secondary` | `#9AA7B6` | Supporting text and metadata |
| `--text-muted` | `#6B7889` | Decorative or nonessential muted detail; avoid for small text |
| `--accent` | `#2DD4BF` | Primary actions, active navigation, focus |
| `--accent-hover` | `#5EEAD4` | Accent hover state |
| `--score-high` | `#34D399` | Scores 70–100 |
| `--score-mid` | `#FBBF24` | Scores 40–69 |
| `--score-low` | `#F87171` | Scores 0–39 |
| `--label-buyer` | `#5EEAD4` | Buyer intent pill text |
| `--label-competitor` | `#C4B5FD` | Competitor complaint pill text |
| `--label-noise` | `#C5D0DD` | Noise pill text |
| `--label-venting` | `#FBBF24` | Venting pill text |

Classifier pills use a 12% tint of their label colour over `--surface`, with
the full label colour for text. Use text-primary or text-secondary for text
that must remain readable at small sizes. Contrast ratios for primary and
secondary text on the app, card, and raised backgrounds exceed WCAG AA; the
accent, score, and label colours also exceed AA on those dark backgrounds.

## Typography

- Interface: Inter; fallback `system-ui, -apple-system, Segoe UI, sans-serif`.
- Monospace: JetBrains Mono; fallback to the system monospace stack. Use it
  for scores, timestamps, IDs, and URLs.
- Page title: 28px, weight 600, line-height 1.2.
- Section heading: 18px, weight 600.
- Body: 15px, weight 400, line-height 1.6. Keep long text near 70 characters
  per line and do not bold text inside paragraphs.
- Labels and metadata: 12px, weight 500, uppercase, letter-spacing 0.06em.

## Layout and components

- Sidebar: 240px wide; collapses to icon navigation below 1024px.
- Main content: maximum width 1200px with 24px desktop padding.
- Spacing uses a 4px base grid: 4, 8, 12, 16, 20, 24, 32, 40, and 48px.
- Cards use `--surface`, a 1px `--border`, 12px corners, and 20px padding;
  do not add drop shadows.
- Ranked signal score bars are 80px wide, paired with a monospace value.
- Table headers stay visible while scrolling; rows are at least 44px tall and
  hover with `--surface-raised`. Wide tables scroll inside their container.
- Primary buttons use the accent with `#0B0F14` text. Secondary buttons use
  an outlined border. Both are 36px high with 8px corners.
- Every classification and score should have a visible explanation. Signal
  detail evidence quotes link to the original post where the source is real.

## Motion and accessibility

- Page enter: 200ms ease-out, fade plus 6px upward movement.
- First ten signal rows: 200ms fade-in, staggered by 20ms per row.
- Score bar fill: 400ms ease-out from zero.
- Hover and focus transitions: 150ms for background, border, and text colour.
- Loading skeleton shimmer: 1.6s ease-in-out.
- All movement and transitions are disabled for `prefers-reduced-motion: reduce`.
- Interactive controls have a visible 2px accent focus ring with 2px offset.
- Use text as well as colour for statuses, and provide accessible names for
  icon-only navigation controls.
