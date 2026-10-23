<script setup lang="ts">
import { computed, ref } from 'vue'

import type {
  CahierFigureAxisTick,
  CahierFigureTooltipAnchor,
  CahierGroupedVerticalBarFigureData,
  CahierTooltipRow,
} from '@/fiche/cahierFigureGrammaire'
import { cahierIntegerYAxisScale } from '@/fiche/cahierFigureGrammaire'
import type { CahierFigureGeometry } from '@/fiche/cahierFigureGrammaire'
import CahierFigureAxisLabels from './CahierFigureAxisLabels.vue'
import CahierFigureFrame from './CahierFigureFrame.vue'
import CahierFigureTooltip from './CahierFigureTooltip.vue'
import { useMeasuredCahierFigureGeometry } from './useMeasuredCahierFigureGeometry'

const props = defineProps<{ figure: CahierGroupedVerticalBarFigureData }>()

const BASE_FIGURE_GEOMETRY = {
  width: 640,
  height: 300,
  margin: { top: 22, right: 68, bottom: 62, left: 64 },
} as const satisfies CahierFigureGeometry
const BAR_GAP = 2
const MAX_BAR_WIDTH = 12
const UNAVAILABLE_LABEL = 'Indisponible'
const plotElement = ref<HTMLElement | null>(null)

function formatValue(value: number): string {
  return props.figure.formatValue?.(value)
    ?? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)
}

function formatAxisTick(value: number): string {
  return props.figure.formatAxisTick?.(value)
    ?? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)
}

const categoryCount = computed(() => props.figure.categories.length)
const seriesCount = computed(() => props.figure.series.length)
const finiteValues = computed(() => props.figure.series.flatMap((series) =>
  series.values.flatMap((value) => value === null || !Number.isFinite(value) ? [] : [value]),
))
const yDomain = computed(() => cahierIntegerYAxisScale(finiteValues.value))
const yTickLabels = computed(() => yDomain.value.ticks.map(formatAxisTick))
const figureGeometry = useMeasuredCahierFigureGeometry(
  plotElement,
  yTickLabels,
  BASE_FIGURE_GEOMETRY,
)
const plotWidth = computed(() => figureGeometry.value.width -
  figureGeometry.value.margin.left - figureGeometry.value.margin.right)
const plotHeight = computed(() => figureGeometry.value.height -
  figureGeometry.value.margin.top - figureGeometry.value.margin.bottom)
const plotBottom = computed(() => figureGeometry.value.margin.top + plotHeight.value)

function yFor(value: number): number {
  const span = yDomain.value.maximum - yDomain.value.minimum
  return figureGeometry.value.margin.top + (1 - (value - yDomain.value.minimum) / span) * plotHeight.value
}

const groupWidth = computed(() => plotWidth.value / Math.max(1, categoryCount.value))

function barWidth(): number {
  if (seriesCount.value === 0) return 0
  const available = groupWidth.value * 0.84 - (seriesCount.value - 1) * BAR_GAP
  return Math.max(1.5, Math.min(MAX_BAR_WIDTH, available / seriesCount.value))
}

function barX(categoryIndex: number, seriesIndex: number): number {
  const width = barWidth()
  const clusterWidth = width * seriesCount.value + BAR_GAP * (seriesCount.value - 1)
  return figureGeometry.value.margin.left + categoryIndex * groupWidth.value +
    (groupWidth.value - clusterWidth) / 2 + seriesIndex * (width + BAR_GAP)
}

function barHeight(value: number): number {
  return Math.max(1, Math.abs(yFor(value) - yFor(0)))
}

const xTicks = computed<CahierFigureAxisTick[]>(() => props.figure.categories.map((category, index) => ({
  key: category.key,
  position: figureGeometry.value.margin.left + (index + 0.5) * groupWidth.value,
  label: category.axisLabel,
})))

const yTicks = computed<CahierFigureAxisTick[]>(() => yDomain.value.ticks.map((value) => ({
  key: value,
  position: yFor(value),
  label: formatAxisTick(value),
})))

const selectedCategoryIndex = ref<number | null>(null)

function selectCategory(index: number): void {
  selectedCategoryIndex.value = index
}

function clearCategory(index: number): void {
  if (selectedCategoryIndex.value === index) selectedCategoryIndex.value = null
}

function categoryLabel(index: number): string {
  const category = props.figure.categories[index]!
  const values = props.figure.series.map((series) => {
    const value = series.values[index]
    return `${series.label} : ${value === null || value === undefined ? UNAVAILABLE_LABEL : formatValue(value)}`
  })
  return `${category.label} : ${values.length ? values.join(' ; ') : 'Aucune série'}`
}

const tooltipRows = computed<readonly CahierTooltipRow[]>(() => {
  if (selectedCategoryIndex.value === null) return []
  return props.figure.series.map((series) => {
    const value = series.values[selectedCategoryIndex.value!]
    return {
      label: series.label,
      value: value === null || value === undefined ? UNAVAILABLE_LABEL : formatValue(value),
      markerColor: series.color,
    }
  })
})

const selectedCategoryTitle = computed(() => selectedCategoryIndex.value === null
  ? ''
  : props.figure.categories[selectedCategoryIndex.value]!.label)

const tooltipAnchor = computed<CahierFigureTooltipAnchor | undefined>(() => {
  if (selectedCategoryIndex.value === null) return undefined
  const values = props.figure.series.flatMap((series) => {
    const value = series.values[selectedCategoryIndex.value!]
    return value === null || value === undefined || !Number.isFinite(value) ? [] : [value]
  })
  const highest = Math.max(0, ...values)
  return {
    x: `${((figureGeometry.value.margin.left + (selectedCategoryIndex.value + 0.5) * groupWidth.value) / figureGeometry.value.width) * 100}%`,
    y: `${Math.max(0.14, Math.min(0.84, yFor(highest) / figureGeometry.value.height)) * 100}%`,
  }
})

const accessibleLabel = computed(() => {
  const seriesReadings = props.figure.series.map((series) => `${series.label} : ${series.values.map((value) =>
    value === null || !Number.isFinite(value) ? UNAVAILABLE_LABEL : formatValue(value),
  ).join(', ')}`).join(' ; ')
  return `${props.figure.description} Axe horizontal : ${props.figure.xAxisTitle}. Axe vertical : ${props.figure.yAxisTitle}. ${seriesReadings}`
})

function categoryHitboxStyle(index: number): Record<string, string> {
  return {
    left: `${(figureGeometry.value.margin.left + index * groupWidth.value) / figureGeometry.value.width * 100}%`,
    top: `${figureGeometry.value.margin.top / figureGeometry.value.height * 100}%`,
    width: `${groupWidth.value / figureGeometry.value.width * 100}%`,
    height: `${plotHeight.value / figureGeometry.value.height * 100}%`,
  }
}
</script>

<template>
  <CahierFigureFrame
    class="cahier-grouped-vertical-bar-chart"
    size="compact"
    :geometry="figureGeometry"
    :x-title="figure.xAxisTitle"
    :y-title="figure.yAxisTitle"
  >
    <template #plot>
      <div ref="plotElement" class="cahier-grouped-vertical-bar-chart__plot cahier-figure-plot">
        <svg
          class="cahier-grouped-vertical-bar-chart__svg"
          :viewBox="`0 0 ${figureGeometry.width} ${figureGeometry.height}`"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          :aria-label="accessibleLabel"
        >
          <g class="cahier-grouped-vertical-bar-chart__grid" aria-hidden="true">
            <line v-for="tick in yTicks" :key="`y-${tick.key}`" :x1="figureGeometry.margin.left" :x2="figureGeometry.width - figureGeometry.margin.right" :y1="tick.position" :y2="tick.position" />
            <line class="cahier-grouped-vertical-bar-chart__axis" :x1="figureGeometry.margin.left" :x2="figureGeometry.width - figureGeometry.margin.right" :y1="plotBottom" :y2="plotBottom" />
          </g>
          <g v-for="(series, seriesIndex) in figure.series" :key="series.key">
            <template v-for="(category, categoryIndex) in figure.categories" :key="`${series.key}-${category.key}`">
              <template v-if="series.values[categoryIndex] !== null && series.values[categoryIndex] !== undefined && Number.isFinite(series.values[categoryIndex])">
              <rect
                class="cahier-grouped-vertical-bar-chart__bar"
                :x="barX(categoryIndex, seriesIndex)"
                :y="Math.min(yFor(series.values[categoryIndex]!), yFor(0))"
                :width="barWidth()"
                :height="barHeight(series.values[categoryIndex]!)"
                :fill="series.color"
                aria-hidden="true"
              />
              </template>
            </template>
          </g>
        </svg>
        <CahierFigureAxisLabels :geometry="figureGeometry" :x-ticks="xTicks" :y-ticks="yTicks" :x-label-offset="8" />
        <div class="cahier-grouped-vertical-bar-chart__hitboxes" role="group" :aria-label="`Détails par ${figure.xAxisTitle.toLocaleLowerCase('fr-FR')}`">
          <button
            v-for="(category, index) in figure.categories"
            :key="category.key"
            class="cahier-grouped-vertical-bar-chart__category-hitbox"
            type="button"
            :style="categoryHitboxStyle(index)"
            :aria-label="categoryLabel(index)"
            @mouseenter="selectCategory(index)"
            @mouseleave="clearCategory(index)"
            @focus="selectCategory(index)"
            @blur="clearCategory(index)"
            @click="selectCategory(index)"
          />
        </div>
        <CahierFigureTooltip
          v-if="selectedCategoryIndex !== null"
          class="cahier-grouped-vertical-bar-chart__tooltip cahier-figure-tooltip--chart"
          :title="selectedCategoryTitle"
          :rows="tooltipRows"
          :anchor="tooltipAnchor"
          aria-live="polite"
        />
      </div>
    </template>
  </CahierFigureFrame>
</template>

<style scoped>
.cahier-grouped-vertical-bar-chart { width: 100%; min-width: 0; }
.cahier-grouped-vertical-bar-chart__plot { position: relative; width: 100%; }
.cahier-grouped-vertical-bar-chart__svg { display: block; width: 100%; height: auto; overflow: visible; }
.cahier-grouped-vertical-bar-chart__grid line { stroke: color-mix(in srgb, var(--cahier-theme) 17%, transparent); stroke-width: 1; }
.cahier-grouped-vertical-bar-chart__grid .cahier-grouped-vertical-bar-chart__axis { stroke: var(--cahier-theme-strong); stroke-width: 1.5; }
.cahier-grouped-vertical-bar-chart__bar { fill-opacity: 0.78; shape-rendering: crispEdges; }
.cahier-grouped-vertical-bar-chart__hitboxes { position: absolute; inset: 0; }
.cahier-grouped-vertical-bar-chart__category-hitbox { position: absolute; display: block; margin: 0; padding: 0; border: 0; background: transparent; cursor: help; }
.cahier-grouped-vertical-bar-chart__category-hitbox:hover, .cahier-grouped-vertical-bar-chart__category-hitbox:focus-visible { outline: 1px solid color-mix(in srgb, var(--cahier-theme-strong) 34%, transparent); outline-offset: -1px; }
.cahier-grouped-vertical-bar-chart__tooltip { width: min(290px, calc(100% - 24px)); pointer-events: none; }
</style>
