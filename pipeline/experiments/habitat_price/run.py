"""One-command entry point for the issue-736 Habitat price prototype.

Usage (from the repository root, with the isolated prototype environment):

    python -m pipeline.experiments.habitat_price.run --stage all

Stages: ``cohort`` (native cohort + context), ``model`` (fit/evaluate),
``decompose`` (grouped attribution), ``report`` (sanitised evidence).
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

if __package__ in (None, ""):  # allow ``python run.py`` from the folder
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    __package__ = "habitat_price"
elif __package__ != "habitat_price":
    # ``python -m pipeline.experiments.habitat_price.run``: the stage modules
    # import each other as ``habitat_price.*``, so expose that name too.
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from habitat_price import config, resources  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", default="all",
                        choices=["cohort", "model", "decompose", "report", "all"])
    parser.add_argument("--force", action="store_true",
                        help="recompute cached private extracts")
    args = parser.parse_args(argv)

    bounds = resources.apply()
    print(f"[run] bounds {bounds}", flush=True)
    started = time.time()
    timings = {}

    if args.stage in ("cohort", "all"):
        from habitat_price import stage1_cohort
        timings["cohort"] = stage1_cohort.run(force=args.force)
    if args.stage in ("model", "all"):
        from habitat_price import stage2_model
        timings["model"] = stage2_model.run()
    if args.stage in ("decompose", "all"):
        from habitat_price import stage3_decompose
        timings["decompose"] = stage3_decompose.run()
    if args.stage in ("report", "all"):
        from habitat_price import stage4_report
        timings["report"] = stage4_report.run()

    timings["total_wall_seconds"] = round(time.time() - started, 1)
    timings["peak_rss_gb"] = round(resources.rss_gb(), 2)
    print(json.dumps(timings, indent=2, default=str), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
