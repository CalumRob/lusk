# Official mainland map-context source for #658

**Research fetched:** 2026-10-04. This is source reconnaissance only; no archive was downloaded and no project data/code was touched.

## Finding

There is a directly downloadable, dated IGN archive suitable for the separate context input: **ADMIN-EXPRESS-COG 4.0, GPKG, Lambert-93, France métropolitaine, edition 2025-01-01**. IGN's Géoplateforme download catalog exposes the exact dated resource and a single 7z archive; its current catalog also exposes a 2026-01-01 edition. This is stronger than relying on a mutable WFS response for the map context and does not require changing the analytical `communes_limites.geojson` input.

Prefer the frozen **2025-01-01** edition for a pinned/reproducible acquisition: it is indisputably listed in the IGN catalog, has explicit published byte length and an accompanying checksum resource. The currently listed 2026 edition may be chosen if the application deliberately wants latest; the authoritative catalog now confirms its edition is `2026-01-01` (not inferred from a URL), but its returned Atom entry had no checksum companion and supplied only the archive length. Do not use CARTO / CARTO-PE / CARTO_PLUS for this purpose.

## Official evidence and exact source identity

The official Géoplateforme resource response identifies the 2025 resource as:

- Resource: [`ADMIN-EXPRESS-COG_4-0__GPKG_LAMB93_FXX_2025-01-01`](https://data.geopf.fr/telechargement/resource/ADMIN-EXPRESS-COG/ADMIN-EXPRESS-COG_4-0__GPKG_LAMB93_FXX_2025-01-01)
- Edition: `2025-01-01` (catalog `<gpf_dl:editionDate>`)
- Geographic scope: `FXX`, explicitly labeled **France métropolitaine**
- Format/CRS: `GPKG`, category EPSG:2154 / RGF93 Lambert-93
- Archive: [7z download](https://data.geopf.fr/telechargement/download/ADMIN-EXPRESS-COG/ADMIN-EXPRESS-COG_4-0__GPKG_LAMB93_FXX_2025-01-01/ADMIN-EXPRESS-COG_4-0__GPKG_LAMB93_FXX_2025-01-01.7z)
- Published archive size: **245,232,458 bytes** (Atom `gpf_dl:length`)
- Published companion: [`.md5` resource](https://data.geopf.fr/telechargement/download/ADMIN-EXPRESS-COG/ADMIN-EXPRESS-COG_4-0__GPKG_LAMB93_FXX_2025-01-01/ADMIN-EXPRESS-COG_4-0__GPKG_LAMB93_FXX_2025-01-01.md5), published length 151 bytes. Atom `content` for the archive entry is `c59ecb81a872cedf6245c3c613eb6bd9` (MD5 value); `.md5` entry's Atom content is `4bad415b317ed83ed9a002086182d8fb` (checksum of the companion file, not the archive).

These byte lengths/checksum values were read from the official Atom catalog response, not computed locally. The official download API documentation states that resources and subresources are discovered through `GetResource` and paginated, total entries are in `gpf_dl:totalentries`, and download URLs follow `/telechargement/download/{resource}/{subresource}/{filename}`: [IGN download API documentation](https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/telechargement/). Therefore acquisition should discover and validate the dated subresource/file entry rather than assume a URL pattern alone proves current availability.

The parent catalog was also checked: [`ADMIN-EXPRESS-COG`](https://data.geopf.fr/telechargement/resource/ADMIN-EXPRESS-COG) calls the product an annual, dated edition of ADMIN EXPRESS COG, aligned with the INSEE COG at January 1; it currently lists 2025 and 2026 FXX Lambert-93 GPKG editions. The 2026 resource is [`ADMIN-EXPRESS-COG_4-0__GPKG_LAMB93_FXX_2026-01-01`](https://data.geopf.fr/telechargement/resource/ADMIN-EXPRESS-COG/ADMIN-EXPRESS-COG_4-0__GPKG_LAMB93_FXX_2026-01-01); the catalog reports 238,498,257 bytes for its archive and edition date 2026-01-01.

## Geometry/product distinction

The IGN's [2026 edition announcement](https://cartes.gouv.fr/aide/fr/partenaires/ign/generalites-ign/actualites/2026-05-admin-express-cog/) describes Admin Express COG as the geographical reference for administrative divisions from commune through region and COG-consistent. It specifically distinguishes additional `CARTO_PLUS` layers/offers and documents the latter as a cartographic visualization offer. Those CARTO variants are not the analytical/context source proposed here.

The older official [ADMIN EXPRESS / ADMIN EXPRESS COG / COG CARTO product metadata](https://geoservices.ign.fr/sites/default/files/2021-07/IGNF_ADMIN_EXPRESS_3-0.html) states that source geometry for ADMIN EXPRESS and ADMIN EXPRESS COG comes from the IGN unified database **without generalization** and from large-scale data, while COG CARTO geometry comes from medium-scale data. This establishes the product-family distinction (and why CARTO is not an appropriate stand-in). **Caveat:** this is version 3.0 metadata, not a published 4.0 schema/geometry specification; it is not proof of an exact 4.0 table/layer name or a formal statement that every 4.0 polygon is topologically unsimplified. Verify the extracted GeoPackage's layer/schema and geometry in the selected edition before adopting it. The archive itself was not downloaded in this research.

## Recommended offline derivation and completeness gate

1. Treat the complete official archive as a distinct, pinned context source. Record source product/resource name, edition date, FXX scope, EPSG:2154, catalog response timestamp, download URL, published length/checksum, and the locally observed archive hash/length in provenance. Do not mix it into the existing analytical commune input.
2. Download to a staging path. Require the observed length to equal catalog `gpf_dl:length`, verify archive MD5 against the catalog value (and preferably also record SHA-256 locally), then test the 7z archive's integrity and enumerate/extract its full contents. A nonempty response or successful HTTP status is not evidence of a complete archive.
3. Validate the extracted GeoPackage as a SQLite/GeoPackage database (`PRAGMA integrity_check`, required spatial metadata, declared CRS EPSG:2154, expected commune polygon layer and key fields, valid geometries, and a defensible feature-count/code-uniqueness check against the same edition's official COG/admin inventory). Check expected regional/departmental presence and a known-coordinate regression for Valognes (50615; lon/lat 49.5122N), rather than accepting merely one feature or a broad bbox.
4. Derive the requested frame subset **locally** from the validated national edition: spatially filter commune polygons intersecting frame `[82287.65, 6643538.55, 417431.65, 6978682.55]` in EPSG:2154, preserving original full-resolution geometry (do not simplify) and retaining whole communes that intersect the frame, then clip/render as required downstream. The source edition is countrywide and includes the requested Bretagne frame and Valognes; no renderer HTTP call is needed. Land polygons should not be expected to fill ocean pixels; source coverage is about the acquisition edition/area, not polygon occupancy of the rectangular frame.
5. Build and validate the derived context in a new generation, then atomically promote it only after every check passes. Keep the previous validated generation intact on download, extraction, schema, or coverage failure. Include tests for a truncated archive, missing/duplicate commune keys, malformed geometries, wrong CRS/layer, and a partial/omitted Valognes fixture.

The precise GPKG layer/table names and schema for edition 4.0 were **not confirmed from a downloadable official 4.0 schema document during this research**. Discover these from the archive's GeoPackage metadata in a controlled follow-up (without adopting a CARTO layer), and make validation fail closed if the commune polygon layer cannot be unambiguously identified. Feature counts should be sourced from that same official edition/schema/catalog evidence, not copied from a third-party derived dataset.

## Source dates and remaining uncertainty

Official resource metadata returned `updated=2025-06-12T14:59:00+01:00` for the 2025 edition and `updated=2026-07-01T14:59:00+01:00` for the 2026 edition. The IGN announcement for 2026 was modified 2026-05-22; the product-family metadata is dated 2021 and explicitly version 3.0. All pages/responses were fetched 2026-10-04.

Not established here: full 4.0 internal layer/schema contract, official expected commune-feature count for FXX, exact 4.0 no-generalization language, or reproducibility of the current mutable catalog beyond its dated resource entry. These are validation follow-ups, not blockers to selecting the dated full-France GPKG archive as the candidate acquisition route. No owner decision is required to conclude that this archive is a stronger official candidate than CARTO-PE or an unverified partial WFS response.
