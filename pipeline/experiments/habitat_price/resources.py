"""Hard resource bounds for the prototype run.

The experiment must never starve the workstation it runs on. This module

* lowers the process priority,
* pins BLAS/OpenMP thread pools to a small budget,
* caps the Python heap with ``RLIMIT_AS`` where the platform supports it,
* and polls resident memory, aborting loudly instead of swapping.

A watchdog thread raises ``MemoryBudgetExceeded`` once the process RSS passes
the budget, so a runaway allocation fails fast and visibly.
"""
from __future__ import annotations

import os
import sys
import threading
import time

import psutil

# Conservative defaults: 16 logical CPUs / 32 GB on the reference workstation.
CPU_THREADS = int(os.environ.get("HABITAT_PRICE_THREADS", "4"))
MEMORY_BUDGET_GB = float(os.environ.get("HABITAT_PRICE_MEMORY_GB", "6"))
POLL_SECONDS = 2.0


class MemoryBudgetExceeded(RuntimeError):
    pass


def apply() -> dict:
    """Apply the bounds once; safe to call repeatedly."""
    for variable in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS",
                     "NUMEXPR_NUM_THREADS", "VECLIB_MAXIMUM_THREADS"):
        os.environ[variable] = str(CPU_THREADS)
    process = psutil.Process()
    try:
        process.nice(psutil.BELOW_NORMAL_PRIORITY_CLASS)
    except (AttributeError, psutil.Error):
        pass
    budget = int(MEMORY_BUDGET_GB * 1024 ** 3)
    if hasattr(os, "RLIMIT_AS") and sys.platform != "win32":
        import resource
        soft, hard = resource.getrlimit(resource.RLIMIT_AS)
        limit = budget if hard == resource.RLIM_INFINITY else min(budget, hard)
        resource.setrlimit(resource.RLIMIT_AS, (limit, hard))

    def watch() -> None:
        # A daemon thread cannot raise into the main thread, so the watchdog
        # ends the process: a runaway allocation must fail loudly and fast
        # instead of driving the workstation into swap.
        while True:
            rss = process.memory_info().rss
            if rss > budget:
                message = (f"RSS {rss / 1024 ** 3:.2f} GB over budget "
                           f"{MEMORY_BUDGET_GB:.1f} GB")
                print(f"[resources] ABORT: {message}", flush=True)
                os._exit(97)
            time.sleep(POLL_SECONDS)

    thread = threading.Thread(target=watch, name="memory-budget", daemon=True)
    thread.start()
    return {"cpu_threads": CPU_THREADS, "memory_budget_gb": MEMORY_BUDGET_GB}


def rss_gb() -> float:
    return psutil.Process().memory_info().rss / 1024 ** 3
