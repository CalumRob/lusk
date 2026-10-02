# Theme read API (incremental contract)

The read API exposes bounded named reads over producer-published scalar and
declared-profile facts. It does not make a theme complete merely because some
facts are available: responses keep `complete_theme: false` until the active
catalogue and actual producer coverage establish completeness.

## Routes

- `GET /api/territories/{type}/{id}/themes/{theme}/facts` returns focal facts
  and declared focal profiles only. Values, shape, labels and provenance come
  from the published descriptors and observations.
- `POST /api/territories/{type}/{id}/themes/{theme}/comparison` returns only
  comparison summaries. The JSON body has `theme_id` (which must match the
  route) and an optional typed `selection` array of `{territory_type,
  territory_id}`. Omitting `selection` requests the published default; sending
  `selection: []` requests no comparison. Nonempty selections resolve whole
  selected territories to distinct communes using the published reference;
overlapping territory selections are deduplicated. The focal territory is
not inserted into or removed from an explicit selection.

The comparison-only response contains only scope metadata, result summaries,
and profile facet references; it has no focal `facts`, `profiles`, or raw cell
arrays. `scope` identifies the default density class / same-level peer set or
an explicit selection and its resolved member count. Example (abbreviated):

```json
{
  "contract": "theme-comparison-v1",
  "theme_id": "habitat",
  "scope": {"kind": "density_class", "density_class_code": "D1",
            "territory_type": "commune", "member_count": 42},
  "results": [{"indicator_id": "part_passoires", "statistic": "median",
                "eligible_count": 40, "median": 0.23, "rank": 12}]
}
```
- The older `/themes/comparison` route remains as a compatibility wrapper.

For a commune, the default cohort is the same published density class. A
missing density class fails closed with 503; it does not fall back to all
communes or administrative peers. EPCI and département defaults use their
same-level published peer territories. A region has no default comparison.
Comparison summaries preserve declared median semantics and require two
comparable measured members; ranks are emitted only when the focal territory
was selected and measured. Null/suppressed observations are not zero.

These endpoints are incremental, not a claim that all theme families are
published. In particular, missing Mobilité producer families and owned-series
active-route metadata remain release blockers. The legacy profile and series
routes remain available to existing clients while those contracts are audited.
