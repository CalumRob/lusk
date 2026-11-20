# Triage Labels

The skills speak in five canonical triage roles. This repo uses the default strings, so no mapping is needed — the role name *is* the label.

| Label in mattpocock/skills | Label in this tracker | Meaning |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | Maintainer needs to evaluate this issue |
| `needs-info` | `needs-info` | Waiting on the reporter for more information |
| `ready-for-agent` | `ready-for-agent` | Fully specified; an AFK agent can pick it up |
| `ready-for-human` | `ready-for-human` | Needs a human's judgement, credentials or hands |
| `wontfix` | `wontfix` | Will not be actioned |

## How this repo uses them

- An issue carries **one category** (`bug`, `enhancement`, `documentation`) and **one triage state** from the table. Both, not either.
- `ready-for-agent` is a claim about specification, not difficulty: the body must state the end-to-end behaviour and its acceptance criteria before it gets this label. Tickets published from a spec are agent-grabbable by construction and are labelled on creation.
- `ready-for-human` covers anything requiring the operator: publishing to the serving database, real-data audits, the `pg_dump`/write steps in a guarded publication, or a decision the owner has not made.
- Work that depends on an unmerged ticket is **not** triaged differently; it stays `ready-for-agent` and carries its `## Blocked by` edge. The frontier decides what runs, not the label.
- `wayfinder:map` and `wayfinder:task` are wayfinding markers, not triage states.

Replace the right-hand column only if the tracker's vocabulary ever diverges from these strings.
