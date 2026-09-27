# ADR-0035 (proposed): Serving grains for indicator facts and scoped comparisons

- **Status:** proposed — **not approved for implementation**
- **Parent:** ADR-0033 (canonical R/Parquet → validated Postgres projection → bounded read-only API)
- **Owner of final decision:** product owner. This draft decides neither which current indicators survive nor how they are displayed.
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

## Working hypothesis for review — NOT YET DECIDED

The canonical Parquet exports use a shared `key`/`detail`/`value` row format,
but their facts have different grains. Use shared territory, descriptor,
source-vintage, and publication infrastructure; store ordinary observations
in a few constrained shapes; add a dedicated projection when a fact needs
meaningful extra axes, a complete matrix, or a non-numeric relationship. The
API presents named, bounded reads over these shapes, not a general-purpose
`SELECT` interface or a chart-specific payload table. R remains the owner of
computed values, aggregation, suppressions, and source provenance.

| Candidate grain | Examples in canonical inputs | Candidate uniqueness within one publication | Important validation |
| --- | --- | --- | --- |
| Scalar observation | `densite`, `chomage`, `part_passoires`, `iso_sante`, `nb_buildings` | territory type + territory ID + indicator key | One declared value or an explicit unavailable value; unit, direction, support count, provenance from declared sources; a support count is not automatically a ranked indicator. |
| Declared detail/profile observation | `structure_age` (detail × sex), `mix_logements`, `reseaux`, `distribution_dpe`, `offre_cyclable` | territory + indicator + declared detail + declared secondary dimension, if any | Order and allowed dimensions from published descriptor; complete versus sparse profiles declared per indicator; per-detail unit, denominator and comparison facet; do not sum lengths/rates as composition shares. |
| Ordered series/state observation | annual `conso_enaf_annuel`, year and pooled `prix_m2`, `artif_par_habitant` endpoints, `raccordement_courbe` | territory + indicator + declared axis identity (year, duration threshold, or state role) | Axis kind and order explicit; observed year separate from vintage/version; null points preserved; pooled DVF headline separate from annual points; state endpoints may cover multiple departmental source windows. |
| Named reference series | `raccordement_reference` | declared reference identity + axis point | Not a region's measured `raccordement_courbe`, not ranked as a territory. |
| Structured evidence / relation | access bivariate bins, access ramp quantiles, BPE equipment cases, top activities, grant areas, programme memberships, two-axis relation if retained | shape-specific coordinates and territory/publication IDs | Denominators, completeness, source lineage and absence rules are family-specific; no fabricated missing rows or truncated complete sets. |

The shared physical tables above are **candidates**, not mandated table names.
For example, a constrained detail-observation table can hold both a list and
a composition, provided its descriptor and publisher enforce their distinct
semantics. A universal optional-column EAV table *without* those constraints
does not satisfy this proposal. Separate physical tables for every indicator
would duplicate validation and publication machinery before their product
future is known.

## Publication and provenance constraints

1. A territory identity/reference projection has one clear publication owner.
   The access + building slice now refreshes its shared reference and fact
   grains together under one committed publication. Independently owned
   foreign-key dependents block refresh until a compatible ownership contract
   exists.
2. Each published dataset is validated for its declared grain, allowed keys,
   detail universes, duplicate observations, missingness, provenance, and
   parity with canonical Parquet before its active snapshot changes. An
   unchanged fingerprint does not re-publish; failed validation or SQL keeps
   the prior complete publication. A read uses one committed snapshot and
   returns the publication ID. If a future response composes independently
   published datasets, either require a compatible release group or expose
   their separate publication IDs; never imply cross-dataset atomicity that
   does not exist.
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
  published facts. Unavailable facets cannot yield a rank.
- `readDeclaredProfileOrSeries(territory, subject)` returns its **whole
  declared** ordered shape and missing points, not an arbitrary column slice.
  A sparse collection explicitly says it is sparse. The two-axis relation
  case needs its own declared roles and facet if that product reading survives.

Before committing to general-purpose physical DDL, exercise these sketches
against a scalar, a complete multidimensional profile, an incomplete series,
a multi-vintage state and a sparse categorical collection. This does not impose
a benchmark gate on the approved, narrow building-access slice.

## Variant E building-access slice (ADR-0036)

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

The proposed narrow implementation uses the existing shared territory reference
and publication machinery, adding only `building_ramp` and `building_grid` fact
grains. The access and building artifacts are validated before one transactional
refresh; both committed markers have the same publication ID. Reference rows
are upserted rather than deleted wholesale, and unknown foreign-key dependents
fail closed. A read pins the publication, identity and selected commune facts
in one repeatable-read transaction. The browser gets no database credentials.
`api/migrations/002_building_access.sql` is a candidate migration, **not** an
authorization to run it in production or change the Pi. The disposable-Postgres
performance gate was declined; fixture and Parquet checks do not claim physical
SQL performance or migration verification.

## Evidence and open owner decisions

The six read-only theme inventories examined canonical Parquet plus pipeline
metadata: Mobilité **43 keys / 78,627 rows**, Démographie **4 / 21,556**,
Habitat **7 / 36,772**, Économie **3 / 3,804**, Milieux **2 / 20,256**, plus
two Programmes indicator pages backed by **2,444** grant and **253** membership
rows. The 43+4+7+3+2 count denotes Parquet keys, **not** approved future pages.

For the still-proposed general indicator catalogue, discuss with the owner:

1. Should eventual scalar/detail/series storage be shared across themes,
   with shape-specific publisher validation, or physically separated by theme?
   The building-access slice does not decide this.
2. Beyond the joint access + building publication, which future datasets need
   shared release IDs and which can honestly expose separate publication IDs?
3. Which fixed `rang_*` outputs remain compatibility evidence versus served
   comparisons? In particular, profiles' repeated ranks are not evidence
   that every category was independently ranked.
4. Resolve observed metadata-vintage discrepancies (e.g. DPE descriptor versus
   Parquet version) as a separate publication validation matter; do not settle
   them through a database default or a frontend literal.

**Gate:** This ADR remains proposed for the general indicator catalogue. Its
open storage choices do not block the approved narrow building-access slice;
production migration and Pi changes still require separate authorization.
