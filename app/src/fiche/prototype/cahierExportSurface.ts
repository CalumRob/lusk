/**
 * App-owned export-surface contract. The offscreen native mount hides screen
 * chrome generically — no per-section selectors, no PDF-side presentation copy.
 * Figure titles/captions, axis/legend text, scalar labels and figure-attached
 * reading notes keep their own roles and are not listed here.
 */
export const CAHIER_EXPORT_SURFACE = {
  hostClass: 'cahier-native-pdf-host',
  /** Owner-declared attribute on section LAYOUT containers (prose + figures). */
  layoutHook: 'data-cahier-export-layout',
  layoutSpread: 'spread',
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

/**
 * The one export-layout primitive. It visits ONLY containers whose owning
 * section declared `data-cahier-export-layout="spread"` — the prose-plus-figure
 * layout container, never an internal figure grid. It drops the authored prose
 * column, collapses the now-unused tracks, centres the block and pins each
 * figure child to its pre-reflow painted width so nothing stretches or shrinks.
 */
export function reflowVisibleFigureTracks(root: HTMLElement): void {
  const surface = CAHIER_EXPORT_SURFACE
  const layouts = root.querySelectorAll<HTMLElement>(
    `[${surface.layoutHook}="${surface.layoutSpread}"]`,
  )
  const hasFigureInk = (element: Element) =>
    /^(IMG|SVG|FIGURE)$/.test(element.tagName) || element.querySelector('img, svg, figure') !== null
  // Capture every native width BEFORE any mutation: an outer layout's track
  // rewrite must not become the "native" size of an inner layout's figures.
  const natural = new Map<HTMLElement, number>()
  for (const layout of layouts) {
    for (const child of [...layout.children]) {
      if (hasFigureInk(child)) natural.set(child as HTMLElement, child.getBoundingClientRect().width)
    }
  }
  for (const layout of layouts) {
    const style = getComputedStyle(layout)
    if (style.display !== 'grid') continue
    const children = [...layout.children] as HTMLElement[]
    const figures = children.filter(hasFigureInk)
    if (!figures.length) continue
    for (const child of children) {
      if (hasFigureInk(child)) continue
      // Only an emptied prose column has no visible text; a legend or caption
      // with real text stays even though it has no raster/vector child.
      if (!(child.innerText ?? '').trim()) child.style.setProperty('display', 'none', 'important')
    }
    const visible = children.filter((child) => getComputedStyle(child).display !== 'none')
    layout.style.setProperty('justify-content', 'center', 'important')
    layout.style.setProperty('justify-items', 'center', 'important')
    const tracks = style.gridTemplateColumns.split(' ').filter(Boolean)
    if (tracks.length <= visible.length) continue
    layout.style.setProperty('grid-template-columns', `repeat(${visible.length}, minmax(0, 1fr))`, 'important')
    layout.style.setProperty('column-gap', '0', 'important')
    figures.forEach((figure) => {
      const width = natural.get(figure) ?? 0
      if (!Number.isFinite(width) || width <= 0) return
      figure.style.setProperty('width', `${width}px`, 'important')
      figure.style.setProperty('max-width', `${width}px`, 'important')
      figure.style.setProperty('justify-self', 'center', 'important')
    })
  }
}
