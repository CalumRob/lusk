/** Cahier-scoped colour aliases, shared by the screen and document painter. */

/**
 * Native shared-cycle hue (Mobilité « partagé » segments). DESIGN.md's mode
 * scale owns transit/bike/car only, so this figure hue has no global token:
 * this module is its single owner for the screen shell and the PDF painter.
 */
export const COULEUR_CYCLE_PARTAGE = '#8c4c9e'

export const CAHIER_COLOR_ROLES = {
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
