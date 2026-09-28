# ADR-0035: Serving grains for indicator facts and scoped comparisons

- **Status:** accepted — serving-model direction, 2026-09-28. The active indicator inventory and per-shape contracts remain to be completed under #587.
- **Parent:** ADR-0033 (canonical R/Parquet → validated Postgres projection → bounded read-only API)
- **Owner of catalogue decisions:** product owner. This ADR decides neither which current indicators survive nor how they are displayed.
- **Building comparison decision:** ADR-0036 supersedes ADR-0034. Custom groups
  use per-commune points and denominators
  to compute eleven building-weighted **mean** positions per mode. Both figures
  supply the metric type `mean` to the app's existing label grammar. The
  proposed general-purpose indicator grains remain undecided.

## Decision already agreed

**Comparison reads are scoped.** A rank, peer median, and group size mean nothing
without an indicator's declared comparison facet, direction, level, and resolved
territory peer set. The browser requests a bounded, declared comparison; it
does not send SQL, select arbitrary columns, invent peers, or reinterpret a
Parquet `rang_*` column as an unqualified global rank. Region facts can exist
without the region being an eligible comparison level. This is a read-interface
rule, not a choice of physical index or a commitment to keep every current
comparison control.

## Accepted shared physical model

The canonical Parquet exports use a shared `key`/`detail`/`value` row format,
but their facts have different grains. Use shared territory, descriptor,
source-vintage, and publication infrastructure. Store ordinary scalar, detail,
and series observations in a small set of **shared, constrained fact shapes**
across themes; add a dedicated projection when a fact needs materially different
axes, a complete matrix, or a non-numeric relationship. Validate each declared
grain and its semantic constraints at publication.

The API presents named, bounded semantic reads over these shapes, not a
general-purpose `SELECT` interface or a chart-specific payload table. There is
no default table-per-indicator design and no unconstrained optional-column EAV
table. The exact shape assignment for each active indicator or product fact is
part of the consumer inventory and per-shape contracts under #587; this ADR does
not commit every current Parquet key to the product catalogue.

R and canonical Parquet remain authoritative for source-derived values,
indicator eligibility, descriptors, aggregation, suppressions, and provenance.
Postgres is a validated serving projection. For a bounded requested comparison,
the API may calculate query-specific median, direction-aware rank, and
comparable count from published facts in one committed snapshot. It does not
reimplement source transformations or derive new indicator values in SQL.

| Candidate grain | Examples in canonical inputs | Candidate uniqueness within one publication | Important validation |
| --- | --- | --- | --- |
| Scalar observation | `densite`, `chomage`, `part_passoires`, `iso_sante`, `nb_buildings` | territory type + territory ID + indicator key | One declared value or an explicit unavailable value; unit, direction, support count, provenance from declared sources; a support count is not automatically a ranked indicator. |
| Declared detail/profile observation | `structure_age` (detail × sex), `mix_logements`, `reseaux`, `distribution_dpe`, `offre_cyclable` | territory + indicator + declared detail + declared secondary dimension, if any | Order and allowed dimensions from published descriptor; complete versus sparse profiles declared per indicator; per-detail unit, denominator and comparison facet; do not sum lengths/rates as composition shares. |
| Ordered series/state observation | annual `conso_enaf_annuel`, year and pooled `prix_m2`, `artif_par_habitant` endpoints, `raccordement_courbe` | territory + indicator + declared axis identity (year, duration threshold, or state role) | Axis kind and order explicit; observed year separate from vintage/version; null points preserved; pooled DVF headline separate from annual points; state endpoints may cover multiple departmental source windows. |
| Named reference series | `raccordement_reference` | declared reference identity + axis point | Not a region's measured `raccordement_courbe`, not ranked as a territory. |
| Structured evidence / relation | access bivariate bins, access ramp quantiles, BPE equipment cases, top activities, grant areas, programme memberships, two-axis relation if retained | shape-specific coordinates and territory/publication IDs | Denominators, completeness, source lineage and absence rules are family-specific; no fabricated missing rows or truncated complete sets. |

The shared physical tables above are **shape decisions**, not mandated table
names. For example, a constrained detail-observation table can hold both a list
and a composition, provided its descriptor and publisher enforce their distinct
semantics. Dedicated tables remain appropriate for fact families whose grain
cannot be represented honestly by those shared shapes. The access and building
tables shipped by #581/#588 prove the publication and read seams; their physical
layouts are not grandfathered into the general catalogue. Prefer one coherent
schema across indicator families where the actual grains permit it. Reuse,
adapt or replace those pilot tables after the active consumer inventory and
representative shape review, preserving their existing reader contracts during
an incremental migration (#589, #590).

## Publication and provenance constraints

1. A territory identity/reference projection has one clear publication owner.
   R publishes the shared reference and each serving fact table independently
   from this machine; unchanged tables are not replaced. Changed tables with
   dependencies can commit together in one database transaction, without
   sharing a permanent global version. A changed reference must remain
   compatible with independently versioned facts or fail closed.
2. Each published table is validated for its declared grain, allowed keys,
   detail universes, duplicate observations, missingness, provenance, and
   parity with canonical Parquet before its active snapshot changes. An
   unchanged table version does not re-publish; a database version behind an
   unchanged local Parquet version is retried. Failed validation or SQL keeps
   the previous complete database table. Reads use one committed snapshot
   and carry the relevant table versions (or a token derived from them), never
   misrepresent independently versioned tables as one stored release.
3. Observation period, source version, source reference date, source
   publication date and database publication time are different concepts.
   Provenance may vary by observation (OCS-GE endpoints, programmes) and may
   have multiple source components; it cannot always be one vintage per theme
   or indicator. Source dataset identity and its vintage children remain
   distinct, consistent with ADR-0022.
4. `NULL` is not zero. A suppressed DVF/DPE value may carry a support count;
   an absent grant-domain row means no source record, not a declared €0; an
   absent membership is not a `false` row. The publisher must declare whether
   a profile is dense and complete (age, DPE signature) or sparse (grants,
   activities), and the reader must not silently complete it with invented
   measurements.
5. Descriptor fields such as eligible levels, direction, comparison facet,
   unit and detail order come from pipeline-owned metadata and must be
   validated against the published observations. The presence of a Région
   row in Parquet does not automatically authorize a Région indicator page.

## Read-interface sketches (NOT endpoint commitments)

- `readTerritoryFacts(territory, declared subject)` returns a complete,
  bounded subject with fact provenance and publication identity, shaped for
  `TerritoryFacts` rather than for a database table or a Vue renderer.
- `readIndicatorComparison(indicator, declared facet, territory, scope)`
  returns the bounded peer population or a bounded result derived from it,
  focal value, median, direction-aware tie rank and comparable count, and the
  actual named scope. A composition's canonical facet can be a different
  indicator (`distribution_dpe` → `part_passoires`), or a declared detail
  (`voitures_menage` → `sans_voiture`). R-owned values and eligibility stay
  authoritative; the API calculates only the requested comparison from its
  published facts in one committed snapshot. It does not derive source
  indicators. Unavailable facets cannot yield a rank.
- `readDeclaredProfileOrSeries(territory, subject)` returns its **whole
  declared** ordered shape and missing points, not an arbitrary column slice.
  A sparse collection explicitly says it is sparse. The two-axis relation
  case needs its own declared roles and facet if that product reading survives.

Before committing to general-purpose physical DDL, exercise these sketches
against a scalar, a complete multidimensional profile, an incomplete series,
a multi-vintage state and a sparse categorical collection. This does not impose
a benchmark gate on the approved, narrow building-access slice.

## Variant E building-access slice (ADR-0036, shipped in #588)

The approved slice is restricted to canonical **per-commune** ramp and distribution
facts. R and Parquet remain authoritative. Three modes have eleven ramp positions
per complete commune; the walk/transit distribution has thirty cells, and both
shapes carry explicit absent sentinels. A user explicitly selects whole territories;
the API resolves them to distinct communes from the published reference without
adding or removing the focal territory. A missing member is an error; an explicit
absent commune contributes no buildings.

For a selected group with at least two available communes, each peer ramp point
is the **building-count-weighted mean of the corresponding commune deciles**.
This is not a quantile of pooled buildings: for example, Allineuc's EPCI
walking/transit midpoint weighted mean is about 12.22, whereas its old
pooled-building midpoint was 7. The grid *does* pool building cell counts and
recomputes shares from the pooled denominator. Both figures carry metric type
`mean` to the app's comparison-label grammar. Neither a fixed-scope registry
nor precomputed fixed-scope peer ramps is required. ADR-0036 supersedes
ADR-0034's fixed-scope prescription; old JSON comparisons are not API inputs.

The shipped narrow slice uses the existing shared territory reference and
publication machinery, adding `building_ramp` and `building_grid` fact grains.
R writes canonical Parquet locally and publishes validated projections from this
machine to Postgres; the Pi does not need the Parquet. Each physical serving
table has its own content version. Only changed tables are replaced, while
related changes may commit atomically. Unknown foreign-key dependents fail
closed. A read pins the table versions, identity and selected commune facts in
one repeatable-read transaction. The browser gets no database credentials.
Migrations `002_building_access.sql` and `003_building_access_all_levels.sql`
support the deployed slice. It did not require a disposable-Postgres performance
gate; its focused checks and observed live read do not establish capacity for
the general indicator catalogue. #587 applies a representative real-Pi
performance target to each broader migration slice.

## Evidence and remaining per-indicator decisions

The six read-only theme inventories examined canonical Parquet plus pipeline
metadata: Mobilité **43 keys / 78,627 rows**, Démographie **4 / 21,556**,
Habitat **7 / 36,772**, Économie **3 / 3,804**, Milieux **2 / 20,256**, plus
two Programmes indicator pages backed by **2,444** grant and **253** membership
rows. The 43+4+7+3+2 count denotes Parquet keys, **not** approved future pages.

The serving direction is accepted; the following work remains for the active
catalogue under #587:

1. Inventory actual consumers and decide which facts migrate, retire, or remain
   temporarily for a named consumer. The current Parquet key counts are evidence
   about shape diversity, not a promise to preserve every key or indicator.
2. Assign each retained fact to a shared declared grain or a justified
   shape-specific serving table. Adding a shape requires a declared contract, an
   explicit fresh-install schema update and an additive migration, not automatic
   DDL from an arbitrary R frame.
3. Resolve observed metadata-vintage discrepancies (e.g. DPE descriptor versus
   Parquet version) as a separate publication-validation matter; do not settle
   them through a database default or a frontend literal.

**Migration contract:** Existing fixed-scope `rang_*` outputs are migration
parity references only; they are not the input to new scoped API comparisons.
Each static consumer is removed only after its API result is proven equivalent
for the supported scope. Before deleting an upstream rank output, audit whether
any named non-browser R/Parquet consumer still needs it.

**Remaining design work:** The active consumer inventory must classify each
field as migrate, retire, or retain temporarily for a named consumer (including
the explicitly in-scope Variant E prototype). It must then assign each retained
fact to a declared grain, define its completeness and provenance contract, and
exercise the read sketches against a scalar, complete multidimensional profile,
incomplete series, multi-vintage state, and sparse categorical collection.
Observed metadata-vintage discrepancies (e.g. DPE descriptor versus Parquet
version) remain a separate publication-validation matter; do not settle them
through a database default or frontend literal. These details do not reopen the
accepted shared-grain or R/API ownership decisions above.
