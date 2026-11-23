# ADR-0049: The resource is the unit of build and publication

- **Status:** accepted — decision 2026-11-23 (owner grilling session). Not yet implemented; the
  migration order is part of the decision (below).
- **Supersedes:** ADR-0044 (indicator-scoped canonical scalar materialization) once migration
  step 4 lands. **Amends:** ADR-0048 decision 5 (the release freeze is scoped to the lineage of
  the resources being published) and decision 4 (checks are attributed by resource lineage).
- **Related:** ADR-0004 (diff-and-skip cron, retired by step 0), ADR-0035/0038 (serving grains and
  common indicator serving contract), ADR-0037 (publish tables independently from R);
  CONTEXT.md « Ressource sémantique de service », « Version de ressource publiée »,
  « Artefact de ressource », « Intermédiaire partagé », « Plan de publication », « Alive »;
  issues #1040, #1048, #1072, #1103.

## Context

Adding one indicator (`stations_service`, then the address-based `offre_tc`) has repeatedly cost
a full five-theme rebuild (~70 min), a 5 h parity audit, and a publication that rewrites every
owner. Two mechanisms were built to escape that — the scoped materialization and closure guard
(ADR-0044) and the one-off `offre_tc` bridge (#1071/#1072), the latter with documented exceptions
to ADR-0044 decisions 4 and 8 — and neither is the normal path. A 2026-11-23 review of the
littoral + `offre_tc` release traced the cost to four couplings:

1. **Serving granularity is inconsistent and partly global.** `scalar_observation` and its
   comparison are one snapshot for every indicator of every theme
   (`project_retained_scalar_snapshot`); declared profiles are one snapshot
   (`table_publication['declared_profile']`); typed readings are per theme; owned series per
   dataset; observed collections per collection. Any scalar change moves the global scalar token,
   which the DPE profile binds (`required_scalar_version`) and the Habitat reading chains from.
2. **The release freeze is global.** `verifier_gel_release` refuses unless every one of the 72
   locked sources was read by the run, so a partial run can never publish.
3. **The build unit is the theme.** One `sources_<theme>` → `brut_<theme>` → `publie_<theme>`
   chain per theme; the theme constructor is hashed as a whole, so a one-line change to one
   indicator invalidates the whole theme (Mobilité: OSM, OCS-GE, GTFS); every theme rewrites the
   shared territory reference, so themes are chained sequentially.
4. **Builds are not kept.** A sortie is overwritten each run; when the generation matching the
   live database was lost, nothing could prove or restore it — hence the bridge.

Every release therefore also carries unrelated drift the owner did not ask for (the 2026-11-21
build: SIRENE 1,244 communes, DPE 1,168, parking 1,224) and must approve it to ship anything.

The data *shapes* (scalar, profile, series, collection, AEDAR) were never the reason for global
versions: shape decides storage; it says nothing about the unit of versioning.

## Decision

### Scope of "cheap"

A new indicator (A), a definition change (B), a value refresh from one source (C) and editorial
wording (D, already app-owned) must be cheap: minutes, touching only the resources concerned.
A territory-reference classification change (E: density classes, littoral code) stays a
deliberate wide release — every comparison is bound to the reference in substance, classes are
not meant to move, and its procedure is made repeatable instead of cheap.

### 1. Unit of version — the resource

The unit is the **Ressource sémantique de service**, whatever its shape. Each resource has its
own facts, descriptor, provenance, comparison and **Version de ressource publiée** (a content
hash). What is live is the set of `(ressource, version)` pairs. Shapes keep their typed tables
and constraints; only the versioning unit changes.

### 2. Dependencies — declared, narrow, cascaded

A resource declares what it depends on at resource granularity (its comparison on the territory
reference; the DPE declared profile on `part_passoires`), never on a global token. Publishing X
republishes, in the same transaction, the closure computed from those declarations. Typed
readings are out of scope (stale; retirement is a separate owner decision).

### 3. Build — sources → shared intermediates → resources

The theme stops being a build unit; it remains an editorial grouping (metadata, app).
One target per source; one target per **Intermédiaire partagé**; one target per resource (or per
small family computed together). The territory reference is a single target read by everyone,
which removes the sequential theme chain.

### 4. Publish from an incremental build

`targets` decides what to recompute; publication comes from the incremental store. The release
freeze checks only the lineage sources of the resources being published. A cold build becomes a
periodic audit (monthly, and before an E release) comparing the `(ressource, version)` list of a
cold build with the incremental one.

### 5. Immutable per-resource artefacts

Each build writes an **Artefact de ressource** at `artifacts/<ressource>/<version>/`, never
overwritten. Publication points a resource at an artefact; rollback republishes the previous
version through the same path. `pg_dump` remains for schema/disaster recovery, not data rollback.
Retention: every published version plus the most recent unpublished build; removal is a manual
owner command. Measured 2026-11-23: all serving outputs of a full build total 5.2 MB (scalars a
few KB per indicator); AEDAR canonical artefacts 45 MB.

### 6. Catalogue from the database

`/api/resources` is derived from the live markers and their published descriptors, not from
theme metadata copied into the API image (`api/deploy/Dockerfile:13`). The API image changes only
when the grammar changes (a new shape or comparison kind).

### 7. Plan / apply

`plan` is read-only: built vs live version per resource, drift, check status, cascade. `apply`
takes an explicit list (or `--all-changed`), adds the cascade, applies the lineage freeze,
refuses on a code regression, requires `--confirm-definition <ressource>` when a descriptor's
meaning (definition, unit, denominator) changes, and writes an append-only receipt. Retirement
is an `apply`. Unrelated drift is never forced into a publication.

### 8. Three seams, enforced structurally

- `declarer_ressource(id, forme, lit, produit, verifie)` / `declarer_intermediaire(...)` — the
  only way to create resource or intermediate targets.
- One adapter per shape (`projeter`, `remplacer`) — the only writers of serving tables. A new
  resource of an existing shape writes no serving code.
- Plan/apply — the only code that opens a serving-database connection.

Each is guarded by a structural test in the style of `helper-provenance-audit.R`. A case that
does not fit changes the seam through review; no parallel one-off path (the bridge is the
counter-example this rule exists to prevent).

### 9. Checks belong to the declaration

`verif_*` real-data checks move into `verifie = ...` on the resource or intermediate declaration.
Drift-vs-regression attribution (ADR-0048 §4) uses that declaration's lineage instead of hand-
listed `args` or "every source of the theme". `plan` shows the status; `apply` blocks only on a
regression.

### 10. One build implementation

`run_pipeline()` and the `targets`-vs-`run_pipeline` parity audit are retired; the cold-vs-
incremental version comparison (decision 4) replaces them.

### 11. « Alive »

Freshness is watched on a schedule (local incremental build + `plan`, weekly); publication stays
deliberate. The GitHub cron, which never worked, is deleted.

## Migration order

0. **Cleanup:** delete the cron workflow, `diff_skip.R` and the cron-mode branches.
1. **Finish the littoral release** (#1040/#1048/#1103) as the last wide release, so a known,
   kept generation matches the live database.
2. **Serving per resource:** per-resource markers, catalogue from the database, plan/apply,
   cascade, lineage freeze, shape adapters. Bootstrap by splitting the littoral release's output
   into per-resource artefacts, proving equality with live, recording the pointers. Works with
   the existing theme builders.
3. **Build per resource**, Mobilité first: single reference target, shared intermediates,
   `declarer_ressource`, checks in declarations. Other themes one at a time.
4. **Retirements:** scoped path and closure guard (ADR-0044), the #1072 bridge, typed readings
   (owner decision), `run_pipeline` and the parity audit, global snapshot code.

Serving precedes build because the blast radius (forced drift, lost baseline, bridge) was the
larger cost, and step 2 delivers it with today's builders.

## Consequences

- Adding or redefining an indicator: declaration + metadata, an incremental build of its lineage,
  `apply <ressource>` — no API rebuild; an app deploy only if it needs a place to appear.
- The serving schema gains per-resource markers for scalars and profiles; their global snapshot
  tables become per-resource replaces. This is a real migration (step 2) with its own rehearsal.
- Global tokens and their chains (`required_scalar_version` against the global scalar version,
  Habitat `linked_content_version`) disappear.
- Correctness of incremental publication depends on producers declaring what they read; an
  undeclared read can publish a stale value until the periodic cold audit catches it. Accepted.
- Old resource versions can be republished but not necessarily rebuilt (source bytes are not
  kept per version, only their digests). Accepted.
- An E release remains wide and is rehearsed against a restored copy of production.

## Rejected alternatives

- **Keep global snapshots and improve the scoped path.** It is the current state: three
  publication mechanisms, exceptions to ADR-0044, forced drift.
- **Producer family as the serving unit.** A family is a build concept; a definition change
  touches one resource.
- **Fail-closed dependents (503 until republished) or pinned old versions** instead of cascade:
  the first makes every publication an outage, the second needs several live versions.
- **Automatic `apply` of value-only changes:** ships unreviewed drift.
- **Making E cheap** (versioning comparisons per classification column): machinery for a change
  that is rare by design.
- **Keep `run_pipeline` as an oracle:** a second build implementation every producer change must
  satisfy.
