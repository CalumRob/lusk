<script setup lang="ts">
/**
 * « Visiter la Bretagne » — the approved travel-time curve of Mobilité page 3
 * (#1006).
 *
 * Same 73 published points at five-minute thresholds, same source, same axis
 * domain and same straight segments as before: nothing is smoothed, resampled
 * or recomputed. What changes is the figure grammar: it takes the compact AEDAR
 * ramp proportions and stroke/typography grammar without touching any protected
 * AEDAR component, drops the chain of permanent point circles and the permanent
 * 90-minute dot, and keeps the published marker as its dashed vertical line
 * only. Hover, focus and touch still show the actual point evidence.
 *
 * The figure title and the x-axis title are app-owned presentation carried by
 * the content layer; the numeric axis, tick labels and marker stay producer
 * facts. Tick labels name their unit for sub-hour values from the numeric axis
 * evidence, never by parsing detail ids.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import type {
  CahierFigureAxisTick,
  CahierFigureGeometry,
  CahierFigureTooltipAnchor,
  CahierTooltipRow,
  FigureLegendEntry,
} from '@/fiche/cahierFigureGrammaire'
import { GROUPE_COMPARE_LABEL } from '@/fiche/content/comparisonWording'
import type { MobiliteRaccordementEvidence } from '@/fiche/content/themeContent'
import type { NumericFact } from '@/fiche/content/territoryFacts'
import ComparisonUnavailableCue from '@/components/fiche/ComparisonUnavailableCue.vue'
import {
  mobiliteCurveAccessibleLabel,
  mobiliteCurveComparisonStateText,
  mobiliteCurveCoordinateForDetail,
  mobiliteCurveCurvesCoincide,
  mobiliteCurveGrid,
  mobiliteCurveReadings,
  mobiliteCurveTooltipRows,
  mobiliteCurveUnavailableNotes,
} from './cahierMobiliteReadings'
import {
  CAHIER_FIGURE_STROKE,
  cahierFigureStrokeVars,
  curveGeometry,
  curveSeriesPath,
  visibleCurveTicks,
} from './cahierFigureNativeGeometry'
import CahierFigureAxisLabels from './CahierFigureAxisLabels.vue'
import CahierFigureFrame from './CahierFigureFrame.vue'
import CahierFigureLegend from './CahierFigureLegend.vue'
import CahierFigureTooltip from './CahierFigureTooltip.vue'
import { useMeasuredCahierFigureGeometry } from './useMeasuredCahierFigureGeometry'
import { useCahierExportPublication } from './cahierExportVenue'

type ComparisonState = {
  status: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'
  error?: string
  retry?: () => void
}

const props = defineProps<{
  figure: MobiliteRaccordementEvidence
  comparison: ComparisonState
  comparisonNone?: boolean
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
// #1021 — this curve owns its independent comparison visibility and whether a
// served reference curve is drawn.
useCahierExportPublication(() => ({
  owner: 'mobilite-raccordement-curve',
  state: {
    toggle: comparisonVisible.value,
    referenceAvailable: comparisonPath.value !== '',
    visibleReferenceAvailable: comparisonPath.value !== '',
    displayed: showComparison.value && comparisonPath.value !== '',
  },
}))
const plotElement = ref<HTMLElement | null>(null)
/** The shared stroke owner is injected as CSS custom properties on the plot. */
const figureStrokeStyle = cahierFigureStrokeVars(CAHIER_FIGURE_STROKE)
const hoveredTickKey = ref<string | null>(null)
const pinnedTickKey = ref<string | null>(null)
const selectedTickKey = computed(() => pinnedTickKey.value ?? hoveredTickKey.value)

function axisForFact(fact: NumericFact): number | null {
  return mobiliteCurveCoordinateForDetail(props.figure, fact.detail)
}

const yTickLabels = computed(() => Y_TICKS.map((value) => `${value * 100} %`))
const geometry = useMeasuredCahierFigureGeometry(plotElement, yTickLabels, BASE_FIGURE_GEOMETRY)
const nativeGeometry = computed(() => curveGeometry(props.figure, geometry.value))
const plotWidth = computed(() => geometry.value.width - geometry.value.margin.left - geometry.value.margin.right)
const plotHeight = computed(() => geometry.value.height - geometry.value.margin.top - geometry.value.margin.bottom)
const plotBottom = computed(() => geometry.value.margin.top + plotHeight.value)

function xForAxis(value: number): number {
  return nativeGeometry.value.x(value)
}

function yFor(value: number): number {
  return nativeGeometry.value.y(value)
}

/** Straight segments only: every published point, no smoothing, no resampling. */
function seriesPath(points: readonly { fact: NumericFact }[]): string {
  return curveSeriesPath(points, props.figure, nativeGeometry.value)
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

const curveGrid = computed(() => mobiliteCurveGrid(props.figure))
const xTicks = computed(() => nativeGeometry.value.xTicks)
const yTicks = computed(() => nativeGeometry.value.yTicks)

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
const visibleXTicks = computed<readonly CahierFigureAxisTick[]>(() => visibleCurveTicks(
  xTicks.value,
  renderedPlotWidth.value,
  geometry.value.width,
  marker.value ? String(marker.value.detail) : null,
  approximateLabelWidth,
  new Set(curveGrid.value.filter((tick) => tick.mobile).map((tick) => tick.detail)),
))

const marker = computed(() => props.figure.trajectory?.marker ?? null)
const markerAxisValue = computed(() => marker.value
  ? mobiliteCurveCoordinateForDetail(props.figure, marker.value.detail)
  : null)
const markerX = computed(() => markerAxisValue.value === null ? null : xForAxis(markerAxisValue.value))

const comparisonAvailable = computed(() =>
  !props.comparisonNone && props.comparison.status === 'ready' && props.figure.comparison !== null,
)
const showComparison = computed(() => comparisonAvailable.value && comparisonVisible.value)

const curveReadings = computed(() => mobiliteCurveReadings({
  figure: props.figure,
  showComparison: showComparison.value,
}))

const curvesCoincide = computed(() => mobiliteCurveCurvesCoincide(props.figure))

const publicationNotes = computed(() => mobiliteCurveUnavailableNotes({
  figure: props.figure,
  comparisonNone: props.comparisonNone === true,
}).map((note) => note.message))

function pointAt(detail: string, points: readonly { fact: NumericFact }[]): NumericFact | null {
  return points.find((point) => point.fact.detail === detail)?.fact ?? null
}

const comparisonStateText = computed(() => mobiliteCurveComparisonStateText({
  figure: props.figure,
  status: props.comparison.status,
  error: props.comparison.error,
  comparisonNone: props.comparisonNone,
}))

const accessibleLabel = computed(() => mobiliteCurveAccessibleLabel({
  figure: props.figure,
  showComparison: showComparison.value,
  notes: [...publicationNotes.value, comparisonStateText.value]
    .filter((note): note is string => Boolean(note)),
}))

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
  const reading = curveReadings.value.find((candidate) => candidate.detail === detail)
  return reading
    ? mobiliteCurveTooltipRows({
      figure: props.figure,
      reading,
      showComparison: showComparison.value,
    })
    : []
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
  const focalName = props.figure.territoryName
  return [
    {
      key: 'territory',
      label: focalName,
      marker: 'line',
      tone: 'theme',
      ariaLabel: `Territoire : ${focalName}`,
    },
    ...(!props.comparisonNone ? [{
      key: 'comparison',
      label: GROUPE_COMPARE_LABEL,
      marker: 'dash',
      tone: 'peer',
      persistentToggle: canToggle,
      ariaLabel: comparisonAria,
    } as const] : []),
  ]
})
const legendColors = {
  territory: 'var(--brand-500)',
  comparison: 'var(--brand-200)',
}
const legendSelected = computed(() => showComparison.value ? ['comparison'] : [])

function toggleLegend(key: string): void {
  if (key === 'comparison') comparisonVisible.value = !comparisonVisible.value
}

const stateMessage = computed(() => mobiliteCurveComparisonStateText({
  figure: props.figure,
  status: props.comparison.status,
  error: props.comparison.error,
  comparisonNone: props.comparisonNone,
}))

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
  <div class="mobilite-raccordement-curve">
    <template v-if="figure.trajectory && figure.axis && hasDrawablePoints">
      <CahierFigureFrame
        size="compact"
        :geometry="geometry"
        :x-title="figure.xAxisTitle"
        :y-title="figure.trajectory.axisLabels?.y"
      >
        <template #plot>
          <div ref="plotElement" class="mobilite-raccordement-curve__plot cahier-figure-plot">
            <svg
              class="mobilite-raccordement-curve__svg"
              :style="figureStrokeStyle"
              :viewBox="`0 0 ${geometry.width} ${geometry.height}`"
              preserveAspectRatio="xMidYMid meet"
              role="img"
              :aria-label="accessibleLabel"
            >
              <g class="mobilite-raccordement-curve__grid" aria-hidden="true">
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
                  class="mobilite-raccordement-curve__axis"
                  :x1="geometry.margin.left"
                  :x2="geometry.width - geometry.margin.right"
                  :y1="plotBottom"
                  :y2="plotBottom"
                />
              </g>

              <path class="mobilite-raccordement-curve__territory" data-series="territory" :d="territoryPath" />
              <path
                v-if="showComparison && comparisonPath"
                class="mobilite-raccordement-curve__comparison"
                data-series="comparison"
                :d="comparisonPath"
              />

              <!-- The published marker stays a dashed vertical reference line:
                   no permanent dot and no on-plot label. -->
              <g
                v-if="marker && markerX !== null"
                class="mobilite-raccordement-curve__marker"
                :data-detail="marker.detail"
                :data-axis-value="markerAxisValue"
              >
                <line
                  class="mobilite-raccordement-curve__marker-line"
                  :x1="markerX"
                  :x2="markerX"
                  :y1="geometry.margin.top"
                  :y2="plotBottom"
                />
              </g>

              <!-- Current-point evidence: hover, focus and touch only. -->
              <g v-if="selectedTick" class="mobilite-raccordement-curve__cursor" aria-hidden="true">
                <line
                  class="mobilite-raccordement-curve__cursor-line"
                  :x1="selectedTick.position"
                  :x2="selectedTick.position"
                  :y1="geometry.margin.top"
                  :y2="plotBottom"
                />
                <circle
                  v-if="cursorComparison"
                  class="mobilite-raccordement-curve__cursor-point mobilite-raccordement-curve__cursor-point--comparison"
                  :cx="cursorComparison.x"
                  :cy="cursorComparison.y"
                  r="3"
                />
                <circle
                  v-if="cursorTerritory"
                  class="mobilite-raccordement-curve__cursor-point mobilite-raccordement-curve__cursor-point--territory"
                  :cx="cursorTerritory.x"
                  :cy="cursorTerritory.y"
                  r="4.2"
                />
              </g>
            </svg>
            <CahierFigureAxisLabels :geometry="geometry" :x-ticks="visibleXTicks" :y-ticks="yTicks" :x-label-offset="8" />
            <button
              type="button"
              class="mobilite-raccordement-curve__hit-surface"
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
              class="mobilite-raccordement-curve__tooltip cahier-figure-tooltip--chart"
              :title="selectedTickTitle"
              :rows="tooltipRows(String(selectedTick.key))"
              :anchor="tooltipAnchor"
              aria-live="polite"
            />
          </div>
        </template>
      </CahierFigureFrame>

      <CahierFigureLegend
        class="mobilite-raccordement-curve__legend"
        :entries="legendEntries"
        :mark-colors="legendColors"
        :selected-keys="legendSelected"
        :comparison-status="comparison.status"
        :comparison-error="comparison.error"
        :label="comparisonNone ? 'Série du territoire' : 'Séries et groupe comparé de la courbe de raccordement'"
        @toggle="toggleLegend"
      />
    </template>
    <p v-else class="mobilite-raccordement-curve__unavailable" role="status">{{ unavailableState }}</p>

    <p v-for="note in publicationNotes" :key="note" class="mobilite-raccordement-curve__state" role="note">{{ note }}</p>
    <p v-if="curvesCoincide && showComparison" class="mobilite-raccordement-curve__state" role="note">
      Groupe comparé superposé au territoire dans cette sélection.
    </p>

    <p v-if="stateMessage" class="mobilite-raccordement-curve__state" role="status">
      <ComparisonUnavailableCue
        v-if="comparison.status === 'unavailable'"
        class="mobilite-raccordement-curve__cue"
        placement="below"
      />
      <span>{{ stateMessage }}</span>
    </p>
    <button
      v-if="!comparisonNone && comparison.status === 'error' && comparison.retry"
      type="button"
      class="mobilite-raccordement-curve__retry"
      @click="comparison.retry()"
    >Réessayer les comparaisons</button>
  </div>
</template>

<style scoped>
.mobilite-raccordement-curve { display: grid; gap: var(--space-3); min-width: 0; }
.mobilite-raccordement-curve__plot { position: relative; width: 100%; }
.mobilite-raccordement-curve__svg { display: block; width: 100%; height: auto; overflow: visible; }
.mobilite-raccordement-curve__grid line {
  stroke: color-mix(in srgb, var(--cahier-theme) 17%, transparent);
  stroke-width: var(--cahier-figure-grid-width);
}
.mobilite-raccordement-curve__grid .mobilite-raccordement-curve__axis {
  stroke: var(--cahier-theme-strong);
  stroke-width: var(--cahier-figure-axis-width);
}
.mobilite-raccordement-curve__territory {
  fill: none;
  stroke: var(--brand-500);
  stroke-width: var(--cahier-figure-series-width);
  stroke-linecap: var(--cahier-figure-series-cap);
  stroke-linejoin: var(--cahier-figure-series-join);
}
.mobilite-raccordement-curve__comparison {
  fill: none;
  stroke: var(--brand-200);
  stroke-width: var(--cahier-figure-comparison-width);
  stroke-dasharray: var(--cahier-figure-comparison-dash);
  stroke-linecap: var(--cahier-figure-series-cap);
  stroke-linejoin: var(--cahier-figure-series-join);
  opacity: var(--cahier-figure-comparison-opacity);
}
.mobilite-raccordement-curve__marker-line {
  stroke: var(--cahier-default, var(--editorial-muted));
  stroke-width: var(--cahier-figure-marker-width);
  stroke-dasharray: var(--cahier-figure-marker-dash);
}
.mobilite-raccordement-curve__cursor-line {
  stroke: color-mix(in srgb, var(--cahier-theme) 38%, transparent);
  stroke-width: 1;
}
.mobilite-raccordement-curve__cursor-point--territory {
  fill: var(--paper);
  stroke: var(--brand-500);
  stroke-width: 2.5;
}
.mobilite-raccordement-curve__cursor-point--comparison {
  fill: var(--paper);
  stroke: var(--brand-200);
  stroke-width: 2;
}
.mobilite-raccordement-curve__hit-surface {
  position: absolute;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: crosshair;
  touch-action: manipulation;
}
.mobilite-raccordement-curve__hit-surface:focus-visible {
  outline: var(--focus-ring);
  outline-offset: -2px;
}
.mobilite-raccordement-curve__tooltip {
  width: min(320px, calc(100vw - 32px));
  max-width: calc(100% - 16px);
  pointer-events: none;
}
.mobilite-raccordement-curve__legend { flex-wrap: wrap; }
.mobilite-raccordement-curve__state {
  margin: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--cahier-default, var(--editorial-muted));
  font: var(--text-body-sm);
}
.mobilite-raccordement-curve__unavailable { margin: 0; color: var(--cahier-default, var(--editorial-muted)); }
.mobilite-raccordement-curve__retry {
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
.mobilite-raccordement-curve__retry:hover { background: var(--surface-tertiary); color: var(--text-primary); }
.mobilite-raccordement-curve__retry:focus-visible { outline: 2px solid var(--brand-500); outline-offset: 2px; }
</style>
