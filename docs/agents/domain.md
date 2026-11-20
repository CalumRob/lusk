# Domain Docs

How the engineering skills consume this repo's domain documentation.

## Layout: single-context

```
/
├── CONTEXT.md          the glossary — the project's own vocabulary
├── DESIGN.md           visual source of truth (human-owned)
└── docs/adr/           numbered decisions the code cites
```

There is no `CONTEXT-MAP.md`; do not create one unless this repo ever splits into bounded contexts.

## Before exploring, read these

- **`CONTEXT.md`** at the root. Read the entries for the area you are touching, including their `_Avoid_` lines.
- **`docs/adr/`** — every ADR that touches the area. ADR numbers are cited all over the codebase and the issue tracker; follow them.
- **`AGENTS.md`** — the operational rules: derive facts from contracts, theme-acquisition contract, R/renv and worktree traps, the UI/UX workflow and its detector baseline.

## Use the glossary's vocabulary

`CONTEXT.md` is written in French domain terms and is normative. When output names a domain concept — an issue title, a test name, a refactor proposal, a hypothesis — use the term as defined there, in its original language. `Cellule` is not "variable", `Figure d'atelier` is not "graphique", a `Filtre de population` is not a "scope", and a `Cahier` is not the `Atelier`.

Each entry's `_Avoid_` line lists the synonyms the project has explicitly rejected. Drifting to one of them is a defect in the output, not a stylistic choice.

If the concept you need is not in the glossary, that is a signal: either you are inventing language the project does not use (reconsider), or there is a real gap (note it for `domain-modeling`).

## Decisions and ADRs

- An ADR is warranted when a decision is **hard to reverse**, **surprising without context**, and **the result of a real trade-off**. All three.
- ADRs are numbered sequentially in `docs/adr/`, follow the existing MADR/Nygard shape, and record *why*, including the options that were rejected.
- Record the decision **when it is made** (during grilling), not retroactively when the code lands.
- If your output contradicts an ADR, say so explicitly rather than silently overriding:

  > _Contradicts ADR-0046 (Atelier formulas in the browser) — but worth reopening because…_

## Fact ownership — the rule the ADRs keep circling

AGENTS.md's "derive facts from contracts; own presentation in the app" is the standing rule: numeric values, units, domains, order, eligibility, status, provenance and territory identities come from their producer; headings, copy and presentation live in shared app content/config.

**ADR-0046 is the sole exception**: inside `/atelier`, a reader's `Formule`, population filter and value filters evaluate in the browser over published `Cellule`s. That exception does not extend anywhere else, and Atelier code must never feed a derived value back into a fiche, a Page d'indicateur or a map reading.

## `DESIGN.md` is human-owned

Never let a skill (`/impeccable init`, `/impeccable document`, or any agent) rewrite `DESIGN.md`. Its current staleness is deliberate input to the DESIGN.md v2 campaign (#511), and it is not an authority for the Atelier — the current production cahier pages are.
