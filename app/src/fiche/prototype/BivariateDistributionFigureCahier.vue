<script setup lang="ts">
/**
 * Same-building breadth × depth distribution (#550).
 *
 * The payload owns the axes, buckets, labels, counts and shares. This adapter
 * only lays those facts out as a responsive SVG grid. Cell details stay in
 * focused/hovered tooltips so the figure does not create a second visible table.
 */
import { computed, ref } from 'vue'

import type { MobiliteBuildingDistribution } from '@/fiche/content/territoryFacts'
import type { CahierFigureTooltipAnchor, CahierTooltipRow } from '@/fiche/cahierFigureGrammaire'
import { CAHIER_FIGURE_STYLE } from '@/fiche/cahierFigureGrammaire'
import CahierFigureAxisLabels from './CahierFigureAxisLabels.vue'
import CahierFigureFrame from './CahierFigureFrame.vue'
import CahierFigureTooltip from './CahierFigureTooltip.vue'

const props = defineProps<{
  distribution: MobiliteBuildingDistribution
  territoryName: string
}>()

const WIDTH = 640
const HEIGHT = 404
const MARGIN = { top: 22, right: 20, bottom: 58, left: 118 }
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom
const FIGURE_GEOMETRY = { width: WIDTH, height: HEIGHT, margin: MARGIN } as const

function formatNumber(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits }).format(value)
}

function formatShare(value: number): string {
  if (value > 0 && value < 0.001) return '<0,1 %'
  return `${formatNumber(value * 100, 1)} %`
}

const cellsByKey = computed(() => new Map(
  props.distribution.cells.map((cell) => [`${cell.breadthBucket}:${cell.depthBucket}`, cell]),
))

const maxShare = computed(() => Math.max(
  0.01,
  ...props.distribution.cells.flatMap((cell) => [
    cell.share,
    ...(cell.comparisonShare === null ? [] : [cell.comparisonShare]),
  ]),
))

const cellWidth = computed(() => PLOT_WIDTH / Math.max(props.distribution.breadthBins.length, 1))
const cellHeight = computed(() => PLOT_HEIGHT / Math.max(props.distribution.depthBins.length, 1))

type RenderedCell = {
  key: string
  x: number
  y: number
  width: number
  height: number
  share: number
  buildingCount: number | null
  comparisonBuildingCount: number | null
  comparisonShare: number | null
  shareLabel: string
  comparisonShareLabel: string
  breadthLabel: string
  depthLabel: string
  label: string
}

const renderedCells = computed<readonly RenderedCell[]>(() => props.distribution.breadthBins.flatMap((breadth, xIndex) =>
  props.distribution.depthBins.map((depth, depthIndex) => {
    const cell = cellsByKey.value.get(`${breadth.key}:${depth.key}`)
    const share = cell?.share ?? 0
    return {
      key: `${breadth.key}:${depth.key}`,
      x: MARGIN.left + xIndex * cellWidth.value,
      y: MARGIN.top + (props.distribution.depthBins.length - 1 - depthIndex) * cellHeight.value,
      width: cellWidth.value,
      height: cellHeight.value,
      share,
      buildingCount: cell?.buildingCount ?? null,
      comparisonBuildingCount: cell?.comparisonBuildingCount ?? null,
      comparisonShare: cell?.comparisonShare ?? null,
      shareLabel: cell ? formatShare(cell.share) : '—',
      comparisonShareLabel: cell?.comparisonShare === null || cell?.comparisonShare === undefined
        ? '—'
        : formatShare(cell.comparisonShare),
      breadthLabel: breadth.label,
      depthLabel: depth.label,
      label: `${breadth.label}, ${depth.label}`,
    }
  }),
))

const interactiveCells = computed(() => renderedCells.value.filter((cell) => cell.share > 0 || (cell.comparisonShare ?? 0) > 0))
const territoryCells = computed(() => renderedCells.value.filter((cell) => cell.share > 0))
const comparisonCells = computed(() => renderedCells.value.filter((cell) => (cell.comparisonShare ?? 0) > 0))

const xLabels = computed(() => props.distribution.breadthBins.map((bin, index) => ({
  ...bin,
  x: MARGIN.left + (index + 0.5) * cellWidth.value,
})))

const yLabels = computed(() => props.distribution.depthBins.map((bin, index) => ({
  ...bin,
  y: MARGIN.top + (props.distribution.depthBins.length - 1 - index + 0.5) * cellHeight.value,
})))

const xAxisTicks = computed(() => xLabels.value.map((label) => ({
  key: label.key,
  position: label.x,
  label: label.label,
})))

const yAxisTicks = computed(() => yLabels.value.map((label) => ({
  key: label.key,
  position: label.y,
  label: label.label,
})))

const accessibleLabel = computed(() => {
  const strongest = [...props.distribution.cells].sort((left, right) => right.share - left.share)[0]
  const lead = strongest
    ? ` La case la plus représentée est ${strongest.share.toLocaleString('fr-FR', { style: 'percent', maximumFractionDigits: 1 })}.`
    : ''
  return `${props.territoryName}. Répartition des bâtiments selon ${props.distribution.breadthAxisLabel} et ${props.distribution.depthAxisLabel}.${lead}`
})

const selectedCell = ref<RenderedCell | null>(null)

function comparisonColor(share: number | null): string {
  if (share === null) return 'transparent'
  const strength = Math.round(25 + 75 * Math.min(1, share / maxShare.value))
  return `color-mix(in oklab, var(--cahier-region-emphasis) ${strength}%, var(--cahier-figure-surface))`
}

function territoryColor(share: number): string {
  const strength = Math.round(14 + 86 * Math.min(1, share / maxShare.value))
  return `color-mix(in srgb, color-mix(in srgb, var(--cahier-mode-foot) 88%, var(--cahier-figure-surface)) ${strength}%, var(--cahier-figure-surface))`
}

function cellHitboxStyle(cell: RenderedCell): Record<string, string> {
  return {
    left: `${(cell.x / WIDTH) * 100}%`,
    top: `${(cell.y / HEIGHT) * 100}%`,
    width: `${(cell.width / WIDTH) * 100}%`,
    height: `${(cell.height / HEIGHT) * 100}%`,
  }
}

function tooltipRows(cell: RenderedCell): readonly CahierTooltipRow[] {
  const rows: CahierTooltipRow[] = [
    {
      label: props.territoryName,
      value: cell.shareLabel,
      tone: 'neutral',
      markerColor: territoryColor(cell.share),
    },
  ]
  if (cell.comparisonShare !== null) {
    rows.push({
      label: 'Groupe comparé',
      value: cell.comparisonShareLabel,
      tone: 'neutral',
      markerColor: comparisonColor(cell.comparisonShare),
    })
  }
  return rows
}

function tooltipTitle(cell: RenderedCell): string {
  return `${cell.breadthLabel} types · ${cell.depthLabel} équipements`
}

const tooltipAnchor = computed<CahierFigureTooltipAnchor | undefined>(() => {
  if (!selectedCell.value) return undefined
  const centerX = selectedCell.value.x + selectedCell.value.width / 2
  const centerY = selectedCell.value.y + selectedCell.value.height / 2
  return {
    x: `${Math.max(0.18, Math.min(0.82, centerX / WIDTH)) * 100}%`,
    y: `${Math.max(0.04, Math.min(0.58, centerY / HEIGHT)) * 100}%`,
  }
})
</script>

<template>
  <CahierFigureFrame
    class="bivariate-distribution-cahier"
    size="compact"
    :style="CAHIER_FIGURE_STYLE"
    :x-title="distribution.breadthAxisLabel"
    :y-title="distribution.depthAxisLabel"
  >
    <template #plot>
      <div class="bivariate-distribution-plot cahier-figure-plot">
        <svg
          class="bivariate-distribution-svg"
          :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          :aria-label="accessibleLabel"
        >
          <g class="bivariate-grid" aria-hidden="true">
            <polygon
              v-for="cell in territoryCells"
              :key="`territory-${cell.key}`"
              class="bivariate-cell-territory"
              :points="`${cell.x},${cell.y} ${cell.x + cell.width},${cell.y} ${cell.x},${cell.y + cell.height}`"
              :style="{ fill: territoryColor(cell.share) }"
            />
            <polygon
              v-for="cell in comparisonCells"
              :key="`comparison-${cell.key}`"
              class="bivariate-cell-comparison"
              :points="`${cell.x + cell.width},${cell.y} ${cell.x + cell.width},${cell.y + cell.height} ${cell.x},${cell.y + cell.height}`"
              :style="{ fill: comparisonColor(cell.comparisonShare) }"
            />
            <line
              v-for="cell in renderedCells"
              :key="`line-${cell.key}`"
              class="bivariate-grid-line"
              :x1="cell.x"
              :x2="cell.x + cell.width"
              :y1="cell.y"
              :y2="cell.y"
            />
            <line
              class="bivariate-grid-axis"
              :x1="MARGIN.left"
              :x2="MARGIN.left + PLOT_WIDTH"
              :y1="MARGIN.top + PLOT_HEIGHT"
              :y2="MARGIN.top + PLOT_HEIGHT"
            />
          </g>
          <g class="bivariate-grid-labels" aria-hidden="true">
            <text
              v-for="cell in territoryCells"
              :key="`share-territory-${cell.key}`"
              class="bivariate-grid-share bivariate-grid-share--territory"
              :x="cell.x + cell.width * 0.3"
              :y="cell.y + cell.height * 0.34 + 4"
              text-anchor="middle"
            >{{ formatShare(cell.share) }}</text>
            <text
              v-for="cell in comparisonCells"
              :key="`share-comparison-${cell.key}`"
              class="bivariate-grid-share bivariate-grid-share--comparison"
              :x="cell.x + cell.width * 0.7"
              :y="cell.y + cell.height * 0.7 + 4"
              text-anchor="middle"
            >{{ cell.comparisonShareLabel }}</text>
          </g>
        </svg>
        <CahierFigureAxisLabels
          :geometry="FIGURE_GEOMETRY"
          :x-ticks="xAxisTicks"
          :y-ticks="yAxisTicks"
          :x-label-offset="8"
        />
        <div class="bivariate-cell-hitboxes" aria-label="Détails des cellules">
          <button
            v-for="cell in interactiveCells"
            :key="`hitbox-${cell.key}`"
            class="bivariate-cell-hitbox"
            :data-cell="cell.key"
            type="button"
            :style="cellHitboxStyle(cell)"
            :aria-label="`${cell.label} : ${cell.shareLabel}`"
            @mouseenter="selectedCell = cell"
            @mouseleave="selectedCell = null"
            @focus="selectedCell = cell"
            @blur="selectedCell = null"
            @click="selectedCell = cell"
          />
        </div>
        <CahierFigureTooltip
          v-if="selectedCell"
          class="bivariate-distribution-tooltip cahier-figure-tooltip--chart"
          :title="tooltipTitle(selectedCell)"
          :rows="tooltipRows(selectedCell)"
          :anchor="tooltipAnchor"
          aria-live="polite"
        />
      </div>
    </template>
    <div class="bivariate-ramp-legend" aria-label="Échelles des parts de bâtiments">
      <div class="bivariate-ramp-legend__item">
        <span>Faible</span>
        <span class="bivariate-ramp-legend__triangle bivariate-ramp-legend__triangle--territory" aria-hidden="true" />
        <span class="bivariate-ramp-legend__scale bivariate-ramp-legend__scale--territory" aria-hidden="true" />
        <span>Forte</span>
        <strong>{{ territoryName }}</strong>
      </div>
      <div class="bivariate-ramp-legend__item">
        <span>Faible</span>
        <span class="bivariate-ramp-legend__triangle bivariate-ramp-legend__triangle--comparison" aria-hidden="true" />
        <span class="bivariate-ramp-legend__scale bivariate-ramp-legend__scale--comparison" aria-hidden="true" />
        <span>Forte</span>
        <strong>Groupe comparé</strong>
      </div>
    </div>
  </CahierFigureFrame>
</template>

<style>
.bivariate-distribution-cahier {
  width: 100%;
  min-width: 0;
}

.bivariate-distribution-plot {
  position: relative;
  width: 100%;
  aspect-ratio: 640 / 404;
}

.bivariate-distribution-svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}

.bivariate-cell-territory,
.bivariate-cell-comparison {
  pointer-events: none;
}

.bivariate-grid-line {
  stroke: color-mix(in srgb, var(--cahier-theme) 25%, transparent);
  stroke-width: 1;
}

.bivariate-grid-axis {
  stroke: var(--cahier-theme-strong);
  stroke-width: 1.5;
}

.bivariate-grid-labels text {
  fill: var(--cahier-default);
  font-family: var(--font-sans);
  font-size: 12px;
}

.bivariate-grid-share {
  fill: var(--ink);
  font-size: 11px !important;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
}

.bivariate-ramp-legend {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 18px;
  margin-top: 10px;
  color: var(--cahier-default);
  font-size: 11px;
}

.bivariate-ramp-legend__item {
  display: grid;
  grid-template-columns: auto 12px minmax(72px, 1fr) auto;
  align-items: center;
  gap: 6px;
}

.bivariate-ramp-legend__item strong {
  grid-column: 1 / -1;
  color: var(--cahier-default);
  font-weight: 700;
  text-align: center;
}

.bivariate-ramp-legend__scale {
  height: 8px;
}

.bivariate-ramp-legend__triangle {
  width: 12px;
  height: 12px;
}

.bivariate-ramp-legend__triangle--territory {
  background: color-mix(in srgb, var(--cahier-mode-foot) 88%, var(--cahier-figure-surface));
  clip-path: polygon(0 0, 100% 0, 0 100%);
}

.bivariate-ramp-legend__triangle--comparison {
  background: var(--cahier-region-emphasis);
  clip-path: polygon(100% 0, 100% 100%, 0 100%);
}

.bivariate-ramp-legend__scale--territory {
  background: linear-gradient(90deg,
    color-mix(in srgb, var(--cahier-mode-foot) 12%, var(--cahier-figure-surface)),
    color-mix(in srgb, var(--cahier-mode-foot) 88%, var(--cahier-figure-surface)));
}

.bivariate-ramp-legend__scale--comparison {
  background: linear-gradient(90deg,
    color-mix(in oklab, var(--cahier-region-emphasis) 25%, var(--cahier-figure-surface)),
    var(--cahier-region-emphasis));
}

.bivariate-cell-hitboxes {
  position: absolute;
  inset: 0;
}

.bivariate-cell-hitbox {
  position: absolute;
  display: block;
  margin: 0;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 2px;
  background: transparent;
  cursor: help;
}

.bivariate-cell-hitbox:hover,
.bivariate-cell-hitbox:focus-visible {
  border-color: var(--cahier-theme-strong);
  outline: 2px solid color-mix(in srgb, var(--cahier-theme-strong) 45%, transparent);
  outline-offset: -2px;
}

.bivariate-distribution-tooltip {
  pointer-events: none;
}

@media (max-width: 640px) {
  .bivariate-grid-labels text {
    font-size: 11px;
  }

  .bivariate-grid-share {
    font-size: 10px !important;
  }

  .bivariate-ramp-legend {
    grid-template-columns: 1fr;
  }
}
</style>
