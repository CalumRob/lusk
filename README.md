# Lusk — Observatoire des territoires bretons

> *« Je transforme des données publiques éparses en intelligence territoriale — de l'idée à l'analyse, en passant par la donnée et le logiciel. »*

Lusk is an **open territorial observatory for Brittany** — départements 22 · 29 · 35 · 56. Every commune, EPCI, and département gets a *fiche d'identité*: a compact portrait of the territory built from public open data, across four themes — **Mobilité**, **Démographie**, **Habitat**, **Économie/Emploi**.

## What the app will do

For each territory, the app assembles a fiche with a variable set of indicators per theme — the standard figures everyone recognises (densité, structure par âge, part de résidences secondaires, établissements par activité…), decided per theme by what's analytically interesting. Every indicator carries its **rank-in-context** — a direction-aware ordinal « Xᵉ / Y » among its comparison peers (a commune within its EPCI, an EPCI among all Breton EPCIs, a département among the four départements — ADR-0015/0021) — and each theme ends with one signature story that goes deeper than the standard block.

On top of the fiches:

- **A map** of Brittany — communes, EPCIs, départements — as the entry point
- **Search** — find a territory by name
- **Freshness you can see** — every indicator shows its **vintage** (source, version, date), so the product never pretends to be fresher than it is

## How it's built

One person, two moving parts:

```
lusk/
├── README.md       ← you are here
├── pipeline/       → R data pipeline (download → compute → publish)   ✅ built (Démographie + Habitat)
└── app/            → Vue application (map, fiches, charts)            [to be built]
```

- **`pipeline/`** — an R pipeline that downloads the source datasets (INSEE, data.gouv.fr, data.bretagne.bzh, data.ademe.fr), filters to Bretagne, computes the fiche indicators and ranks, records each dataset's vintage (reference **and** publication dates), and publishes the result. Idempotent (re-runs never duplicate; corrupt downloads are re-fetched), with a single documented entry point (`run_pipeline(theme = ...)`) and a testthat suite (1 089 expectations). Démographie and Habitat are built and run end-to-end; Économie/Emploi replicates the skeleton.
- **`app/`** — a Vue application that renders the fiche payload: the map, search, territory pages, charts. The app renders; the pipeline computes.
- **Automation** — the light themes refresh on a schedule (GitHub Actions); the flagship Mobilité analysis rebuilds on a slower clock. A vintage table is the seam that makes the freshness promise honest.

The data is **open**: the bulk under Licence Ouverte, with OSM-derived layers under ODbL (attribution "© OpenStreetMap contributors"). The code is **public**; there are **no accounts**.

## v1 scope

- All of Brittany — ~1 200 communes, their EPCIs, the four départements, and the région
- Four themes, each contributing a block to the fiche: **Mobilité** (the flagship — an existing accessibility analysis, ported), **Démographie**, **Habitat**, **Économie/Emploi**
- A fiche d'identité per territory, the map, search, a methodology page
- Scheduled refresh with visible vintage

## Status

- **v0.5 (now)** — the plan is set, and the **Démographie and Habitat pipelines are built**: both download their sources (INSEE RP for Démographie; RP Logements · DVF · ADEME DPE for Habitat), filter to Bretagne, compute the four indicators with ranks-in-context and their stories ("Attractive ou fertile ?" · "L'état énergétique du parc"), and publish the fiche payload as parquet per theme (1 269 territoires, testthat suite green — 1 089 expectations). The app is not yet built.
- **v1** — Bretagne, four themes, light themes automated, the app (map, fiches, charts)
- **After v1** — an AI query layer, France-wide coverage, finer-grained data

---

*Conçu par Calum Robertson — Docteur en économie urbaine.*
