import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'

import {
  CAHIER_FIGURE_GEOMETRY,
  deriveCahierFigureGeometry,
} from '@/fiche/cahierFigureGrammaire'
import type { CahierFigureGeometry } from '@/fiche/cahierFigureGrammaire'

function fontForCanvas(style: CSSStyleDeclaration): string {
  return [style.fontStyle, style.fontVariant, style.fontWeight, style.fontStretch, style.fontSize, style.fontFamily]
    .filter((part) => part && part !== 'normal')
    .join(' ')
}

/** Measure the actual fixed-pixel tick labels and keep their rail aligned with the SVG geometry. */
export function useMeasuredCahierFigureGeometry(
  plotElement: Ref<HTMLElement | null>,
  yTickLabels: ComputedRef<readonly (string | null)[]>,
  baseGeometry: CahierFigureGeometry = CAHIER_FIGURE_GEOMETRY,
) {
  const geometry = ref<CahierFigureGeometry>(baseGeometry)
  let observer: ResizeObserver | undefined
  let observedElement: HTMLElement | null = null

  const measureRail = async () => {
    await nextTick()
    const plot = plotElement.value
    if (!plot) return

    const renderedWidth = plot.getBoundingClientRect().width
    const labels = yTickLabels.value.filter((label): label is string => label !== null)
    if (renderedWidth <= 0 || labels.length === 0) return

    const labelElement = plot.querySelector<HTMLElement>('.cahier-figure-tick-label--y')
    if (!labelElement) return
    const style = getComputedStyle(labelElement)
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) return

    context.font = fontForCanvas(style)
    const letterSpacing = Number.parseFloat(style.letterSpacing) || 0
    const longestLabelWidth = Math.max(...labels.map((label) =>
      context.measureText(label).width + Math.max(0, label.length - 1) * letterSpacing,
    ))
    geometry.value = deriveCahierFigureGeometry(baseGeometry, renderedWidth, longestLabelWidth)
  }

  const scheduleMeasure = () => { void measureRail() }

  onMounted(() => {
    if (typeof ResizeObserver === 'undefined') return
    observedElement = plotElement.value
    if (observedElement) {
      observer = new ResizeObserver(scheduleMeasure)
      observer.observe(observedElement)
    }
    scheduleMeasure()
    document.fonts?.ready.then(scheduleMeasure)
    document.fonts?.addEventListener('loadingdone', scheduleMeasure)
  })

  watch(() => yTickLabels.value.join('\u0000'), scheduleMeasure, { flush: 'post' })
  onBeforeUnmount(() => {
    observer?.disconnect()
    document.fonts?.removeEventListener('loadingdone', scheduleMeasure)
    observedElement = null
  })

  return computed(() => geometry.value)
}
