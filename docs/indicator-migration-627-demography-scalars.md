# #627 batch: ordinary demography scalars

This batch adds `densite` and `taille_menages` to the producer-owned scalar
contracts and includes their canonical Parquet rows in the existing combined
Services + economy + demography `scalar_observation` snapshot. It reuses the
same scalar projection, assembler, transaction, content-version and retry path;
it adds no table, publisher command, or publication identity. Sparse is the
producer declaration, and support/denominator counts remain unavailable (not
inferred). The producer's four observed fact levels include Région; page
comparison levels remain separate. The fixture adapter's explicit fixture
policy remains scoped to its fixture.

The checked-in demography artifact is regenerated with
`publier_theme_metadata(lire_theme_metadata("demographie"), ..., vintages_demographie())`.
The metadata unit spelling `hab/km²` now matches the canonical producer code
and Parquet; the numeric facts are unchanged.

## Consumer work still outstanding

This is publication preparation, not a reader cutover. The ordinary facts
still have static reads at the indicator-page/read-model seam
(`app/src/views/IndicateurPage.vue`,
`app/src/payload/indicatorReadModel.ts`), the fiche fact resolver
(`app/src/fiche/content/territoryFacts.ts` and `themeContent.ts`), and map
preview/layer assembly (`app/src/carte/popup.ts`, `coucheModel.ts`, and
`fusion.ts`). The map's density preview also serves a different density-class
concept and needs a fact-specific audit before changing its source. Existing
rank outputs and static payload artifacts stay intact for those and any
non-browser consumers. Follow-up must migrate each seam to bounded acquisition
with visible/retryable unavailable behavior and verify whether any rank/map
artifact has other consumers; this batch neither claims a page cutover nor
authorizes artifact deletion.

No live PostgreSQL publication was performed.
