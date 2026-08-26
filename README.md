# Lusk — Observatoire des territoires bretons

> *« Je transforme des données publiques éparses en intelligence territoriale — de l'idée à l'analyse, en passant par la donnée et le logiciel. »*

Lusk is an **open territorial observatory for Brittany** — départements 22 · 29 · 35 · 56. Every commune, EPCI, and département gets a *fiche d'identité*: a compact portrait of the territory built from public open data, across six themes — **Mobilité**, **Démographie**, **Habitat**, **Économie/Emploi**, **Milieux**, **Programmes et subventions**. And every published indicator gets its own *Page d'indicateur*: the same data read the other way, followed across all comparable territories.

## What the app will do

For each territory, the app assembles a fiche whose structure is **declared in the payload**: each theme publishes its own metadata file (`theme_<theme>.json`) naming its **subgroups** — stable, ordered slots that carry the indicators, a compact figure, and one **resolved Story reading** per subgroup. Every indicator carries its **rank-in-context** — a direction-aware ordinal « Xᵉ / Y » among its comparison peers (a commune within its EPCI, an EPCI among all Breton EPCIs, a département among the four départements — ADR-0015/0021). Stories are computed readings, resolved **per (territoire, subgroup) by the pipeline** and shipped as `histoires_<theme>.json` — the app never picks or infers them (ADR-0002). Each theme stays **hermetic**: it renders only its own metadata, indicators, and histories files, plus the shared reference tables (ADR-0020).

On top of the fiches:

- **Pages d'indicateur** — one canonical page per published indicator (`/indicateurs`), with three views: Repères (distribution, extremes, ranks), Carte (the indicator's spatial view), and L'indicateur (definition, calculation, sources)
- **Search** — find a territory by name
- **Freshness you can see** — every indicator shows its **vintage** (source, version, date), so the product never pretends to be fresher than it is; dataset provenance lives on the **Sources** page

## How it's built

One person, two moving parts:

```
lusk/
├── README.md       ← you are here
├── pipeline/       → R data pipeline (download → compute → publish)   ✅ built (all five themes + programmes)
└── app/            → Vue application (fiches, Pages d'indicateur, Sources) ✅ built
```

- **`pipeline/`** — an R pipeline that downloads the source datasets (INSEE, data.gouv.fr, data.bretagne.bzh, data.ademe.fr), filters to Bretagne, computes the fiche indicators and ranks, resolves the subgroup Story readings, records each dataset's vintage (reference **and** publication dates), and publishes the result per theme — facts, histories, and theme metadata, independently refreshable. Idempotent (re-runs never duplicate; corrupt downloads are re-fetched), with a single documented entry point (`run_pipeline(theme = ...)`) and a testthat suite (4 559 expectations). All five themes are built and run end-to-end.
- **`app/`** — a Vue application that renders the payload: territory pages (the fiches), the Pages d'indicateur catalogue and its pages, search, lists, and the Sources page. The app renders; the pipeline computes. Navigation: Territoires · Indicateurs · Sources · À propos; the standalone `/carte` remains routed but carries no link (PO ruling 2026-08-26).
- **Automation** — the light themes refresh on a schedule (GitHub Actions); the flagship Mobilité analysis rebuilds on a slower clock. A vintage table is the seam that makes the freshness promise honest.

The data is **open**: the bulk under Licence Ouverte, with OSM-derived layers under ODbL (attribution "© OpenStreetMap contributors"). The code is **public**; there are **no accounts**.

## v1 scope

- All of Brittany — ~1 200 communes, their EPCIs, the four départements, and the région
- Six theme blocks on the fiche: **Mobilité** (the flagship — an existing accessibility analysis, ported), **Démographie**, **Habitat**, **Économie/Emploi**, **Milieux**, **Programmes et subventions**
- A fiche d'identité per territory, a Page d'indicateur per published indicator, search, the Sources page
- Scheduled refresh with visible vintage

## Status

- **v0.5 (now)** — all five data themes are built end-to-end: each downloads its sources, filters to Bretagne, computes its indicators (a variable set, decided per theme) with direction-aware ordinal ranks and its subgroup Story readings, and publishes its payload — `indicateurs_<theme>.json` (facts), `histoires_<theme>.json` (resolved readings), and `theme_<theme>.json` (the declared structure) — plus the programmes payload and the shared reference tables (1 268 territoires, testthat suite green). The app is built: fiches (Programmes et subventions first/default), the catalogue `/indicateurs` and its 34 Pages d'indicateur across the six themes, search, lists, and Sources; navigation Territoires · Indicateurs · Sources · À propos (Vitest suite green — 88 files, 1 344 tests).
- **v1** — Bretagne, the six theme blocks, light themes automated, the app (fiches, Pages d'indicateur, charts)
- **After v1** — an AI query layer, France-wide coverage, finer-grained data

---

*Conçu par Calum Robertson — Docteur en économie urbaine.*
