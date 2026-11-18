/**
 * App-owned export-surface contract. The offscreen native mount hides screen
 * chrome generically — no per-section selectors, no PDF-side presentation copy.
 * Figure titles/captions, axis/legend text, scalar labels and figure-attached
 * reading notes keep their own roles and are not listed here.
 */
export const CAHIER_EXPORT_SURFACE = {
  hostClass: 'cahier-native-pdf-host',
  hidden: [
    '.cahier-section-footer',
    '[role=tooltip]',
    // The served rank belongs to the exported `Rang` column, not a screen chip.
    '.cahier-rank',
    // Owner decision: exports carry no explanatory prose.
    '.argument-copy',
    '.page-subtitle',
    // Screen-only interactive chrome: CTAs, retries and carousel/control affordances.
    // Legend toggles keep their own roles and remain visible.
    '.cahier-action-button',
    '.cahier-comparison-retry',
    '.cahier-map-gallery-controls',
    '[data-pdf-confirm]',
  ],
  neutralised: [
    '.concept-group',
    '.cahier-page',
    '.page-layout',
    '.page-main',
    '.page-heading',
  ],
  documentOnlyHidden: '.cahier-evidence-source:not(.cahier-map-legend__note)',
} as const
