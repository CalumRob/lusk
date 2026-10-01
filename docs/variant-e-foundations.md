# Variant E presentation foundations

Status: adopted foundation (issue #637); not a declaration that every view or theme has completed visual adoption.

## Decision inventory

| Decision | Evidence | Status |
|---|---|---|
| Gray-green paper, red margin/index accent, reading-led presentation | `app/src/fiche/prototype/VarianteCahierLibre.vue`; `DESIGN.md` §1 and §7 | Identity adopted as the rollout direction, not proof every surface is implemented or reviewed. Shared values are `--editorial-paper`, `--editorial-margin`, and related tokens. |
| Semantic typography roles kept independently tunable | `app/src/styles/tokens.css`; approved role mapping #618/#626 | Preserve semantic roles and current assignments: wordmark = Newsreader; display/subsection titles = Mozilla Headline; body/narrative/UI/global header/theme tabs/figure labels = Mozilla Text; body emphasis, metadata, figure values/comparison = Fira Code. Global header remains independently tunable from UI and theme tabs. |
| Figure label/legend/value grammar | `app/src/fiche/prototype/cahierFigure.css` and figure components | Observed reusable grammar; family-specific marks remain local. |
| Hand-drawn rank outlines and experimental map treatments | `CahierRank.vue`, map prototype | Observed, provisional/specialized; not approved as universal requirements. |
| Exact spread widths, pagination treatments, and future readings | E prototype | Provisional and composition-specific; not promoted as universal rules. |

The shared token layer and `.presentation-editorial` scope are consumed by the existing territory subgroup surface and normal indicator page. The scope shares visual values only; the territory remains metadata-driven and the indicator retains its existing family dispatch and exploration behavior. No content, API, data, or semantic contract changes are part of this foundation. Detailed rollout ownership and limits are recorded in `DESIGN.md` §1 and §3.

## Adoption boundary

| Surface | Foundation status |
|---|---|
| Existing E Mobilité prototype and production territory subgroup + normal indicator route | Foundation available/consumed; not complete rollout composition or final design validation. |
| Remaining territory themes and indicator views/families | Pending scoped adoption and review (#638–#640); shared tokens do not establish composed adoption. |
| Catalogue, header, sources, and other site surfaces | Site-wide foundation is documented; surface-specific adoption/review remains pending where listed in `DESIGN.md` §1. |

Related work: #511 (design evidence campaign), #528 (territory product rebuild), #636 (typography roles), and #637 (shared foundations). This inventory supplements—not replaces—the human-owned `DESIGN.md`, which records adopted direction, current contracts, provisional observations, and pending adoption without claiming the wider campaigns are complete.
