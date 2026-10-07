# Theme read API (incremental contract)

Named, bounded reads use producer descriptors and published facts; the API does
not interpret physical table shape as product meaning. Responses keep
`complete_theme: false` until active-catalogue coverage is proven. This is the
read-surface contract for the incremental scalar/profile work under #627 and
#587, consistent with ADR-0035 and ADR-0038.

## Routes and snapshots

- `GET /api/territories/{type}/{id}/themes/{theme}/facts` returns the focal
  facts/profiles plus compact default-comparison summaries. Descriptor lookup,
  publication markers, focal facts, profile facet values and comparison
  summaries are read inside one read-only repeatable-read transaction. The
  Mobilité response also carries `essential_service_access`, using the existing
  grouped service response contract and the same transaction as its other
  focal evidence. A commune defaults to its density-class service comparison;
  `?comparison=densite|epci|bretagne` selects one of the established commune
  scopes. Other territory levels retain their same-level comparison behavior.
  `building_access.distribution[].share` is computed from the published SQL
  count and denominator in this snapshot. `building_access.presentation`
  carries the producer's existing building descriptor metadata (bucket bounds
  and labels, mode and axis labels, quantile labels). Variant E consumes these
  fields rather than inventing categories or copy in its adapter. This is an
  additive descriptor-JSON extension, not a new fact shape or SQL migration;
  older publications without this metadata must be republished before E's
  numeric consumer is enabled, and missing metadata fails closed.
- `GET /api/territories/{type}/{id}/indicators/{indicator}` resolves a stable
  indicator identity through the published scalar/profile/legacy-series
  descriptors in one read-only repeatable-read transaction. Scalar and series
  responses are focal-only. Profile responses contain only that descriptor's
  focal cells and its compact declared-facet default comparison. They never
  delegate to legacy peer-dump response builders.
- `POST /api/territories/{type}/{id}/themes/{theme}/comparison` returns only
  compact comparison summaries, source evidence, and resolved scope metadata.
  It does not include focal fact/profile-cell blobs or per-peer profile arrays.
  The JSON body includes matching `theme_id` and an optional typed `selection`
  array of `{territory_type, territory_id}`.
- `POST /api/territories/{type}/{id}/indicators/{indicator}/comparison` accepts
  the same optional typed `selection`, without requiring the caller to know the
  indicator's theme or storage shape. Omitted body/selection uses the default;
  `selection: []` is empty. It resolves the published scalar, profile, or
  legacy-series descriptor and returns one compact result for only that
  indicator. Profile results identify their producer-declared `source_facet`;
  an external-scalar profile also names `source_facet_indicator_id` and its
  checked scalar publication version. A series without a declared comparable
  point returns typed `unsupported_comparison_contract` rather than an inferred
  statistic. Named series comparisons do not publish a median or rank until at
  least two selected members have a measured value at the declared point; an
  empty selection and a one-measure cohort remain typed unavailable.
- The older `/profiles/{indicator}` and `/themes/comparison` routes remain
  compatibility paths with their existing response shapes.

Omitting `selection` uses the published default: a commune compares with its
same density-class communes; EPCI and département focal territories compare
with same-level published peers; region has no default comparison. Missing
commune density membership fails closed with 503. An explicit `selection: []`
means no members and produces typed unavailable profile comparisons. A
nonempty selection resolves each whole typed territory to communes from the
published reference, deduplicates overlaps, and does not auto-add/remove the
focal territory. The actual cohort kind and member count accompany results.

## Comparison grains and measures

Ordinary scalar comparisons use their declared scalar facet, unit, direction,
and established median behavior. The serving read calculates medians and a
direction-aware rank over selected measured values only; a rank is present only
when the focal territory was selected and measured. The scalar API retains its
established singleton median behavior.

Profile comparison uses only the declared point, never profile bins as a group
distribution:

- An external-scalar facet (for example `distribution_dpe` → `part_passoires`)
  reads the pinned scalar observation. Label, unit, direction, and source
  evidence come from that scalar descriptor/observations.
- A detail facet reads only its declared `(detail_key, sex_key)` coordinate.
  A profile with no sex axis uses the physical empty `sex_key` and returns
  `sex: null`; no artificial sex dimension is added. A per-detail profile gets
  its comparison unit from that exact `profile_axis` coordinate and carries the
  producer-declared denominator semantics. Required mixed-unit coordinates
  fail closed when a unit is absent. Legacy homogeneous profiles may fall back
  to the descriptor unit only when an axis unit is absent or agrees with it.
- Profile comparisons follow the established two-comparable-member
  availability rule. With fewer than two measured members, the result retains
  counts/focal context and is typed unavailable; it does not invent a mean or
  singleton comparison. Missing/suppressed values are not zero. Ties use the
  declared direction-aware rank semantics.

Example (abbreviated comparison-only response):

```json
{
  "contract": "theme-comparison-v1",
  "theme_id": "habitat",
  "scope": {"kind": "density_class", "density_class_code": "D1",
            "territory_type": "commune", "member_count": 42},
  "results": [{"indicator_id": "part_passoires", "statistic": "median",
                "eligible_count": 40, "median": 0.23, "rank": 12}],
  "profile_comparisons": [{"indicator": "distribution_dpe",
    "facet": "part_passoires", "unit": "%", "statistic": "median",
    "eligible_count": 40, "median": 0.23, "rank": 12}]
}
```

The indicator-scoped form wraps exactly one result and keeps theme completeness
false, for example:

```json
{
  "contract": "indicator-comparison-v1",
  "complete_theme": false,
  "indicator_id": "offre_cyclable",
  "shape": "profile",
  "scope": {"kind": "density_class", "density_class_code": "D1",
            "territory_type": "commune", "member_count": 42},
  "result": {"indicator_id": "offre_cyclable",
    "source_facet": {"detail": "total_longueur", "sex": null},
    "unit": "km", "denominator_semantics": "<published-denominator-semantics>",
    "statistic": "median", "eligible_count": 40, "median": 12.4}
}
```

The comparison response describes one metric per declared facet, not a
territory-by-fact dump. Both dedicated theme and indicator comparison
responses omit `focal_value` and other focal observations. Rank calculation may
use the focal value internally; the separately acquired focal payload owns that
observation. Legacy comparison endpoint shapes remain unchanged. Profile scalar dependencies are checked against their
exact required scalar publication version in the same snapshot. Profile-only
themes do not require an unrelated scalar publication. Stale reference,
profile, or declared scalar dependency versions fail closed.

Owned-series observations without producer-declared active-route metadata
remain unavailable on the named-indicator route; storage presence is not
authority to guess route ownership. Mobilité producer coverage remains
incomplete, so no route claims complete-theme coverage. These are follow-up
publication/release gates, not a basis for serving guessed facts.
