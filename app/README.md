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
| `npm run test` | Vitest, one run (tokens contract + router + render smoke tests) |
| `npm run build` | `vue-tsc` type-check + `vite build` → `dist/` |
| `npm run preview` | Serve the built `dist/` locally |

## Routes

The site map lives in `src/router/index.ts`. The **fiche d'identité** (`/territoire/:type/:id`) is built — breadcrumb, H1 + type chip, context switcher, payload-driven ThemeTabs (`?theme=`) — and lives in `src/views/TerritoireView.vue` (issue #35). The **carte interactive** (`/carte`) is built too (issue #39) — MapExplorer (MapLibre GL, CARTO Voyager basemap, GeoJSON territory masks per ADR-0008, theme-driven indicator layers), MapSidebar (search, mask levels, legend), and the same ThemeTabs subheader. maplibre-gl is lazy-loaded with the route (a ~225 ko gzip chunk on `/carte` only). The three **data lists** are built — `/communes`, `/epcis`, `/departements` as filterable link directories to the fiches (issue #40), sharing `src/components/ListeTerritoires.vue` over the pure list logic in `src/listes/listes.ts`. The remaining routes are placeholders until their tickets land:

| Route | Name | Status |
|---|---|---|
| `/` | `accueil` | **Built** — landing (#41) |
| `/carte` | `carte` | **Built** — map (#39) |
| `/communes` | `communes` | **Built** — link directory (#40) |
| `/epcis` | `epcis` | **Built** — link directory (#40) |
| `/departements` | `departements` | **Built** — link directory (#40) |
| `/territoire/:type/:id` | `territoire` | **Built** — fiche shell (#35) |
| `/methodologie` | `methodologie` | **Shell** — Sources & Méthodes (#42) |
| `/a-propos` | `a-propos` | **Shell** — À propos (#42) |

## Deploy path

Two hosts, one URL contract (`/` = app, `/data/` = payload):

- **Pi (primary, `docs/self-hosting.md`)** — a tag triggers the dist build, committed to the repo; nginx serves `dist/` at the site root with `try_files $uri /index.html` (SPA fallback) and aliases `/data/` to repo-root `public/data/` — the payload is served live from the working tree, never baked into the app.
- **Vercel (failover/dev, ADR-0006)** — project Root Directory = `app`. `vercel.json` supplies the same SPA fallback (rewrites → `/index.html`). Vercel can only serve what the build output contains, so the Vite build copies `public/data/` into `dist/data/` (ADR-0010) — a per-deploy snapshot, exactly the failover role: current as of the last push, no nginx alias needed.

The app therefore uses **history-mode routing** (`createWebHistory`, default base `/`) — matching the fallback on both hosts. The app's own bundle never ships the payload; `public/data/` at the repo root remains the single source, fetched at runtime from `/data/`.

From the repo root, `npm run dev` / `build` / `test` / `preview` forward to the app via the root `package.json` wrapper.

## Conventions

- **French is the product language** — UI copy, page titles, route names. No "under construction" copy: empty states say "À venir."
- Component names and behaviors follow `CONTEXT.md` (territoire, fiche d'identité, thème, indicateur, rang, vintage…).
- Tokens only from `src/styles/tokens.css`. No new color/heuristic outside it — extend `DESIGN.md` first.
