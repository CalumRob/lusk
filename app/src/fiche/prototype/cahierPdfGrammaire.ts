/**
 * Approved document grammar of the shared Cahier PDF (#1024 / PRD #1014).
 *
 * Two owners are kept separate:
 *
 * 1. **Role/layout grammar** comes from the app's own CSS owners and from the
 *    approved prototype generator (`desktop.js`, `comparisonHeadingMockup.js`):
 *    a role's family, weight, tracking, colour and the px rhythm between its
 *    blocks.
 * 2. **Physical reading scale** is the approved A4 projection of that grammar.
 *    The prototype rendered the desktop column into the approved page box:
 *    32 pt insets → 531.28 pt content width for a 1010.4 px desktop column, i.e.
 *    `531.28 / 1010.4 = 0.5258083073` pt per CSS px. The approved artifacts
 *    (R1–R3) confirm each role at that scale (page heading 38.4 px → 20.19 pt,
 *    figure title 15 px → 7.89 pt, table value 13 px → 6.84 pt, tick 11 px →
 *    5.78 pt, source stamp 10 px → 5.26 pt).
 *
 * The comparison names are the one owner-fixed exception: PRD #1014 approved a
 * **fixed 18 px CSS** (2026-11-15). At the owner's fixed CSS-to-point mapping
 * that is 13.5 pt, which is the size the previous acceptance recorded. The
 * prototype's uniform 0.5258 render emitted 9.46 pt; that is a property of
 * that throwaway render, not permission to shrink the approved names. The
 * composer therefore never derives the comparison size from the scale below.
 *
 * Nothing here is a second palette or a copied PDF template: sizes are CSS
 * role sizes × the approved reading scale, and spacing is the same source px
 * rhythm (24 / 20 / 12 / 10 / 8 px) consumed by the painter.
 */
import { POLICE_PDF } from './cahierPdfFonts'

/** Approved A4 projection: 531.28 pt of content for a 1010.4 px desktop column. */
export const ECHELLE_LECTURE_CSS_PX = 531.28 / 1010.4

/** The owner's fixed CSS-px → pt mapping for the approved 18 px comparison names. */
export const PT_PAR_CSS_PX_FIXE = 0.75

export const PX_COMPARAISON = 18
export const TAILLE_COMPARAISON_PT = PX_COMPARAISON * PT_PAR_CSS_PX_FIXE

export function ptDepuisCssPx(px: number): number {
  return px * ECHELLE_LECTURE_CSS_PX
}

export function mmDepuisPt(pt: number): number {
  return pt * 25.4 / 72
}

export function mmDepuisCssPx(px: number): number {
  return mmDepuisPt(ptDepuisCssPx(px))
}

/** Pointer size of an `em`-relative tracking/offset, in points. */
export function emDepuisTaille(taillePt: number, em: number): number {
  return taillePt * em
}

/**
 * The approved page box (points), measured on R1–R3 and set by `desktop.js`:
 * `left = 32, top = 72, bottom = 46`, header painted at `y = 24`.
 */
export const PAGE_APPROUVEE = {
  largeurPt: 595.28,
  hauteurPt: 841.89,
  insetGauchePt: 32,
  insetDroitPt: 32,
  hautContenuPt: 72,
  basContenuPt: 46,
  hautEnTetePt: 24,
  filetEnTetePt: 51,
  /** `.cahier--sans-grille .concept-group` + `--cahier-unit-padding`. */
  paddingSectionPx: 13,
  largeurUtilePt: 595.28 - 32 - 32,
} as const

/** Horizontal inset of the section body inside its own surface border. */
export const PADDING_SECTION_PT = ptDepuisCssPx(PAGE_APPROUVEE.paddingSectionPx)
export const LARGEUR_CORPS_PT = PAGE_APPROUVEE.largeurUtilePt - 2 * PADDING_SECTION_PT

/**
 * Typographic roles. Every size is the role's CSS size at the approved reading
 * scale (except the owner-fixed comparison names). Colours are resolved through
 * `PALETTE_PDF` by the painters, never duplicated here.
 */
export const ROLE_PDF = {
  /** `.page-heading h2` → `--text-page-heading` + `--text-page-heading-tracking`. */
  titrePage: {
    police: POLICE_PDF.display,
    taille: ptDepuisCssPx(38.4),
    espacementEm: -0.035,
  },
  /** Section territory: `--text-page-heading` + `--text-overline-tracking`. */
  identite: {
    police: POLICE_PDF.display,
    taille: ptDepuisCssPx(38.4),
    espacementEm: 0.08,
  },
  /** Owner-fixed comparison names (18 px CSS), same face/weight/tracking as focal. */
  comparaisonNom: {
    police: POLICE_PDF.display,
    taille: TAILLE_COMPARAISON_PT,
    espacementEm: 0.08,
  },
  /** `--type-figure-legend` at weight 400, as in the approved subtitle mockup. */
  comparaisonPrefixe: {
    police: POLICE_PDF.body,
    taille: ptDepuisCssPx(13),
    espacementEm: 0,
  },
  /** `.page-heading-territory` (indexed Cahier): 600 / 16 px / `--accent-primary`. */
  territoireEntete: {
    police: POLICE_PDF.bodyStrong,
    taille: ptDepuisCssPx(16),
    espacementEm: 0,
  },
  /** `.cahier-marque`: 600 italic wordmark, `--text-primary`, -0.01em. */
  marqueMot: {
    police: POLICE_PDF.wordmark,
    taille: ptDepuisCssPx(22),
    espacementEm: -0.01,
  },
  /** `--type-figure-title` (600 / 15 px), `--brand-700`. */
  titreFigure: {
    police: POLICE_PDF.bodyStrong,
    taille: ptDepuisCssPx(15),
    espacementEm: 0,
  },
  /** `--type-figure-title` used by the figure's own panel titles. */
  sousTitreFigure: {
    police: POLICE_PDF.bodyStrong,
    taille: ptDepuisCssPx(15),
    espacementEm: 0,
  },
  /** `--type-figure-label` (400 / 12 px) + `--type-figure-label-tracking`. */
  axe: {
    police: POLICE_PDF.body,
    taille: ptDepuisCssPx(12),
    espacementEm: 0.08,
  },
  /** `--type-figure-tick-size` (11 px), same label role. */
  tick: {
    police: POLICE_PDF.body,
    taille: ptDepuisCssPx(11),
    espacementEm: 0.08,
  },
  /** `.cahier-figure-legend` → `--text-caption` (500 / 12 px, metadata face). */
  legende: {
    police: POLICE_PDF.metaMedium,
    taille: ptDepuisCssPx(12),
    espacementEm: 0,
  },
  /** `--type-figure-title` used by table captions. */
  titreTableau: {
    police: POLICE_PDF.bodyStrong,
    taille: ptDepuisCssPx(15),
    espacementEm: 0,
  },
  /** `--type-figure-mode` mode-group header (600 / 14 px). */
  enteteTableauMode: {
    police: POLICE_PDF.bodyStrong,
    taille: ptDepuisCssPx(14),
    espacementEm: 0,
  },
  /** `--type-figure-legend` sub-header (600 / 13 px). */
  enteteTableauSous: {
    police: POLICE_PDF.bodyStrong,
    taille: ptDepuisCssPx(13),
    espacementEm: 0,
  },
  /** Table cell value: `--type-figure-legend` (500 / 13 px). */
  valeurTableau: {
    police: POLICE_PDF.bodyMedium,
    taille: ptDepuisCssPx(13),
    espacementEm: 0,
  },
  /** Table row label: `--type-figure-mode` (400 / 14 px). */
  libelleTableau: {
    police: POLICE_PDF.body,
    taille: ptDepuisCssPx(14),
    espacementEm: 0,
  },
  /** `.cahier-evidence-source` (500 / 10 px, metadata face, 0.02em). */
  source: {
    police: POLICE_PDF.metaMedium,
    taille: ptDepuisCssPx(10),
    espacementEm: 0.02,
  },
  /** Approved footer is an explicit 7 pt in `desktop.js`, not a scaled role. */
  pied: {
    police: POLICE_PDF.metaMedium,
    taille: 7,
    espacementEm: 0,
  },
} as const

/**
 * Source px rhythm, converted at the approved reading scale. Kept as named
 * source facts (not invented point values) so a change to the source spacing is
 * a change to a role, not to a painter literal.
 */
export const RYTHME_PX = {
  /** `desktop.js: heading margin:24px 0 12px`. */
  titreTableauxHaut: 24,
  titreTableauxBas: 12,
  /** `desktop.js`: stacked table `margin-bottom:20px`. */
  entreTableaux: 20,
  /** `desktop.js`: caption `margin:0 0 8px`. */
  sousTitreTableauBas: 8,
  /** `cahierFigure.css`: legend `margin: 10px 0 0`. */
  legendeHaut: 10,
  /** `desktop.js`: section sources `margin-top:16px`. */
  sourcesHaut: 16,
  /** `--cahier-unit-heading` gap between the focal identity and the subtitle. */
  identiteSousTitre: 12,
  /** Measured figure-start gap after the section identity block. */
  apresIdentite: 28,
  /** `.page-heading` header padding-bottom: 12px. */
  enteteBas: 12,
  /** `.cahier-figure-legend` gaps. */
  legendeGapColonne: 18,
  legendeGapLigne: 8,
  legendeGapMarque: 6,
  /** `.cahier-figure-legend-mark` owner mark (18 × 3 px). */
  marqueLargeur: 18,
  marqueHauteur: 3,
  marqueRayon: 2,
  marqueCarre: 8,
  marquePoint: 8,
  marqueTraitLargeur: 16,
  marqueTraitHauteur: 16,
  marqueTickLargeur: 2,
  marqueTickHauteur: 14,
} as const

export function rythmePt(px: number): number {
  return ptDepuisCssPx(px)
}
