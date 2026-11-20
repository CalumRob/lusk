# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues on `CalumRob/lusk`. Use the `gh` CLI from the repo root; it infers the repo from the clone.

## Conventions

- **Create**: `gh issue create --title "..." --body-file <path>`. Prefer a body file over a heredoc — bodies are long and this repo is edited from PowerShell, where quoting is the main failure mode.
- **Read**: `gh issue view <n> --json number,title,state,labels,body`, plus `--comments`.
- **Comment**: `gh issue comment <n> --body-file <path>`.
- **Labels**: `gh issue edit <n> --add-label "..."` / `--remove-label "..."`.
- **Close**: `gh issue close <n> --comment "..."`.

## Hierarchy: spec → tickets

- A **spec** (you may know it as a PRD) is one issue, labelled `enhancement` + `ready-for-agent`.
- Its **tickets** are native GitHub **sub-issues**. Link one with:

  ```bash
  gh api repos/CalumRob/lusk/issues/<parent>/sub_issues -X POST -F sub_issue_id=<child-db-id>
  ```

  `<child-db-id>` is the child's numeric **database id** (`gh api repos/.../issues/<n> --jq .id`), not its `#number` and not its `node_id`.

- A ticket body opens with `## Parent` (the spec), then `## What to build` — the end-to-end behaviour, from the reader's side, never a layer-by-layer plan — then `## Acceptance criteria`, then `## Blocked by`.
- **Blocking edges** are written as `- #<n> — why it gates this ticket` under `## Blocked by`, or `None — can start immediately`. Prose plus a real link; there is no native dependency object in this repo's workflow.
- Publishing tickets never closes, edits or relabels the parent. The parent stays open until its children are accepted.
- Titles and bodies use the project's own vocabulary from `CONTEXT.md`; French domain terms stay French (`Cellule`, `Formule`, `Filtre de population`, `Figure d'atelier`, `Page d'indicateur`, `fiche`, `Cahier`).

## Landing

Two ways in, decided by whether anyone reviews the change — not by size or by mood.

- **Direct to main** — docs, chore, build, one-line config. Nothing that changes runtime behaviour, and never while a worktree may be touching the same files. Commit, `git pull --rebase`, push.
- **Branch + pull request** — everything else, including anything that goes through the review loop. One branch per issue, `issue/<n>-<slug>`, cut from `origin/main`.
- **Rebase onto `origin/main`** before asking for review and again before merging. Conflicts must surface on the branch while it is small, never at the merge button. `git pull --rebase` before every push gives the same safety to direct commits.
- **Land with a merge commit.** The branch name carries the issue, every commit carries `(#<n>)`, and the merge node names the PR — `git log --grep '#<n>'` finds the whole slice with or without the topology. Squash only when the branch genuinely is one change and its commit series carries no information.
- **A worktree owns its branch.** Do not delete the branch at merge time while a worktree is checked out on it; worktree cleanup removes both, and that cleanup is human-only (see `AGENTS.md`).

## Labels

- **Category**: `bug`, `enhancement`, `documentation`.
- **Triage state**: the five in `triage-labels.md`.
- `wayfinder:map` / `wayfinder:task` mark a wayfinding map and its tickets. They are not triage states and do not replace one.

## Pull requests as a triage surface

**PRs as a request surface: no.** A PR here is the delivery surface for a ticket, not an incoming feature request. If that changes, flip this line — `/triage` reads it.

## When a skill says "publish to the issue tracker"

Create a GitHub issue. When the source is an existing spec, create it as a sub-issue of that spec and apply `ready-for-agent` unless instructed otherwise.

## When a skill says "fetch the relevant ticket"

`gh issue view <n> --comments`, then read the spec it names under `## Parent`. Child issues are the work; the parent is the contract.
