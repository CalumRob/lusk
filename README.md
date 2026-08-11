# Lusk — Observatoire des territoires bretons

> *« Je transforme des données publiques éparses en intelligence territoriale — de l'idée à l'analyse, en passant par la donnée et le logiciel. »*

Lusk is an **open territorial observatory for Brittany** — départements 22 · 29 · 35 · 56. Every commune, EPCI, and département gets a *fiche d'identité*: a compact portrait of the territory built from public open data, across five themes — **Mobilité**, **Démographie**, **Habitat**, **Économie/Emploi**, **Milieux**.

## What the app will do

For each territory, the app assembles a fiche whose structure is **declared in the payload**: each theme publishes its own metadata file (`theme_<theme>.json`) naming its **subgroups** — stable, ordered slots that carry the indicators, a compact figure, and one **resolved Story reading** per subgroup. Every indicator carries its **rank-in-context** — a direction-aware ordinal « Xᵉ / Y » among its comparison peers (a commune within its EPCI, an EPCI among all Breton EPCIs, a département among the four départements — ADR-0015/0021). Stories are computed readings, resolved **per (territoire, subgroup) by the pipeline** and shipped as `histoires_<theme>.json` — the app never picks or infers them (ADR-0002). Each theme stays **hermetic**: it renders only its own metadata, indicators, and histories files, plus the shared reference tables (ADR-0020).

On top of the fiches:

- **A map** of Brittany — communes, EPCIs, départements — as the entry point
- **Search** — find a territory by name
- **Freshness you can see** — every indicator shows its **vintage** (source, version, date), so the product never pretends to be fresher than it is

## How it's built

One person, two moving parts:

```
lusk/
├── README.md       ← you are here
├── pipeline/       → R data pipeline (download → compute → publish)   ✅ built (all five themes)
└── app/            → Vue application (map, fiches, charts, Méthodes) ✅ built
```

- **`pipeline/`** — an R pipeline that downloads the source datasets (INSEE, data.gouv.fr, data.bretagne.bzh, data.ademe.fr), filters to Bretagne, computes the fiche indicators and ranks, resolves the subgroup Story readings, records each dataset's vintage (reference **and** publication dates), and publishes the result per theme — facts, histories, and theme metadata, independently refreshable. Idempotent (re-runs never duplicate; corrupt downloads are re-fetched), with a single documented entry point (`run_pipeline(theme = ...)`) and a testthat suite (4 559 expectations). All five themes are built and run end-to-end.
- **`app/`** — a Vue application that renders the fiche payload: the map, search, territory pages, charts, and the Méthodes page. The app renders; the pipeline computes.
- **Automation** — the light themes refresh on a schedule (GitHub Actions); the flagship Mobilité analysis rebuilds on a slower clock. A vintage table is the seam that makes the freshness promise honest.

The data is **open**: the bulk under Licence Ouverte, with OSM-derived layers under ODbL (attribution "© OpenStreetMap contributors"). The code is **public**; there are **no accounts**.

## v1 scope

- All of Brittany — ~1 200 communes, their EPCIs, the four départements, and the région
- Five themes, each contributing a block to the fiche: **Mobilité** (the flagship — an existing accessibility analysis, ported), **Démographie**, **Habitat**, **Économie/Emploi**, **Milieux**
- A fiche d'identité per territory, the map, search, a methodology page
- Scheduled refresh with visible vintage

## Status

- **v0.5 (now)** — all five themes are built end-to-end: each downloads its sources, filters to Bretagne, computes its indicators (a variable set, decided per theme) with direction-aware ordinal ranks and its subgroup Story readings, and publishes its payload — `indicateurs_<theme>.json` (facts), `histoires_<theme>.json` (resolved readings), and `theme_<theme>.json` (the declared structure) — plus the shared reference tables (1 268 territoires, testthat suite green — 4 559 expectations). The app is built: map, fiches, search, lists, and the Méthodes page (Vitest suite green — 1 092 tests).
- **v1** — Bretagne, five themes, light themes automated, the app (map, fiches, charts)
- **After v1** — an AI query layer, France-wide coverage, finer-grained data

---

*Conçu par Calum Robertson — Docteur en économie urbaine.*
