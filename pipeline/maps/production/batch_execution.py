"""Family-neutral subprocess execution for deterministic territory batches.

Family launchers retain responsibility for plans, worker commands, and validating
their domain-specific outputs; this module owns bounded process lifecycle and
durable log mirroring.
"""
from __future__ import annotations

import re
import shutil
import subprocess
import threading
from pathlib import Path


def partition_territories(territories, worker_count, cost):
    """Greedy LPT allocation; each input territory is assigned exactly once."""
    if worker_count not in (1, 2, 4):
        raise ValueError("Worker count must be 1, 2 or 4")
    weighted = [(float(cost(row)), index) for index, row in enumerate(territories)]
    if any(weight < 0 for weight, _ in weighted):
        raise ValueError("Territory costs must be nonnegative")
    shards, totals = [[] for _ in range(worker_count)], [0.0] * worker_count
    for weight, index in sorted(weighted, reverse=True):
        shard = min(range(worker_count), key=totals.__getitem__)
        shards[shard].append(index)
        totals[shard] += weight
    return [sorted(shard) for shard in shards]


def prepare_worker_layout(output_dir, worker_count, seed_cache, seed_source):
    """Create disjoint mutable shard/cache/source paths and copy immutable seeds."""
    output = Path(output_dir)
    seed_cache, seed_source = Path(seed_cache), Path(seed_source)
    layout = []
    for index in range(worker_count):
        cache, source = output / f"cache-{index}", output / f"source-{index}"
        shard = output / f"shard-{index}"
        cache.mkdir(parents=True, exist_ok=True)
        shutil.copytree(seed_cache, cache, dirs_exist_ok=True)
        shutil.copytree(seed_source, source, dirs_exist_ok=True)
        shard.mkdir(parents=True, exist_ok=True)
        layout.append({"cache": cache, "source": source, "shard": shard})
    return layout


def run_workers(commands, output_dir, expected_artifacts, *, write_json, log,
                log_lock=None):
    """Run preplanned child commands, mirror progress, and preserve failures.

    Each command must already assign private mutable paths to its child.  The
    executor does not interpret family facts or alter a family's checkpoint.
    """
    output_dir = Path(output_dir)
    lock = log_lock or threading.RLock()
    write_json(output_dir / "progress.json", {"status": "starting",
        "completed_webps": 0, "expected_webps": expected_artifacts, "by_worker": {}})
    processes, mirrors, completed = [], [], {}
    progress_pattern = re.compile(r"\[maps\]\s+(\d+)/(\d+)\s")
    try:
        for index, item in enumerate(commands):
            command, env = item if isinstance(item, tuple) else (item, None)
            worker_log = output_dir / f"worker-{index}.log"
            process = subprocess.Popen(command, stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                errors="replace", bufsize=1, env=env)
            processes.append(process)

            def mirror(proc=process, destination=worker_log, worker=index):
                with destination.open("a", encoding="utf-8") as stream:
                    for line in proc.stdout:
                        stream.write(line)
                        stream.flush()
                        log(output_dir / "run.log", f"worker-{worker}: {line.rstrip()}")
                        match = progress_pattern.search(line)
                        if match:
                            with lock:
                                completed[worker] = int(match.group(1))
                                current = {"status": "rendering",
                                    "completed_webps": sum(completed.values()),
                                    "expected_webps": expected_artifacts,
                                    "by_worker": dict(completed)}
                                write_json(output_dir / "progress.json", current)
                                write_json(output_dir / f"worker-{worker}.progress.json",
                                    {"status": "rendering", "completed_webps": int(match.group(1)),
                                     "expected_webps": int(match.group(2))})
                                if int(match.group(1)) % 25 == 0 or match.group(1) == match.group(2):
                                    log(output_dir / "run.log", f"TOTAL {current['completed_webps']}/"
                                        f"{expected_artifacts} validated WebPs")
            thread = threading.Thread(target=mirror, daemon=True)
            thread.start()
            mirrors.append(thread)
        codes = [process.wait() for process in processes]
    except BaseException:
        for process in processes:
            if process.poll() is None:
                process.terminate()
        for process in processes:
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        raise
    finally:
        for thread in mirrors:
            thread.join()
        for process in processes:
            if process.stdout:
                process.stdout.close()
    if any(codes):
        raise RuntimeError(f"Worker failure codes={codes}; completed artifacts are preserved for resume")
