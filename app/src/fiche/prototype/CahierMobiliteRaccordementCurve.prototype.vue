<script setup lang="ts">
/**
 * [PROTOTYPE page 3 — JETABLE] « Visiter la Bretagne ».
 *
 * Même courbe cumulative, même source, mêmes domaines d'axe, mêmes graduations
 * et mêmes états que la figure de production. Seule la forme change : les
 * proportions, la grille, les épaisseurs de trait et la typographie reprennent
 * la famille compacte des rampes AEDAR, sans chaîne de pastilles à chaque
 * point. Seul le repère de temps publié garde une pastille permanente ; le
 * point courant (survol, focus, toucher) s'ajoute par-dessus. La ligne du
 * territoire reste l'encre verte de marque, la comparaison reste une courbe
 * pointillée neutre, et les valeurs ne sont jamais lissées.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import type {
  CahierFigureAxisTick,
  CahierFigureGeometry,
  CahierFigureTooltipAnchor,
  CahierTooltipComparison,
  CahierTooltipRow,
  FigureLegendEntry,
} from '@/fiche/cahierFigureGrammaire'
import { GROUPE_COMPARE_LABEL } from '@/fiche/content/comparisonWording'
import type { MobiliteRaccordementEvidence } from '@/fiche/content/themeContent'
import type { NumericFact } from '@/fiche/content/territoryFacts'
import { formatServedRank, formatServedRankAria, puceRangDirection } from '@/fiche/figureGrammaire'
import ComparisonUnavailableCue from '@/components/fiche/ComparisonUnavailableCue.vue'
import CahierFigureAxisLabels from './CahierFigureAxisLabels.vue'
import CahierFigureFrame from './CahierFigureFrame.vue'
import CahierFigureLegend from './CahierFigureLegend.vue'
import CahierFigureTooltip from './CahierFigureTooltip.vue'
import { useMeasuredCahierFigureGeometry } from './useMeasuredCahierFigureGeometry'

type ComparisonState = {
  status: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'
  error?: string
  retry?: () => void
}

const props = defineProps<{
  figure: MobiliteRaccordementEvidence
  comparison: ComparisonState
}>()

/** Same compact proportions as the shared AEDAR ramps (no protected geometry touched). */
const BASE_FIGURE_GEOMETRY = {
  width: 640,
  height: 300,
  margin: { top: 22, right: 68, bottom: 62, left: 64 },
} as const satisfies CahierFigureGeometry

const Y_TICKS = [0, 0.25, 0.5, 0.75, 1] as const
const UNAVAILABLE_LABEL = 'Indisponible'

const comparisonVisible = ref(true)
const plotElement = ref<HTMLElement | null>(null)
const hoveredTickKey = ref<string | null>(null)
const pinnedTickKey = ref<string | null>(null)
const selectedTickKey = computed(() => pinnedTickKey.value ?? hoveredTickKey.value)

function formatNumber(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits }).format(value)
}

function percentValue(value: number): number {
  return Math.max(0, Math.min(100, value * 100))
}

function visiblePercent(value: number | null): string {
  return value === null ? UNAVAILABLE_LABEL : formatNumber(percentValue(value))
}

function ariaPercent(value: number | null, unit: string): string {
  return value === null ? UNAVAILABLE_LABEL : `${formatNumber(percentValue(value))} ${unit}`
}

const axisByDetail = computed(() => new Map(
  (props.figure.axis?.values ?? []).map((value) => [value.detail, value.numericValue]),
))

function axisForDetail(detail: string | null): number | null {
  if (!detail) return null
  const declared = axisByDetail.value.get(detail)
  return declared !== undefined && Number.isFinite(declared) ? declared : null
}

function axisForFact(fact: NumericFact): number | null {
  if (typeof fact.axisValue === 'number' && Number.isFinite(fact.axisValue)) return fact.axisValue
  return axisForDetail(fact.detail)
}

const axisDomain = computed(() => props.figure.axis
  ? { minimum: props.figure.axis.minimum, maximum: props.figure.axis.maximum }
  : { minimum: 0, maximum: 1 })

const yTickLabels = computed(() => Y_TICKS.map((value) => `${value * 100} %`))
const geometry = useMeasuredCahierFigureGeometry(plotElement, yTickLabels, BASE_FIGURE_GEOMETRY)
const plotWidth = computed(() => geometry.value.width - geometry.value.margin.left - geometry.value.margin.right)
const plotHeight = computed(() => geometry.value.height - geometry.value.margin.top - geometry.value.margin.bottom)
const plotBottom = computed(() => geometry.value.margin.top + plotHeight.value)

function xForAxis(value: number): number {
  const { minimum, maximum } = axisDomain.value
  const ratio = (value - minimum) / (maximum - minimum)
  return geometry.value.margin.left + ratio * plotWidth.value
}

function yFor(value: number): number {
  return geometry.value.margin.top + (1 - Math.max(0, Math.min(1, value))) * plotHeight.value
}

function seriesPath(points: readonly { fact: NumericFact }[]): string {
  let started = false
  return points.map((point) => {
    const value = point.fact.value
    const axis = axisForFact(point.fact)
    if (value === null || !Number.isFinite(value) || axis === null) {
      started = false
      return ''
    }
    const x = xForAxis(axis)
    const y = yFor(value)
    const command = `${started ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`
    started = true
    return command
  }).filter(Boolean).join(' ')
}

const territoryPath = computed(() => seriesPath(props.figure.points))
const comparisonPath = computed(() => seriesPath(props.figure.comparison?.points ?? []))
const drawablePoints = computed(() => props.figure.points.flatMap((point) => {
  const axis = axisForFact(point.fact)
  return point.fact.value !== null && Number.isFinite(point.fact.value) && axis !== null
    ? [{ point, x: xForAxis(axis), y: yFor(point.fact.value) }]
    : []
}))
const hasDrawablePoints = computed(() => drawablePoints.value.length > 0)

const declaredTicks = computed(() => props.figure.trajectory?.ticks ?? [])
const xTicks = computed<readonly CahierFigureAxisTick[]>(() => declaredTicks.value.flatMap((tick) => {
  const axisValue = axisForDetail(tick.detail)
  return axisValue === null ? [] : [{ key: tick.detail, label: tick.label, position: xForAxis(axisValue) }]
}))
const yTicks = computed<readonly CahierFigureAxisTick[]>(() => Y_TICKS.map((value) => ({
  key: value,
  label: `${value * 100} %`,
  position: yFor(value),
})))

const renderedPlotWidth = ref(0)
let plotObserver: ResizeObserver | null = null
function measurePlotWidth(): void {
  renderedPlotWidth.value = plotElement.value?.getBoundingClientRect().width ?? 0
}

function approximateLabelWidth(label: string | null): number {
  return Math.max(18, (label?.length ?? 2) * 7)
}

/**
 * Keep the producer's full native grid and path, but label only the declared
 * ticks that fit at the measured width. Endpoints and the declared marker are
 * protected; remaining declared ticks fill the available space in metadata
 * order, with the producer's mobile anchors considered first.
 */
const visibleXTicks = computed<readonly CahierFigureAxisTick[]>(() => {
  const ticks = xTicks.value
  const width = renderedPlotWidth.value
  if (!width || ticks.length < 2) return ticks
  const pixelsPerUnit = width / geometry.value.width
  const selected: CahierFigureAxisTick[] = []
  const fits = (tick: CahierFigureAxisTick): boolean => {
    const x = tick.position * pixelsPerUnit
    const half = approximateLabelWidth(tick.label) / 2
    return selected.every((other) => {
      const otherX = other.position * pixelsPerUnit
      const otherHalf = approximateLabelWidth(other.label) / 2
      return Math.abs(x - otherX) >= half + otherHalf + 10
    })
  }
  const add = (tick: CahierFigureAxisTick | undefined) => {
    if (tick && !selected.includes(tick) && fits(tick)) selected.push(tick)
  }
  add(ticks[0])
  add(ticks.find((tick) => marker.value && String(tick.key) === marker.value.detail))
  add(ticks.at(-1))
  for (const tick of ticks.filter((tick) => declaredTicks.value.find((declared) =>
    declared.detail === String(tick.key))?.mobile)) add(tick)
  for (const tick of ticks) add(tick)
  return [...selected].sort((left, right) => left.position - right.position)
})

const marker = computed(() => props.figure.trajectory?.marker ?? null)
const markerAxisValue = computed(() => marker.value ? axisForDetail(marker.value.detail) : null)
const markerPoint = computed(() => {
  if (!marker.value) return null
  return props.figure.points.find((point) => point.fact.detail === marker.value!.detail) ?? null
})
const markerX = computed(() => markerAxisValue.value === null ? null : xForAxis(markerAxisValue.value))
const markerY = computed(() => markerPoint.value?.fact.value === null || markerPoint.value?.fact.value === undefined
  ? null
  : yFor(markerPoint.value.fact.value))

/**
 * The reference-time label lives in HTML, not in the scaled SVG text: it keeps
 * the figure's own label size at every width instead of shrinking with the
 * viewBox.
 */
const markerLabelStyle = computed(() => {
  if (markerX.value === null) return {}
  const xPercent = (markerX.value / geometry.value.width) * 100
  return {
    left: `${xPercent}%`,
    top: `${(geometry.value.margin.top / geometry.value.height) * 100}%`,
    transform: xPercent > 66
      ? 'translateX(calc(-100% - 0.5rem))'
      : 'translateX(0.5rem)',
  }
})

const comparisonAvailable = computed(() =>
  props.comparison.status === 'ready' && props.figure.comparison !== null,
)
const showComparison = computed(() => comparisonAvailable.value && comparisonVisible.value)

const comparisonDetail = computed(() => {
  if (!props.figure.comparison) return null
  const scope = props.figure.comparison.scope.label
    ?? props.figure.comparisonLabel?.replace(/^(?:Moyenne|Médiane) des /u, '')
    ?? 'groupe comparé'
  return {
    statistic: props.figure.comparison.statistic === 'mean' ? 'Moyenne' : 'Médiane',
    label: scope,
  }
})

const curvesCoincide = computed(() => {
  const comparison = props.figure.comparison
  if (!comparison || comparison.points.length !== props.figure.points.length) return false
  const values = new Map(comparison.points.map((point) => [point.fact.detail, point.fact.value]))
  return props.figure.points.every((point) => values.get(point.fact.detail) === point.fact.value)
})

const publicationNotes = computed(() => [
  ...(props.figure.unavailableResources ?? []).map((label) => `Publication indisponible : ${label}`),
  ...(props.figure.unavailableComparisons ?? []).map((label) => `Comparaison indisponible : ${label}`),
])

const markerComparison = computed(() => props.figure.markerValue?.fact.comparison ?? null)
const markerRankAria = computed(() => {
  const comparison = markerComparison.value
  if (!comparison?.rank) return null
  return puceRangDirection(comparison.rank, comparison.direction, comparisonDetail.value?.label)?.phraseAria
    ?? formatServedRankAria(comparison.rank)
})

function pointAt(detail: string, points: readonly { fact: NumericFact }[]): NumericFact | null {
  return points.find((point) => point.fact.detail === detail)?.fact ?? null
}

function tickAriaValue(detail: string, points: readonly { fact: NumericFact }[], unit: string): string {
  return ariaPercent(pointAt(detail, points)?.value ?? null, unit)
}

const curveUnit = computed(() => props.figure.points[0]?.fact.unit ?? '%')

function comparisonRankForTick(detail: string) {
  if (!marker.value || marker.value.detail !== detail) return null
  return props.figure.markerValue?.fact.comparison?.rank ?? null
}

const comparisonStateText = computed(() => {
  if (props.comparison.status === 'loading') return 'Comparaison en cours de chargement.'
  if (props.comparison.status === 'error') {
    return props.figure.unavailableComparisons?.length
      ? `Comparaison indisponible : ${props.figure.unavailableComparisons.join(', ')}.`
      : `Comparaison indisponible : ${props.comparison.error ?? 'la lecture a échoué.'}`
  }
  if (props.comparison.status === 'unavailable') return 'Aucun groupe comparé actif.'
  if (props.figure.comparison === null) return 'Aucune courbe de référence disponible pour cette sélection.'
  return ''
})

const accessibleLabel = computed(() => {
  const readings = xTicks.value
    .map((tick) => `${tick.label} : ${tickAriaValue(String(tick.key), props.figure.points, curveUnit.value)}`)
    .join(' ; ')
  const comparisonReadings = showComparison.value && props.figure.comparison
    ? xTicks.value
      .map((tick) => `${tick.label} : ${tickAriaValue(String(tick.key), props.figure.comparison!.points, curveUnit.value)}`)
      .join(' ; ')
    : ''
  const markerReading = marker.value
    ? ` Repère : ${marker.value.label}.${markerRankAria.value ? ` Rang ${markerRankAria.value}.` : ''}`
    : ''
  const comparisonReading = comparisonReadings && comparisonDetail.value
    ? ` ${GROUPE_COMPARE_LABEL} — ${comparisonDetail.value.statistic} des ${comparisonDetail.value.label} : ${comparisonReadings}.`
    : ''
  const coincidence = curvesCoincide.value && showComparison.value
    ? ' Le groupe comparé est superposé au territoire dans cette sélection.'
    : ''
  const notes = [...publicationNotes.value, comparisonStateText.value].filter(Boolean).join(' ')
  return `${props.figure.figureTitle}. Courbe cumulative de la population bretonne joignable selon le temps de trajet. ` +
    `Axe horizontal : ${props.figure.trajectory?.axisLabels?.x ?? 'temps de trajet'}. ` +
    `Axe vertical : ${props.figure.trajectory?.axisLabels?.y ?? 'population joignable (%)'}. ` +
    `Territoire : ${readings}.${comparisonReading}${coincidence}${markerReading}${notes ? ` ${notes}` : ''}`
})

const selectedTick = computed(() => xTicks.value.find((tick) => String(tick.key) === selectedTickKey.value) ?? null)
const selectedTickTitle = computed(() => selectedTick.value?.label ?? '')

function pointPosition(detail: string, points: readonly { fact: NumericFact }[]): { x: number; y: number } | null {
  const fact = pointAt(detail, points)
  const axis = fact ? axisForFact(fact) : null
  if (!fact || fact.value === null || !Number.isFinite(fact.value) || axis === null) return null
  return { x: xForAxis(axis), y: yFor(fact.value) }
}

/** Current-point emphasis: hover/focus/touch only, never a pastille at every published point. */
const cursorTerritory = computed(() => {
  if (!selectedTick.value) return null
  return pointPosition(String(selectedTick.value.key), props.figure.points)
})
const cursorComparison = computed(() => {
  if (!selectedTick.value || !showComparison.value || !props.figure.comparison) return null
  return pointPosition(String(selectedTick.value.key), props.figure.comparison.points)
})

function tooltipRows(detail: string): readonly CahierTooltipRow[] {
  const unit = curveUnit.value
  const focal = pointAt(detail, props.figure.points)
  let comparison: CahierTooltipComparison | undefined
  if (showComparison.value && props.figure.comparison) {
    const group = pointAt(detail, props.figure.comparison.points)
    const rank = comparisonRankForTick(detail)
    const rankText = formatServedRank(rank)
    const rankAria = formatServedRankAria(rank)
    comparison = {
      value: visiblePercent(group?.value ?? null),
      rank: rankText,
      rankAria,
      ariaLabel: `${GROUPE_COMPARE_LABEL} : ${ariaPercent(group?.value ?? null, unit)} (${comparisonDetail.value?.statistic ?? 'Moyenne'} des ${comparisonDetail.value?.label ?? 'groupe comparé'})${rankAria ? `. Rang ${rankAria}` : ''}`,
    }
  }
  return [{
    label: 'Territoire',
    value: visiblePercent(focal?.value ?? null),
    tone: 't',
    marker: 'dot',
    markerColor: 'var(--brand-500)',
    ariaLabel: `Territoire : ${ariaPercent(focal?.value ?? null, unit)}`,
    comparison,
  }]
}

const tooltipAnchor = computed<CahierFigureTooltipAnchor | undefined>(() => {
  if (!selectedTick.value) return undefined
  const detail = String(selectedTick.value.key)
  const focal = pointAt(detail, props.figure.points)
  const group = props.figure.comparison ? pointAt(detail, props.figure.comparison.points) : null
  const highest = Math.max(focal?.value ?? 0, group?.value ?? 0)
  const renderedWidth = plotElement.value?.getBoundingClientRect().width ?? 0
  const tooltipWidth = renderedWidth > 0
    ? Math.min(320, Math.max(0, window.innerWidth - 32), Math.max(0, renderedWidth - 16))
    : 0
  const half = renderedWidth > 0 ? tooltipWidth / 2 / renderedWidth : 0.5
  const xPercent = selectedTick.value.position / geometry.value.width
  const clampedX = Math.max(half, Math.min(1 - half, xPercent))
  return {
    x: `${clampedX * 100}%`,
    y: `${Math.max(0.14, Math.min(0.84, yFor(highest) / geometry.value.height)) * 100}%`,
  }
})

const hitSurfaceLabel = 'Explorer les valeurs par temps de trajet. Flèches gauche et droite pour changer de repère.'

const hitSurfaceStyle = computed(() => ({
  left: `${(geometry.value.margin.left / geometry.value.width) * 100}%`,
  top: `${(geometry.value.margin.top / geometry.value.height) * 100}%`,
  width: `${(plotWidth.value / geometry.value.width) * 100}%`,
  height: `${(plotHeight.value / geometry.value.height) * 100}%`,
}))

function nearestTick(clientX: number, element: HTMLElement): CahierFigureAxisTick | null {
  const rect = element.getBoundingClientRect()
  if (!rect.width || !xTicks.value.length) return null
  const x = ((clientX - rect.left) / rect.width) * geometry.value.width
  return xTicks.value.reduce((nearest, tick) =>
    Math.abs(tick.position - x) < Math.abs(nearest.position - x) ? tick : nearest,
  )
}

function selectTick(tick: CahierFigureAxisTick | null, pin = false): void {
  if (!tick) return
  hoveredTickKey.value = String(tick.key)
  if (pin) pinnedTickKey.value = String(tick.key)
}

function onPointerMove(event: PointerEvent): void {
  selectTick(nearestTick(event.clientX, event.currentTarget as HTMLElement))
}

function onPointerDown(event: PointerEvent): void {
  selectTick(nearestTick(event.clientX, event.currentTarget as HTMLElement), true)
}

function onPointerLeave(): void {
  if (pinnedTickKey.value === null) hoveredTickKey.value = null
}

function onFocus(): void {
  if (selectedTickKey.value !== null) return
  const markerSeed = xTicks.value.find((tick) => marker.value && String(tick.key) === marker.value.detail)
  selectTick(markerSeed ?? xTicks.value[0] ?? null)
}

function moveSelectedTick(delta: number): void {
  if (!xTicks.value.length) return
  const current = xTicks.value.findIndex((tick) => String(tick.key) === selectedTickKey.value)
  const index = current < 0 ? 0 : Math.max(0, Math.min(xTicks.value.length - 1, current + delta))
  selectTick(xTicks.value[index] ?? null, pinnedTickKey.value !== null)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowLeft') { event.preventDefault(); moveSelectedTick(-1); return }
  if (event.key === 'ArrowRight') { event.preventDefault(); moveSelectedTick(1); return }
  if (event.key === 'Home') { event.preventDefault(); selectTick(xTicks.value[0] ?? null, pinnedTickKey.value !== null); return }
  if (event.key === 'End') { event.preventDefault(); selectTick(xTicks.value.at(-1) ?? null, pinnedTickKey.value !== null); return }
  if (event.key === 'Escape') { event.preventDefault(); dismissTick() }
}

function dismissTick(): void {
  pinnedTickKey.value = null
  hoveredTickKey.value = null
}

function dismissOutside(event: Event): void {
  const target = event.target
  if (plotElement.value && target instanceof Node && !plotElement.value.contains(target)) dismissTick()
}

onMounted(() => {
  document.addEventListener('pointerdown', dismissOutside)
  measurePlotWidth()
  if (typeof ResizeObserver !== 'undefined' && plotElement.value) {
    plotObserver = new ResizeObserver(measurePlotWidth)
    plotObserver.observe(plotElement.value)
  }
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', dismissOutside)
  plotObserver?.disconnect()
  plotObserver = null
})

const legendEntries = computed<readonly FigureLegendEntry[]>(() => {
  const canToggle = props.comparison.status === 'loading' || props.comparison.status === 'error' || comparisonAvailable.value
  const comparisonAria = `${GROUPE_COMPARE_LABEL} : ${props.figure.comparisonLabel ?? UNAVAILABLE_LABEL}`
    + (curvesCoincide.value && showComparison.value ? ' (superposé au territoire)' : '')
  return [
    {
      key: 'territory',
      label: 'Territoire',
      marker: 'line',
      tone: 'theme',
      ariaLabel: `Territoire : ${props.figure.territoryName}`,
    },
    {
      key: 'comparison',
      label: GROUPE_COMPARE_LABEL,
      marker: 'dash',
      tone: 'peer',
      persistentToggle: canToggle,
      ariaLabel: comparisonAria,
    },
  ]
})
const legendColors = {
  territory: 'var(--brand-500)',
  comparison: 'var(--color-figure-reference, var(--cahier-default, var(--editorial-muted)))',
}
const legendSelected = computed(() => showComparison.value ? ['comparison'] : [])

function toggleLegend(key: string): void {
  if (key === 'comparison') comparisonVisible.value = !comparisonVisible.value
}

const stateMessage = computed(() => {
  if (props.comparison.status === 'loading') return 'Chargement du groupe comparé…'
  if (props.comparison.status === 'error') {
    if (props.figure.unavailableComparisons?.length) return null
    return props.comparison.error ?? 'Groupe comparé indisponible.'
  }
  if (props.comparison.status === 'unavailable') return 'Aucun groupe comparé actif : aucune courbe de référence n’est affichée.'
  if (props.figure.comparison === null) {
    return props.figure.unavailableComparisons?.length ? null : 'Aucune courbe de référence disponible pour cette sélection.'
  }
  return null
})

const unavailableState = computed(() => {
  if (props.figure.points.length && props.figure.axis === null) {
    return `${props.figure.figureTitle} : repères de trajectoire indisponibles.`
  }
  if (props.figure.points.length && !hasDrawablePoints.value) {
    return `${props.figure.figureTitle} indisponible : aucune valeur publiée.`
  }
  return `${props.figure.figureTitle} indisponible.`
})
</script>

<template>
  <div class="page3-curve-proto">
    <template v-if="figure.trajectory && figure.axis && hasDrawablePoints">
      <CahierFigureFrame
        size="compact"
        :geometry="geometry"
        :x-title="figure.trajectory.axisLabels?.x"
        :y-title="figure.trajectory.axisLabels?.y"
      >
        <template #plot>
          <div ref="plotElement" class="page3-curve-proto__plot cahier-figure-plot">
            <svg
              class="page3-curve-proto__svg"
              :viewBox="`0 0 ${geometry.width} ${geometry.height}`"
              preserveAspectRatio="xMidYMid meet"
              role="img"
              :aria-label="accessibleLabel"
            >
              <g class="page3-curve-proto__grid" aria-hidden="true">
                <line
                  v-for="tick in yTicks"
                  :key="`grid-y-${tick.key}`"
                  :x1="geometry.margin.left"
                  :x2="geometry.width - geometry.margin.right"
                  :y1="tick.position"
                  :y2="tick.position"
                />
                <line
                  v-for="tick in xTicks"
                  :key="`grid-x-${tick.key}`"
                  :x1="tick.position"
                  :x2="tick.position"
                  :y1="geometry.margin.top"
                  :y2="plotBottom"
                />
                <line
                  class="page3-curve-proto__axis"
                  :x1="geometry.margin.left"
                  :x2="geometry.width - geometry.margin.right"
                  :y1="plotBottom"
                  :y2="plotBottom"
                />
              </g>

              <path class="page3-curve-proto__territory" data-series="territory" :d="territoryPath" />
              <path
                v-if="showComparison && comparisonPath"
                class="page3-curve-proto__comparison"
                data-series="comparison"
                :d="comparisonPath"
              />

              <g v-if="marker && markerX !== null" class="page3-curve-proto__marker" :data-detail="marker.detail">
                <line
                  class="page3-curve-proto__marker-line"
                  :x1="markerX"
                  :x2="markerX"
                  :y1="geometry.margin.top"
                  :y2="plotBottom"
                />
                <circle
                  v-if="markerPoint && markerY !== null"
                  class="page3-curve-proto__marker-point"
                  :cx="markerX"
                  :cy="markerY"
                  :data-value="markerPoint.fact.value"
                  r="4.5"
                />
              </g>

              <g v-if="selectedTick" class="page3-curve-proto__cursor" aria-hidden="true">
                <line
                  class="page3-curve-proto__cursor-line"
                  :x1="selectedTick.position"
                  :x2="selectedTick.position"
                  :y1="geometry.margin.top"
                  :y2="plotBottom"
                />
                <circle
                  v-if="cursorComparison"
                  class="page3-curve-proto__cursor-point page3-curve-proto__cursor-point--comparison"
                  :cx="cursorComparison.x"
                  :cy="cursorComparison.y"
                  r="3"
                />
                <circle
                  v-if="cursorTerritory"
                  class="page3-curve-proto__cursor-point page3-curve-proto__cursor-point--territory"
                  :cx="cursorTerritory.x"
                  :cy="cursorTerritory.y"
                  r="4.2"
                />
              </g>
            </svg>
            <CahierFigureAxisLabels :geometry="geometry" :x-ticks="visibleXTicks" :y-ticks="yTicks" :x-label-offset="8" />
            <span
              v-if="marker && markerX !== null"
              class="page3-curve-proto__marker-label"
              :style="markerLabelStyle"
            >{{ marker.label }}</span>
            <button
              type="button"
              class="page3-curve-proto__hit-surface"
              :style="hitSurfaceStyle"
              :aria-label="hitSurfaceLabel"
              @pointermove="onPointerMove"
              @pointerdown="onPointerDown"
              @pointerleave="onPointerLeave"
              @focus="onFocus"
              @blur="dismissTick"
              @keydown="onKeydown"
            />
            <CahierFigureTooltip
              v-if="selectedTick"
              class="page3-curve-proto__tooltip cahier-figure-tooltip--chart"
              :title="selectedTickTitle"
              :rows="tooltipRows(String(selectedTick.key))"
              :anchor="tooltipAnchor"
              aria-live="polite"
            />
          </div>
        </template>
      </CahierFigureFrame>

      <CahierFigureLegend
        class="page3-curve-proto__legend"
        :entries="legendEntries"
        :mark-colors="legendColors"
        :selected-keys="legendSelected"
        :comparison-status="comparison.status"
        :comparison-error="comparison.error"
        label="Séries et groupe comparé de la courbe de raccordement"
        @toggle="toggleLegend"
      />
    </template>
    <p v-else class="page3-curve-proto__unavailable" role="status">{{ unavailableState }}</p>

    <p v-for="note in publicationNotes" :key="note" class="page3-curve-proto__state" role="note">{{ note }}</p>
    <p v-if="curvesCoincide && showComparison" class="page3-curve-proto__state" role="note">
      Groupe comparé superposé au territoire dans cette sélection.
    </p>

    <p v-if="stateMessage" class="page3-curve-proto__state" role="status">
      <ComparisonUnavailableCue
        v-if="comparison.status === 'unavailable'"
        class="page3-curve-proto__cue"
        placement="below"
      />
      <span>{{ stateMessage }}</span>
    </p>
    <button
      v-if="comparison.status === 'error' && comparison.retry"
      type="button"
      class="page3-curve-proto__retry"
      @click="comparison.retry()"
    >Réessayer les comparaisons</button>
  </div>
</template>

<style scoped>
.page3-curve-proto { display: grid; gap: var(--space-3); min-width: 0; }
.page3-curve-proto__plot { position: relative; width: 100%; }
.page3-curve-proto__svg { display: block; width: 100%; height: auto; overflow: visible; }
.page3-curve-proto__grid line {
  stroke: color-mix(in srgb, var(--cahier-theme) 17%, transparent);
  stroke-width: 1;
}
.page3-curve-proto__grid .page3-curve-proto__axis {
  stroke: var(--cahier-theme-strong);
  stroke-width: 1.5;
}
.page3-curve-proto__territory {
  fill: none;
  stroke: var(--brand-500);
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.page3-curve-proto__comparison {
  fill: none;
  stroke: var(--color-figure-reference, var(--cahier-default, var(--editorial-muted)));
  stroke-width: 2.5;
  stroke-dasharray: 10 6;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.68;
}
.page3-curve-proto__marker-line {
  stroke: var(--cahier-default, var(--editorial-muted));
  stroke-width: 1.5;
  stroke-dasharray: 3 3;
}
.page3-curve-proto__marker-point {
  fill: var(--paper);
  stroke: var(--brand-600, var(--brand-500));
  stroke-width: 2.5;
}
.page3-curve-proto__marker-label {
  position: absolute;
  z-index: 1;
  margin: 0;
  color: var(--cahier-default, var(--editorial-muted));
  font: var(--type-figure-label);
  font-size: var(--type-figure-tick-size);
  font-weight: 700;
  white-space: nowrap;
  pointer-events: none;
}
.page3-curve-proto__cursor-line {
  stroke: color-mix(in srgb, var(--cahier-theme) 38%, transparent);
  stroke-width: 1;
}
.page3-curve-proto__cursor-point--territory {
  fill: var(--paper);
  stroke: var(--brand-500);
  stroke-width: 2.5;
}
.page3-curve-proto__cursor-point--comparison {
  fill: var(--paper);
  stroke: var(--color-figure-reference, var(--cahier-default, var(--editorial-muted)));
  stroke-width: 2;
}
.page3-curve-proto__hit-surface {
  position: absolute;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: crosshair;
  touch-action: manipulation;
}
.page3-curve-proto__hit-surface:focus-visible {
  outline: var(--focus-ring);
  outline-offset: -2px;
}
.page3-curve-proto__tooltip {
  width: min(320px, calc(100vw - 32px));
  max-width: calc(100% - 16px);
  pointer-events: none;
}
.page3-curve-proto__legend { flex-wrap: wrap; }
.page3-curve-proto__state {
  margin: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--cahier-default, var(--editorial-muted));
  font: var(--text-body-sm);
}
.page3-curve-proto__unavailable { margin: 0; color: var(--cahier-default, var(--editorial-muted)); }
.page3-curve-proto__retry {
  justify-self: start;
  min-height: 2.75rem;
  padding: 0 var(--space-3);
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  font: var(--text-body-sm);
  text-decoration: underline;
  cursor: pointer;
}
.page3-curve-proto__retry:hover { background: var(--surface-tertiary); color: var(--text-primary); }
.page3-curve-proto__retry:focus-visible { outline: 2px solid var(--brand-500); outline-offset: 2px; }
</style>
