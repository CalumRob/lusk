import { onBeforeUnmount, onMounted, type Ref } from 'vue'

const CAHIER_GRID_STEP = 32
const CAHIER_FIRST_RULE = 29

function baselineOffset(element: HTMLElement): number {
  const styles = getComputedStyle(element)
  const fontSize = Number.parseFloat(styles.fontSize) || 16
  const lineHeight =
    styles.lineHeight === 'normal'
      ? fontSize * 1.2
      : Number.parseFloat(styles.lineHeight) || fontSize * 1.2
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (context) {
    context.font = `${styles.fontStyle} ${styles.fontWeight} ${styles.fontSize} ${styles.fontFamily}`
    const ascent = context.measureText('H').actualBoundingBoxAscent
    if (ascent) return (lineHeight - fontSize) / 2 + ascent
  }
  return (lineHeight - fontSize) / 2 + fontSize * 0.8
}

function baselineOpticalOffset(element: HTMLElement): number {
  return element.classList.contains('cahier-marelle-anchor') ? 14 : 0
}

function baselineMeasureElement(anchor: HTMLElement): HTMLElement {
  return anchor.classList.contains('cahier-baseline-group')
    ? anchor.querySelector<HTMLElement>('h3') ?? anchor
    : anchor
}

function alignBaselineFlow(anchors: HTMLElement[], pageTop: number): void {
  for (const anchor of anchors) anchor.style.setProperty('--cahier-baseline-shift', '0px')
  for (const anchor of anchors) {
    const measure = baselineMeasureElement(anchor)
    const rectangle = measure.getBoundingClientRect()
    const baseline = rectangle.top + baselineOffset(measure)
    const firstLine = pageTop + CAHIER_FIRST_RULE
    const line = Math.round((baseline - firstLine) / CAHIER_GRID_STEP)
    const target = firstLine + line * CAHIER_GRID_STEP
    const shift = target - baseline + baselineOpticalOffset(measure)
    anchor.style.setProperty('--cahier-baseline-shift', `${shift.toFixed(2)}px`)
  }
}

function alignCahierBaselines(root: HTMLElement): void {
  const page = root.querySelector<HTMLElement>('.cahier-page')
  if (!page) return
  const pageTop = page.getBoundingClientRect().top
  const selector = '.cahier-baseline-anchor, .cahier-baseline-first-line, .cahier-baseline-group'
  page
    .querySelectorAll<HTMLElement>(selector)
    .forEach((element) => element.style.setProperty('--cahier-baseline-shift', '0px'))
  const flows: HTMLElement[][] = []
  const pageHeading = page.querySelector<HTMLElement>('.page-heading')
  if (pageHeading) flows.push([...pageHeading.querySelectorAll<HTMLElement>(selector)])
  for (const group of page.querySelectorAll<HTMLElement>('.concept-group')) {
    const heading = group.querySelector<HTMLElement>('.concept-group-heading')
    for (const side of group.querySelectorAll<HTMLElement>('.argument-side, .evidence-side')) {
      const anchors = [...side.querySelectorAll<HTMLElement>(selector)]
      if (side.classList.contains('argument-side') && heading) anchors.unshift(heading)
      flows.push(anchors)
    }
  }
  flows.filter((flow) => flow.length > 0).forEach((flow) => alignBaselineFlow(flow, pageTop))
}

/** Shared baseline-grid lifecycle for every Cahier surface. */
export function useCahierBaselineGrid(
  rootRef: Ref<HTMLElement | null>,
  isEnabled: () => boolean = () => true,
): void {
  let observer: ResizeObserver | null = null
  let frame: number | null = null

  const schedule = (): void => {
    if (!isEnabled()) return
    if (frame !== null || typeof window.requestAnimationFrame !== 'function') return
    frame = window.requestAnimationFrame(() => {
      frame = null
      if (rootRef.value) alignCahierBaselines(rootRef.value)
    })
  }

  onMounted(() => {
    schedule()
    if (rootRef.value && 'ResizeObserver' in window) {
      observer = new ResizeObserver(schedule)
      observer.observe(rootRef.value)
    }
    const fontsReady = document.fonts?.ready
    if (fontsReady) void fontsReady.then(schedule)
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    if (frame !== null) window.cancelAnimationFrame(frame)
  })
}
