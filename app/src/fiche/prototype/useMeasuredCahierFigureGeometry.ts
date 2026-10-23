import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'

import {
  CAHIER_FIGURE_GEOMETRY,
  deriveCahierFigureGeometry,
} from '@/fiche/cahierFigureGrammaire'
import type { CahierFigureGeometry } from '@/fiche/cahierFigureGrammaire'

/** Measure rendered HTML or SVG y ticks and keep every rail consumer aligned. */
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

    const renderedLabels = [...plot.querySelectorAll<HTMLElement | SVGTextElement>(
      '.cahier-figure-tick-label--y, .cahier-figure-tick-label-svg--y',
    )]
    if (!renderedLabels.length) return
    const longestLabelWidth = Math.max(...renderedLabels.map((label) => label.getBoundingClientRect().width))
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
