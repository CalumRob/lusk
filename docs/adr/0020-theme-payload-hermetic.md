# Theme payloads are hermetic — a theme's files are self-contained; cross-theme facts are precomputed in, never cross-read at runtime

**Serialization retirement (owner-approved, 2026-11-06):** the per-theme
`indicateurs_*.json` / `histoires_*.json` browser exports are retired for every
theme, superseding the intermediate Programmes exception below. The original
decision remains historical context for producer ownership and theme-local
calculation, not a requirement to write or retain a numerical JSON pair. Current
browser facts use the semantic API; canonical in-memory facts/readings and
retained serving artifacts remain. Metadata, territory identity, geometry and
freshness assets are separate, deliberately retained contracts. This amendment
does not authorize app-side cross-theme arithmetic or any live publication.

**Metadata boundary update (#827, 2026-11-07):** the retained theme catalogue is
not one of the retired numerical JSON pairs. The #827 browser-projection change
removes the producer capability maps `scalar_contracts`, `profile_contracts`,
and `map_layers`; other producer-only fields had already been excluded.
Canonical declarations remain for R publishers and semantic API discovery.
Named factual/source metadata readers remain separately inventoried
in [the structured-consumer ledger](../structured-consumer-inventory.md). This
does not claim that all theme metadata has left the browser or that its remaining
readers are reconciled.

## Historical implementation and decision — JSON pair requirements superseded

The fiche renders each theme block from exactly two files — `indicateurs_<theme>.json` + `histoires_<theme>.json` — and the « Chargement prioritaire » feature (#296) makes each route wait only on its own wait-set: for a theme, that is exactly its own pair. This architecture is only coherent if a theme's rendering never needs another theme's files at runtime. The first cross-theme fact surfaced in grilling #296: the Milieux story reads **Δpopulation** — a Démographie-series fact — yet the app never touches `indicateurs_demographie` to render Milieux. The pipeline precomputes `delta_population` into the Milieux `histoires` row (the population-sourcing rule of ADR-0014, schema in ADR-0017), so the Milieux block is self-contained in its own pair. The same shape holds everywhere: the Aperçu anchors come from the pipeline-published `apercu` table (never derived in the app); Économie's top-5 LQ ships precomputed (the full matrix never ships); the story clouds read peers *within the same theme's* `histoires` file; the carte layers read each theme's own scalars. The pattern was working implicitly; it is now named and prescriptive.

**Decision (user, 2026-08-10):** a theme's payload is **hermetic**. A theme's rendering reads only its own `indicateurs_<theme>.json` + `histoires_<theme>.json` (plus the shared `territoires` reference and the shared cross-theme tables — `apercu`, `programmes`, `vintages`, `run-report`). Any fact a theme needs from another theme's domain is **precomputed by the pipeline into the consuming theme's own payload at compute time** — never cross-read, never derived in the app. The apparent duplication (Δpopulation ships in both Démographie and Milieux) is the **seam**, not waste: it is what keeps each theme independently loadable, which is what the wait-set architecture depends on.

**Considered options:** (1) **force cross-theme loading** — the app resolves a theme→theme dependency graph (Milieux → Démographie) and a wait-set becomes transitive — rejected: it builds an app-side dependency graph that must be kept in sync with the pipeline's real data flows, makes wait-sets transitive (loading Milieux drags Démographie), violates the product's core split — "the app renders; the pipeline computes" (`docs/principles.md` §5, ADR-0003) — and re-derives in the browser what the pipeline already owns; (2) **precompute into the consuming theme — chosen**: each theme stays independently loadable, the app's rendering stays a pure projection of one theme's files, and the pipeline stays the single place where cross-theme arithmetic happens.

**Consequences:** every theme's wait-set stays per-theme (`indicateurs_<theme>` + `histoires_<theme>`), never transitive — the #296 wait-set table assumes this rule. A new theme that needs a fact from another theme's domain must precompute it into its own payload at pipeline time (Milieux/Δpopulation is the precedent). A future developer seeing apparent duplication across theme files must **not** "fix" it by cross-reading another theme's files at runtime — that silently breaks loadability and the wait-set contract. The rule is binding on the pipeline (where cross-theme facts land) and on the app (where they are never re-derived). `CONTEXT.md` gains the term (see the **Hermétique** entry).

**Historical intermediate amendment (#925, superseded by all-theme retirement):** Programmes' empty history file was retired first. At that stage, other reading-bearing themes still required their numerical JSON pair and missing history files were validation failures. That remaining file-pair requirement is now superseded too: no browser numerical pair is required for any theme. Producer-owned facts/readings and the prohibition on reconstructing cross-theme facts in the app remain; the original serialization and wait-set mechanics above are historical, not current requirements.
