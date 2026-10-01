# #627 — Economy scalar page cohort consumer

This batch switches the existing Economy `IndicateurPage.vue` facts seam for producer-registered scalar pages to one bounded cohort read. Repères and the page's existing Carte view consume the same snapshot. The browser continues to use the current exploration/read-model helpers for presentation and does not recompute source indicators.

## API contract and fallback

`GET /api/territories/{level}/{focal}/indicator-cohorts/{indicator}?scope_level=...` reads one declared scalar descriptor and its territory cohort in a single repeatable-read, read-only transaction. Commune department/EPCI filters are validated against the territory reference and focal membership. The response retains registered territories even when a sparse scalar row is absent (`not_published`, null value), carries provenance per observation, and carries the scalar content version. It rejects incompatible markers, mismatched comparison facets, missing provenance on published observations and cohorts over 1,500 territories; it never pages or truncates a snapshot.

The default build remains static. `VITE_SCALAR_COHORT_API=1` enables the shared scalar-cohort reader, but an indicator is API-selected only when the generated `theme_economie.json` producer metadata registers it in `scalar_contracts` (either the producer's string-key array or key-indexed object). Unregistered pages continue through their incumbent static consumer; this intentionally keeps sparse `eco_activites` outside this ordinary-scalar batch. A registered page never falls back to static facts after API failure: it shows the existing retryable unavailable state. This PR does not set the deployment flag or publish/deploy the API.

## Rollout gates

Before setting the build flag in a deployed app, separately verify that:

1. the publisher's registered contracts for the page indicator exist in the live scalar descriptor snapshot and its territory-reference version is compatible;
2. the deployed API image contains this cohort route and passes its bounded sparse-cohort/provenance checks;
3. the served economy theme metadata includes the matching producer-owned `scalar_contracts` registration; and
4. the targeted browser/API smoke succeeds against the deployed service.

Merged code is not evidence of API deployment, canonical publication, or a production cutover. Static indicator artifacts and ranks remain for rollback and remaining consumers.

## Named consumers not covered

- Fiche/theme numeric facts still use their structured payload seams in `app/src/fiche/content/` and `app/src/views/TerritoireView.vue`.
- Site-wide numeric map fact reads still use `app/src/carte/coucheModel.ts` and `app/src/carte/fusion.ts`.
- Static economy indicator read models and all downstream R/export consumers remain retained; `histoires_economie` remains its own semantic consumer.

Those consumers must be reconciled in later #627 batches and should reuse this bounded cohort acquisition contract where their selected scope matches. This batch claims only the Economy indicator-page Repères/Carte surface.
