<script setup lang="ts">
/**
 * Marginal access ramp for the three modes.
 *
 * The pipeline sends eleven quantiles per mode rather than individual
 * buildings. Each curve is therefore a separately ranked building population;
 * equal x positions do not identify the same building across modes.
 */
import { computed, ref } from 'vue'
import type { Component } from 'vue'
import { Bike, BusFront, CarFront, Footprints } from 'lucide-vue-next'

import type { MobiliteAccessMode, MobiliteAccessRamp, MobiliteAccessRampPoint, TimeRampFigureData, TimeRampPoint } from '@/fiche/content/territoryFacts'
import type { CahierFigureTooltipAnchor, CahierTooltipRow, CahierTooltipTone, FigureLegendEntry } from '@/fiche/cahierFigureGrammaire'
import { CAHIER_FIGURE_STYLE } from '@/fiche/cahierFigureGrammaire'
import CahierFigureAxisLabels from './CahierFigureAxisLabels.vue'
import CahierFigureFrame from './CahierFigureFrame.vue'
import CahierFigureLegend from './CahierFigureLegend.vue'
import CahierFigureTooltip from './CahierFigureTooltip.vue'

const props = defineProps<{
  ramp?: MobiliteAccessRamp
  timeRamp?: TimeRampFigureData
  territoryName: string
}>()

const MODE_ORDER: readonly MobiliteAccessMode[] = ['car', 'bike', 'walkTransit']
const WIDTH = 640
const HEIGHT = 300
const MARGIN = { top: 22, right: 68, bottom: 62, left: 64 }
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom
const FIGURE_GEOMETRY = { width: WIDTH, height: HEIGHT, margin: MARGIN } as const

function formatNumber(value: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)
}

const curves = computed(() => props.ramp ? MODE_ORDER.map((mode) => props.ramp!.curves[mode]) : [])

const maximum = computed(() => Math.max(
  1,
  ...curves.value.flatMap((curve) => curve.points.flatMap((point) => [
    point.accessibleTypes,
    ...(point.comparisonAccessibleTypes === null ? [] : [point.comparisonAccessibleTypes]),
  ])),
))

function xFor(quantile: number): number {
  return MARGIN.left + quantile * PLOT_WIDTH
}

function yFor(value: number): number {
  return MARGIN.top + (1 - value / maximum.value) * PLOT_HEIGHT
}

function pathFor(points: MobiliteAccessRamp['curves'][MobiliteAccessMode]['points']): string {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${xFor(point.quantile).toFixed(2)} ${yFor(point.accessibleTypes).toFixed(2)}`)
    .join(' ')
}

const xLabels = computed(() => curves.value[0]?.points ?? [])
const yLabels = computed(() => [0, maximum.value])

const xAxisTicks = computed(() => xLabels.value.map((point) => ({
  key: point.quantile,
  position: xFor(point.quantile),
  label: point.quantileLabel,
})))

const yAxisTicks = computed(() => yLabels.value.map((value) => ({
  key: value,
  position: yFor(value),
  label: formatNumber(value),
})))

const comparisonCurves = computed(() => curves.value.map((curve) => ({
  ...curve,
  points: curve.points.filter((point) => point.comparisonAccessibleTypes !== null).map((point) => ({
    ...point,
    accessibleTypes: point.comparisonAccessibleTypes!,
  })),
})).filter((curve) => curve.points.length > 1))

const MODE_ICONS = {
  car: CarFront,
  bike: Bike,
  walkTransit: Footprints,
} as const

const legend = computed<readonly FigureLegendEntry[]>(() => [
  { key: 'territory', label: props.territoryName, marker: 'line', tone: 'territory' },
  { key: 'comparison', label: 'Groupe comparé', marker: 'dash', tone: 'peer' },
])

type ModeAnnotation = {
  mode: MobiliteAccessMode
  modeLabel: string
  value: number
  pointX: number
  pointY: number
  labelY: number
  labelX: number
}

const modeAnnotations = computed<readonly ModeAnnotation[]>(() => {
  const desired = curves.value.map((curve) => ({
    mode: curve.mode,
    modeLabel: curve.modeLabel,
    value: curve.points.find((point) => point.quantile === 1)?.accessibleTypes ?? curve.points.at(-1)?.accessibleTypes ?? 0,
  }))
  const placed: ModeAnnotation[] = []
  for (const item of [...desired].sort((left, right) => yFor(left.value) - yFor(right.value))) {
    let labelY = Math.max(MARGIN.top + 12, Math.min(MARGIN.top + PLOT_HEIGHT - 8, yFor(item.value)))
    const previous = placed.at(-1)
    if (previous) labelY = Math.max(labelY, previous.labelY + 18)
    placed.push({
      ...item,
      pointX: xFor(1),
      pointY: yFor(item.value),
      labelY,
      labelX: xFor(1) + 28,
    })
  }
  const bounded = placed.map((annotation) => ({
      ...annotation,
      labelY: Math.min(annotation.labelY, MARGIN.top + PLOT_HEIGHT - 8),
    }))
  return MODE_ORDER.flatMap((mode) => bounded.filter((annotation) => annotation.mode === mode))
})

type SelectedCut = {
  quantile: number
  quantileLabel: string
  points: readonly {
    mode: MobiliteAccessMode
    modeLabel: string
    point: MobiliteAccessRampPoint
  }[]
}

const selectedCut = ref<SelectedCut | null>(null)

function selectCut(quantile: number): void {
  const points = curves.value.flatMap((curve) => {
    const point = curve.points.find((candidate) => candidate.quantile === quantile)
    return point ? [{ mode: curve.mode, modeLabel: curve.modeLabel, point }] : []
  })
  const quantileLabel = points[0]?.point.quantileLabel
  if (!quantileLabel) return
  selectedCut.value = { quantile, quantileLabel, points }
}

function clearCut(quantile: number): void {
  if (selectedCut.value?.quantile === quantile) selectedCut.value = null
}

function cutTooltipRows(selection: SelectedCut): readonly CahierTooltipRow[] {
  return selection.points.flatMap(({ mode, modeLabel, point }) => {
    const presentation = {
      tone: mode === 'walkTransit' ? 't' as const : mode === 'bike' ? 'b' as const : 'c' as const,
      icon: MODE_ICONS[mode],
    }
    return [
      {
        label: `${props.territoryName} · ${modeLabel}`,
        value: formatNumber(point.accessibleTypes),
        ...presentation,
      },
      {
        label: `Groupe comparé · ${modeLabel}`,
        value: point.comparisonAccessibleTypes === null
          ? '—'
          : formatNumber(point.comparisonAccessibleTypes),
        ...presentation,
      },
    ]
  })
}

function cutHitboxStyle(point: MobiliteAccessRampPoint, index: number): Record<string, string> {
  const points = xLabels.value
  const previous = points[index - 1]
  const next = points[index + 1]
  const leftQuantile = previous ? (previous.quantile + point.quantile) / 2 : point.quantile
  const rightQuantile = next ? (point.quantile + next.quantile) / 2 : point.quantile
  return {
    left: `${((xFor(leftQuantile) / WIDTH) * 100)}%`,
    top: `${(MARGIN.top / HEIGHT) * 100}%`,
    width: `${((xFor(rightQuantile) - xFor(leftQuantile)) / WIDTH) * 100}%`,
    height: `${(PLOT_HEIGHT / HEIGHT) * 100}%`,
  }
}

const tooltipAnchor = computed<CahierFigureTooltipAnchor | undefined>(() => {
  if (!selectedCut.value) return undefined
  const values = selectedCut.value.points.flatMap(({ point }) => [
    point.accessibleTypes,
    ...(point.comparisonAccessibleTypes === null ? [] : [point.comparisonAccessibleTypes]),
  ])
  const average = values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)
  return {
    x: `${Math.max(0.18, Math.min(0.82, xFor(selectedCut.value.quantile) / WIDTH)) * 100}%`,
    y: `${Math.max(0.04, Math.min(0.48, yFor(average) / HEIGHT)) * 100}%`,
  }
})

function curveLabel(curve: MobiliteAccessRamp['curves'][MobiliteAccessMode]): string {
  return `${curve.modeLabel} : ${curve.points.map((point) => `${point.quantileLabel}, ${formatNumber(point.accessibleTypes)} types`).join('; ')}`
}

const accessibleLabel = computed(() =>
  props.ramp
    ? `${props.territoryName}. ${props.ramp.yAxisLabel} selon ${props.ramp.xAxisLabel}, par mode. ${curves.value.map(curveLabel).join('. ')}`
    : '',
)

/** AEDAR ramp modes: icon, tooltip tone and line color per mode (narrower modes take a lightened family tone). */
const TIME_MODE_ICONS: Readonly<Record<string, Component>> = {
  car: CarFront,
  bike_lts4: Bike,
  bike_lts2: Bike,
  transit: BusFront,
  walk: Footprints,
}
const TIME_MODE_TONES: Readonly<Record<string, CahierTooltipTone>> = {
  car: 'c',
  bike_lts4: 'b',
  bike_lts2: 'b',
  transit: 't',
  walk: 't',
}
const TIME_MODE_COLORS: Readonly<Record<string, string>> = {
  car: 'var(--cahier-mode-car)',
  bike_lts4: 'var(--cahier-mode-bike)',
  bike_lts2: 'color-mix(in srgb, var(--cahier-mode-bike) 55%, var(--paper))',
  transit: 'var(--cahier-mode-foot)',
  walk: 'color-mix(in srgb, var(--cahier-mode-foot) 55%, var(--paper))',
}
const TIME_MODE_LINE_CLASS: Readonly<Record<string, string>> = {
  car: 'access-ramp-line--car',
  bike_lts4: 'access-ramp-line--bike',
  bike_lts2: 'access-ramp-line--bike-light',
  transit: 'access-ramp-line--walkTransit',
  walk: 'access-ramp-line--walkTransit-light',
}
const TIME_MODE_POINT_CLASS: Readonly<Record<string, string>> = {
  car: 'access-ramp-point--car',
  bike_lts4: 'access-ramp-point--bike',
  bike_lts2: 'access-ramp-point--bike-light',
  transit: 'access-ramp-point--walkTransit',
  walk: 'access-ramp-point--walkTransit-light',
}
function timeSeriesLineClass(key: string): string {
  return TIME_MODE_LINE_CLASS[key] ?? ''
}
function timeSeriesPointClass(key: string): string {
  return TIME_MODE_POINT_CLASS[key] ?? ''
}

const timePoints = computed(() => props.timeRamp?.series[0]?.points ?? [])
const selectedTimeModes = ref(new Set(['car', 'transit', 'bike_lts2']))
const visibleTimeSeries = computed(() => (props.timeRamp?.series ?? []).filter((series) => selectedTimeModes.value.has(series.key)))
const visibleTimeModes = computed(() => new Set(visibleTimeSeries.value.map((series) => series.key)))
function toggleTimeMode(key: string): void {
  const selected = new Set(selectedTimeModes.value)
  if (selected.has(key)) selected.delete(key)
  else selected.add(key)
  selectedTimeModes.value = selected
}
const timeMaximum = computed(() => Math.max(1, ...visibleTimeSeries.value.flatMap((series) => series.points.flatMap((point) => [point.value, point.referenceValue].filter((value): value is number => value !== null)))))
const timeX = (value: number) => MARGIN.left + ((value - (timePoints.value[0]?.xValue ?? 0)) / Math.max(1, (timePoints.value.at(-1)?.xValue ?? 1) - (timePoints.value[0]?.xValue ?? 0))) * PLOT_WIDTH
const timeY = (value: number) => MARGIN.top + (1 - value / timeMaximum.value) * PLOT_HEIGHT
const timeTicks = computed(() => timePoints.value.map((point) => ({ key: point.xValue, position: timeX(point.xValue), label: point.xLabel })))
const timeYTicks = computed(() => [0, timeMaximum.value].map((value) => ({ key: value, position: timeY(value), label: `${formatNumber(value)}${props.timeRamp?.yAxis.unit ? ` ${props.timeRamp.yAxis.unit}` : ''}` })))

function timePaths(points: readonly TimeRampPoint[], reference = false): string[] {
  const paths: string[] = []
  let current: string[] = []
  for (const point of points) {
    const value = reference ? point.referenceValue : point.value
    if (value === null) {
      if (current.length) paths.push(current.join(' '))
      current = []
    } else {
      current.push(`${current.length ? 'L' : 'M'} ${timeX(point.xValue).toFixed(2)} ${timeY(value).toFixed(2)}`)
    }
  }
  if (current.length) paths.push(current.join(' '))
  return paths
}

const timeLegend = computed<readonly FigureLegendEntry[]>(() => [
  ...(props.timeRamp?.series ?? []).map((series) => ({
    key: series.key,
    label: series.label,
    marker: 'line' as const,
  })),
  ...(props.timeRamp?.comparisonLabel ? [{
    key: 'reference',
    label: props.timeRamp.comparisonLabel,
    marker: 'dash' as const,
    tone: 'peer' as const,
  }] : []),
])
const timeLegendMarkColors = computed<Readonly<Record<string, string>>>(() => Object.fromEntries(
  (props.timeRamp?.series ?? []).map((series) => [series.key, TIME_MODE_COLORS[series.key] ?? 'var(--cahier-theme-strong)']),
))
const selectedTimeCut = ref<{ xValue: number; xLabel: string } | null>(null)
const timeTooltipAnchor = computed<CahierFigureTooltipAnchor | undefined>(() => selectedTimeCut.value ? { x: `${Math.max(0.18, Math.min(0.82, timeX(selectedTimeCut.value.xValue) / WIDTH)) * 100}%`, y: '12%' } : undefined)
const timeTooltipRows = computed<readonly CahierTooltipRow[]>(() => {
  const cut = selectedTimeCut.value
  const timeRamp = props.timeRamp
  if (!cut || !timeRamp) return []
  const unit = timeRamp.yAxis.unit
  return visibleTimeSeries.value.flatMap((series) => {
    const point = series.points.find((candidate) => candidate.xValue === cut.xValue)
    if (!point) return []
    return [{
      label: `${props.territoryName} · ${series.label}`,
      value: point.value === null ? 'Indisponible' : `${formatNumber(point.value)}${unit ? ` ${unit}` : ''}`,
      tone: TIME_MODE_TONES[series.key] ?? 'neutral',
      icon: TIME_MODE_ICONS[series.key],
      note: timeRamp.comparisonLabel
        ? `${timeRamp.comparisonLabel} : ${point.referenceValue === null ? 'Indisponible' : `${formatNumber(point.referenceValue)}${unit ? ` ${unit}` : ''}`}`
        : undefined,
    }]
  })
})
const timeAccessibleLabel = computed(() => {
  if (!props.timeRamp) return ''
  const unit = props.timeRamp.yAxis.unit
  const seriesText = visibleTimeSeries.value
    .map((series) => `${series.label} : ${series.points.map((point) => `${point.xLabel} ${point.value === null ? 'indisponible' : formatNumber(point.value)}`).join(', ')}`)
    .join(' ; ')
  const referenceText = props.timeRamp.comparisonLabel
    ? ` Référence ${props.timeRamp.comparisonLabel} : ${visibleTimeSeries.value.map((series) => `${series.label} ${series.points.map((point) => `${point.xLabel} ${point.referenceValue === null ? 'indisponible' : formatNumber(point.referenceValue)}`).join(', ')}`).join(' ; ')}`
    : ''
  return `${props.territoryName}. ${props.timeRamp.yAxis.label ?? ''}${unit ? ` (${unit})` : ''} selon ${props.timeRamp.xAxis.label ?? ''}, par mode de déplacement. ${seriesText}.${referenceText}`
})
function timeHitboxStyle(index: number): Record<string, string> {
  const point = timePoints.value[index]
  const previous = timePoints.value[index - 1]
  const next = timePoints.value[index + 1]
  const left = previous ? (timeX(previous.xValue) + timeX(point.xValue)) / 2 : timeX(point.xValue)
  const right = next ? (timeX(point.xValue) + timeX(next.xValue)) / 2 : timeX(point.xValue)
  return { left: `${left / WIDTH * 100}%`, top: `${MARGIN.top / HEIGHT * 100}%`, width: `${Math.max(2, (right - left) / WIDTH * 100)}%`, height: `${PLOT_HEIGHT / HEIGHT * 100}%` }
}
</script>

<template>
  <CahierFigureFrame
    v-if="timeRamp"
    class="access-ramp-cahier access-ramp-cahier--time"
    size="compact"
    :style="CAHIER_FIGURE_STYLE"
    :x-title="`${timeRamp.xAxis.label} (${timeRamp.xAxis.unit})`"
    :y-title="`${timeRamp.yAxis.label}${timeRamp.yAxis.unit ? ` (${timeRamp.yAxis.unit})` : ''}`"
  >
    <template #plot>
      <div class="access-ramp-plot cahier-figure-plot">
        <svg class="access-ramp-svg" :viewBox="`0 0 ${WIDTH} ${HEIGHT}`" preserveAspectRatio="xMidYMid meet" role="img" :aria-label="timeAccessibleLabel">
          <g class="access-ramp-grid" aria-hidden="true">
            <line v-for="tick in timeYTicks" :key="`ty-${tick.key}`" :x1="MARGIN.left" :x2="MARGIN.left + PLOT_WIDTH" :y1="tick.position" :y2="tick.position" />
            <line v-for="point in timePoints" :key="`tx-${point.xValue}`" :x1="timeX(point.xValue)" :x2="timeX(point.xValue)" :y1="MARGIN.top" :y2="MARGIN.top + PLOT_HEIGHT" />
            <line class="access-ramp-axis" :x1="MARGIN.left" :x2="MARGIN.left + PLOT_WIDTH" :y1="MARGIN.top + PLOT_HEIGHT" :y2="MARGIN.top + PLOT_HEIGHT" />
            <line v-if="timeRamp.highlightedX >= (timePoints[0]?.xValue ?? 0) && timeRamp.highlightedX <= (timePoints.at(-1)?.xValue ?? 0)" class="access-ramp-horizon" :x1="timeX(timeRamp.highlightedX)" :x2="timeX(timeRamp.highlightedX)" :y1="MARGIN.top" :y2="MARGIN.top + PLOT_HEIGHT" />
          </g>
          <g v-for="series in visibleTimeSeries" :key="series.key">
            <template v-if="timeRamp.comparisonLabel">
              <path v-for="(path, index) in timePaths(series.points, true)" :key="`ref-${index}`" class="access-ramp-line access-ramp-line--comparison access-ramp-time-line" :class="timeSeriesLineClass(series.key)" :d="path" aria-hidden="true" />
            </template>
            <path v-for="(path, index) in timePaths(series.points)" :key="`value-${index}`" class="access-ramp-line access-ramp-line--territory access-ramp-time-line" :class="timeSeriesLineClass(series.key)" :d="path" aria-hidden="true" />
          </g>
          <g class="access-ramp-points" aria-hidden="true"><template v-for="series in visibleTimeSeries" :key="series.key"><circle v-for="point in series.points.filter((item) => item.value !== null)" :key="`time-${series.key}-${point.xValue}`" class="access-ramp-point access-ramp-time-point" :class="timeSeriesPointClass(series.key)" :cx="timeX(point.xValue)" :cy="timeY(point.value!)" r="4" /></template></g>
        </svg>
        <CahierFigureAxisLabels :geometry="FIGURE_GEOMETRY" :x-ticks="timeTicks" :y-ticks="timeYTicks" :x-label-offset="8" />
        <div class="access-ramp-cut-hitboxes" aria-label="Détails par temps d'accès">
          <button v-for="(point, index) in timePoints" :key="point.xValue" class="access-ramp-cut-hitbox" type="button" :style="timeHitboxStyle(index)" :aria-label="`Temps d'accès : ${point.xLabel}`" @mouseenter="selectedTimeCut = { xValue: point.xValue, xLabel: point.xLabel }" @mouseleave="selectedTimeCut = null" @focus="selectedTimeCut = { xValue: point.xValue, xLabel: point.xLabel }" @blur="selectedTimeCut = null" @click="selectedTimeCut = { xValue: point.xValue, xLabel: point.xLabel }" />
        </div>
        <CahierFigureTooltip v-if="selectedTimeCut" class="access-ramp-tooltip cahier-figure-tooltip--chart" :title="selectedTimeCut.xLabel" :rows="timeTooltipRows" :anchor="timeTooltipAnchor" aria-live="polite" />
      </div>
    </template>
    <CahierFigureLegend :entries="timeLegend" :mark-colors="timeLegendMarkColors" :selected-keys="[...visibleTimeModes]" :toggle-keys="timeRamp.series.map((series) => series.key)" label="Modes de déplacement et référence" @toggle="toggleTimeMode" />
  </CahierFigureFrame>
  <CahierFigureFrame
    v-else-if="ramp"
    class="access-ramp-cahier"
    size="compact"
    :style="CAHIER_FIGURE_STYLE"
    :x-title="ramp.xAxisLabel"
    :y-title="ramp.yAxisLabel"
  >
    <template #plot>
      <div class="access-ramp-plot cahier-figure-plot">
        <svg
          class="access-ramp-svg"
          :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          :aria-label="accessibleLabel"
        >
          <g class="access-ramp-grid" aria-hidden="true">
            <line
              v-for="value in yLabels"
              :key="`y-${value}`"
              :x1="MARGIN.left"
              :x2="MARGIN.left + PLOT_WIDTH"
              :y1="yFor(value)"
              :y2="yFor(value)"
            />
            <line
              v-for="point in xLabels"
              :key="`x-${point.quantile}`"
              :x1="xFor(point.quantile)"
              :x2="xFor(point.quantile)"
              :y1="MARGIN.top"
              :y2="MARGIN.top + PLOT_HEIGHT"
            />
            <line
              class="access-ramp-axis"
              :x1="MARGIN.left"
              :x2="MARGIN.left + PLOT_WIDTH"
              :y1="MARGIN.top + PLOT_HEIGHT"
              :y2="MARGIN.top + PLOT_HEIGHT"
            />
            <line
              class="access-ramp-median"
              :x1="xFor(0.5)"
              :x2="xFor(0.5)"
              :y1="MARGIN.top"
              :y2="MARGIN.top + PLOT_HEIGHT"
            />
          </g>
          <path
            v-for="curve in comparisonCurves"
            :key="`comparison-${curve.mode}`"
            class="access-ramp-line access-ramp-line--comparison"
            :class="`access-ramp-line--${curve.mode}`"
            :d="pathFor(curve.points)"
            aria-hidden="true"
          />
          <path
            v-for="curve in curves"
            :key="curve.mode"
            class="access-ramp-line access-ramp-line--territory"
            :class="`access-ramp-line--${curve.mode}`"
            :d="pathFor(curve.points)"
            aria-hidden="true"
          />
          <path
            v-for="annotation in modeAnnotations"
            :key="`leader-${annotation.mode}`"
            class="access-ramp-mode-leader"
            :d="`M ${annotation.pointX} ${annotation.pointY} L ${annotation.labelX - 10} ${annotation.labelY}`"
            aria-hidden="true"
          />
          <g
            v-for="annotation in modeAnnotations"
            :key="`annotation-${annotation.mode}`"
            class="access-ramp-mode-annotation"
            :class="`access-ramp-mode-annotation--${annotation.mode}`"
            :transform="`translate(${annotation.labelX}, ${annotation.labelY})`"
            role="img"
            :aria-label="annotation.modeLabel"
          >
            <component
              :is="MODE_ICONS[annotation.mode]"
              :size="16"
              :stroke-width="1.8"
              x="-8"
              y="-8"
              aria-hidden="true"
            />
          </g>
          <g v-for="curve in curves" :key="`points-${curve.mode}`" class="access-ramp-points" aria-hidden="true">
            <circle
              v-for="point in curve.points"
              :key="`${curve.mode}-${point.quantile}`"
              class="access-ramp-point"
              :class="`access-ramp-point--${curve.mode}`"
              :cx="xFor(point.quantile)"
              :cy="yFor(point.accessibleTypes)"
              r="4"
            />
          </g>
        </svg>
        <CahierFigureAxisLabels
          :geometry="FIGURE_GEOMETRY"
          :x-ticks="xAxisTicks"
          :y-ticks="yAxisTicks"
          :x-label-offset="8"
        />
        <div class="access-ramp-cut-hitboxes" aria-label="Détails par part cumulée de bâtiments">
          <button
            v-for="(point, index) in xLabels"
            :key="`cut-${point.quantile}`"
            class="access-ramp-cut-hitbox"
            type="button"
            :data-quantile="point.quantile"
            :style="cutHitboxStyle(point, index)"
            :aria-label="`Part cumulée : ${point.quantileLabel}`"
            @mouseenter="selectCut(point.quantile)"
            @mouseleave="clearCut(point.quantile)"
            @focus="selectCut(point.quantile)"
            @blur="clearCut(point.quantile)"
            @click="selectCut(point.quantile)"
          />
        </div>
        <CahierFigureTooltip
          v-if="selectedCut"
          class="access-ramp-tooltip cahier-figure-tooltip--chart"
          :title="`Part cumulée : ${selectedCut.quantileLabel}`"
          :rows="cutTooltipRows(selectedCut)"
          :anchor="tooltipAnchor"
          aria-live="polite"
        />
      </div>
    </template>
    <CahierFigureLegend :entries="legend" label="Séries comparées" />
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
  aspect-ratio: 640 / 300;
}

.access-ramp-svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}

.access-ramp-grid line {
  stroke: color-mix(in srgb, var(--cahier-theme) 17%, transparent);
  stroke-width: 1;
}

.access-ramp-grid .access-ramp-axis {
  stroke: var(--cahier-theme-strong);
  stroke-width: 1.5;
}

.access-ramp-grid .access-ramp-median {
  stroke: var(--cahier-default);
  stroke-dasharray: 4 4;
  stroke-width: 1;
}

.access-ramp-grid .access-ramp-horizon { stroke: var(--cahier-theme-strong); stroke-dasharray: 3 3; stroke-width: 2; }
.access-ramp-time-line { stroke: var(--cahier-theme-strong); }
.access-ramp-time-point { stroke: var(--cahier-theme-strong); }

.access-ramp-labels text {
  fill: var(--cahier-default);
  font-family: var(--font-sans);
  font-size: 11px;
}

.access-ramp-line {
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2.5;
}

.access-ramp-line--comparison {
  stroke-dasharray: 10 6;
  opacity: 0.68;
  stroke-width: 2.5;
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
  font-family: var(--font-sans);
  font-size: 11px;
  font-weight: 700;
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

.access-ramp-line--bike-light {
  stroke: color-mix(in srgb, var(--cahier-mode-bike) 55%, var(--paper));
  color: color-mix(in srgb, var(--cahier-mode-bike) 55%, var(--paper));
}

.access-ramp-line--walkTransit-light {
  stroke: color-mix(in srgb, var(--cahier-mode-foot) 55%, var(--paper));
  color: color-mix(in srgb, var(--cahier-mode-foot) 55%, var(--paper));
}

.access-ramp-point--bike-light { stroke: color-mix(in srgb, var(--cahier-mode-bike) 55%, var(--paper)); }

.access-ramp-point--walkTransit-light { stroke: color-mix(in srgb, var(--cahier-mode-foot) 55%, var(--paper)); }

@media (max-width: 640px) {
  .access-ramp-labels text {
    font-size: 10px;
  }
}
</style>
