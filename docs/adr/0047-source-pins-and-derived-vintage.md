# ADR-0047: Opt-in content-addressed source pins and derived vintage

- **Status:** **superseded by ADR-0048** (2026-11-21, issue #1103) — unified source provenance: one committed lockfile, explicit basis per source, attributed locks and a release freeze. The opt-in pins and `pins/` registry are retired. Kept as the historical record of the decision ADR-0048 replaces.
- **Former status:** accepted — decision 2026-11-21: pinning was **opt-in**, source by source; implementation for issue #1099 (parent #1040)
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

The first implementation pinned every source on first acquisition. That was rejected: it would make
every volatile URL hard-fail on an upstream byte change, changing the operational contract for
sources this issue never intended to touch. Pinning is therefore **opt-in**.

## Decision

1. **Pinning is opt-in.** Only sources named in `SOURCES_EPINGLEES` have a pin registry file and
   pin semantics. For every other source, `resoudre_source()` reproduces the pre-#1099 behaviour
   exactly: a present, structurally valid file is reused as « frais »; otherwise the URL is fetched
   (two attempts) and verified only against the manifest's own `sha256` column if it has one. No pin
   is read, no pin is written, no extra hash is enforced, and the vintage remains the one the
   manifest declares today. An upstream content change never raises `erreur_pin` for an unlisted
   source.
2. **The three pinned sources are those that produced dishonest vintages:** `osm_reseaux`,
   `bornes-recharges`, `korrigo`. A listed source without a pin, or with an unmaterialised pin
   (`etat = "en_attente"`), fails closed with a named refusal.
3. **One resolver, `resoudre_source()`, for every manifest fetch.** `download_sources()` delegates
   to it; the difference between listed and unlisted lives in this one seam. For listed sources:
   - pin present and cached bytes hash to it → use the bytes, no network;
   - cached bytes missing → download with the usual two attempts and verify against the pin;
   - pin present but bytes differ → **hard error** naming the source, both hashes and the deliberate
     repin command. Never silent drift.
   Writes are atomic: bytes and pins are written to a temporary file in the same directory and then
   renamed, so a failed write never destroys the previous good copy. `erreur_pin` is a named
   condition carrying `source_id`, `raison`, both hashes and accrued statuts; `run_pipeline()` writes
   a `refus pin — <raison>` report row before re-signalling, as it does for `erreur_telechargement`.
   Unlisted sources can never raise this condition.
4. **One deliberate repin entry point.** `Rscript pipeline/scripts/repin-source.R <source_id>`
   only accepts a listed source. It rebuilds the pin from the already-present file — recording that
   file's mtime as the acquisition date, never "now" — or downloads it when absent, then replaces the
   pin in one atomic write. An old pin stays intact if the rebuild fails.
   *Retired (#1103, superseded by ADR-0048):* `repin-source.R` no longer exists — do not run this
   command. The replacement is ADR-0048's lockfile relock, launched from `pipeline/` (the only
   documented, working form, #1122): `cd pipeline && Rscript scripts/relock-sources.R <run-dir> [source_id...]`.
5. **Vintage is derived, never hardcoded, for pinned sources.** The closed `vintage_basis`
   vocabulary is `fichier_date` (unlisted/dated sources: declared from an immutable filename or URL),
   `contenu_date_maj`, `contenu_timestamp` and `telechargement`. Derived bases read the actual file:
   the maximum `date_maj` of the bornes export (2026-11-11), the OSM PBF HeaderBlock replication
   timestamp (field 32, after inflating the zlib blob; 2026-11-16), else the recorded download date
   (Korrigo's daily regeneration, 2026-11-18). A contract test asserts each listed source actually
   delivers the basis it declares. `vintages_depuis_manifest()` overrides the published
   `version`/`date_reference`/`date_publication` from the pin for derived sources; unlisted/dated
   sources keep their declared vintage.
6. **Every manifest source declares a `vintage_basis`.** `avec_vintage_basis()` supplies
   `fichier_date` to manifests written before this ADR; this is metadata only and does not opt a
   source into pinning.

## Consequences

- **No cron change is required.** Unlisted sources run exactly as they did before this PR — the
  download targets, retry policy, idempotence and vintages are unchanged. The three listed sources
  have real, committed pins and their published vintage now matches the bytes actually used.
- A changed pinned file, a missing listed pin and an unmaterialised pin all fail the run loudly and
  are reported. Two resolutions of the same pinned content yield the same derived vintage,
  independent of the download clock.
- No HTTP metadata is used as a vintage. Dated sources (INSEE, static.data.gouv, per-year OSM,
  OCS-GE, Geovelo snapshots) are unaffected.
- Pin files are versioned (`pipeline/.gitignore` exception); the bytes they pin remain ignored.

## Follow-up: remaining unpinned sources and their risks

They are deliberately NOT in `SOURCES_EPINGLEES`; each keeps the pre-#1099 risk that a live URL can
change under an unchanged vintage, and should be promoted with a deliberate repin cadence when the
owner decides:

- `sncf_voyageurs` — the SNCF national GTFS zip is a rolling export; `feed_version` and the declared
  vintage can drift on any rebuild.
- `dila_bdl` — DILA `all_latest.tar.bz2` is a ~348 MB archive rebuilt almost daily.
- `korrigo`'s sibling data.bretagne exports: territoires d'industrie (`manifest_programmes`) and
  SIRENE (`manifest_economie_sirene`) — live ODS exports with no stable publication date.
- `manifest_programmes` Grist download — a hosted live document export.
- `manifest_habitat_dpe` data-fair API — a rolling DPE base whose declared publication date is NA.
- `manifest_habitat_dvf` `geo-dvf/latest/...` — a moving `latest` alias for a yearly dataset.
- the `all_latest`/other live URLs in `manifest_mobilite` not named above.

Two consecutive byte-identical cold builds (`_targets` cleared, `scalar-serving`) remain to be
re-proven by the orchestrator on real data; the isolated worktree cannot perform that run.
