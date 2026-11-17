<script setup lang="ts">
/**
 * AEDAR time ramp: the accessible-equipment curves per travel mode over the
 * published horizons. The legacy building-quantile ramp was retired with the
 * Mobilité accessibility surface (#627); only the AEDAR semantic evidence
 * renders here.
 */
import { computed, ref } from 'vue'

import type { TimeRampFigureData, TimeRampPoint } from '@/fiche/content/territoryFacts'
import { AEDAR_DEFAULT_VISIBLE_RAMP_MODES } from '@/fiche/content/aedarTimeRampFacts'
import type { AedarRampMode } from '@/fiche/content/themeContent'
import type { CahierFigureTooltipAnchor, CahierTooltipRow, FigureLegendEntry } from '@/fiche/cahierFigureGrammaire'
import {
  CAHIER_FIGURE_STROKE,
  cahierFigureStrokeVars,
  rampGeometry,
  rampPaths,
  rampScale,
} from './cahierFigureNativeGeometry'
import { AEDAR_TIME_MODE_COLORS } from './aedarTimeModeColors'
import {
  formatTimeRampNumber,
  timeRampAccessibleReading,
  timeRampTooltipRows,
} from './cahierFigureReadings'
import CahierFigureAxisLabels from './CahierFigureAxisLabels.vue'
import CahierFigureFrame from './CahierFigureFrame.vue'
import CahierFigureLegend from './CahierFigureLegend.vue'
import CahierFigureTooltip from './CahierFigureTooltip.vue'
import { useMeasuredCahierFigureGeometry } from './useMeasuredCahierFigureGeometry'

const props = withDefaults(defineProps<{
  timeRamp?: TimeRampFigureData
  territoryName: string
  selectedModes?: readonly AedarRampMode[]
  showModeLegend?: boolean
  comparisonVisible?: boolean | null
  comparisonStatus?: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'
  comparisonError?: string
}>(), { showModeLegend: true, comparisonVisible: null })
const emit = defineEmits<{ 'update:selectedModes': [modes: readonly AedarRampMode[]] }>()

const WIDTH = 640
const HEIGHT = 300
const BASE_FIGURE_GEOMETRY = {
  width: WIDTH,
  height: HEIGHT,
  margin: { top: 22, right: 68, bottom: 62, left: 64 },
} as const
const plotElement = ref<HTMLElement | null>(null)
/** The shared stroke owner is injected as CSS custom properties on the plot. */
const figureStrokeStyle = cahierFigureStrokeVars(CAHIER_FIGURE_STROKE)

const formatNumber = formatTimeRampNumber
const TIME_MODE_LINE_CLASS: Readonly<Record<string, string>> = {
  car: 'access-ramp-line--car',
  bike_lts2: 'access-ramp-line--bike-light',
  bike_lts4: 'access-ramp-line--bike',
  transit: 'access-ramp-line--walkTransit',
  walk: 'access-ramp-line--walkTransit-light',
}
function timeSeriesLineClass(key: string): string {
  return TIME_MODE_LINE_CLASS[key] ?? ''
}
function timeSeriesColor(key: string): string {
  return AEDAR_TIME_MODE_COLORS[key] ?? 'var(--cahier-theme-strong)'
}
const timePoints = computed(() => props.timeRamp?.series[0]?.points ?? [])
const selectedTimeModes = ref(new Set<string>(AEDAR_DEFAULT_VISIBLE_RAMP_MODES))
const localComparisonVisible = ref(true)
const visibleTimeModes = computed(() => new Set(props.selectedModes ?? [...selectedTimeModes.value]))
const comparisonVisible = computed(() => props.comparisonVisible ?? localComparisonVisible.value)
const comparisonLayerSupported = computed(() => props.timeRamp?.comparisonLayerSupported ?? Boolean(props.timeRamp?.comparisonLabel))
const visibleTimeSeries = computed(() => (props.timeRamp?.series ?? []).filter((series) => visibleTimeModes.value.has(series.key)))
function toggleTimeMode(key: string): void {
  if (key === 'reference') {
    localComparisonVisible.value = !comparisonVisible.value
    return
  }
  const selected = new Set(visibleTimeModes.value)
  if (selected.has(key)) selected.delete(key)
  else selected.add(key)
  if (props.selectedModes) emit('update:selectedModes', [...selected] as AedarRampMode[])
  else selectedTimeModes.value = selected
}
const timeYAxis = computed(() => rampScale(visibleTimeSeries.value, comparisonVisible.value))
const figureGeometry = useMeasuredCahierFigureGeometry(
  plotElement,
  computed(() => timeYAxis.value.ticks.map((value) =>
    `${formatNumber(value)}${props.timeRamp?.yAxis.unit ? ` ${props.timeRamp.yAxis.unit}` : ''}`)),
  BASE_FIGURE_GEOMETRY,
)
const rampGeom = computed(() => rampGeometry(
  timePoints.value,
  timeYAxis.value,
  figureGeometry.value,
  props.timeRamp?.yAxis.unit ?? '',
))
const plotHeight = computed(() => figureGeometry.value.height -
  figureGeometry.value.margin.top - figureGeometry.value.margin.bottom)
const timeX = (value: number) => rampGeom.value.x(value)
const timeTicks = computed(() => rampGeom.value.xTicks)
const timeYTicks = computed(() => rampGeom.value.yTicks)

function timePaths(points: readonly TimeRampPoint[], reference = false): string[] {
  return [...rampPaths(
    points,
    (point) => reference ? point.referenceValue : point.value,
    (value) => rampGeom.value.x(value),
    (value) => rampGeom.value.y(value),
  )]
}

const timeLegend = computed<readonly FigureLegendEntry[]>(() => [
  ...(props.timeRamp?.series ?? []).map((series) => ({
    key: series.key,
    label: series.label,
    marker: 'line' as const,
  })),
  ...(comparisonLayerSupported.value ? [{
    key: 'reference',
    label: 'Groupe comparé',
    ariaLabel: `Groupe comparé : ${props.timeRamp?.comparisonLabel ?? 'Indisponible'}`,
    marker: 'dash' as const,
    tone: 'peer' as const,
    persistentToggle: true,
  }] : []),
])
const timeLegendMarkColors = computed<Readonly<Record<string, string>>>(() => Object.fromEntries(
  (props.timeRamp?.series ?? []).map((series) => [series.key, AEDAR_TIME_MODE_COLORS[series.key] ?? 'var(--cahier-theme-strong)']),
))
const selectedTimeCut = ref<{ xValue: number; xLabel: string } | null>(null)
const timeTooltipAnchor = computed<CahierFigureTooltipAnchor | undefined>(() => selectedTimeCut.value ? { x: `${Math.max(0.18, Math.min(0.82, timeX(selectedTimeCut.value.xValue) / figureGeometry.value.width)) * 100}%`, y: '12%' } : undefined)
/** A reference hidden by the reader's toggle is not evidence the tooltip may show. */
const comparisonDisplayed = computed(() => comparisonLayerSupported.value && comparisonVisible.value)
const timeTooltipRows = computed<readonly CahierTooltipRow[]>(() => {
  if (!props.timeRamp) return []
  return timeRampTooltipRows({
    timeRamp: props.timeRamp,
    series: visibleTimeSeries.value,
    cut: selectedTimeCut.value,
    territoryName: props.territoryName,
    comparisonLayerSupported: comparisonDisplayed.value,
  })
})
const timeAccessibleLabel = computed(() => {
  if (!props.timeRamp) return ''
  return timeRampAccessibleReading({
    timeRamp: props.timeRamp,
    series: visibleTimeSeries.value,
    territoryName: props.territoryName,
    comparisonLayerSupported: comparisonDisplayed.value,
  })
})
function timeHitboxStyle(index: number): Record<string, string> {
  const point = timePoints.value[index]
  const previous = timePoints.value[index - 1]
  const next = timePoints.value[index + 1]
  const left = previous ? (timeX(previous.xValue) + timeX(point.xValue)) / 2 : timeX(point.xValue)
  const right = next ? (timeX(point.xValue) + timeX(next.xValue)) / 2 : timeX(point.xValue)
  const { width, height, margin } = figureGeometry.value
  return { left: `${left / width * 100}%`, top: `${margin.top / height * 100}%`, width: `${Math.max(2, (right - left) / width * 100)}%`, height: `${plotHeight.value / height * 100}%` }
}
</script>

<template>
  <CahierFigureFrame
    v-if="timeRamp"
    class="access-ramp-cahier access-ramp-cahier--time"
    size="compact"
    :geometry="figureGeometry"
    x-title="Temps de trajet"
    :y-title="`${timeRamp.yAxis.label}${timeRamp.yAxis.unit ? ` (${timeRamp.yAxis.unit})` : ''}`"
  >
    <template #plot>
      <div ref="plotElement" class="access-ramp-plot cahier-figure-plot">
        <svg class="access-ramp-svg" :style="figureStrokeStyle" :viewBox="`0 0 ${figureGeometry.width} ${figureGeometry.height}`" preserveAspectRatio="xMidYMid meet" role="img" :aria-label="timeAccessibleLabel">
          <g class="access-ramp-grid" aria-hidden="true">
            <line v-for="tick in timeYTicks" :key="`ty-${tick.key}`" :x1="figureGeometry.margin.left" :x2="figureGeometry.width - figureGeometry.margin.right" :y1="tick.position" :y2="tick.position" />
            <line v-for="point in timePoints" :key="`tx-${point.xValue}`" :x1="timeX(point.xValue)" :x2="timeX(point.xValue)" :y1="figureGeometry.margin.top" :y2="figureGeometry.height - figureGeometry.margin.bottom" />
            <line class="access-ramp-axis" :x1="figureGeometry.margin.left" :x2="figureGeometry.width - figureGeometry.margin.right" :y1="figureGeometry.height - figureGeometry.margin.bottom" :y2="figureGeometry.height - figureGeometry.margin.bottom" />
          </g>
          <g v-for="series in visibleTimeSeries" :key="series.key">
            <template v-if="comparisonLayerSupported && comparisonVisible">
              <path v-for="(path, index) in timePaths(series.points, true)" :key="`ref-${index}`" class="access-ramp-line access-ramp-line--comparison access-ramp-time-line" :class="timeSeriesLineClass(series.key)" :style="{ stroke: timeSeriesColor(series.key) }" :d="path" aria-hidden="true" />
            </template>
            <path v-for="(path, index) in timePaths(series.points)" :key="`value-${index}`" class="access-ramp-line access-ramp-line--territory access-ramp-time-line" :class="timeSeriesLineClass(series.key)" :style="{ stroke: timeSeriesColor(series.key) }" :d="path" aria-hidden="true" />
          </g>
        </svg>
        <CahierFigureAxisLabels :geometry="figureGeometry" :x-ticks="timeTicks" :y-ticks="timeYTicks" :x-label-offset="8" />
        <div class="access-ramp-cut-hitboxes" aria-label="Détails par temps d'accès">
          <button v-for="(point, index) in timePoints" :key="point.xValue" class="access-ramp-cut-hitbox" type="button" :style="timeHitboxStyle(index)" :aria-label="`Temps d'accès : ${point.xLabel}`" @mouseenter="selectedTimeCut = { xValue: point.xValue, xLabel: point.xLabel }" @mouseleave="selectedTimeCut = null" @focus="selectedTimeCut = { xValue: point.xValue, xLabel: point.xLabel }" @blur="selectedTimeCut = null" @click="selectedTimeCut = { xValue: point.xValue, xLabel: point.xLabel }" />
        </div>
        <CahierFigureTooltip v-if="selectedTimeCut" class="access-ramp-tooltip cahier-figure-tooltip--chart" :title="selectedTimeCut.xLabel" :rows="timeTooltipRows" :anchor="timeTooltipAnchor" aria-live="polite" />
      </div>
    </template>
    <CahierFigureLegend v-if="props.showModeLegend" :entries="timeLegend" :mark-colors="timeLegendMarkColors" :selected-keys="[...visibleTimeModes, ...(comparisonVisible && comparisonLayerSupported ? ['reference'] : [])]" :toggle-keys="timeRamp.series.map((series) => series.key)" :comparison-status="props.comparisonStatus" :comparison-error="props.comparisonError" label="Modes de déplacement et référence" @toggle="toggleTimeMode" />
  </CahierFigureFrame>
</template>

<style>
.access-ramp-cahier {
  width: 100%;
  min-width: 0;
}

.access-ramp-plot {
  position: relative;
  width: 100%;
  aspect-ratio: var(--cahier-figure-aspect-ratio);
}

.access-ramp-svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}

.access-ramp-grid line {
  stroke: color-mix(in srgb, var(--cahier-theme) 17%, transparent);
  stroke-width: var(--cahier-figure-stroke-grid-width);
}

.access-ramp-grid .access-ramp-axis {
  stroke: var(--cahier-theme-strong);
  stroke-width: var(--cahier-figure-stroke-axis-width);
}

.access-ramp-grid .access-ramp-median {
  stroke: var(--cahier-default);
  stroke-dasharray: 4 4;
  stroke-width: 1;
}

.access-ramp-time-line { stroke: var(--cahier-theme-strong); }
.access-ramp-time-point { stroke: var(--cahier-theme-strong); }

.access-ramp-labels text {
  fill: var(--cahier-default);
  font: var(--type-figure-label);
  font-size: var(--type-figure-tick-size);
}

.access-ramp-line {
  fill: none;
  stroke-linecap: var(--cahier-figure-stroke-series-cap);
  stroke-linejoin: var(--cahier-figure-stroke-series-join);
  stroke-width: var(--cahier-figure-stroke-series-width);
}

.access-ramp-line--comparison {
  stroke-dasharray: var(--cahier-figure-stroke-comparison-dash);
  opacity: var(--cahier-figure-stroke-comparison-opacity);
  stroke-width: var(--cahier-figure-stroke-comparison-width);
}

.access-ramp-line--territory {
  position: relative;
  z-index: 2;
}

.access-ramp-mode-leader {
  fill: none;
  stroke: var(--cahier-default);
  stroke-dasharray: 2 3;
  stroke-width: 1;
}

.access-ramp-mode-annotation {
  fill: var(--cahier-default);
}

.access-ramp-mode-annotation--car { color: var(--cahier-mode-car); }
.access-ramp-mode-annotation--bike { color: var(--cahier-mode-bike); }
.access-ramp-mode-annotation--walkTransit { color: var(--cahier-mode-foot); }

.access-ramp-mode-annotation :deep(svg) {
  color: currentColor;
}

.access-ramp-point {
  fill: var(--cahier-figure-surface, #f1f2ec);
  stroke-width: 2;
}

.access-ramp-point--car { stroke: var(--cahier-mode-car); }
.access-ramp-point--bike { stroke: var(--cahier-mode-bike); }
.access-ramp-point--walkTransit { stroke: var(--cahier-mode-foot); }

.access-ramp-tooltip {
  width: min(290px, calc(100% - 24px));
  pointer-events: none;
}

.access-ramp-tooltip .cahier-figure-tooltip-row dt {
  min-width: 0;
  overflow-wrap: anywhere;
}

.access-ramp-cut-hitboxes {
  position: absolute;
  inset: 0;
}

.access-ramp-cut-hitbox {
  position: absolute;
  display: block;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: help;
}

.access-ramp-cut-hitbox:hover,
.access-ramp-cut-hitbox:focus-visible {
  outline: 1px solid color-mix(in srgb, var(--cahier-theme-strong) 34%, transparent);
  outline-offset: -1px;
}

.access-ramp-cahier .cahier-figure-legend-mark--dash {
  width: 28px;
  border-top-width: 3px;
}

.access-ramp-line--car {
  stroke: var(--cahier-mode-car);
  color: var(--cahier-mode-car);
}

.access-ramp-line--bike {
  stroke: var(--cahier-mode-bike);
  color: var(--cahier-mode-bike);
}

.access-ramp-line--walkTransit {
  stroke: var(--cahier-mode-foot);
  color: var(--cahier-mode-foot);
}

@media (max-width: 640px) {
  .access-ramp-labels text {
    font-size: var(--type-figure-tick-size);
  }
}
</style>
