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

The site map lives in `src/router/index.ts`. The **fiche d'identité** (`/territoire/:type/:id`) is built — breadcrumb, H1 + type chip, context switcher, payload-driven ThemeTabs (`?theme=`) — and lives in `src/views/TerritoireView.vue` (issue #35). The **carte interactive** (`/carte`) is built too (issue #39) — MapExplorer (MapLibre GL, CARTO Voyager basemap, GeoJSON territory masks per ADR-0008, theme-driven indicator layers), MapSidebar (search, mask levels, legend), and the same ThemeTabs subheader. maplibre-gl is lazy-loaded with the route (a ~225 ko gzip chunk on `/carte` only). The remaining routes are placeholders until their tickets land:

| Route | Name | Status |
|---|---|---|
| `/` | `accueil` | Placeholder |
| `/carte` | `carte` | **Built** — map (#39) |
| `/communes` | `communes` | Placeholder |
| `/epcis` | `epcis` | Placeholder |
| `/departements` | `departements` | Placeholder |
| `/territoire/:type/:id` | `territoire` | **Built** — fiche shell (#35) |
| `/methodologie` | `methodologie` | Placeholder |
| `/a-propos` | `a-propos` | Placeholder |

## Deploy path

Per `docs/self-hosting.md`: a tag triggers the dist build, committed to the repo; the Pi's nginx serves `dist/` at the site root with `try_files $uri /index.html` (SPA fallback) and aliases `/data/` to the published payload. The app therefore uses **history-mode routing** (`createWebHistory`, default base `/`) — matching that fallback. `public/data/` at the repo root is the payload the nginx `/data/` alias serves; the app never ships it in its own bundle.

## Conventions

- **French is the product language** — UI copy, page titles, route names. No "under construction" copy: empty states say "À venir."
- Component names and behaviors follow `CONTEXT.md` (territoire, fiche d'identité, thème, indicateur, rang, vintage…).
- Tokens only from `src/styles/tokens.css`. No new color/heuristic outside it — extend `DESIGN.md` first.
