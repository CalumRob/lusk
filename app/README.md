# Lusk — app

The Vue application: the map, the fiches d'identité, the lists. **The app renders the fiche payload; it does not compute it** (see `docs/architecture.md`).

## Stack

Vue 3.5 · TypeScript · Vite 7 · vue-router 5 · Vitest 4 (+ @vue/test-utils, happy-dom) · lucide-vue-next · Fontsource (Manrope + Newsreader, variable, latin-ext).

Design decisions live in **`DESIGN.md`** (repo root) — the single source of truth for every visual decision. The token layer (`src/styles/tokens.css`) implements it 1:1; the contract test `src/__tests__/tokens.spec.ts` asserts that correspondence.

## Commands

| Command | What it does |
|---|---|
| `npm install` | Install dependencies (lockfile: `package-lock.json`) |
| `npm run dev` | Vite dev server (hot reload) |
| `npm run test` | Vitest, one run (payload contract + fiche/carte/méthodes + tokens + router — 1 092 tests) |
| `npm run build` | `vue-tsc` type-check + `vite build` → `dist/` |
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

## Conventions

- **French is the product language** — UI copy, page titles, route names. No "under construction" copy: empty states say "À venir."
- Component names and behaviors follow `CONTEXT.md` (territoire, fiche d'identité, thème, indicateur, rang, vintage…).
- Tokens only from `src/styles/tokens.css`. No new color/heuristic outside it — extend `DESIGN.md` first.
