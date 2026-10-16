# Bounded field-selection coverage (checkpoint for #781)

`fields` is a repeated query parameter containing resource-owned logical field
names. Omission preserves the complete legacy response. A non-empty explicit
selection is validated against that typed resource's selectable optional fields;
duplicates, empty lists, and unsupported names return 422. Normalized ordering is
deterministic. Mandatory identity, availability/status, unit/axis/order where
declared, provenance, and publication/dependency metadata remain in the response.
Selection changes neither grain nor calculations, filters, bounded row counts,
nor publication validation. It is not SQL or a physical table/column API.

## Coverage ledger

| Bounded resource family | Lifecycle | Current contract / checkpoint status |
| --- | --- | --- |
| AEDAR territorial aggregate | Active | Implemented here: `measures.<registered-key>` logical leaf selection; all envelope, TYPEQU, identity, coverage, vintage, and publication fields retained. The measure vocabulary comes from the existing registry, not a screen list. |
| Scalar / individual indicator | Active | Implemented: `value`, `support_count`, and `denominator_count` are projectable from the allowlisted scalar columns. `status`, descriptor/identity, sources, units, and content/publication metadata remain mandatory. Redundantly selecting `status` is accepted as a known resource field but does not remove it. |
| Declared profile | Active | Implemented for the focal and individual-profile reads: `value` can be omitted from cells while status, descriptor-owned axes/order, sources, comparison semantics, and publication metadata remain. Values are projected in SQL; profile completeness/provenance validation remains active. |
| Ordered / owned series | Active | Implemented for the focal series, owned focal series, named references, and `/series-datasets/...` read: `value` can be omitted from points; status, axes/order, missingness, provenance, and publication metadata remain. Comparison-point/mean inputs still read when required by the existing comparison calculation, but are not returned unless requested. |
| Numeric collections | Active | Implemented for sparse period/detail collections: `value` can be omitted in SQL while status, period/detail identity/order, source/vintage provenance, and publication metadata remain. Anchored membership accepts `detail`, `label`, `rider`, and `anchor_count`; anchor identity, labels, relationships, availability, and provenance remain mandatory. |
| Theme facts | Active | `value` projects the optional numeric attributes for scalar facts, declared-profile cells, ordered series, sparse numeric collections, and the registered theme-specific reading families (Demographie, Mobilité, Habitat, Économie, Milieux). Those families use typed SQL projections and retain status/classification, coordinates, units, axes, sources, provenance, and publication checks. Anchored-membership projection is `rider` and `anchor_count`; membership identity/labels/relationships remain mandatory. Theme-facts comparisons share the result vocabulary below. Do not read `value` as a physical column or a promise that every family has one numeric attribute. |
| Fixed comparisons | Active | Per-resource typed validation; status/reason and provenance remain mandatory. Scalar and declared-profile resources support `median`, `focal_value`, `rank`, `rank_size`, `rank_ties`, `selected_member_count`, `eligible_count`, and `missing_count`. Owned-series supports focal/rank/count fields plus its declared statistic (`median`, or `mean` and `mean_curve` for a published mean-curve resource); curve axes/order/status remain mandatory and point `value` is omitted unless `mean_curve` is selected. Numeric period/detail collections support `median`, `rank`, `rank_size`, and selected/eligible/missing counts; anchored membership does not expose numeric comparison fields. Theme comparison selections use the union of fields supported by participating resources, with each result including only fields its own resource supports; a field supported by none returns 422. Fixed profile/series/collection result attributes are projected with SQL CASE expressions; compact SQL predicates still validate internal completeness, support/rank constraints, and status/value shape. Bounded lineage and source metadata remain exact. |
| AEDAR fixed comparison | Active | Existing `measure` remains the typed measure selector; no second selector language. `fields` can project `group_value`, focal `value`, `rank`, `rank_size`, `member_count`, `eligible_count`, and `missing_count`; AEDAR address/coverage denominators, status, units, TYPEQU identity, source clock and publication metadata remain mandatory. |
| Essential-services legacy routes / #619 compatibility paths / static compatibility reads | Compatibility or retired | Not treated as active resource vocabulary; no selection grammar added. Existing compatibility behavior remains unchanged. |

This ledger is a coverage inventory, not a UI allowlist: every published,
resource-owned supported field is eligible regardless of current screen usage.
Identity/descriptor/coordinates/status-or-availability, provenance, and publication-
dependency fields are mandatory; documented numeric and membership attributes are
selectable. An explicitly selected mandatory field is valid and redundant (for example
`fields=status`). Families with no optional member field may accept their documented
mandatory vocabulary redundantly, but should not invent dummy selectors.
New computed facts, relationships or publication capabilities remain separate
work; selection cannot synthesize them.
