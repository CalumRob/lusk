# Pin Geo API labels for EPCI display names

Lusk's pipeline has two naming concerns for an EPCI. The versioned INSEE EPCI reference supplies the name attached to the data snapshot, while the Geo API supplies a concise administrative label such as `CA Lorient Agglomération`. The published payload only needs the public label: the source name remains available to the pipeline and its provenance, rather than being duplicated into a second app-facing field.

**Decision (user, 2026-09-03):**

- The EPCI code/SIREN remains the identity key.
- The **nom de référence** remains the exact INSEE `LIBEPCI` value from the pinned EPCI data vintage as pipeline/source language.
- The published `territoires.nom` is the **nom public**: for an EPCI, the Geo API `nom` value verbatim, including its administrative type abbreviation (`CA`, `CC`, etc.); for other territory types, the existing source name remains unchanged.
- Geo API labels are resolved by the pipeline and stored in the tracked `pipeline/inst/extdata/epci_geo_api.json` artifact as a versioned code-to-label input. The app never calls Geo API at runtime and never shortens or reformulates the label.
- The pipeline validates that each mapping is keyed by the expected EPCI code and fails for missing or duplicate mappings.

**Considered options:**

1. Use INSEE `LIBEPCI` everywhere — rejected because the full administrative wording is unnecessarily heavy for public surfaces.
2. Fetch Geo API at runtime — rejected because Lusk is static-first and display labels must not introduce a live network dependency or drift independently of a published payload.
3. Derive a shorter label in the app — rejected because the display decision would be hidden in presentation code and would require exception-prone string rules.
4. Fetch Geo API on every pipeline run without pinning — rejected because identical data inputs could produce different display output as the live API changes.
5. Publish both INSEE and Geo API names — rejected because no current app surface needs the raw INSEE label and a second payload field would duplicate naming concerns.
6. **Pin the Geo API mapping in the pipeline and publish it as `territoires.nom` — chosen** because it keeps the exact official API label while making each published payload reproducible and reviewable without adding a second display field.

**Consequences:** `territoires.nom` means the public territory name, not necessarily the exact raw source label. Name search, lists, maps, and fiches all use the same payload-owned value. The INSEE reference name remains in the pipeline/source trace. A refresh of display labels is an intentional data update, not an app-side formatting change. The existing `nomTerritoirePourAffichage()` helper can be removed because no consumer needs to rewrite the payload name.
