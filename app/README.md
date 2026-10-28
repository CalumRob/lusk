# Lusk — app

The Vue application: the map, the fiches d'identité, the lists. **The app renders the fiche payload; it does not compute it** (see `docs/architecture.md`).

## Stack

Vue 3.5 · TypeScript · Vite 7 · vue-router 5 · Vitest 4 (+ @vue/test-utils, happy-dom) · lucide-vue-next · Fontsource (Manrope, Newsreader, Mozilla Headline, Mozilla Text, Fira Code; variable, self-hosted).

Design decisions live in **`DESIGN.md`** (repo root) — the single source of truth for every visual decision. The token layer (`src/styles/tokens.css`) implements it 1:1; the contract test `src/__tests__/tokens.spec.ts` asserts that correspondence.

### Typography roles

`src/styles/tokens.css` separates family primitives from semantic roles. The five site-wide roles are `--font-wordmark`, `--font-display-title`, `--font-section-title`, `--font-body`, and `--font-ui`; their approved family assignments are pinned by `src/__tests__/tokens.spec.ts`. More specific surfaces (the global header, theme tabs, metadata, and figure text) have family-only override points where independent tuning is useful. The shared type scale continues to own size, weight, line-height, and tracking; surface tokens should not duplicate those properties merely to change a family. Fonts are imported from Fontsource and served locally.

## Commands

| Command | What it does |
|---|---|
| `npm install` | Install dependencies (lockfile: `package-lock.json`) |
| `npm run dev` | Vite dev server (hot reload) |
| `npm run test` | Vitest, one run (payload contract + fiche/carte + bascule + tokens + router) |
| `npm run build` | `vue-tsc` type-check + `vite build` → `dist/` |
| `npm run verify:profile-pages` | Bounded Playwright proof of all retained API-only profile pages with fully intercepted semantic API traffic |
| `npm run verify:ordinary-scalar-pages` | Bounded browser proof for all 15 retained ordinary-scalar pages; emits a JSON report to stdout for external capture |
| `npm run verify:series-pages` | Bounded browser proof for the five retained series-backed pages, including cold/warm acquisition and comparison retry; emits a JSON report to stdout |
| `npm run verify:series-warm-503 -- <external-report.json>` | Mounted browser proof of cold-batch and warm-focal HTTP 503 recovery, comparison-only retry, cache revisits and no previous-focal substitution; requires a clean committed tree and writes a trace-bearing UTF-8 JSON report outside the checkout |
| `npm run verify:series-native-bridge -- <external-output-directory>` | Fresh guarded SQL/HTTP capture plus the real native series acquirer bridge tests; requires the documented test-only database environment and writes evidence outside the checkout |
| `npm run preview` | Serve the built `dist/` locally |

## Routes

The site map lives in `src/router/index.ts`. The **fiche d'identité** (`/territoire/:type/:id`) is built — breadcrumb, H1 + type chip, context switcher, and the manifest-driven theme tabs: one shared subgroup loop over each theme's metadata (`theme_<theme>.json` — labels, order, figures, and reading templates are payload-owned, never app-side dictionaries), with the resolved `histoires` readings and payload-driven `?theme=` tabs — and lives in `src/views/TerritoireView.vue` (issues #35, #308, #314). The **carte interactive** (`/carte`) is built too (issue #39) — MapExplorer (MapLibre GL, Etalab positron vector basemap per ADR-0018 — OSM under ODbL, local vendored style without labels, GeoJSON territory masks per ADR-0008), MapSidebar (search, mask levels, legend), and the same ThemeTabs subheader. The carte consumes the **same metadata contract as the fiche** (ADR-0019): its layers, default layer, and popup rank semantics derive from `theme_<theme>.json` + `histoires_<theme>.json`, never from a carte-specific spec. maplibre-gl is lazy-loaded with the route (a ~225 ko gzip chunk on `/carte` only). The three **data lists** are built — `/communes`, `/epcis`, `/departements` as filterable link directories to the fiches (issue #40), sharing `src/components/ListeTerritoires.vue` over the pure list logic in `src/listes/listes.ts`. The remaining routes are placeholders until their tickets land:

| Route | Name | Status |
|---|---|---|
| `/` | `accueil` | **Built** — landing (#41, deux portes Territoires · Indicateurs #410) |
| `/carte` | `carte` | **Built** — map (#39) ; épargnée par ruling PO (2026-08-26, #410) : routée et fonctionnelle mais SANS aucun lien face-utilisateur |
| `/communes` | `communes` | **Built** — link directory (#40) |
| `/epcis` | `epcis` | **Built** — link directory (#40) |
| `/departements` | `departements` | **Built** — link directory (#40) |
| `/territoire/:type/:id` | `territoire` | **Built** — fiche (#35, manifest-driven #308/#314, Programmes et subventions premier #408) |
| `/sources` | `sources` | **Built** — la page Sources (#406) |
| `/a-propos` | `a-propos` | **Shell** — À propos (#42) |
| `/indicateurs` | `indicateurs` | **Built** — le catalogue des Pages d'indicateur (#409) |
| `/indicateurs/:theme/:indicator` | `indicateur` | **Built** — une Page d'indicateur (#409 et suites) |

La route `/methodologie` est **retirée** par la bascule atomique #410 : Méthodes n'est plus une destination — l'explication par indicateur vit sur « L'indicateur » de chaque Page d'indicateur, la provenance des jeux de données sur Sources (#406), le propos du projet sur À propos. Aucun alias ne subsiste.

## Deploy path

Two hosts, one URL contract (`/` = app, `/data/` = payload):

- **Pi (primary, `docs/self-hosting.md`)** — `git tag vX.Y` triggers the `build-dist.yml` workflow (tests first, then build, then a `github-actions[bot]` commit of `app/dist` to main); the Pi's systemd timer pulls it and nginx serves `app/dist/` at the site root with `try_files $uri /index.html` (SPA fallback) and aliases `/data/` to repo-root `public/data/` — the payload is served live from the working tree, never baked into the app.
- **Vercel (failover/dev, ADR-0006)** — the repo-root `vercel.json` drives the whole deploy, so the Vercel project needs no dashboard setting (leave Root Directory at the default `/`): `installCommand` installs in `app/`, `buildCommand` is the root wrapper, `outputDirectory` is `app/dist`, and `rewrites` supply the SPA fallback while `/data/` keeps real 404s (the loader's « 404 = theme absent » contract — the catch-all must never swallow a missing payload file). Vercel can only serve what the build output contains, so the Vite build copies `public/data/` into `dist/data/` (ADR-0010) — a per-deploy snapshot, exactly the failover role: current as of the last push, no nginx alias needed.

The app therefore uses **history-mode routing** (`createWebHistory`, default base `/`) — matching the fallback on both hosts. The app's own bundle never ships the payload; `public/data/` at the repo root remains the single source, fetched at runtime from `/data/`.

From the repo root, `npm run dev` / `build` / `test` / `preview` forward to the app via the root `package.json` wrapper.

The bounded browser proofs use intercepted API routes and fail closed for any
unrecognized request (HTTP 599); Chromium has a loopback-only outbound proxy
(`127.0.0.1:9`). Pass a unique output path under an external evidence directory,
for example:

```powershell
npm run verify:series-warm-503 -- 'E:\Temp\opencode\857-series-parent-review\luna-readiness\attempt-<id>\series-warm-503.json'
```

For the #857 final acceptance battery, run the five-page series proof, this
warm-503 proof, the native bridge, all 15 ordinary-scalar and 10 declared-profile
page proofs, plus the separately retained fiche 8-scenario and facts-first
3-scenario browser proofs. Capture each JSON stdout stream as UTF-8 in the
attempt's external evidence directory, use the native bridge's explicit external
output directory, and record the full exact source SHA; a passing browser fixture
run is not live-publication parity.

## Conventions

- **French is the product language** — UI copy, page titles, route names. No "under construction" copy: empty states say "À venir."
- Component names and behaviors follow `CONTEXT.md` (territoire, fiche d'identité, thème, indicateur, rang, vintage…).
- Tokens only from `src/styles/tokens.css`. No new color/heuristic outside it — extend `DESIGN.md` first.
## Configuration

The app does not require tracked `.env.development` or `.env.production` files.
Normal commands use the defaults defined in app source; intentional overrides
can be supplied through the invoking process environment (for example, in
PowerShell: `$env:VITE_THEME_ACQUISITION_API='0'` before running a command).

- `VITE_THEME_ACQUISITION_API` is enabled by default; setting it to `'0'` selects
  the incumbent static path. This client-side switch does not establish that an
  API route is deployed or available.
- `VITE_SCALAR_COHORT_API` remains an opt-in for retained fiche/standalone
  consumers; it does not gate ordinary scalar pages or the five registered
  ordered-series indicator pages. The latter are classified from `/api/resources`
  and read through the semantic batch contract; their old per-series feature
  switches and direct series routes do not select the page reader.
- Every canonical `/indicateurs/:theme/:indicator` route first discovers its
  producer-owned resource classification through `/api/resources`. A fresh
  discovery outage is retryable for all indicator pages, including pages whose
  other non-profile classifications keep an existing static reader. Page
  metadata or the read-model manifest cannot select a reader during an outage.
  Ordinary scalar pages use API-only facts and comparisons when the
  producer catalogue declares a scalar-only resource accepted by the existing
  normalized scalar page grammar; they have no environment switch or static
  numeric fallback. The five producer-declared ordered-series pages also use
  API-only facts, with their existing page grammar retained. Producer descriptor,
  facet, publication, and source identity remain authoritative: incompatibilities
  fail closed, comparison-only failures stay retryable without rereading valid
  facts, and the app does not invent source clocks. Producer-allowed levels do
  not expand the page's normalized comparison controls or create regional
  facts-only behavior. Other non-profile series, model, and legacy readers keep
  their existing modes and factual semantics.
- All retained declared-profile Page d’indicateur resources use the shared
  semantic profile reader without an opt-in switch. They remain API-only even
  when the independent scalar or theme-acquisition switches are unset or set
  to `'0'`; their incumbent page numerics are never a fallback. The old
  `VITE_STRUCTURE_AGE_PROFILE_API` switch and retired age-profile route reader
  have been removed. This does not change series, fiche, or standalone map
  acquisition modes.
- `LUSK_API_ORIGIN` optionally overrides the Vite development server's `/api`
  proxy target only; it is not bundled into the production frontend.
- `VITE_MAPS_PUBLIC_BASE_URL` optionally overrides the map-asset origin; the
  source-defined default is used when it is unset.
