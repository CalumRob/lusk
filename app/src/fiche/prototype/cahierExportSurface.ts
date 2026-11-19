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
  /** The one prose-role list: hides prose in the mount and identifies the
   *  prose child of a spread in the reflow pass. */
  proseSelector: '.argument-copy, .page-subtitle, .cahier-prose, .cahier-evidence-source',
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
    const prose = children.filter((child) => !isFigure(child) && isProse(child)
      && getComputedStyle(child).display !== 'none')
    if (!prose.length) continue
    const figures = children.filter((child) => !prose.includes(child) && isFigure(child))
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
  if (plans.length) root.setAttribute('data-cahier-reflowed', plans.map((plan) =>
    (plan.layout as HTMLElement).className || plan.layout.tagName).join('|'))
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
  // A reflowed figure is more than its plates: a title/caption band above them
  // and a legend/scale band below. Those bands keep their own authored
  // alignment and can sit off the axis the plates were centred on. Centre every
  // full-width band on that same body axis by a pure horizontal translation.
  // Generic — no per-section selectors — and only for figure blocks that are
  // actually on the body axis, so an uncentred (unreflowed) block is untouched.
  const axes: { layout: HTMLElement; axis: number }[] = []
  const pinned = new Set<Element>(plans.flatMap((plan) => plan.figures.map((figure) => figure.element)))
  for (const plan of plans) {
    void plan.layout.offsetWidth
    const boxes = plan.figures.map((figure) => figure.element.getBoundingClientRect())
    axes.push({ layout: plan.layout,
      axis: (Math.min(...boxes.map((box) => box.left)) + Math.max(...boxes.map((box) => box.right))) / 2 })
  }
  for (const layout of layouts) {
    if (axes.some((entry) => entry.layout === layout)) continue
    // An attribute-scoped layout whose export prose is hidden is reflowed by
    // the export surface even when its own tracks stay authored (the owner's
    // figure grid collapses its emptied track itself).
    const hiddenProse = [...layout.querySelectorAll<HTMLElement>(surface.proseSelector)]
      .some((element) => getComputedStyle(element).display === 'none')
    if (!hiddenProse) continue
    const plates = [...layout.querySelectorAll<HTMLImageElement>('img')]
      .filter((img) => getComputedStyle(img).display !== 'none')
      .map((img) => img.getBoundingClientRect())
      .filter((box) => box.width > 1 && box.height > 1)
    if (!plates.length) continue
    axes.push({ layout,
      axis: (Math.min(...plates.map((box) => box.left)) + Math.max(...plates.map((box) => box.right))) / 2 })
  }
  for (const { layout, axis } of axes) {
    const layoutBox = layout.getBoundingClientRect()
    if (Math.abs(axis - (layoutBox.left + layoutBox.width / 2)) > 1) continue
    const block = layout.closest('figure') ?? layout
    const bands = new Set<HTMLElement>()
    for (const parent of new Set<Element>([block, layout])) {
      for (const child of [...parent.children]) {
        if (!(child instanceof HTMLElement) || pinned.has(child)) continue
        if (getComputedStyle(child).display === 'none') continue
        // A plate block carries raster ink; a band does not.
        if (child.querySelector('img')) continue
        if (!(child.innerText ?? child.textContent ?? '').trim()) continue
        bands.add(child)
      }
    }
    for (const band of bands) {
      const box = band.getBoundingClientRect()
      const dx = axis - (box.left + box.width / 2)
      if (Math.abs(dx) <= 0.5) continue
      band.style.setProperty('transform', `translateX(${dx}px)`, 'important')
      band.style.setProperty('text-align', 'center', 'important')
    }
  }
}
