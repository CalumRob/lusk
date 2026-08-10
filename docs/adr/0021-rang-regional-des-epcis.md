# EPCIs rank against the regional peer group

Ranks on the fiche are intended to make territories comparable at the scale that matters for the product. The earlier policy ranked an EPCI against the EPCIs in its département. The département is not a sufficiently meaningful administrative comparison frame for Lusk's territorial reading, while the full Breton EPCI set provides a consistent regional peer group.

**Decision (user, 2026-08-10):** an EPCI ranks against **all Breton EPCIs**, not against the EPCIs in its département. A commune ranks among its EPCI's communes when it has an EPCI; a commune without an EPCI falls back to regional communes. A département ranks among the four départements, and the région uses its declared regional comparison set. The rendered rank always includes the peer-group size and names the actual scope.

**Considered options:** (1) retain département-scoped EPCI ranks — rejected because département boundaries are not the most relevant analytical comparison for EPCIs; (2) rank every territory regionally — rejected because commune-level comparison remains most useful within the local EPCI; (3) **regional EPCI peers — chosen** because it preserves local commune context while giving EPCIs a stable Breton comparison frame.

**Consequences:** the pipeline must compute EPCI rank columns from the complete Breton EPCI peer set. The app must not infer a département scope for EPCI ranks. Rank presentation can remain compact — scope is derivable from the territory and its relationships — while every user-facing comparable metric still carries its position, total, and resolved scope. This policy supersedes the earlier nearest-département rule described in `CONTEXT.md` and should be reflected in ADR-0015's implementation follow-ups.
