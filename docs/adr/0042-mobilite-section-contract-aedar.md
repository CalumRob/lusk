# ADR-0042: The Mobilité fiche adopts the AEDAR section contract

- **Status:** accepted — product owner through PRD #952, 2026-11-11; page 2 implemented by #954, page 3 by #955.
- **Supersedes:** ADR-0026 for the Mobilité theme only, and the
  « Figure « Réseaux » de la Variante E » CONTEXT entry (2026-11-10).
- **Related:** ADR-0039 / ADR-0041 (published and request-scoped comparison
  aggregates), ADR-0032 (unique cycling geometry).

## Context

The Mobilité tab (`/territoire/:type/:id?theme=mobilite`) mounts
`ProductionMobiliteAedar` → `VarianteCahierLibre` from
`resolveMobiliteThemeContent()`. Page 1 is the accepted AEDAR surface. Pages 2
to 4 previously carried a *Marelle* (tension title) plus page-level prose
repeating numbers already shown by the figures. « La motorisation » was a
separate unit, « Une piste ne suffit pas » duplicated the cycling distinction,
and the Réseaux plate carried a border legend, north arrow, shared scale, road
footprint sub-figure, internal exploration link and its own bar chart.

PRD #952 aligns pages 2 and 3 with the AEDAR section anatomy, merges then
retires the motorisation unit, removes the redundant cycling-offer section, and
gives every figure a served comparison. Section 13 adds the API prerequisite
(#960): a fixed declared profile now serves one comparison per declared detail,
so the three network categories can each read their own reference without a
browser-side peer computation. #953 publishes the refuelling densities.

## Decision

1. **Section anatomy (C1).** A Mobilité section carries a label and an
   availability, a prose column, one or more source stamps rendered by
   `CahierEvidenceSource`, figures with a caption and complete accessible names,
   and the existing section-footer exploration target. It carries **no
   `lecture`** and therefore no Marelle. `VarianteCahierLibre` keeps its honest
   `absent` / `incomplete` states.
2. **Narrow delegate (C8).** New sections render through
   `CahierMobiliteSection` with exactly `{ section, unit, comparison }`. No AEDAR
   prop, mode/horizon state or pagination is forwarded. The delegate reads the
   already-injected `CONTROLE_COMPARAISON_KEY` only to turn an explicitly empty
   selection into an honest inactive state; it reads nothing else from the
   AEDAR context.
3. **Page 2 subtitle (C2).** One paragraph replaces both the old introduction
   and the rundown. It composes the car-owner share from the published parts
   (`une_voiture + deux_plus`), the two-or-more share, and the road footprint in
   context. Each clause stays silent when its published parts are missing.
4. **Réseaux (C3).** The three map panels, their mode ring, the inspection
   gallery and the network/bike tooltips remain. The plate helpers, road
   footprint sub-figure, internal exploration link, internal heading/tagline and
   decorative rules are removed. Below the maps: prose + source stamps on the
   left, a vertical grouped-bar figure on the right. Categories are the three
   networks; values are the published `reseaux_par_habitant` densities. The
   territory bike bar is segmented Protégé/Partagé; its comparison bar uses the
   served total statistic (median today), unsegmented — segment statistics are
   never summed. Raw kilometres and each declared segment/raw comparison (with
   its served rank) appear in tooltips only.
5. **Se garer et se ravitiller (C4).** Two paired columns, each with its own
   prose, source stamps, compared bars and ratio line. The bars carry no rank
   chip; the ratio line owns its reference and rank. The parking ratio keeps its
   honest unavailable note. The refuelling ratio is published only where the
   territory has at least one station-service.
6. **Sources (C8/§6).** The sources are built from the producer's
   `source_records` (publisher name, URL, licence, millésime). `ContentSource`
   gains additive `url` and `licence` fields. No producer name, URL or licence
   is hardcoded in the renderer.
7. **Motorisation merge and retirement.** The `motorisation` unit, its section,
   its evidence kind and `CahierMotorisationFigure` are removed. Its indicator
   keys join `partage-de-lespace-public`. The `offre-cyclable` section and the
   `CahierSharingFigure` / `CahierNetworkFigure` / `CahierRoadSurfaceFigure` /
   `CahierNetworkBarChart` family are removed; the protected/shared distinction
   survives in prose and in the segmented bike bar. Page numbering becomes 13.
8. **Comparison states.** Every new figure names « Groupe comparé » and handles
   loading, error (with retry), unavailable and empty selection without a
   fallback reference. The theme comparison status is the
   `nativeComparisonStatus` already owned by `TerritoireView`.
9. **Partial per-resource publication (release state).** A declared resource
   whose publication is still absent must not blank the rest of the Mobilité
   page. The theme acquisition isolates each resource+target group in a fresh
   bounded snapshot (≤12 reads), keeps its focal/default and expanded declared
   comparisons together, and records an explicit `resource_failures` entry.
   A failed atomic batch is never partially salvaged; a comparison-only failure
   keeps fresh focal facts while that comparison stays explicitly unavailable.
   Affected figures list the unavailable publication visibly and accessibly; no
   zero, rank or reference is fabricated. Other themes keep their existing
   atomic default contract.

10. **Page 3 (C5/§7.5–7.6, #955).** « Couverture du territoire » renders
    `offre_tc` as a compact 0–100 % share track with the active comparison tick
    and its value, under the full published indicator label; the Korrigo
    proximity universe stays distinct from the national GTFS raccordement
    sources. « Visiter la Bretagne » renders the full native
    `raccordement_courbe` grid, the marker from
    `indicator_pages.raccordement_courbe.trajectory`, the territory line in
    `--brand-500`, and the **active header group mean** as a neutral dashed
    line. That mean comes from `selectedTrajectoryComparison`; there is no
    named-Brittany fallback, no third series and no automatic reference for an
    empty selection. `raccordement_tc` is prose only. The GTFS model is
    outbound planned stop-to-stop, and aggregate curves are equal means of
    member communes including model zeros. Both figures expose their honest
    loading/error/retry/unavailable/empty states without blanking the other
    section. The old `public-transport` evidence kind and
    `CahierOffreTransportsFigure` are retired.

## AEDAR preservation rule (C7)

`aedarAccessSection.ts`, every `Aedar*` component, the `aedar-*` branches of
`VarianteCahierLibre`, `AccessRampFigureCahier.vue` and
`CahierGroupedVerticalBarChart.vue` are unchanged by this ADR's implementation.
`production-mobilite-aedar.spec.ts` must not be modified and must stay green.
The AEDAR unit's DOM, CSS and 29 regression assertions are the contract;
`mobilite-aedar-contract-guard.spec.ts` additionally pins its section order,
labels, source stamps, two ramps, profile, sandbox and loss maps, and the
absence of any Marelle inside the unit.

## Consequences

- ADR-0026 remains the policy for the other themes until their own migration.
- The `/indicateurs` catalogue keeps its existing editorial membership,
  including its « La motorisation » subgroup; only the fiche grammar merges the
  motorisation rows into the public-space subgroup.
- The app consumes the #960 declared-profile detail references through the
  existing theme comparison acquisition; it never computes peer statistics in
  the browser.
- An unpublishing producer resource is a scoped data failure on the affected
  figure, not a page error: the page keeps its published maps, bars, parking
  column, ratio and prose while the missing publication remains visibly
  unavailable until a fresh read after publication.
- The new Cahier figure families (`CahierMobiliteComparisonBars`,
  `CahierMobiliteShareTrack`, `CahierMobiliteRaccordementCurve`) are the
  Mobilité pages' shared presentation layer; page 3 uses the same grammar and
  primitives as page 2.
- The raccordement source identity, method registry and test fixtures now name
  `raccordement_gtfs_national` and the outbound stop-to-stop model; the old
  mairie-to-mairie alias is retired from the app's factual methods copy.
- `DESIGN.md` is not rewritten; this ADR stands in until the human-owned
  DESIGN.md v2 campaign (#511).

## Not decided here

- No renderer registry: the extraction of AEDAR sections is a separate
  follow-up (#956).
- No change to `/indicateurs` page membership, no new catalogue grouping.
- No new aesthetic direction and no edit to the protected AEDAR components.
