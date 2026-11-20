/**
 * App-owned export-surface contract. The offscreen native mount hides screen
 * chrome generically — no per-section selectors, no PDF-side presentation copy.
 * Figure titles/captions, axis/legend text, scalar labels and figure-attached
 * reading notes keep their own roles and are not listed here.
 *
 * `proseSelector` is the ONE prose list: the mount hides exactly those roles,
 * and the reflow pass removes exactly those roles. It deliberately excludes
 * `.cahier-prose` (an implementation detail of every CahierProse, including
 * figure titles) and `.cahier-map-legend__note` (a preserved figure note).
 */
export const CAHIER_EXPORT_SURFACE = {
  hostClass: 'cahier-native-pdf-host',
  /** Owner-declared attribute on section LAYOUT containers (prose + figures). */
  layoutHook: 'data-cahier-export-layout',
  layoutSpread: 'spread',
  /** The single owned prose list, shared by the mount and the reflow pass. */
  proseSelector: '.argument-copy, .page-subtitle, .cahier-evidence-source:not(.cahier-map-legend__note)',
  hidden: [
    '.cahier-section-footer',
    '[role=tooltip]',
    // The served rank belongs to the exported `Rang` column, not a screen chip.
    '.cahier-rank',
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
} as const

/** The mount's hide list, built from the one owned prose list — never a second copy. */
export function cahierExportHiddenSelectors(): string[] {
  return [...CAHIER_EXPORT_SURFACE.hidden, CAHIER_EXPORT_SURFACE.proseSelector]
}

/**
 * The one export-layout primitive. It visits ONLY containers whose owning
 * section declared `data-cahier-export-layout="spread"`, and it acts ONLY when
 * a visible prose child is actually removed. A container with no prose to drop
 * is left byte-for-byte untouched — no track rewrite, no centring, no size pin.
 * Where it does act, the figure children keep their exact pre-pass width,
 * height and mutual gap; only the block's position within the body changes.
 */
export function reflowVisibleFigureTracks(root: HTMLElement): void {
  const surface = CAHIER_EXPORT_SURFACE
  const layouts = root.querySelectorAll<HTMLElement>(
    `[${surface.layoutHook}="${surface.layoutSpread}"]`,
  )
  const isFigure = (element: Element) =>
    element.tagName === 'FIGURE' || element.matches('[data-cahier-native-figure]')
      || element.querySelector(':scope > figure, :scope > [data-cahier-native-figure]') !== null
  const isProse = (element: Element) =>
    element.matches(surface.proseSelector) || element.querySelector(surface.proseSelector) !== null
  const plans: {
    layout: HTMLElement
    prose: HTMLElement[]
    figures: { element: HTMLElement; width: number; height: number }[]
    gap: number
  }[] = []
  // Pass one: measure before ANY mutation.
  for (const layout of layouts) {
    const style = getComputedStyle(layout)
    if (style.display !== 'grid') continue
    const children = [...layout.children] as HTMLElement[]
    const directProse = children.filter((child) => !isFigure(child) && isProse(child)
      && getComputedStyle(child).display !== 'none')
    // Prose nested in the layout and already hidden by the mount is owned by
    // this container too: removing it (same shared selector) makes a real plan.
    const nestedProse = [...layout.querySelectorAll<HTMLElement>(surface.proseSelector)]
      .filter((element) => getComputedStyle(element).display === 'none')
    const prose = [...new Set([...directProse, ...nestedProse])]
    if (!prose.length) continue
    const figures = children.filter((child) => !directProse.includes(child) && isFigure(child))
    if (!figures.length) continue
    plans.push({
      layout,
      prose,
      figures: figures.map((element) => {
        const rect = element.getBoundingClientRect()
        return { element, width: rect.width, height: rect.height }
      }),
      gap: Number.parseFloat(style.columnGap) || 0,
    })
  }
  // Pass two: remove the prose, collapse the authored tracks and pin the exact
  // native geometry of every figure so only the block's x position changes.
  for (const plan of plans) {
    for (const child of plan.prose) child.style.setProperty('display', 'none', 'important')
    plan.layout.style.setProperty('grid-template-columns', `repeat(${plan.figures.length}, minmax(0, 1fr))`, 'important')
    plan.layout.style.setProperty('column-gap', `${plan.gap}px`, 'important')
    plan.layout.style.setProperty('justify-content', 'center', 'important')
    plan.layout.style.setProperty('justify-items', 'center', 'important')
    for (const figure of plan.figures) {
      figure.element.style.setProperty('width', `${figure.width}px`, 'important')
      figure.element.style.setProperty('max-width', `${figure.width}px`, 'important')
      figure.element.style.setProperty('height', `${figure.height}px`, 'important')
      figure.element.style.setProperty('justify-self', 'center', 'important')
    }
  }
  // Bands: only inside a container that pass one ACTUALLY reflowed. No symmetry
  // heuristic and no prose-presence shortcut — the plan is the sole guard.
  // A band keeps its authored alignment and wrapping; its box is translated
  // horizontally only, clamped so it cannot overrun the body.
  for (const plan of plans) {
    void plan.layout.offsetWidth
    const body = plan.layout.getBoundingClientRect()
    // The body axis is the target: pinning a figure can shift its block a few
    // px off-centre, so the whole reflowed block is translated horizontally to
    // the body axis. Width, height and mutual gaps are never re-derived.
    const axis = body.left + body.width / 2
    const boxes = plan.figures.map((figure) => figure.element.getBoundingClientRect())
    const blockAxis = (Math.min(...boxes.map((box) => box.left)) + Math.max(...boxes.map((box) => box.right))) / 2
    const shift = axis - blockAxis
    if (Math.abs(shift) > 0.5) {
      for (const figure of plan.figures) {
        figure.element.style.setProperty('translate', `${shift}px`, 'important')
      }
    }
    const block = plan.layout.closest('figure') ?? plan.layout
    const pinned = new Set<Element>(plan.figures.map((figure) => figure.element))
    const bands = new Set<HTMLElement>()
    for (const parent of new Set<Element>([block, plan.layout])) {
      for (const child of [...parent.children]) {
        if (!(child instanceof HTMLElement) || pinned.has(child)) continue
        if (plan.prose.includes(child) || getComputedStyle(child).display === 'none') continue
        // A plate block carries raster ink; a band does not.
        if (child.querySelector('img')) continue
        if (!(child.innerText ?? child.textContent ?? '').trim()) continue
        bands.add(child)
      }
    }
    for (const band of bands) {
      const box = band.getBoundingClientRect()
      const minDx = body.left - box.left
      const maxDx = body.right - box.right
      if (minDx > maxDx) continue
      const dx = Math.max(minDx, Math.min(axis - (box.left + box.width / 2), maxDx))
      if (Math.abs(dx) <= 0.5) continue
      // `translate` composes with any authored `transform`; it never clobbers it.
      band.style.setProperty('translate', `${dx}px`, 'important')
    }
  }
}
