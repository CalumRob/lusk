/**
 * #1093 — the SINGLE owner of the editorial page colour roles.
 *
 * Every alias below is declared exactly once, here. Both the Cahier and the
 * Atelier bind this map on their root (`EDITORIAL_PAGE_ROLES`), and the PDF
 * palette spreads its entries into its token table, so the screen and the
 * document resolve from the same declarations rather than copied hexes.
 * `editorialPage.css` owns only the *structure* that consumes these roles
 * (page surface, sheet ruling, heading type, rule, margin reflow).
 */

/**
 * Native shared-cycle hue (Mobilité « partagé » segments). DESIGN.md's mode
 * scale owns transit/bike/car only, so this figure hue has no global token:
 * this module is its single owner for the screen shell and the PDF painter.
 */
export const COULEUR_CYCLE_PARTAGE = '#8c4c9e'

export const EDITORIAL_PAGE_ROLES = {
  '--paper': 'var(--editorial-paper)',
  '--paper-deep': 'var(--editorial-paper-deep)',
  '--ink': 'var(--editorial-ink)',
  '--muted': 'var(--editorial-muted)',
  '--red': 'var(--editorial-margin)',
  '--red-soft': 'var(--editorial-margin-soft)',
  '--cahier-default': 'var(--muted)',
  '--cahier-theme': 'var(--theme-mobilite-line)',
  '--cahier-theme-strong': 'var(--theme-mobilite-strong)',
  '--cahier-ground': 'var(--theme-mobilite-soft)',
  '--cahier-theme-emphasis': 'var(--theme-mobilite)',
  '--cahier-region-emphasis': 'var(--brand-200)',
  '--cahier-mode-foot': 'var(--mode-transit)',
  '--cahier-mode-bike': 'var(--mode-bike)',
  '--cahier-mode-car': 'var(--mode-car)',
  '--cahier-cycle-protected': 'var(--cahier-mode-bike)',
  '--cahier-cycle-shared': COULEUR_CYCLE_PARTAGE,
} as const

/**
 * The coverage-share track's three state inks. `CahierMobiliteShareTrack.vue`
 * and the PDF palette consume these exact roles, so the screen and the
 * document cannot drift to two different paper mixes (#1024).
 */
export const CAHIER_SHARE_COLOUR = {
  /** `.mobilite-share-track__track` complement ground, 18 % on the paper. */
  fond: 'color-mix(in srgb, var(--cahier-default, var(--editorial-muted)) 18%, var(--paper))',
  /** A populated track's 1 px border, 22 % on transparent. */
  filet: 'color-mix(in srgb, var(--cahier-default, var(--editorial-muted)) 22%, transparent)',
  /** The empty track's dashed 1 px border, 40 % on transparent. */
  filetVide: 'color-mix(in srgb, var(--cahier-default, var(--editorial-muted)) 40%, transparent)',
} as const

/** Inline custom properties bound by the share SFC; the same owner expressions. */
export const CAHIER_SHARE_TRACK_STYLE = {
  '--mobilite-share-complement': CAHIER_SHARE_COLOUR.fond,
  '--mobilite-share-border': CAHIER_SHARE_COLOUR.filet,
  '--mobilite-share-border-empty': CAHIER_SHARE_COLOUR.filetVide,
} as const
