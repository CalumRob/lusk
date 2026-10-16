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
| Scalar / individual indicator | Active | Implemented here: allowlisted physical optional columns `support_count`, `denominator_count`; value/status, descriptor, sources and content version retained. Indicator identity remains route-bound. |
| Declared profile | Active | Next: descriptor-owned axes/cells and comparison contract. |
| Ordered / owned series | Active | Next: descriptor-owned point fields; order, null points and source provenance retained. |
| Numeric collections | Active | Next: resource-owned numeric/detail fields; sparse/missing semantics preserved. |
| Theme facts | Active | Next: typed theme resource fields and availability/provenance contract. |
| Fixed comparisons (including AEDAR) | Active | AEDAR measure is already a typed selector; no duplicate selector added. Broader result selection remains to be covered where the declared response has optional fields. |
| Essential-services legacy routes / #619 compatibility paths / static compatibility reads | Compatibility or retired | Not treated as active resource vocabulary; no selection grammar added. Existing compatibility behavior remains unchanged. |

This ledger is a coverage inventory, not a UI allowlist: every published,
resource-owned supported field is eligible regardless of current screen usage.
New computed facts, relationships or publication capabilities remain separate
work; selection cannot synthesize them.
