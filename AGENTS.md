# Lusk — Agent notes

## Agent skills

### Issue tracker

Issues and PRDs live as GitHub issues on `CalumRob/lusk`, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Issues move through the five default triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` at the repo root, ADRs in `docs/adr/`. See `docs/agents/domain.md`.

### UI/UX workflow (impeccable + intent) — READ BEFORE ANY UI WORK ON `app/`

`.opencode/skills/` holds **impeccable** (design craft + a deterministic anti-slop detector) and five
**intent** skills (`intent`, `include`, `fortify`, `articulate`, `evaluate`). They are deliberately
UNTRACKED — the whitelist `.gitignore` keeps them out of the repo; never commit them. Refresh via
`npx impeccable install --providers=opencode --scope=project`, and selective copy from `ghaida/intent`.

Layers, cheapest first:

1. **Always-on, zero tokens.** `npx impeccable detect app/src` (~1 s warm). MUST come back clean
   before any PR touching `app/` UI. Workers get this as a dispatch-brief line; reviewers run it
   scoped to the diff. It parses `.vue` SFCs natively.
2. **Design standards + review.** Root `DESIGN.md` is the single source of truth for visual
   decisions; `/code-review`'s Standards axis cites it plus detector findings. `code-review` runs on
   EVERY UI-touching merge — orchestrator's job during wave review, not ad hoc.
   **`DESIGN.md` is human-owned:** never let `/impeccable init` or `/impeccable document` write over
   it. Pre-campaign backup: `E:\Temp\opencode\lusk-DESIGN-v1-backup.md`.
3. **Expensive craft passes.** Orchestrator session ONLY — never workers, no standing agent. One
   scoped `/impeccable critique <surface>` when an issue ships a genuinely NEW screen/tab/surface;
   otherwise on demand only.

Intent usage policy — *enforce-in-docs, method-as-skills*: intent skills are invoked at milestones
by the orchestrator, never standing. `fortify` = edge-state inventory → issue generator;
`include` = accessibility / RGAA; `articulate` = UX copy; `evaluate` = reserved for the
DESIGN.md v2 audit (#511). Mechanically checkable rules get vendored into repo docs so code-review
can cite them; method depth stays in the skills. No intent personas/subagents.

**Known baseline:** 10 detector findings on current code (mostly `[side-tab]` theme accent lines)
are deliberately NOT ignore-listed — they open the evidence base of the DESIGN.md v2 campaign (#511).

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
```

(La vérification « données réelles » ne passe plus par une variable d'environnement :
elle vit dans le graphe targets, pilotée par ses entrées — `pipeline/_targets.R`,
verrous `verif_*`, issue #342.)

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

### Data + worktrees (pipeline) — READ BEFORE ANY WORKTREE OPERATION

The real data lives ONLY in the main checkout: `E:\Lusk\pipeline\data\raw` (the ~14 GB download
cache) and `data/processed` (regenerated intermediates). Both are gitignored — a worktree
checkout NEVER contains them.

**NEVER create a junction/symlink from a worktree's `pipeline/data` to the main checkout's data.**
On Windows, recursive deletes — notably `git worktree remove`, but also `rm -rf` and
`Remove-Item -Recurse` — FOLLOW junctions and wipe the TARGET. This has happened twice and each
time destroyed the full ~14 GB cache + intermediates, forcing hours of re-download. There is no
safe junction; do not "test" one.

A worktree that needs real data gets its OWN COPY — deleting the worktree then only deletes the
copy:

```powershell
robocopy E:\Lusk\pipeline\data <worktree>\pipeline\data /E /MT:16 /NFL /NDL /NJH /NJS
```

(~2–5 min for the full cache on NVMe; disk cost ≈14 GB per copy. `data/` is gitignored, so the
copy never pollutes git.)

**Before ANY `git worktree remove`** (orchestrator OR worker), run the guard — it scans the
worktree for junctions/symlinks pointing outside it and exits 1 (abort) if any exist:

```powershell
powershell -File scripts/guard-worktree-remove.ps1 <worktree-path>
```

`git worktree remove` is FORBIDDEN when the guard fails. Remove the links first
(`Remove-Item -LiteralPath '<lien>' -Force` — never `-Recurse`, which would follow the link).

As a last line of defence, `pipeline/data` is ACL-protected against deletion
(`scripts/set-data-acl.ps1`). Trade-off: `download_sources`' corrupt-file replacement (an
`unlink`) fails loudly under the lock — acceptable (loud failure > silent 14 GB wipe). To
replace a corrupt file or deliberately clear the cache, remove the lock first with
`powershell -File scripts/set-data-acl.ps1 -Remove`, do the operation, then re-apply
`powershell -File scripts/set-data-acl.ps1`.
