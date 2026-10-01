# Variant E presentation foundations

Status: adopted foundation (issue #637); not a declaration that every view or theme has completed visual adoption.

## Decision inventory

| Decision | Evidence | Status |
|---|---|---|
| Gray-green paper, red margin/index accent, reading-led presentation | `app/src/fiche/prototype/VarianteCahierLibre.vue` | Identity approved for rollout. Shared values are `--editorial-paper`, `--editorial-margin`, and related tokens. |
| Semantic typography roles kept independently tunable | `app/src/styles/tokens.css` | Existing roles retained; wordmark remains Newsreader and global header/navigation retain separate roles. |
| Figure label/legend/value grammar | `app/src/fiche/prototype/cahierFigure.css` and figure components | Observed reusable grammar; family-specific marks remain local. |
| Hand-drawn rank outlines and experimental map treatments | `CahierRank.vue`, map prototype | Observed, provisional/specialized; not approved as universal requirements. |
| Exact spread widths, pagination treatments, and future readings | E prototype | Provisional and composition-specific; not promoted as universal rules. |

The shared token layer and `.presentation-editorial` scope are consumed by the existing territory subgroup surface and normal indicator page. The scope shares visual values only; the territory remains metadata-driven and the indicator retains its existing family dispatch and exploration behavior. No content, API, data, or semantic contract changes are part of this foundation.

## Adoption boundary

| Surface | Foundation status |
|---|---|
| Existing E Mobilité prototype and production territory subgroup + normal indicator route | Shared foundation available/consumed; this ticket does not complete rollout composition. |
| Other territory themes, remaining indicator family details, catalogue, header and sources | Pending their scoped adoption/review; shared tokens are available. |

`DESIGN.md` is human-owned but is absent from the reviewed implementation base (`813903e9`). This inventory records the owner-approved identity and distinguishes provisional observations without fabricating or replacing that missing design document. Reconcile/adopt its standards when the human-owned document is restored in the integration checkout.
