# ADR-0046: Atelier — reader formulas computed in the browser, one shared population filter

- **Status:** accepted — product owner, 2026-11-20 (grilling session); implementation tickets to follow
- **Related:** ADR-0033, ADR-0035, ADR-0038, ADR-0040, ADR-0024; CONTEXT.md « Atelier », « Cellule », « Formule », « Filtre de population »

## Context

Lusk's standing rule is that the app never derives facts: R/Parquet computes, the API serves bounded
reads and request-scoped comparison statistics, and the browser renders (AGENTS.md « derive facts
from contracts », CONTEXT.md « Hermétique »). The **Atelier** is a public, expert-register page where
readers plot any published **Cellule** against any other — including e.g. an AEDAR equipment at 20 min
on foot against another at 15 min by bike — and the owner wants them free to combine Cellules
arithmetically. The serving host (Raspberry Pi) is weak.

## Decision

1. **Reader formulas are computed in the browser, on the Atelier only.** A **Formule** is free
   arithmetic over the figure's Cellules (A, B, C…), `+ − × ÷ ^`, constants, and a closed function set
   (`log`, `log10`, `sqrt`, `abs`, `min`, `max`), parsed by a dedicated parser — never `eval`, because
   Atelier URLs come from strangers. This is a scoped exception to the « app never derives » rule: a
   Formule is a reader's computation, labelled by its own expression and marked as computed, never a
   published indicator. It has no unit claim beyond a non-blocking mixed-unit warning, no direction and
   no rank. Missing inputs and division by zero yield « not plotted », counted — never zero.
2. **No Atelier computation moves to the API or the pipeline.** Each Cellule is acquired as a bounded
   cohort read over a whole level through the existing semantic client; population filters, value
   filters and Formules all evaluate client-side, so changing a filter costs no request and excluded
   territories can stay visible as greyed context. Performance is gated empirically: if it is too slow,
   revisit.
3. **One population-filter vocabulary.** Every comparison preset is a **Filtre de population** over
   **Catégories** (densité, littoral…) and **Appartenances** (département, EPCI…). The Atelier evaluates
   the filter in the browser against the published territory reference; the fiche's comparison
   resolver evaluates the same filter server-side. A contract test proves both resolve each preset to
   the same members.
4. **State lives in a compressed, versioned URL.** No write endpoint, account or server storage. Cellules
   are referenced by producer identity and coordinates, never labels. The prototype
   (`prototype/atelier-cell-picker`) measured deflate-raw + base64url links at ~1,000 characters for a
   two-figure page and ~2,100 with 1,500 characters of reader prose — comfortable for a pasted link.

## Considered options

- *No arithmetic, reference lines only* (y = x, medians) — rejected by the owner as leaving too many
  questions out of reach.
- *Bounded operations (difference/ratio, same unit only)* — rejected as too restrictive.
- *Formulas on the API* — rejected: the Pi is weak, and it would turn a read-only bounded API into a
  computation service.
- *Server-side population filtering* — rejected: every filter change would refetch, and the greyed
  context needs the excluded territories anyway.
- *Server short links* — rejected: adds the API's first write path, storage and moderation.

## Consequences

- AGENTS.md carries an explicit, Atelier-only exception; everywhere else the « app never derives » rule
  stands unchanged.
- The API needs a bounded AEDAR cohort read (one Cellule across a level) and a resolver generalised to
  the Filtre de population; the browser territory reference must carry every Catégorie and Appartenance.
- The ≈200,000-unit read-batch budget allows roughly fifty commune-level scalar Cellules per batch.
