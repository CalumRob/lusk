"""Prepare or verify persistent network-source caches without rendering maps."""
import argparse
from pathlib import Path

from qgis.core import QgsApplication

from network import prepare_network_cache


def main() -> int:
    repository = Path(__file__).resolve().parents[3]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--raw-dir",
        type=Path,
        default=repository / "pipeline" / "data" / "raw",
        help="directory containing the authoritative OSM and Geovelo sources",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        help="override the default pipeline/maps/.cache/network-sources directory",
    )
    parser.add_argument(
        "--family",
        choices=("osm", "geovelo"),
        action="append",
        dest="families",
        help="prepare only this family; may be repeated (default: both)",
    )
    args = parser.parse_args()

    application = QgsApplication([], False)
    application.initQgis()
    try:
        prepared = prepare_network_cache(
            args.raw_dir,
            cache_root=args.cache_dir,
            families=tuple(args.families or ("osm", "geovelo")),
        )
        for family, artifacts in prepared.items():
            for name, path in artifacts.items():
                print(f"[network-prep] ready {family}/{name}: {path}", flush=True)
    finally:
        application.exitQgis()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
