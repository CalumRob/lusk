# AEDAR source fixtures

`aedar-region-2026v1-typequ.csv` is an independent test axis extracted from
the producer's `aggregates_region_53-2026v1.parquet`, retaining only
`TYPEQU` and `LIB_TYPEQU`. Its SHA-1 matches the pinned AEDAR source checksum
`c0e080c110de68a0dcddaad0e20a4a001c46965f`; the source Parquet SHA-256 is
`86a8c67d01ca0a6eba4969f1a1f515e9deb200f4f7cfbef2e9026f18de3dc090`.

This fixture intentionally remains separate from the vendored
`pipeline/inst/extdata/aedar-typequ-2025.csv` registry. Tests use the producer
axis to build source-shaped publication facts and verify that the pinned BPE
nomenclature independently matches it.
