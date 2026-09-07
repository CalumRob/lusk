<script setup lang="ts">
/**
 * Marginal access ramp for the three modes.
 *
 * The pipeline sends eleven quantiles per mode rather than individual
 * buildings. Each curve is therefore a separately ranked building population;
 * equal x positions do not identify the same building across modes.
 */
import { computed, ref } from 'vue'
import { Bike, CarFront, Footprints } from 'lucide-vue-next'

import type { MobiliteAccessMode, MobiliteAccessRamp, MobiliteAccessRampPoint } from '@/fiche/content/territoryFacts'
import type { CahierFigureTooltipAnchor, CahierTooltipRow, FigureLegendEntry } from '@/fiche/cahierFigureGrammaire'
import { CAHIER_FIGURE_STYLE } from '@/fiche/cahierFigureGrammaire'
import CahierFigureFrame from './CahierFigureFrame.vue'
import CahierFigureLegend from './CahierFigureLegend.vue'
import CahierFigureTooltip from './CahierFigureTooltip.vue'

const props = defineProps<{
  ramp: MobiliteAccessRamp
  territoryName: string
}>()

const MODE_ORDER: readonly MobiliteAccessMode[] = ['car', 'bike', 'walkTransit']
const WIDTH = 640
const HEIGHT = 300
const MARGIN = { top: 22, right: 68, bottom: 62, left: 64 }
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom

function formatNumber(value: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)
}

const curves = computed(() => MODE_ORDER.map((mode) => props.ramp.curves[mode]))

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
  `${props.territoryName}. ${props.ramp.yAxisLabel} selon ${props.ramp.xAxisLabel}, par mode. ${curves.value.map(curveLabel).join('. ')}`,
)
</script>

<template>
  <CahierFigureFrame
    class="access-ramp-cahier"
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
          <g class="access-ramp-labels" aria-hidden="true">
            <text
              v-for="point in xLabels"
              :key="`label-x-${point.quantile}`"
              :x="xFor(point.quantile)"
              :y="MARGIN.top + PLOT_HEIGHT + 20"
              text-anchor="middle"
            >{{ point.quantileLabel }}</text>
            <text
              v-for="value in yLabels"
              :key="`label-y-${value}`"
              :x="MARGIN.left - 10"
              :y="yFor(value) + 4"
              text-anchor="end"
            >{{ formatNumber(value) }}</text>
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

@media (max-width: 640px) {
  .access-ramp-labels text {
    font-size: 10px;
  }
}
</style>
