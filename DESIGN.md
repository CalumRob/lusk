# Lusk Design System

The human-owned source of visual decisions for Lusk. Read it when changing presentation; implementation and surface adoption are tracked separately and are not implied by a rule being documented here. This document preserves the inherited system while recording the approved Variant E foundation and the boundaries between adopted, provisional, and pending work.

**Sources and status:** inherited palette, components, and constraints below remain historical/current guidance where compatible with present product contracts. The approved Variant E identity is the rollout direction: gray-green paper, red margin/index accents, and reading-led presentation. Its shared foundation is implemented on the existing E Mobilité and limited production territory/indicator surfaces; that is not site-wide completion or final visual validation. See [Variant E foundation inventory](docs/variant-e-foundations.md), #511 (design evidence), #528 (territory rebuild), #636 (typography), #637 (foundations), and pending adoption #638–#640.

### Adoption and ownership

- **Adopted direction:** paper ground, red margin/index accents, reading-led sections. Shared semantic values belong in the token layer and reusable presentation scope; surface renderers consume those roles rather than copy arbitrary literals.
- **Implemented, not universally reviewed:** existing E Mobilité and the limited production territory subgroup/normal indicator routes consume shared foundations. Do not infer all six themes, every indicator family/view, or all site chrome are visually adopted.
- **Pending:** remaining territory themes and indicator views/family treatments proceed through #638–#640. Catalogue, header, sources, and other surfaces need scoped adoption/review; shared tokens alone do not complete them.
- **Provisional/specialized:** exact spread widths and pagination, future readings, hand-drawn extreme-rank outlines, and map-specific experimental treatments remain composition-specific observations, not universal requirements.
- **Seams:** the site-wide header is independently tunable; its typography role is not interchangeable with generic UI or theme-tab roles. Shared editorial styles do not merge territory content semantics with indicator exploration semantics.

The detailed identity is a rollout foundation, not a claim that every listed value or prototype detail is already applied everywhere. Content, figure meaning, metadata, comparisons, URLs, interactions, and provenance remain governed by their product/data contracts.

## 1. Atmosphere & Identity

The statements in this section describe the inherited mint/teal system, not the adopted rollout identity. Variant E's adopted direction is the paper/red-margin reading-led presentation described above. Existing legacy color roles may remain where current contracts require them; do not infer the old atmosphere is the new default.

A living territorial report. Calm mint-and-teal surfaces, quiet density for data, and an editorial serif voice for the story each fiche tells. The signature is the **collision of two typefaces**: Manrope's tool voice and Newsreader's report voice, on the mint/teal ground. The one moment a visitor remembers: the fiche d'identité's **serif one-liner** — the sentence the data wrote about their commune, in a voice that says "a human report," not "a stats page."

Each theme has its own pale color voice — teal, indigo, terracotta, amber — carried by the theme subheader: the tab you're on wears the theme in its text and underline, and the page itself takes a whisper of it.

Personas: the chargé d'études (wants credible numbers fast), the élu (wants the story), the data-manager peer (wants to know it's reproducible), and the person behind it (wants the product to be the pitch).

## 2. Color

Light-only for v1 (dark mode is accepted debt — Section 8). Extracted from the current palette, tightened into a real ramp.

### Palette

| Role | Token | Light | Usage |
|------|-------|-------|-------|
| Surface/page | `--surface-secondary` | `#F8FBFB` | Page background (mint-tinted white) |
| Surface/primary | `--surface-primary` | `#FFFFFF` | Cards, header |
| Surface/tertiary | `--surface-tertiary` | `#F0F6F5` | Alt panels, table headers, hover fills |
| Surface/elevated | `--surface-elevated` | `#FFFFFF` | Modals, popovers, drawer (with border + shadow) |
| Text/primary | `--text-primary` | `#2D3748` | Headlines, body |
| Text/secondary | `--text-secondary` | `#718096` | Captions, hints, muted |
| Text/tertiary | `--text-tertiary` | `#A0AEC0` | Disabled, placeholders |
| Border/default | `--border-default` | `#E2E8F0` | Dividers, card outlines |
| Border/subtle | `--border-subtle` | `#EDF1F1` | Soft separations |

### Brand ramp (tightened)

| Step | Token | Value |
|------|-------|-------|
| 50 | `--brand-50` | `#F0F6F5` |
| 100 | `--brand-100` | `#CCE3DE` (the mint — original requested color) |
| 200 | `--brand-200` | `#83ACA7` |
| 300 | `--brand-300` | `#6B918C` |
| **500** | `--brand-500` | `#57726F` (**the anchor**) |
| 600 | `--brand-600` | `#4A615E` (hover, primary button) |
| 700 | `--brand-700` | `#3E5350` (replaces the old `--brand-dark` dup) |
| 900 | `--brand-900` | `#2B3A38` |

> Values marked with a step are **provisional**. The identity steps are fixed (extracted): `--brand-50` `#F0F6F5`, `--brand-100` `#CCE3DE`, `--brand-200` `#83ACA7`, `--brand-500` `#57726F` (the anchor). The intermediate steps **derive** from the anchor the same way the theme ramps do — change the anchor, the ramp follows:
>
> - `--brand-300: color-mix(in oklab, var(--brand-500) 60%, #FFFFFF)`
> - `--brand-600: color-mix(in oklab, var(--brand-500) 85%, #0C1B19)`
> - `--brand-700: color-mix(in oklab, var(--brand-500) 62%, #0C1B19)`
> - `--brand-900: color-mix(in oklab, var(--brand-500) 35%, #0C1B19)`
>
> The old `--brand-dark` (= `--brand-primary`) duplicate is resolved: there is now one ramp.

### Interactive

| Token | Value | Usage |
|-------|-------|-------|
| `--accent-primary` | `var(--brand-500)` | Links, active states, focus |
| `--accent-hover` | `var(--brand-600)` | Hover states |
| `--focus-ring` | `2px solid var(--brand-500)` | Visible focus (improved from the weak mint ring) |

### Theme colors — one anchor per theme, ramp derived (PROVISIONAL anchors)

Each theme defines **one anchor color** (`--theme-X`). The four roles are **derived programmatically** from it — adjusting a theme later is a **one-hex change**, never four. The **general theme** (no theme selected) is the **brand ramp** — there is no fifth color system.

Derivation recipe (CSS `color-mix`, OKLCH space — perceptually even; the mix percentages are the tuning knobs, validated in the showcase):

| Role | Recipe | Usage |
|------|--------|-------|
| `--theme-X-wash` | `color-mix(in oklab, var(--theme-X) 8%, var(--surface-secondary))` | page bg whisper |
| `--theme-X-soft` | `color-mix(in oklab, var(--theme-X) 16%, var(--surface-primary))` | fills, chips, hover |
| `--theme-X-line` | `var(--theme-X)` | underline, icons, legend |
| `--theme-X-strong` | `color-mix(in oklab, var(--theme-X) 62%, #0C1B19)` | text, selected (darkened for contrast) |

| Theme | Anchor (`--theme-X`) |
|-------|----------------------|
| **Mobilité** | `#6BA3B5` (teal) |
| **Démographie** | `#8E85C4` (indigo) |
| **Habitat** | `#C98F6E` (terracotta) |
| **Économie** | `#D9A441` (amber — or/ambre, la valeur/économie, hors du vert-bleu de marque; décision #214) |

**Historical four-theme guidance:** the anchors, general-theme/Aperçu behavior, and surface list in this subsection document the inherited implementation, not the current canonical theme contract. Product themes/defaults have evolved (see ADR-0024 and `CONTEXT.md`); treat runtime metadata and route contracts as authoritative. Do not assume the legacy Aperçu/default behavior remains current.

**Where theme colors apply** — on every page that carries the ThemeTabs subheader (fiche, carte, à-propos):
- the **tab**: selected = `-strong` text + `-line` underline; hover = `-soft`
- the **page**: a whisper of `-wash` in the background
- **UI elements**: theme block headers, chips, KPI accents, map layer + legend, focus ring within the theme, the story overline
- the **cross-theme elements** (KPI strip, header, footer) stay on the brand ramp — the general theme — everywhere.

> Mobilité keeps its **mode colors** (below) as the semantic layer *within* the theme: the theme marks the tab and the page, the mode colors mark the metric (t/b/c).

### Modes (semantic — preserved from the original)

| Token | Value | Meaning |
|-------|-------|---------|
| `--mode-transit` | `#448FA6` | Walk + transit |
| `--mode-bike` | `#2E6171` | Bike |
| `--mode-car` | `#A94562` | Car |
| `--gradient-modes` | `linear-gradient(90deg, #448FA6, #2E6171, #A94562)` | Mode legend gradient |
| `--gradient-main` | `linear-gradient(90deg, #448FA6, #2E6171)` | Brand gradient accents |

### Status

| Token | Value |
|-------|-------|
| `--status-success` | `#2EA043` |
| `--status-warning` | `#D97706` |
| `--status-error` | `#CB2431` |
| `--status-info` | `var(--brand-500)` |

### Rules

- Accent (brand) is used ONLY for interactive elements and brand identity. Never decorative.
- The one sanctioned decorative use of the brand is the **filigrane** — the fiche watermark (Section 7): the locked ermine at `--filigrane-opacity`, its accents in the active theme's anchor. Everything else stays under the "never decorative" rule.
- Never introduce a color not in this table. Extend the table first.
- Theme ramps derive from **one anchor per theme** (`color-mix`) — never hardcode a derived role; adjust the anchor.
- Status colors never carry meaning alone — always pair with an icon or label (color-blind safe).
- Map choropleths: never rely on a single hue ramp alone — see Section 8 debt.

## 3. Typography

The inherited two-family description below is historical, not a current restriction: approved semantic roles now use multiple self-hosted families, independently assigned by role. Current mappings are owned by `app/src/styles/tokens.css`; do not copy family choices into individual renderers.

| Stack | Token |
|-------|-------|
| Legacy sans stack | `--font-sans` (Manrope fallback stack; inherited compatibility role) |
| Serif / wordmark | `--font-serif` / `--font-wordmark` (Newsreader) |
| Additional stacks | Mozilla Headline, Mozilla Text, and Fira Code are assigned through semantic role tokens; see current token source. |

### Scale

| Level | Token | Size | Family/Weight | LH | Tracking | Usage |
|-------|-------|------|---------------|----|----------|-------|
| Story/Display | `--text-display` | `clamp(2.25rem, 4vw, 3rem)` | Newsreader 600 | 1.15 | -0.01em | Hero claim, fiche one-liner |
| H1 | `--text-h1` | `clamp(1.75rem, 3vw, 2rem)` | Manrope 700 | 1.2 | -0.015em | Page titles |
| H2 | `--text-h2` | `1.5rem` | Manrope 600 | 1.3 | -0.01em | Section headers |
| H3 | `--text-h3` | `1.1875rem` | Manrope 600 | 1.4 | 0 | Card titles, theme block titles |
| Body/lg | `--text-body-lg` | `1.125rem` | Manrope 400 | 1.6 | 0 | Lead paragraphs |
| Body | `--text-body` | `1rem` | Manrope 400 | 1.6 | 0 | Default text |
| Body/sm | `--text-body-sm` | `0.875rem` | Manrope 400 | 1.5 | 0 | Secondary info |
| Caption | `--text-caption` | `0.75rem` | Manrope 500 | 1.4 | 0.02em | Labels, metadata, vintage stamps |
| Overline | `--text-overline` | `0.6875rem` | Manrope 600 | 1.3 | 0.08em | Section labels, uppercase |
| Numeric | `--text-numeric` | matches body sizes | Manrope 600, **tabular-nums** | — | — | KPI figures, indicator values |

### Rules

- Typography follows semantic roles, not a maximum-family count or a blanket chrome-family rule. Current approved assignments include display/subsection titles in Mozilla Headline; body, narrative, UI, global header, theme tabs, and figure labels in Mozilla Text; body emphasis, metadata, figure values and comparisons in Fira Code; and the wordmark in Newsreader. Roles remain independently tunable; the global header has its own role. The token file is authoritative for exact current assignments.
- Body text never below 14px.
- All numeric data uses `font-variant-numeric: tabular-nums` — digits never jitter.
- Headings that would wrap to 4+ lines are too large — use `clamp()`.

## 4. Spacing & Layout

Base unit **4px**. Full scale:

`--space-1: 4px` · `--space-2: 8px` · `--space-3: 12px` · `--space-4: 16px` · `--space-5: 20px` · `--space-6: 24px` · `--space-8: 32px` · `--space-10: 40px` · `--space-12: 48px` · `--space-16: 64px` · `--space-20: 80px` · `--space-24: 96px`

### Grid & shell

- Page content max width: **1200px**. Header/full-bleed max: **1400px**.
- 12-column grid, 24px gutter, 16px margin at mobile.
- Breakpoints: sm 640 · md 768 · lg 1024 · xl 1280.
- `--header-height: 60px` (single source of truth, kept).

### Radii / shadows / z-index

| Token | Value |
|-------|-------|
| `--radius-sm` 6px (fixes the undefined `--radius-sm` bug in ACI_app) · `--radius-md` 8px · `--radius-lg` 12px · `--radius-full` 999px |
| `--shadow-subtle` `0 1px 2px rgba(0,0,0,0.04)` · `--shadow-default` `0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03)` · `--shadow-prominent` `0 8px 24px rgba(0,0,0,0.12)` |
| `--z-sticky` 100 · `--z-header` 1000 · `--z-drawer` 1100 · `--z-overlay` 1200 · `--z-popover` 1300 · `--z-toast` 1400 |

### Rules

- Tokenize design intent (spacing, widths, gutters). Keep browser mechanics raw (`clamp()`, `auto`, `%`, intrinsic sizing).
- Asymmetric spacing is intentional — document why when used.

## 5. Components

Primitives extracted from the two apps (used 2+ times or shared across both). Full inventory with states: `docs/design/ui-elements.md`. Summary of the core set:

| Primitive | Notes |
|-----------|-------|
| **AppHeader** | Inherited component description; exact navigation, links, and behavior follow current product/navigation contracts. Typography has an independent `--font-global-header` role; do not assume the legacy nav/contact details are current. |
| **ThemeTabs** | Inherited component description. Current theme membership, labels, order, and URL defaults come from current product contracts (see ADR-0024 and `CONTEXT.md`); legacy Aperçu/four-theme behavior here is not a current rule. |
| **AppCard** | Default / hoverable / accent variants. Border + `--shadow-default`. Radius `--radius-lg`. |
| **Buttons** | Base (surface + border), Primary (`--brand-600`, hover 700), Ghost. Full states. See ui-elements. |
| **AppIcon** | lucide-vue-next wrapper — sized, colored via tokens. No emojis anywhere. |
| **GlobalSearchBar** | Tabbed search (Entités / Données / Aléatoire) — ported, with result actions (voir la page, comparer, explorer). |
| **FootnoteMarker + AppFootnotePopover** | The scholarly credibility system: footnote markers in text, popover on hover/click. Distinctive — kept. |
| **FigureLightbox** | Editorial figures (from ACI_app) — for methodology and story visuals. |
| **TransportModeIcon + mode colors** | t/b/c mode chips (transit/bike/car). Semantic colors preserved. |
| **MapExplorer / MapSidebar / MapLegend** | Full-bleed map shell, sidebar with search/layers, legend. |
| **KPI / IndicatorFigure** | The fiche number: `--text-numeric`, value + label + rank-in-context chip + vintage stamp. |
| **ThemeBlock** | One theme's tab content (fiche): overline (theme `-strong`) → **one story angle** (serif one-liner + chart + "how to read" + Méthodes link — the fiche's signature moment, first in the block since #71) → standard indicator grid. Full theme ramp in play. |
| **Table** | Data lists (communes/EPCIs/départements, équipements) — sortable, department filter, mobile → cards. |
| **EntityCarousel** | Landing "aléatoire" carousel — ported. |
| **Badge / Chip** | Status, rank-in-context, mode chips. Radius `--radius-full`. |

## 6. Motion & Interaction

| Type | Duration | Easing | Usage |
|------|----------|-------|-------|
| Micro | 100–150ms | ease-out | Button press, hover fills, icon states |
| Standard | 200–300ms | ease-in-out | Panel open, tab switch, drawer |
| Emphasis | 400–600ms | `cubic-bezier(0.16, 1, 0.3, 1)` | Page transition, carousel, hero entry, bottom sheet |
| Scroll-driven | tied to scroll | linear | (rare — IntersectionObserver only, never scroll listeners) |

### Rules

- Only animate `transform` and `opacity`. Never layout properties.
- Every interactive element has hover + active + focus states.
- **Slop animation is forbidden**: motion only where it signals interaction or state. A hover that changes nothing is a defect.
- Respect `prefers-reduced-motion` — disable non-essential animation (the drawer becomes instant; the carousel stops auto-advancing).

## 7. Depth & Surface

Strategy: **mixed** (extracted from the apps) — borders for structure, soft shadows for elevation, tonal-shift (`--surface-tertiary`) for hierarchy, backdrop-blur for chrome.

- Structure: `--border-default` on cards/rows; `--border-subtle` for soft separations.
- Elevation: `--shadow-subtle` (rest) → `--shadow-default` (cards, dropdowns) → `--shadow-prominent` (modals, drawer).
- Chrome: the header and mobile backdrop use `rgba(255,255,255,0.8)` + `backdrop-filter: blur(12px)` (with `@supports` guard), kept from the originals.
- The mint ground does the emotional work: `--surface-tertiary` panels against `#F8FBFB` is the calm the product is named for.
- **Hero band (landing)**: `--surface-hero` — `radial-gradient(46rem 32rem at 82% -6%, color-mix(in oklab, var(--brand-100) 55%, transparent), transparent 70%), var(--surface-secondary)`. The hero's branded ground (mock/brand/iterations/v8.html): the mint washes in from the top-right and fades, the page surface does the rest. The carousel zone below stays on the plain `--surface-secondary` page ground — the band edge (with a `--border-subtle` bottom border) is the vertical separation between the two landing zones.
- **Filigrane (fiche watermark)**: the fiche d'identité's quiet brand signature — the locked ermine drawn *behind* the tab content, two-tone: the ink body and tail tip stay `#1B1B19`, the accent parts (tail root, ear, eye) take the active theme's anchor (`--theme-X-line`; Aperçu = `--brand-500`, the canonical lockup colors washed). Whole-mark opacity `--filigrane-opacity` (0.08). Width re-draws randomly per tab switch within `--filigrane-largeur-min` → `--filigrane-largeur-max`, position within the fiche content area; the draw is fixed for the lifetime of a mount (tab switch = remount = new draw; a re-render never moves it). This is the theme's signature on the ground — §1's "the page takes a whisper of it" given a shape — kept calm by its opacity, by painting behind content, and by the draw-once contract (no motion, §6). Decorative in the strict sense, but sanctioned brand identity (§2 carve-out), never data.

## 8. Accessibility Constraints & Accepted Debt

### Constraints

- **WCAG 2.2 AA**: contrast floor 4.5:1 body / 3:1 large text; visible focus on every interactive element (`--focus-ring`); full keyboard reachability (drawer: focus trap + Escape; popovers: dismissible; carousel: keyboard controls).
- `prefers-reduced-motion` respected (Section 6).
- Color never the sole carrier of meaning (status pairs with icons/labels; choropleths carry non-color encoding or an accessible alternative).
- French is the product language (per `docs/principles.md`); the i18n infrastructure from ACI_app is ported, but v1 ships French.

### Accepted Debt

| Item | Where | Why accepted | Owner / Exit |
|------|-------|--------------|--------------|
| No dark mode | whole system | v1 is light-only; the mint identity is a light-surface design; dark mode would need a full second ramp | revisit after v1 |
| Theme anchors + derivation mix % | Section 2 | one hex per theme, ramp derives — anchors provisional, validated in the showcase | user validation in primitive showcase |
| Brand ramp steps 300/600/700/900 unverified | Section 2 | provisional values; anchor + 100/200 fixed | visual QA in primitive showcase |
| Google Fonts in the two legacy apps | `E:\Website\Dashboard`, `E:\ACI_app` | legacy; Lusk starts clean with Fontsource | no exit planned (legacy) |
| Map choropleth single-hue ramps (existing pattern) | MapExplorer | legacy pattern; accessibility alternative pending | revisit with map work |

## 9. The Figure Grammar (inherited production contract; under review)

This section records the inherited production contract, not a newly validated or permanently closed product rule. `CONTEXT.md` describes the figure-family model as under review; current product descriptors and ADRs own shipped semantics. The E figure label/legend/value grammar is a shared presentation candidate, while family-specific marks and meanings remain local. Do not treat the eight-family list as universally adopted across territory and indicator surfaces.

### The eight families

| Family | Reads | Renders | On the fiche |
|--------|-------|---------|--------------|
| **Scalar** | one value | the number + rank chip | the default grid card — most indicators |
| **Composition** | parts of a whole | non-stacked bars to 100 % | mix_logements, voitures 0/1/2+, statut, type (mode-colored where the parts are modes) |
| **Trajectory** | an evolution | line / state-pair | conso_enaf_annuel (with the EPCI/région mean), artif_par_habitant M2→M3 |
| **Distribution** | a spread | compact two-medians histogram | the div_loss readings, the vélo reading |
| **Relationship/cloud** | two forces | same-scale peer cloud (ADR-0011) | the soldes, the Milieux quadrant |
| **List** | a ranking | top-5 list | the Économie lecture |
| **Pyramid** | men/women by age | horizontal-bands pyramid | structure_age (#199) |
| **Comparison bars** | a value vs references | vertical non-stacked bars + EPCI/région médiane | the iso_* deprivation figure, artif M2→M3 |

### The card shell

Every grid figure shares the same card shell — the app never invents its parts:

- **Payload-owned label** — the label comes from the theme metadata, never hardcoded in the app (ADR-0020). No raw key ever renders.
- **Rank chip « Xᵉ / Y »** — the direction-aware ordinal (ADR-0015/0021), group size always shown, **with the direction glyph**: ▲ « plus = mieux » / ▼ « moins = mieux ». **The glyph never carries meaning alone** — the full sentence lives in the tooltip and the aria-label (color-blind safe, §2/§8). A chip without its sentence is a defect.
- **Vintage stamp** — source identity + version + date (§3 caption style): the freshness promise on every card (ADR-0005).

### The scalar accent

Scalar cards carry a **quiet theme-ramp edge accent keyed on rank position** — a left edge in the theme's `-strong` tone: **strong in the top third of the rank, faint in the middle third, none in the bottom third**. It is direction-safe by construction: the rank is already direction-corrected (« 1er est toujours bon », ADR-0015), so the accent reads *position*, never *judgment*. It is **never a status color** — the §2 status tokens stay reserved for real states, and the accent never says good/bad, only where the territory sits.

### The compactness rule

**No figure exceeds ~200 px tall.** Reading figures sit **compact beside the prose** — the serif one-liner in the report voice with its figure at its side; **only the prose is full-width**. The fiche clarifies, it never dominates: a figure taller than the prose it explains is a defect. The full-width slab is retired.

### The DPE carve-out

**distribution_dpe renders in the official A→G colours**, never the theme's palette: the fiche speaks the same visual language as the DPE label on the door (US 7, #367). This is the **one sanctioned palette override** — every other figure stays on the theme ramp (§2), and the carve-out is recorded here so a future palette tightening never silently re-colors the DPE.

### Rules

- The family is payload-declared — the app switches, it never chooses.
- Reading values (div_loss, tot_loss, the soldes rates, the top-5 LQ…) are **indicators of their subgroup like any other**: they render in their family's figure style, they keep the shell (except the clouds, which replace the chip).
- A subgroup may declare **no reading** — the honest silent state is a first-class contract, never a placeholder.
- Never introduce a ninth family by hand — extend the grammar, then the renderer.
