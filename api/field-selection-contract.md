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
| Numeric collections | Active | Implemented for sparse period/detail collections: `value` can be omitted in SQL while status, period/detail identity/order, source/vintage provenance, and publication metadata remain. Categorical anchored membership does not accept `fields`, because it has no coherent numeric projection. |
| Theme facts | Active | Next: typed theme resource fields and availability/provenance contract. |
| Fixed comparisons (including AEDAR) | Active | AEDAR measure is already a typed selector; no duplicate selector added. Broader result selection remains to be covered where the declared response has optional fields. |
| Essential-services legacy routes / #619 compatibility paths / static compatibility reads | Compatibility or retired | Not treated as active resource vocabulary; no selection grammar added. Existing compatibility behavior remains unchanged. |

This ledger is a coverage inventory, not a UI allowlist: every published,
resource-owned supported field is eligible regardless of current screen usage.
For these first projections, identity/descriptor/coordinates/status-or-availability,
provenance and publication-dependency fields are mandatory; numeric observation
attributes are selectable. An explicitly selected mandatory field is valid and
redundant (for example `fields=status`).
New computed facts, relationships or publication capabilities remain separate
work; selection cannot synthesize them.
