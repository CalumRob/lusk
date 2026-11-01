# #872 — Sources consumer-navigation truthfulness

**Status:** implemented on branch `issue/872-sources-links-20261102` (base `4a40156d`, merged #870), 2026-11-02. This is the reader disposition of the Sources slice only: not a new source-availability policy, not an archive/navigation surface, not a change to producer declarations, payloads, API, schema or R publishing. #827/#619/#627 remain open; #873 owns the union reconciliation of central consumer inventories.

## The problem

The Sources projection (`sourceRecords` + `SourcesView`) joined producer source declarations to consumers and rendered **every non-territory-reference consumer as a Page d'indicateur RouterLink**. Producer declarations deliberately survived the legacy accessibility retirement (#627/#870) and still describe non-page uses, so the page manufactured misleading links:

- **Retired accessibility declarations** — the 32 `mobilite_snapshot` consumer keys (`iso_*`, `share_*`, `avg_*`, `tot_loss_*`, `nb_buildings`) rendered `/indicateurs/mobilite/<key>` URLs. The served `theme_mobilite.json` producer artifact still carries their `indicator_pages` entries (14 of the 45 declared pages are the superseded accessibility pages), but the route now renders the honest unknown-indicator state — the link was dead.
- **Named non-page resources** — `raccordement_reference` (the raccordement curve's named reference) rendered a page URL that has never been a page.
- **Categorical non-page consumer** — `couverture_programmes` (Programmes et subventions) rendered a page URL; the theme's pages are the two subventions pages only.

Declaration presence alone is not page existence; page presentation is not API factual availability.

## The disposition

`SourceConsumerRecord.kind` is now a required, three-valued navigation disposition computed in `sourceRecords` (`app/src/payload/selectors.ts`):

| `kind` | Meaning | Rendering in `SourcesView` |
|---|---|---|
| `indicator` | The consumer identity `(theme, key)` is a **current Page d'indicateur of the shared app page catalogue**. | RouterLink to the canonical `/indicateurs/:theme/:indicator` route. |
| `declaration` | A source declaration **without** a current page: a retired declaration or a named non-page resource. | Plain text with the producer label, theme and caveat **plus the visible generic cue « · Déclaration sans page d'indicateur courante »** — never a fabricated page URL. |
| `territory-reference` | The territorial reference (unchanged). | Plain text + « Référentiel territorial ». |

The reconciliation derives the current-page set from `CONTENU_CATALOGUE_INDICATEURS` (`app/src/indicateurs/catalogueContent.ts`) — the same app-owned stable organization that serves `/indicateurs` and grouped search, whose 31 entries the catalogue contract test pins exactly against the retained producer declarations (45 declared − 14 `excluded_legacy_accessibility`). **No second retained/retired slug list is introduced**; the set is derived from the shared catalogue, read-only. The catalogue spec already enforces the catalogue ≡ retained-declarations equality, so the two authorities cannot silently drift.

Deliberately **not** used as the link authority:

- **`indicator_pages` from the served payload** — a producer artifact that still carries the 14 retired accessibility page descriptors; it would keep manufacturing dead links. It remains the source of per-consumer caveats and the page-level secondary source join, unchanged.
- **`source_records[].serving_disposition`** (`excluded_legacy_accessibility`) — a producer factual-availability fact. Sources is metadata-only and demand-driven; inferring link presence from it would make app presentation claim factual availability it does not fetch. The served snapshot does not carry the field (extdata-only), so it cannot govern navigation anyway.

## What is preserved

Exact source joins (primary `metadata.sources` + secondary `indicator_pages[].sources`), dataset identity, publisher, licences, per-vintage freshness, independent clocks, caveats, source anchors (`#source-<slug>` article + vintage rows) and the consumers list itself: a declaration without a page remains a **published consumer of its dataset**, truthfully represented in text with its producer label. Nothing was deleted from producer inputs; no provenance was discarded to remove a link. Sources still waits only on `territoires-metadata`, `vintages` and `theme_<theme>` — no numeric tables, no indicator-model manifest fetch, no per-indicator API fan-out, no new metadata endpoint; loading/error/retry behavior is unchanged.

## Historical declarations are not presented as current page consumers

A declaration without a page is **visibly recognizable as such**: every `declaration` item carries the app-owned stable presentation cue « · Déclaration sans page d'indicateur courante », distinct from the linked current pages and from the territory reference's own « Référentiel territorial » cue. The wording is deliberately generic: it states the absence of a current Page d'indicateur, nothing more. It does not label any consumer « retiré »/« historique » — that would be an invented retained-vs-historical factual classification (and would mislabel retained named references and the categorical coverage) — and it does not infer factual API availability. The model's expressible distinction is page/non-page; within non-page consumers, separating "retained non-page uses" (the named reference) from "historical declarations" (retired accessibility keys) would require exactly the second hardcoded retained/retired slug list the issue forbids. Both therefore render as the same truthful declaration kind — text with the visible no-current-page cue, producer label and caveat intact. No new archive/navigation surface was introduced.

## Evidence (native exits recorded)

**Baseline slice (commit `665de9e0`/`12cf882f`, head `f9a6f2b2`):**

- Selector regressions: `sources-authority.spec.ts` — 10 passed (5 new: current pages marked `indicator` with correct theme identity; named reference `declaration` with label+caveat; retired accessibility keys all `declaration` with provenance retained; `couverture_programmes` `declaration` vs both subventions pages `indicator`; catalogue-based reconciliation proven against a fixture publishing a descriptor for `densite` only).
- Mounted regressions: `sources-view.spec.ts` — 7 passed (2 new: exact link destinations for current pages; no `/indicateurs/mobilite/iso_alimentation`, `/share_food_t`, `/nb_buildings`, `/raccordement_reference`, `/indicateurs/programmes/couverture_programmes` URLs; declarations remain represented in text; territory reference without link; per-card anchor/dataset/publisher/millésime/clock evidence preserved; the matrice card's consumer links are exactly the two current pages).
- Complete app suite: **159 files / 2076 tests passed, exit 0**. `vue-tsc --noEmit -p tsconfig.app.json`: exit 0. External-output build: exit 0. `npx impeccable detect app/src`: 11 findings, byte-identical to the pre-branch baseline by file/rule/line, no new finding or suppression.

**SPEC-review repair — the visible no-current-page cue (new head, see PR):**

- The initial mounted state failed exactly as reviewed: a declaration rendered as `label · theme — caveat` with no visible cue distinguishing it from a current page consumer (RED, native exit 1).
- `SourcesView` now appends the app-owned stable presentation cue « · Déclaration sans page d'indicateur courante » to every `declaration` consumer; current pages keep their links and never carry the cue; the territory reference keeps its own « Référentiel territorial » cue.
- New mounted regression asserts the visible distinction, not merely link absence: the named reference carries the cue with no link; a current page links without the cue; every retired-accessibility snapshot item and the categorical `couverture_programmes` carry the same generic cue; the territory reference carries neither the cue nor a link.
- Affected complete Sources specs: 6 files / 82 tests passed, native exit 0 (`E:\Temp\opencode\lusk-872-build\vitest-affected-f9a-fix.log`). Complete app suite: **159 files / 2077 tests passed, native exit 0** (`E:\Temp\opencode\lusk-872-build\vitest-complete-f9a-fix.log`). Exact-head `vue-tsc --noEmit -p tsconfig.app.json`, external-output build, `git diff --check` and scoped detector receipts are recorded in the PR.
- Other `sourceRecords` callers unchanged: `sourcesMethodes` (dataset rows, consumers not read) and `IndicateurPage`'s provenance binding (source cards pass `consumers` through without rendering them; the required `kind` field compiles structurally). The committed `public/data` payloads, producer extdata and R publishing are untouched.

## Notes for #873 (union reconciliation)

- The current-page set derivation lives in `selectors.ts` (`PAGES_INDICATEUR_COURANTES`) as a read-only consumer of `CONTENU_CATALOGUE_INDICATEURS`. If the union reconciliation centralizes page-membership, move both the Sources consumer and any other consumer-inventory readers onto that single seam rather than re-deriving per module.
- The territory-reference consumer remains the only `theme: null` consumer; its label comes from `territory_reference_label`.
- The per-vintage anchor collision (article `#source-<dataset>` vs vintage row `#source-<vintage-id>` share an id when vintage id === dataset id, e.g. `matrice_temps_mairies`) is pre-existing and untouched by this slice.
