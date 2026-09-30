# Lusk typography roles — production usage audit

This is the static comparison for #618. It compares three complete assignments across the wordmark, display and section titles, body copy, UI, and figure data. The retained mapping is shown first; the other two columns are alternatives. The comparison uses the self-hosted Fontsource families shipped with the app and makes no external font requests.

Open `index.html` in a browser after installing the app dependencies (`npm install` in `app/`). The specimen loads the Fontsource files directly from `app/node_modules`; it has no network font requests.

## Current production ownership

| Current seam | Current family | Semantic role / finding |
|---|---|---|
| `app/src/components/LuskBrand.vue` `.lusk-brand__wordmark` | Newsreader | **Wordmark**; explicitly protected by #618. |
| `app/src/styles/tokens.css` `--font-display-title` | Mozilla Headline | **Display title**; high-level editorial titles. |
| `app/src/styles/tokens.css` `--font-section-title` | Manrope | **Section title**; content hierarchy below display. |
| `app/src/styles/tokens.css` `--font-body` | Mozilla Text | **Body**; long-form reading copy. |
| `app/src/styles/tokens.css` `--font-ui` | Mozilla Text | **UI**; interface text, independently assignable from body. |
| Figure family roles | Mozilla Text / Fira Code | Figure labels, titles, legends, values, and comparisons each have independent family controls. Fira Code remains a figure-data family, separate from the five site-wide roles. |
| `app/src/main.ts` | Fontsource Manrope, Newsreader, Mozilla Headline, Mozilla Text, Fira Code | Families are self-hosted. Prototype-only Cahier variants are not part of the production-site audit. |

Production surfaces consume semantic family roles rather than naming family stacks directly: shared shell/header/footer, territory and indicator pages, Sources, map, search, theme tabs, and figure components. Variant E's shared Cahier styles are also routed through semantic roles for the user's future canonical reading view; this does not change routing or promote the prototype.

## Comparison options

The board shows three complete assignments using the self-hosted families currently available to the app. The retained mapping matches the production role defaults; two alternatives make the role trade-offs visible.

The wordmark remains Newsreader. Change the semantic roles in `app/src/styles/tokens.css` to preview alternatives in production; the static board remains a local-only comparison aid.
