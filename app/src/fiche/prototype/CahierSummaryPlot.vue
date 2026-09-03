<script setup lang="ts">
import { Bike, CarFront, CircleSlash2, Footprints } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import type { Component } from 'vue'

import {
  graduationsPourDomaine,
  layoutCahierSummaryPlot,
} from '@/fiche/cahierFigureGrammaire'
import type {
  CahierFigureAxisTick,
  CahierTooltipRow,
} from '@/fiche/cahierFigureGrammaire'
import type { ContentModeFacts } from '@/fiche/content/themeContent'
import type { MobiliteAccessMode } from '@/fiche/content/territoryFacts'
import { MOBILITE_INACCESSIBLE_LABEL, MOBILITE_MODE_LABELS } from '@/fiche/content/territoryFacts'
import CahierFigureAxes from './CahierFigureAxes.vue'
import CahierFigureTooltip from './CahierFigureTooltip.vue'

type SummaryPlotMetric = 'equipment' | 'types'
type SummaryPlotGroupKey = 'territory' | 'reference'
type SummaryPlotMode = MobiliteAccessMode | 'inaccessible'

type SummaryPlotGroup = {
  key: SummaryPlotGroupKey
  label: string
  reference: boolean
  center: number
}

const props = defineProps<{
  metric: SummaryPlotMetric
  axisTitle: string
  values: ContentModeFacts
  territoryName: string
  typeCount: number | null
  inaccessibleTypes?: ContentModeFacts['car']
  showGroupLabels: boolean
}>()

const SUMMARY_MODES: readonly SummaryPlotMode[] = ['walkTransit', 'bike', 'car', 'inaccessible']
const MODE_ICONS: Readonly<Record<SummaryPlotMode, Component>> = {
  walkTransit: Footprints,
  bike: Bike,
  car: CarFront,
  inaccessible: CircleSlash2,
}
const MODE_TONES: Readonly<Record<SummaryPlotMode, CahierTooltipRow['tone']>> = {
  walkTransit: 't',
  bike: 'b',
  car: 'c',
  inaccessible: 'neutral',
}
const selectedGroup = ref<SummaryPlotGroupKey | null>(null)
const inaccessiblePatternId = `summary-inaccessible-${props.metric}`

function formatNumber(value: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)
}

function comparisonValue(mode: MobiliteAccessMode): number | null {
  return props.values[mode].fact.comparison?.reference?.value ?? null
}

function valueForSeries(reference: boolean, mode: SummaryPlotMode): number | null {
  if (mode === 'inaccessible') {
    if (props.metric !== 'types') return null
    return reference
      ? props.inaccessibleTypes?.fact.comparison?.reference?.value ?? null
      : props.inaccessibleTypes?.fact.value ?? null
  }
  return reference ? comparisonValue(mode) : props.values[mode].fact.value
}

const hasComparison = computed(() => SUMMARY_MODES.some((mode) => valueForSeries(true, mode) !== null))

const maximum = computed(() => {
  if (props.metric === 'types' && props.typeCount !== null) return Math.max(1, props.typeCount)
  return Math.max(
    1,
    ...SUMMARY_MODES.flatMap((mode) => [valueForSeries(false, mode) ?? 0, valueForSeries(true, mode) ?? 0]),
  )
})

const plottedValues = computed(() => SUMMARY_MODES
  .flatMap((mode) => [valueForSeries(false, mode), valueForSeries(true, mode)])
  .filter((value): value is number => value !== null))

const visibleModes = computed<readonly SummaryPlotMode[]>(() => props.metric === 'types'
  ? SUMMARY_MODES
  : SUMMARY_MODES.filter((mode) => mode !== 'inaccessible'))

const groupDefinitions = computed((): readonly Omit<SummaryPlotGroup, 'center'>[] => [
  { key: 'territory', label: props.territoryName, reference: false },
  ...(hasComparison.value ? [{ key: 'reference' as const, label: 'Groupe comparé', reference: true }] : []),
])

const plotLayout = computed(() => layoutCahierSummaryPlot(groupDefinitions.value.length, visibleModes.value.length))

const groups = computed<readonly SummaryPlotGroup[]>(() => groupDefinitions.value.map((definition, index) => ({
  ...definition,
  center: plotLayout.value.groupCenters[index]!,
})))

const axisTitleStyle = computed(() => {
  const { width, margin } = plotLayout.value.geometry
  const axeDroite = width - margin.right
  return {
    '--cahier-figure-axis-title-x-left': `${((margin.left + axeDroite) / (2 * width)) * 100}%`,
  }
})

const xTicks = computed<readonly CahierFigureAxisTick[]>(() => graduationsPourDomaine(
  maximum.value,
  plotLayout.value.geometry,
  props.metric === 'types'
    ? { grading: { kind: 'fixed', step: 10, maximumGap: 5 } }
    : {
        grading: { kind: 'adaptive', targetCount: 6 },
        labels: { avoidValues: plottedValues.value },
      },
))

function valueFor(group: SummaryPlotGroup, mode: SummaryPlotMode): number | null {
  return valueForSeries(group.reference, mode)
}

function xFor(value: number): number {
  const { width, margin } = plotLayout.value.geometry
  return margin.left + (Math.max(0, Math.min(value, maximum.value)) / maximum.value) * (width - margin.right - margin.left)
}

function barY(group: SummaryPlotGroup, mode: SummaryPlotMode): number {
  const modeIndex = visibleModes.value.indexOf(mode)
  return group.center + (modeIndex - (visibleModes.value.length - 1) / 2) * plotLayout.value.rowPitch - plotLayout.value.barHeight / 2
}

function barWidth(value: number): number {
  return Math.max(0, xFor(value) - plotLayout.value.geometry.margin.left)
}

function groupAriaLabel(group: SummaryPlotGroup): string {
  const values = SUMMARY_MODES
    .map((mode) => {
      const value = valueFor(group, mode)
      const label = mode === 'inaccessible' ? MOBILITE_INACCESSIBLE_LABEL : MOBILITE_MODE_LABELS[mode]
      return value === null ? null : `${label} ${formatNumber(value)}`
    })
    .filter((value): value is string => value !== null)
  return `${group.label} : ${values.join('; ')}`
}

function tooltipRows(group: SummaryPlotGroup): readonly CahierTooltipRow[] {
  return SUMMARY_MODES.flatMap((mode) => {
    const value = valueFor(group, mode)
    return value === null
      ? []
      : [{
          label: mode === 'inaccessible' ? MOBILITE_INACCESSIBLE_LABEL : MOBILITE_MODE_LABELS[mode],
          value: formatNumber(value),
          tone: MODE_TONES[mode],
          icon: MODE_ICONS[mode],
        }]
  })
}

function tooltipId(group: SummaryPlotGroup): string {
  return `summary-plot-${props.metric}-${group.key}-detail`
}

function modeClass(mode: SummaryPlotMode): string {
  if (mode === 'inaccessible') return 'inaccessible'
  return mode === 'walkTransit' ? 't' : mode === 'bike' ? 'b' : 'c'
}

function groupLabelStyle(group: SummaryPlotGroup): Record<string, string> {
  return { top: `${(group.center / plotLayout.value.geometry.height) * 100}%` }
}

function selectGroup(group: SummaryPlotGroupKey): void {
  selectedGroup.value = group
}

function clearGroup(group: SummaryPlotGroupKey): void {
  if (selectedGroup.value === group) selectedGroup.value = null
}

const selectedGroupData = computed(() => groups.value.find((group) => group.key === selectedGroup.value) ?? null)
</script>

<template>
  <div class="summary-plot">
    <div
      class="summary-plot-area cahier-figure-plot"
      :style="{ aspectRatio: `${plotLayout.geometry.width} / ${plotLayout.geometry.height}` }"
    >
      <svg
        class="summary-plot-svg"
        :viewBox="`0 0 ${plotLayout.geometry.width} ${plotLayout.geometry.height}`"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        :aria-label="`${props.axisTitle}. ${groups.map(groupAriaLabel).join('. ')}`"
      >
        <defs>
          <pattern :id="inaccessiblePatternId" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(-45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--cahier-default)" stroke-width="2" />
          </pattern>
        </defs>
        <CahierFigureAxes
          :geometry="plotLayout.geometry"
          :x-ticks="xTicks"
          :y-ticks="[]"
        />
        <g
          v-for="group in groups"
          :key="group.key"
          class="summary-plot-group"
          role="img"
          tabindex="0"
          :aria-describedby="selectedGroup === group.key ? tooltipId(group) : undefined"
          :aria-label="groupAriaLabel(group)"
          @mouseenter="selectGroup(group.key)"
          @mouseleave="clearGroup(group.key)"
          @focus="selectGroup(group.key)"
          @blur="clearGroup(group.key)"
        >
          <template v-for="mode in SUMMARY_MODES" :key="mode">
            <rect
              v-if="valueFor(group, mode) !== null"
              class="summary-plot-bar"
              :class="`summary-plot-bar--${modeClass(mode)}`"
              :data-mode="mode"
              :data-series="group.reference ? 'reference' : 'territory'"
              :x="plotLayout.geometry.margin.left"
              :y="barY(group, mode)"
              :width="barWidth(valueFor(group, mode)!)"
              :height="plotLayout.barHeight"
              :fill="mode === 'inaccessible' ? `url(#${inaccessiblePatternId})` : undefined"
              aria-hidden="true"
            />
          </template>
        </g>
      </svg>
      <div v-if="props.showGroupLabels" class="summary-plot-group-labels" aria-hidden="true">
        <span
          v-for="group in groups"
          :key="group.key"
          class="summary-plot-group-label type-figure-column"
          :style="groupLabelStyle(group)"
        >
          {{ group.label }}
        </span>
      </div>
      <span
        class="cahier-figure-axis-title cahier-figure-axis-title--x type-figure-label"
        :style="axisTitleStyle"
      >
        {{ props.axisTitle }}
      </span>
    </div>
    <CahierFigureTooltip
      v-if="selectedGroupData"
      :id="tooltipId(selectedGroupData)"
      class="summary-plot-tooltip cahier-figure-tooltip--chart"
      title="Détail par mode"
      :rows="tooltipRows(selectedGroupData)"
      :anchor="{ x: '72%' }"
    />
  </div>
</template>

<style src="./cahierFigure.css"></style>

<style>
.summary-plot {
  position: relative;
  width: 100%;
  min-width: 0;
}

.summary-plot-area {
  position: relative;
  width: 100%;
}

.summary-plot-group-labels {
  position: absolute;
  inset: 0 auto 0 0;
  width: 26.8%;
  pointer-events: none;
}

.summary-plot-group-label {
  position: absolute;
  right: 8px;
  display: block;
  width: calc(100% - 8px);
  transform: translateY(-50%);
  color: var(--cahier-default);
  line-height: 1.2;
  text-align: right;
  white-space: normal;
  overflow-wrap: anywhere;
}

.summary-plot-svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}

.summary-plot-group {
  cursor: help;
  outline: none;
}

.summary-plot-bar {
  stroke: transparent;
  stroke-width: 0;
}

.summary-plot-bar--t { fill: var(--cahier-mode-foot); }
.summary-plot-bar--b { fill: var(--cahier-mode-bike); }
.summary-plot-bar--c { fill: var(--cahier-mode-car); }
.summary-plot-group:focus-visible .summary-plot-bar,
.summary-plot-group:hover .summary-plot-bar {
  stroke: var(--cahier-region-emphasis);
  stroke-width: 2;
}
.summary-plot-group .summary-plot-bar[data-series='reference'] { opacity: .32; }
</style>
