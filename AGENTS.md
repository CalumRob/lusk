# Lusk — Agent notes

## Agent skills

### Issue tracker

Issues and PRDs live as GitHub issues on `CalumRob/lusk`, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Issues move through the five default triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` at the repo root, ADRs in `docs/adr/`. See `docs/agents/domain.md`.

### PostgreSQL integration tests

Before running database-backed API tests, read `api/tests/integration/README.md` for the guarded
test-only database, dedicated roles, and private passfile setup. The persistent target is
`lusk_it_contract`; per-run random schemas are disposable. Never point tests at the serving
database `lusk` or copy credentials into the repository.

### UI/UX workflow (impeccable + intent) — READ BEFORE ANY UI WORK ON `app/`

`.opencode/skills/` holds **impeccable** (design craft + a deterministic anti-slop detector) and five
**intent** skills (`intent`, `include`, `fortify`, `articulate`, `evaluate`). They are deliberately
UNTRACKED — the whitelist `.gitignore` keeps them out of the repo; never commit them. Refresh via
`npx impeccable install --providers=opencode --scope=project`, and selective copy from `ghaida/intent`.

Layers, cheapest first:

1. **Always-on, zero tokens.** `npm --prefix app run verify:detector` (~1 s warm), which pins
   `npx --yes impeccable@4.9.2 detect app/src`. The 11 findings below are **known debt** recorded
   for the DESIGN.md v2 campaign (#511), not a clean result and not an acceptance waiver. A scan
   is clean only when it reports **exactly those 11** (same file/rule/line) and no new finding;
   a raw zero means the wrong engine ran. Pinning matters: `4.10.0` retired the `[side-tab]` regex
   rule and reports 0, so an unpinned `npx impeccable detect` silently contradicts this baseline.
   Workers get this as a dispatch-brief line; reviewers run it scoped to the diff. It parses `.vue`
   SFCs natively.
2. **Design standards + review.** Root `DESIGN.md` is the single source of truth for visual
   decisions; `/code-review`'s Standards axis cites it plus detector findings. `code-review` runs on
   EVERY UI-touching merge — orchestrator's job during wave review, not ad hoc.
   **`DESIGN.md` is human-owned:** never let `/impeccable init` or `/impeccable document` write over
   it. Pre-campaign backup: `E:\Temp\opencode\lusk-DESIGN-v1-backup.md`.
3. **Expensive craft passes.** Orchestrator session ONLY — never workers, no standing agent. One
   scoped `/impeccable critique <surface>` when an issue ships a genuinely NEW screen/tab/surface;
   otherwise on demand only.
4. **Visual gate before merge (any ticket that creates or changes a visible surface).** The detector
   scans *source*, not what renders. The orchestrator screenshots the surface at **desktop and phone**
   widths and compares it with the reference named in the issue's acceptance criteria before merge —
   e.g. the Atelier against the production Mobilité cahier
   (`/territoire/commune/35238?theme=mobilite`), not against an ordinary fiche. A structural test or a
   green detector is not evidence that the rendered page matches the reference; the recorded
   before/after receipts are. For a ticket that must leave a surface pixel-identical, capture both
   before and after against the same fixture and report any difference that cannot be justified.

Intent usage policy — *enforce-in-docs, method-as-skills*: intent skills are invoked at milestones
by the orchestrator, never standing. `fortify` = edge-state inventory → issue generator;
`include` = accessibility / RGAA; `articulate` = UX copy; `evaluate` = reserved for the
DESIGN.md v2 audit (#511). Mechanically checkable rules get vendored into repo docs so code-review
can cite them; method depth stays in the skills. No intent personas/subagents.

**Known baseline:** 11 detector findings on current code (mostly `[side-tab]` theme accent lines)
are deliberately NOT ignore-listed — they open the evidence base of the DESIGN.md v2 campaign (#511).
Count verified 2026-11-02 (#873 receipts): the 11 findings span 8 files and are byte-identical to the
`12d18315` base by file/rule/line. **Reproduce with `npm --prefix app run verify:detector`**
(`npx --yes impeccable@4.9.2 detect app/src`) — verified 2026-11-19 to report exactly
`11 anti-patterns found.` The `4.9.x` line (4.9.0/4.9.1/4.9.2) all report 11; `4.10.0` retired the
`[side-tab]` regex rule and reports 0, so it is NOT the baseline engine and must not be used for
this gate. These 11 are **known design debt**, not a waiver: a scan is clean only when it reports
exactly these 11 (no new file/rule/line), and the debt remains open for the #511 campaign until an
owner actually resolves it. The default engine pass scans `.css`/`.mjs`/`.ts`/`.vue` with regex rules
only (rendered/element rules are not exercised by that pass).

### General implementation rule — derive facts from contracts; own presentation in the app

- Stable presentation/editorial choices belong in the appropriate shared app content/config layer:
  headings, explanatory copy, display labels, page/subgroup organisation, and figure presentation.
  Ordinary wording or organisation changes do not require R publication, generated presentation
  metadata, hashes/global release versions, or a new metadata API/framework. Keep these choices out
  of scattered renderer literals and do not duplicate factual semantics in them.
- Do not hardcode domain facts or derived policy: numeric values, units/scales, actual axis domains or
  order, eligibility/facets/direction, status, provenance, source observation dates, or territory
  identities and relationships. Bind app-owned content to the actual producer/API identities and
  consume those facts and semantics from their source of truth.
- Before adding a domain-looking literal, identify whether it is stable app presentation or a fact
  owned upstream, and put it in that owner's layer. Add or update a contract test proving factual
  consumers use the source contract rather than silently duplicating it.
- **Sole exception — the Atelier (`/atelier`, ADR-0046):** reader-written **Formules**, population
  filters and value filters are evaluated in the browser over published Cellules. A Formule is the
  reader's computation (labelled by its expression, marked computed, no direction/rank, missing ⇒
  not plotted and counted, never zero), not a published fact. The exception does not extend to any
  other surface, and Atelier code must not feed derived values back into fiche, indicator-page or
  map readings.

### Theme acquisition contract

- Every added indicator or theme ships through the registered theme-acquisition path (or an owner-owned acquisition path such as the Mobilité prototype E flow).
- Since #868 the API path is the ONLY mode: `VITE_THEME_ACQUISITION_API='0'` and its callers are retired; rollback is previous-release/manual recovery, not a second numerical browser runtime.
- Keep the acquisition registry complete against `THEMES_CANONIQUES`; its contract test must fail when a canonical theme is omitted.
- Domain vocabulary and owner decisions for this mode live in `CONTEXT.md` — « Acquisition par thème » (anciennement « Acquisition paresseuse par thème »).

### App tests (`app/`) — how to run them

- `npm test` = the `unit` Vitest project: happy-dom only, **no real browser**, no Playwright/Chromium
  import reachable. Config lives in `app/vitest.config.ts` (never in `vite.config.ts`).
- During iteration run filtered: `npx vitest run --project unit <file-or-regex>`. Run the full
  `npm test` **once, before handoff** — not after every edit.
- `npm run test:browser` = the `browser` project (`*.browser.spec.ts`): the Cahier PDF specs that need a
  real layout engine. It starts ONE Chromium and ONE Vite bundle for the whole run
  (`src/__tests__/browser/globalSetup.ts`); spec files reach it through a loopback bridge and never
  launch a browser. Needs Chrome (`LUSK_CHROME_PATH` or the system install). Run it **only** when
  touching the Cahier PDF composer / native paint / DOM painter, or `cahierPdf*` test helpers —
  and before merging such a ticket. It is not part of `npm test`.
- A spec that needs real layout is named `*.browser.spec.ts`; do not add Chromium to the unit project.
- `npm ci` first on a fresh checkout/worktree (missing `jspdf` / `pdfjs-dist` breaks module loading).
  `node_modules` must be a real directory per checkout — never a junction to another checkout.

### R / renv in worktrees (pipeline) — READ BEFORE RUNNING ANY R

The R pipeline (`pipeline/`) uses renv, which stores each project's package library at
`%LOCALAPPDATA%\R\cache\R\renv\library\pipeline-<hash>\...`, keyed by a hash of the project
directory path. A **git worktree is a different path → a different hash → an EMPTY renv library**
(only the tracked `renv/activate.R` + `renv.lock` + `.Rprofile` come with the checkout; the
library itself never does). On R startup renv then prints "None of the packages recorded in the
lockfile are currently installed. Use renv::restore()...". **This is a trap.**

**NEVER run `renv::restore()`, `renv::install()`, `source('renv/activate.R')`, or any `renv::` function from a worktree.** It re-triggers bootstrap/restore against the shared cache, wipes/truncates the worktree library mid-copy, breaks the environment, and can disturb the main checkout's working renv. If a command seems to need renv, STOP and report to the orchestrator instead.

The environment is already live: R's startup `.Rprofile` auto-activates renv, and the packages
resolve from the populated worktree library + the user library. Run R commands from `pipeline/`
(never activate renv yourself). Keep three verification loops distinct:

```
# During iteration: filter to the affected test files (the value is a regex).
Rscript -e "testthat::test_local(filter = 'distribution-acces-batiments|modeles-lecture', stop_on_failure = TRUE)"

# Before handoff: the complete default fixture suite.
Rscript -e "testthat::test_local(stop_on_failure = TRUE)"

# Slow parity audit: run for targets/orchestration changes or before a release.
Rscript scripts/verify-targets-byte-identical.R
```

The byte-identical parity audit lives under `pipeline/slow-tests/`, outside the default
testthat suite. It cold-builds each theme and the full graph against `run_pipeline()` and can take
many minutes with the real cache; it intentionally clears the local `_targets/` store between
comparisons. Without `data/raw`, the explicit command skips its two parity tests. Use an isolated
worktree with its own data copy for a real-data run; never link the main checkout's data.

This audit is separate from the real-data verification locks: those remain input-driven `verif_*`
targets in `_targets.R` and need no environment-variable opt-in (issue #342). Do not reintroduce
`LUSK_RUN_REAL` for those checks.

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

**Do not create symlinks, junctions, hard links, or other reparse points inside or pointing into
a worker worktree, including via setup scripts.** This is not limited to `pipeline/data`. On
Windows, recursive cleanup has followed junctions and destroyed the real cache. If you find a
junction or symlink, or a setup step requires one, stop and report it; do not unlink it yourself.

A worktree that needs real data gets its OWN COPY — deleting the worktree then only deletes the
copy:

```powershell
robocopy E:\Lusk\pipeline\data <worktree>\pipeline\data /E /MT:16 /NFL /NDL /NJH /NJS
```

(~2–5 min for the full cache on NVMe; disk cost ≈14 GB per copy. `data/` is gitignored, so the
copy never pollutes git.)

**Worktree removal is human-only.** Workers and orchestrators must never remove, unlink,
prune, or force-delete a worktree, including through an API or delegated tool. After merge,
report `BLOCKED — manual worktree cleanup required` with the exact paths. Do not advance to
the next wave or follow-on implementation until the user has removed those worktrees and a
read-only check confirms they are gone from both the filesystem and `git worktree list
--porcelain`. If a check fails or the two disagree, stay blocked. Failed and unmerged worktrees
remain intact for review. The existing guard's success message alone is not clearance to delete.

As a last line of defence, `pipeline/data` is ACL-protected against deletion
(`scripts/set-data-acl.ps1`). Trade-off: `download_sources`' corrupt-file replacement (an
`unlink`) fails loudly under the lock — acceptable (loud failure > silent 14 GB wipe). To
replace a corrupt file or deliberately clear the cache, remove the lock first with
`powershell -File scripts/set-data-acl.ps1 -Remove`, do the operation, then re-apply
`powershell -File scripts/set-data-acl.ps1`.
