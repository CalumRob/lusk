"""Family-neutral subprocess execution for deterministic territory batches.

Family launchers retain responsibility for plans, worker commands, and validating
their domain-specific outputs; this module owns bounded process lifecycle and
durable log mirroring.
"""
from __future__ import annotations

import re
import subprocess
import threading
from pathlib import Path


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
