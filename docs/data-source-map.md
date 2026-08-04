# Source map — theme → indicator → data source

The working map of what Lusk wants in each theme and where it comes from. Built from the grilling session (2026-08-03) and the primary-source research in `docs/research/`. Status tags: ✅ **decided** · 🔶 **provisional** (working default) · ❓ **open** (needs a decision) · ⏸️ **deferred**.

> **Pipeline-facing contracts:** the per-theme working documents live in **`docs/themes/`** (`README.md` + one file per theme). This file is the source-level companion; the theme files carry the pipeline detail (indicators, computation, testing, open items).

**Fiche shape (✅ confirmed 2026-08-03):** 4 indicator figures + 1 signature visual per theme. Each figure carries value + label + rank-in-context chip + vintage stamp.

---

## Démographie — INSEE (locked, from `docs/architecture.md`)

| Indicator | Source | Access | Vintage |
|---|---|---|---|---|
| Densité (habitants/km²) | INSEE RP — série historique (`SUP`/`POP`) | CSV long national, data.gouv melodi | annual |
| Structure par âge | INSEE RP — âge détaillé (`PRINC`) | same | annual |
| Évolution de la population 1968→ | INSEE RP — série historique (`POP` 1968/2017/2023) | CSV | annual |
| **Taille moyenne des ménages** (4th standard) | INSEE RP — ménages (`DWELLINGS`/`DWELLINGS_POPSIZE`) | same | annual |
| Story: **"Attractive ou fertile ?"** (solde naturel vs migratoire) — **single-story theme: this IS the default** | computed from RP | pipeline | ✅ shape decided 2026-08-03 — universal, mildest when balanced; only candidate (people-as-dots = chart treatment for standard indicators, not a story) |

No creative sources needed — RP is authoritative. ✅ *4th standard indicator decided 2026-08-03: taille moyenne des ménages* (household structure is orthogonal to the population-structure trio; links to Habitat's demand for small dwellings; same RP dossier complet, same vintage — no new source). **Cross-check (research 2026-08-03):** data.bretagne.bzh republishes RP-derived tables per commune/EPCI/pays (`recensement-de-la-population-en-bretagne-*`, refreshed 2026-07-10) — usable as *validation/reconciliation* of the pipeline's own INSEE-derived numbers, never as the primary source (the pipeline stays on raw INSEE).

## Habitat — INSEE + DVF + BDNB + environmental cross-cutting (DPE, land-use)

| Indicator | Source | Access | Status |
|---|---|---|---|
| Nb logements · résid. principales/secondaires · vacants | INSEE RP Logements (dossier complet) | CSV ~98 MB, data.gouv | ✅ built 2026-08-03 (#14) |
| Statut d'occupation, ancienneté, taille des logements | same | same | ✅ built 2026-08-03 (#14) |
| **Médiane prix/m² (par type maison/appartement)** | **DVF géolocalisées** (Etalab) | per-département CSV ~1.4–1.8 MB/an → `files.data.gouv.fr/geo-dvf/latest/csv/{year}/departements/{22,29,35,56}.csv.gz` | ✅ decided (user) |
| Volume de transactions | DVF (count distinct `id_mutation`) | same | 🔶 recommended |
| Prix du terrain à bâtir (€/m²) | DVF (`surface_terrain` + nature_culture) | same | 🔶 recommended |
| Nb de bâtiments, emprise bâtie | **BDNB** (CSTB) | per-département GeoPackage ~700–950 MB → bdnb.io | 🔶 recommended |
| Âge moyen du bâti (année de construction) | BDNB `annee_construction` | same | 🔶 recommended (expect missingness) |
| Part résidentiel vs non-résidentiel | BDNB `usage_principal_bdnb_open` | same | 🔶 recommended |
| Logements vacants (bâtiment-level) | BDNB `nb_log_vac_*` | same | 🔶 (cross-check with RP) |
| **Performance énergétique / DPE** (cross-cutting env.) | **ADEME Observatoire DPE** (`dpe03existant`, ~15.3 M DPEs; Bretagne ≈ 664 k) — preferred; or BDNB `batiment_groupe_dpe_representatif_logement` (`classe_bilan_dpe`, `classe_emission_ges` — open) | REST API `data.ademe.fr/data-fair/.../lines?qs=code_departement_ban:22` | ✅ **built 2026-08-03 (#16/#17)** — figure = part de passoires thermiques (F/G); visual = A–G distribution chart with F/G highlighted |
| Isolation du parc (qualité) | ADEME DPE `qualite_isolation_*`, `isolation_toiture`, `ubat_w_par_m2_k` | same | 🔶 recommended — data-layer reservoir (broad/narrow); no longer feeds the story (the story classifies the DPE distribution, not an insulation combination) |
| Part passoires thermiques (F/G) | ADEME DPE `etiquette_dpe` | same | ✅ decided (the standard figure, see above) |
| **Occupation du sol / artificialisation** (cross-cutting env.) | **IGN OCS GE v2.0 (NG)** — official ZAN referential | Géoplateforme API per-département GeoPackage (~1.5 Go/dép) + ready-made `OCSGE-ARTIFICIALISATION` DIFF flux | ⏸️ **deferred** (2026-08-03: heaviest compute, lumpy at small-commune scale, reads poorly as a single fiche figure — see reservoir) |
| Friches/ruines ("gisement oublié") — ZAN story | **BD TOPO** `Etat='En ruine'` — *NOT BDNB* (BDNB excludes ruines) | BD TOPO data.gouv | ❓ open — **user unsure about this story** |
| **Story pool** (1 default + 1 salience-fired): **default = "L'état énergétique du parc"** — DPE distribution classified into four readings (Parc performant / Parc intermédiaire / Passoire énergétique / Parc hétérogène; deterministic concentration rule, NA when n < 30) — ✅ **built** (#18); **salience-fired = "Pression résidentielle"** — ⏸️ **deferred (#21)** (2×2: pression haute/basse × source touristique/résidentielle; RS share = source signal; pression indicator NOT yet settled) | computed (DPE) | pipeline | ✅ built 2026-08-03 (default); salience-fired deferred |
| ~~Story: "Le littoral qui dort" (rés. secondaires × distance côte)~~ | ~~RP + coastline geometry~~ | ~~computed~~ | ❌ **superseded** — "littoral qui dort" survives only as the *name* of the haute-pression/RSource quadrant, never as a coastline axis (no geometry dependency) |

**Environmental note (user decision 2026-08-03):** environmental issues (energy performance, land-use/artificialisation) are **holistic — taken into account across themes**, not a separate "Environnement" theme. For now they live in Habitat (DPE, OCS GE). They may later inform Démographie (land-use pressure) too. A standalone theme is *possible* but feels "oldschool" — default is cross-cutting.

**Corrections from research:** the "BNDB" premise was actually **BDNB (CSTB)** — see `docs/research/bndb.md` §0. DPE data lives in **ADEME Observatoire DPE** (open, Licence Ouverte) and also in **BDNB Open** — including `batiment_groupe_dpe_representatif_logement` with open `classe_bilan_dpe` / `classe_emission_ges` (user-verified); the ayants-droit restriction applies to fichiers-fonciers-derived and expert tables only. ADEME DPE remains the preferred source (freshest, most complete per-dwelling detail). OSM is **not** a Habitat source (user decision — parked in Mobilité).

**Vintages (research 2026-08-03):** OCS GE NG per-département — 22→2018/2021/2025 · 29→2018/2021/2024 · 35→2017/2020/2023 · 56→2019/2022/2024 (M3 landing; freshest window = M2→M3). ADEME DPE updates weekly/monthly (~1-week vintage at research time).

**Key caveats:** OCS GE — never compare v1 vs NG vintages; check `patch correctif` layers (22/29/56 M2 have known anomalies); MMU 2500 m² outside zone construite (bâti detected to 50 m²) → small-commune flux is lumpy. DPE — base covers only sale/rental/new-build (<15% of buildings), owner-occupied rural stock is under-represented → publish n per commune, suppress small n; dedupe per dwelling (most recent `date_etablissement_dpe`); control for 2024 (40 m²) and 2026 (electricity factor 2.3→1.9) label breaks.

## Mobilité — BPE + existing analysis + OSM

| Indicator | Source | Access | Status |
|---|---|---|---|
| Accessibilité t/b/c (gaps, vulnérabilité) | existing analysis (ported) | in hand | ✅ locked (docs) |
| Équipements (BPE 229 types) | INSEE BPE | data.gouv / insee.fr | ✅ locked (docs) |
| **Voitures par ménage** (part des ménages sans voiture / 2+) — the demand side | INSEE RP (dossier complet — table code to pin in research) | same | ✅ decided 2026-08-03 — pairs with slot 1: "ce qu'on peut atteindre sans voiture" + "combien de voitures on possède" |
| **Réseaux routiers/cyclables/pédestres** (longueur, densité) | **OSM** (`highway=*`) | Geofabrik `bretagne-latest.osm.pbf` ~311 MB, daily → `osmextract::oe_get("Bretagne")` | ✅ decided 2026-08-03 — ODbL (ADR-0001) |
| **Offre TC — transit supply** (arrêts, réseau) — feeds the accessibility deep-dive (transit side) and/or a stop-density indicator | **Korrigo GTFS/NETEX** (24 réseaux: BreizhGo TER/Car/maritime + tous les réseaux urbains) + **`mobibreizh-stops`** (24 380 arrêts, refreshed 2026-08-02) | data.bretagne.bzh ODS API — GTFS files + stops with coordinates | 🔶 recommended 2026-08-03 (research) — **ODbL**, same attribution discipline as OSM (ADR-0001) |
| Bornes de recharge VE (IRVE) | `bornes-recharges` (9 424, refreshed 2026-07-28, commune + EPCI codes) | data.bretagne.bzh | 🔶 recommended 2026-08-03 (research) — candidate indicator "bornes/commune"; Licence Ouverte |
| Points d'intérêt / tourisme micro-géo | OSM (`tourism=*`, `shop=*`) | same | ❌ dropped — BPE redundancy (research verdict) |
| Story: **single-story theme — the flagship accessibility deep-dive is the default** | existing | — | ✅ shape decided 2026-08-03 — "for now"; may grow multi-story when a reservoir idea matures |

**⚠ Licence (user decision 2026-08-03):** OSM is **ODbL** — it cannot be relicensed under Licence Ouverte. The project accepts this: the product will simply be *less than 100% open* (OSM-derived layers stay ODbL with attribution "© OpenStreetMap contributors"; everything else stays Licence Ouverte). Full openness is not a hard requirement — OSM is a gold mine for Mobilité. See `docs/adr/0001-osm-odbl-accepted.md`.

## Économie/Emploi — INSEE SIDE/REE + RP + analytical depth (the economist's theme)

**Source-table phase (✅ built 2026-08-04):** three source fragments — SIRENE snapshot (monthly stock 2026-08, ZIP ~2,7 Go, « manuel »), Flores A38/A88 (2024, « cron »), RP Emploi resident ACT4/ACT5 (2023, « cron ») — each normalized to **its own** commune-first long sparse table (`sirene_snapshot`, `flores_a38`, `flores_a88`, `rp_emploi`) under `pipeline/data/processed/economie/`, profiled by `profil_economie.R`, and locked by a mocked end-to-end run test (`test-run-economie-contracts.R` : four tables + profiling evidence, no fiche artifact, re-runs never duplicate). **No common date alignment, no NAF ↔ A38/A88 crosswalk, no fiche facts** in this phase. The indicator rows below (SIDE/REE, chômage, green score, LQ, relatedness, dormitory story) are the **post-profiling analytical phase** — they build on these tables, they are not part of the source-table phase.

| Indicator | Source | Access | Status |
|---|---|---|---|
| ~~Établissements par activité (A10)~~ | ~~INSEE SIDE/REE stocks~~ | ~~CSV ~35 MB~~ | ❌ **dropped 2026-08-03** — A10 *is* LQ's input; as a standard figure it duplicates the LQ story, adds only absolute size (already carried by emploi/créations) |
| Créations d'établissements | INSEE SIDE/REE | CSV ~50 MB | ✅ locked (docs) |
| Emploi au lieu de résidence (source-table phase) | INSEE RP — dossier complet, tables ACT4/ACT5 `DS_RP_TD_ACTIVITE_PCSACTIVITY_COMP` (« Emploi au lieu de résidence », PCS × activité économique) | CSV ~79 MB | ✅ **built 2026-08-04** — table `rp_emploi` ; the workplace file (`DS_RP_EMPLOI_LT_PRINC`, ~16,8 MB) is a **separate source, unused in this phase** |
| Chômage (population active) | INSEE RP | same | ✅ locked (docs) |
| **Part des établissements dans les éco-activités** (green score — replaces A10) | computed: SDES "périmètre des activités de l'économie verte" (2020, NAF-based) × SIRENE commune establishment counts (same M matrix as relatedness) | pipeline | ✅ decided 2026-08-03 — *research item: pin the exact SDES NAF code list to SIRENE* |
| **Location quotient (LQ)** — "what knowledge lies here" | computed from SIRENE/SIDE-REE vs moyenne bretonne | pipeline | ✅ **the theme's signature story — default** |
| **Relatedness density + "jumeaux économiques"** — "what other places does it connect to" | SIRENE NAF 5-digit co-location network; density + commune×commune producer space (top-5 twin communes) | pipeline — method settled by research (see `docs/research/relatedness.md`) | ✅ **v1 (promoted 2026-08-03)** — the Économie 2nd story; heaviest computation in the product → rides the slow clock, not the light weekly refresh; *deeper* layers stay deferred (see `docs/scope.md`) |
| Story: "Le matin, la commune se vide" | RP emploi lieu de travail vs résidence | computed | 🔶 salience-fired story candidate (fires when jobs/homes balance is extreme) |
| Prix des locaux commerciaux? | DVF (type_local 4 = local industriel/commercial) | DVF per-dép | ❓ optional creative |

**User direction (2026-08-03):** Économie should go deeper than direct data — **specialisation** (LQ) and **relatedness** ("what synergies with other places") are analytical, not downloaded. That is the theme's point. LQ is the story; the standard block carries the green score as its 4th dimension (dynamique · taille · santé · verdure).

**RA2020 (deferred agriculture story — research 2026-08-03):** the source for the reservoir story "l'agriculture qui nourrit la baie" is `recensement-agricole-2020-par-commune-en-bretagne` (data.bretagne.bzh, 1 242 communes, Licence Ouverte) — **caveat: the description advertises UGB/PBS but the exposed schema only carries `nb_expl`/`otex`/`sau`/`etp`/`surface`/`sau_tx_evol_2010_2020` — verify at download before designing the nitrogen-load indicator.**

---

## Cross-cutting

- **Territory geometry (the missing seam — research 2026-08-03):** the `territoires` reference table and the app map need current commune/EPCI/département polygons, and the pipeline previously had no explicit source for them. **Solution found: consume them live via GéoBretagne WFS** — `geor_loc:COMMUNE/EPCI/DEPARTEMENT` (IGN AdminExpress mirror, EPSG:2154, Licence Ouverte, national coverage → filter to 22/29/35/56): `https://geobretagne.fr/geoserver/wfs?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=geor_loc:COMMUNE&OUTPUTFORMAT=application/json`. Backstop: IGN AdminExpress direct from the Géoplateforme (data.geopf.fr). Also WFS-published and useful as reference/context layers: `ign:bdtopo_commune`, `opendata:ban_communes`, `insee:zone_emploi_bretagne`, `dreal_b:l_aires_attraction_villes_communes`. **Commune-merger integrity:** `communes-nouvelles-en-bretagne-suivi-des-evolutions-depuis-le-01012016` (data.bretagne.bzh, 1 278 rec) maps old→new INSEE codes + fusion dates — the pipeline must apply it before joining historical indicators (vintages, time series).
- **Programmes & financements** (✅ new cross-theme fiche element, decided 2026-08-03): a badge/strip below the theme tabs showing the state/regional programs the territory is covered by + link to its Région subventions. **Sources (all Licence Ouverte):** ANCT *Croisement des dispositifs de politique publique* (16 programs per commune: Territoires d'industrie, PVD, ACV, CRTE, Avenir montagnes, Quartiers prioritaires, Cité éducative, Cité de l'emploi, France services, Villages d'avenir, etc. — data.gouv.fr); Région Bretagne *subventions attribuées depuis 2014* (data.bretagne.bzh, SCDL, per-commune geolocated); *fonds européens* (data.bretagne.bzh — **prefer `feder-fse_beneficiaires`: carries `code_insee`; `fondseuropeens_com` has only code_postal + point_geo** — research 2026-08-03). **Honesty rule:** displays *membership + grants attributed*, never outcomes ("lauréate ACV" ≠ "centre-ville revitalisé") — Méthodes obligation. Not a theme block; does not touch the 4-indicator-per-theme contract.
- **Vintage:** every source records `source / version / date_reference / date_publication`; BDNB ships source vintages inside (geometry BD TOPO 2025-12, FF 2025) — the freshness display must surface *that* vintage, not just the package date. `date_reference` is the data's reference date ("RP 2023"); `date_publication` is the real release date on data.gouv — the watchdog compares against the publication date. **Watchdog seam (research 2026-08-03):** data.bretagne.bzh is an **Opendatasoft** portal → standard ODS v2.1 REST API (`/api/explore/v2.1/catalog/datasets`), trivially pollable for its 192 datasets (mostly weekly/monthly refresh). GéoBretagne's CSW GetRecords is **gated** (403 — partner login needed for bulk harvest); GetRecordById works — plan a partner login or per-record fetches if the metadata layer matters.
- **Licences:** INSEE/Etalab/DVF/BDNB/OCS GE/ADEME = Licence Ouverte 2.0; OSM = ODbL — **accepted, product is intentionally less than 100% open** (user decision). data.bretagne.bzh is **fully open** (~176/192 Licence Ouverte variants, ~13 ODbL mostly GTFS, 1 CC BY-SA) — the ODbL items (Korrigo GTFS, BreizhGo, urban GTFS) need the same attribution as OSM. **GéoBretagne licence traps:** BD TOPO, SCAN, ortho, cadastre are view-only under IGN/DGFiP licences — never bake them into the redistributable payload; consume OCS GE vectors from IGN Géoplateforme (Licence Ouverte 2.0), not from GéoBretagne (WMS-only there). DVF adds CGU constraints (no re-identification, no search-engine indexing of identifying data).
- **Rank-in-context** computed in the pipeline per `docs/architecture.md` §Pipeline.
- **Environmental concerns** are cross-cutting (user decision): DPE + OCS GE live in Habitat for now; land-use pressure may later inform Démographie. No separate Environnement theme. Économie now carries the green score (éco-activités share).
- **Story model** (✅ decided 2026-08-03): every theme has a pool of 1–3 candidate Stories; exactly one shows per fiche; one is the always-on default (most universal computation, naturally the mildest); the others replace it only when their salience fires. Deterministic, documented in Méthodes, tested with the fixture pipeline. See `CONTEXT.md` → Story.
- **Open/needs-decision queue:** Démographie 4th indicator — ✅ *decided 2026-08-03 (taille moyenne des ménages)*; Habitat **story pool** — ✅ *shape decided 2026-08-03 (default: état énergétique; salience-fired: pression résidentielle 2×2; names provisional; pression indicator not yet settled — €/m² rank questioned, proper design later)*; whether DVF "volume de transactions" and "prix terrain" indicators are in v1 or deferred — ❓ still open; Démographie/Mobilité/Économie story pools — ✅ *all decided 2026-08-03 (see each theme section)*. *(Relatedness method: settled; base promoted to v1 2026-08-03 — deeper layers deferred, see Économie row.)*

*Sources consulted 2026-08-03: `docs/research/dvf.md`, `docs/research/openstreetmap.md`, `docs/research/bndb.md`, `docs/research/ocs-ge.md`, `docs/research/ademe-dpe.md`, `docs/research/relatedness.md`, `docs/research/geobretagne-kartenn.md`, `docs/research/data-bretagne-bzh.md`, `docs/research/bretagne-ecosystem.md`, `docs/architecture.md`, `docs/scope.md`, `docs/principles.md`, `CONTEXT.md`.*
