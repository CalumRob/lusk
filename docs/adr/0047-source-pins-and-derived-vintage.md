# ADR-0047: Content-addressed source pins and derived vintage

- **Status:** accepted — implementation for issue #1099 (parent #1040); pins for the three live sources are declared here and materialised by the operator on real data
- **Related:** ADR-0001, ADR-0004, ADR-0005, ADR-0024; issue #1040; CONTEXT.md « Version de table publiée »

## Context

Several manifest sources point at a live URL while the manifest declares a fixed vintage. On
2026-11-18, `bornes-recharges` was downloaded with a declared reference of 2026-07-28 although the
live export had moved to 2026-08-04; `osm_reseaux` (`bretagne-latest.osm.pbf`) was downloaded with a
declared 2026-08-05 although the extract had moved to 2026-08-06. The consequence was measured:
`bornes_recharge` fell by 173 stations region-wide (−9.1%, 131 communes decreased, 75 by exactly −1)
and parking capacity moved by more than 5% in 83 communes. The values were plausible for the file
actually downloaded, but the app presented them as July/August data.

HTTP dates are not a remedy: the `bornes-recharges` ODS export sends neither `Last-Modified` nor
`ETag`, and the Korrigo alternative export is regenerated daily. A rebuild under an unchanged version
label was therefore changing published facts silently.

## Decision

1. **One resolver, `resoudre_source()`, for every manifest fetch.** `download_sources()` no longer
   downloads directly: it resolves each source through this single seam. A pin at
   `data/raw/pins/<source_id>.json` records `{url, sha256, bytes, downloaded_at, vintage,
   vintage_basis, date_reference, etat}`.
   - pin present and cached bytes hash to it → use the bytes, no network;
   - cached bytes missing → download once and verify against the pin;
   - no pin yet → download, hash, derive the vintage, write the pin;
   - pin present but bytes differ → **hard error** naming the source, both hashes and the deliberate
     repin command. Never silent drift.
2. **Mandatory pins for migrated sources.** `osm_reseaux`, `korrigo` and `bornes-recharges` are in
   `SOURCES_EPINGLEES`. A migrated source without a pin, or with an unmaterialised pin
   (`etat = "en_attente"`), fails closed. Other sources are pinned opportunistically on first
   acquisition, preserving the historical flow; they are follow-up work, not silently migrated.
3. **One deliberate repin entry point.** `Rscript pipeline/scripts/repin-source.R <source_id>` forces
   a fresh acquisition, recomputes the hash and vintage, and replaces the pin. Every pin error names
   this command. No automatic retry or cron path may repin a mandatory source.
4. **Vintage is derived, never hardcoded.** The closed `vintage_basis` vocabulary is
   `fichier_date` (declared from an immutable dated filename/URL — the historical dated sources),
   `contenu_date_maj`, `contenu_timestamp` and `telechargement`. Derived bases read the actual file:
   the maximum `date_maj` of the bornes export, the OSM PBF header replication timestamp, else the
   recorded download date (Korrigo's daily regeneration). `vintages_depuis_manifest()` overrides the
   published `version`/`date_reference`/`date_publication` from the pin for derived sources; dated
   sources keep their declared vintage. The manifest literals remain as contract fixtures and are
   what the existing fragment contracts validate — the published table is what the file actually is.
5. **Every manifest source declares a `vintage_basis`.** `avec_vintage_basis()` supplies
   `fichier_date` to manifests written before this ADR, so an unpinned/unclassified source fails the
   contract suite instead of drifting into an assumed date.

## Consequences

- A changed pinned file, a missing mandatory pin and an unmaterialised pin all fail the run loudly.
  The bytes of a published vintage are reproducible: two resolutions of the same pinned content
  yield the same derived vintage, independent of the download clock.
- The three migrated sources' pins are committed as `en_attente` descriptors (URL and basis only).
  The operator must materialise them with `repin-source.R` against real data before the next
  publication; only then can two cold builds be proven byte-identical. That real-data proof is
  explicitly out of scope for the isolated worktree.
- No HTTP metadata is used as a vintage. Dated sources (INSEE, static.data.gouv, per-year OSM,
  OCS-GE, Geovelo snapshots) are unaffected: their vintage continues to come from the contract.
- Pin files are versioned (`pipeline/.gitignore` exception); the bytes they pin remain ignored.

## Follow-up

The remaining live/unpinned sources — DILA `all_latest.tar.bz2`, the SNCF national GTFS zip, the
other data.bretagne `exports/csv` sources (programmes' territoires d'industrie and SIRENE), the Grist
download, the data-fair DPE API and `geo-dvf/latest/...` — are not migrated here. They keep their
current, opportunistically-pinned flow and are enumerated for a later ticket.
