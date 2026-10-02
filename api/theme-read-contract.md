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
  summaries are read inside one read-only repeatable-read transaction.
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
  `sex: null`; no artificial sex dimension is added. Current homogeneous
  profile units come from the profile descriptor. When per-detail units are
  published, the reader consumes the focal declared cell's unit for that exact
  detail (never a hardcoded conversion or presentation literal).
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

The comparison response describes one metric per declared facet, not a
territory-by-fact dump. Profile scalar dependencies are checked against their
exact required scalar publication version in the same snapshot. Profile-only
themes do not require an unrelated scalar publication. Stale reference,
profile, or declared scalar dependency versions fail closed.

Owned-series observations without producer-declared active-route metadata
remain unavailable on the named-indicator route; storage presence is not
authority to guess route ownership. Mobilité producer coverage remains
incomplete, so no route claims complete-theme coverage. These are follow-up
publication/release gates, not a basis for serving guessed facts.
