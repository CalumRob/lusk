# Lusk — Agent notes

## Agent skills

### Issue tracker

Issues and PRDs live as GitHub issues on `CalumRob/lusk`, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Issues move through the five default triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` at the repo root, ADRs in `docs/adr/`. See `docs/agents/domain.md`.

### R / renv in worktrees (pipeline) — READ BEFORE RUNNING ANY R

The R pipeline (`pipeline/`) uses renv, which stores each project's package library at
`%LOCALAPPDATA%\R\cache\R\renv\library\pipeline-<hash>\...`, keyed by a hash of the project
directory path. A **git worktree is a different path → a different hash → an EMPTY renv library**
(only the tracked `renv/activate.R` + `renv.lock` + `.Rprofile` come with the checkout; the
library itself never does). On R startup renv then prints "None of the packages recorded in the
lockfile are currently installed. Use renv::restore()...". **This is a trap.**

**NEVER run `renv::restore()`, `renv::install()`, `source('renv/activate.R')`, or any `renv::` function from a worktree.** It re-triggers bootstrap/restore against the shared cache, wipes/truncates the worktree library mid-copy, breaks the environment, and can disturb the main checkout's working renv. If a command seems to need renv, STOP and report to the orchestrator instead.

The environment is already live: R's startup `.Rprofile` auto-activates renv, and the packages
resolve from the populated worktree library + the user library. Run tests exactly like this from
`pipeline/` (never activate renv yourself):

```
Rscript -e "testthat::test_local(stop_on_failure = TRUE)"
Rscript -e "Sys.setenv(LUSK_RUN_REAL='1'); testthat::test_local(stop_on_failure = TRUE)"   # real-data block
```

**If the worktree library is genuinely empty** (fresh worktree), populate it by copying the main
checkout's populated library into the worktree's hashed library — never by restoring:

```powershell
# find each side's hash by running Rscript there and reading .libPaths()[1]
# main checkout (E:\Lusk\pipeline)  -> e.g. pipeline-fc1859c3  (57 packages incl. testthat + pkgload)
# worktree (E:\Temp\...\issue-N\pipeline) -> e.g. pipeline-1ae02460
$src = "C:\Users\calum\AppData\Local\R\cache\R\renv\library\pipeline-<MAIN-HASH>\windows\R-4.4\x86_64-w64-mingw32"
$dst = "C:\Users\calum\AppData\Local\R\cache\R\renv\library\pipeline-<WORKTREE-HASH>\windows\R-4.4\x86_64-w64-mingw32"
Copy-Item (Join-Path $src '*') -Destination $dst -Recurse -Force
```

Verify from the worktree before proceeding: `Rscript -e "cat(requireNamespace('dplyr'), requireNamespace('testthat'), requireNamespace('pkgload'))"` → `TRUE TRUE TRUE`.
