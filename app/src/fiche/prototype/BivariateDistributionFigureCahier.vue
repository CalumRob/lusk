<script setup lang="ts">
/**
 * Same-building breadth × depth distribution (#550).
 *
 * The payload owns the axes, buckets, labels, counts and shares. This adapter
 * only lays those facts out as a responsive SVG grid and exposes the same
 * cells as a readable HTML table.
 */
import { computed } from 'vue'

import type { MobiliteBuildingDistribution } from '@/fiche/content/territoryFacts'
import { CAHIER_FIGURE_STYLE } from '@/fiche/cahierFigureGrammaire'
import CahierFigureFrame from './CahierFigureFrame.vue'

const props = defineProps<{
  distribution: MobiliteBuildingDistribution
  territoryName: string
}>()

const WIDTH = 640
const HEIGHT = 430
const MARGIN = { top: 22, right: 20, bottom: 84, left: 118 }
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom

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
  ...props.distribution.cells.map((cell) => cell.share),
))

const cellWidth = computed(() => PLOT_WIDTH / Math.max(props.distribution.breadthBins.length, 1))
const cellHeight = computed(() => PLOT_HEIGHT / Math.max(props.distribution.depthBins.length, 1))

const renderedCells = computed(() => props.distribution.breadthBins.flatMap((breadth, xIndex) =>
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
      shareLabel: cell ? formatShare(cell.share) : '—',
      breadthLabel: breadth.label,
      depthLabel: depth.label,
      label: `${breadth.label}, ${depth.label}`,
      value: cell
        ? `${formatNumber(cell.buildingCount, 0)} bâtiments, ${formatShare(cell.share)}`
        : 'Aucun bâtiment',
    }
  }),
))

const xLabels = computed(() => props.distribution.breadthBins.map((bin, index) => ({
  ...bin,
  x: MARGIN.left + (index + 0.5) * cellWidth.value,
})))

const yLabels = computed(() => props.distribution.depthBins.map((bin, index) => ({
  ...bin,
  y: MARGIN.top + (props.distribution.depthBins.length - 1 - index + 0.5) * cellHeight.value,
})))

const accessibleLabel = computed(() => {
  const strongest = [...props.distribution.cells].sort((left, right) => right.share - left.share)[0]
  const lead = strongest
    ? ` La case la plus représentée est ${strongest.share.toLocaleString('fr-FR', { style: 'percent', maximumFractionDigits: 1 })}.`
    : ''
  return `${props.territoryName}. Répartition des bâtiments selon ${props.distribution.breadthAxisLabel} et ${props.distribution.depthAxisLabel}.${lead}`
})
</script>

<template>
  <CahierFigureFrame
    class="bivariate-distribution-cahier"
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
            <rect
              v-for="cell in renderedCells"
              :key="cell.key"
              class="bivariate-grid-cell"
              :x="cell.x"
              :y="cell.y"
              :width="cell.width"
              :height="cell.height"
              :style="{ opacity: cell.share === 0 ? 0.06 : 0.16 + 0.84 * (cell.share / maxShare) }"
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
              v-for="label in xLabels"
              :key="`x-${label.key}`"
              :x="label.x"
              :y="MARGIN.top + PLOT_HEIGHT + 20"
              text-anchor="middle"
            >{{ label.label }}</text>
            <text
              v-for="label in yLabels"
              :key="`y-${label.key}`"
              :x="MARGIN.left - 12"
              :y="label.y + 4"
              text-anchor="end"
            >{{ label.label }}</text>
            <text
              v-for="cell in renderedCells"
              :key="`share-${cell.key}`"
              v-show="cell.share > 0"
              class="bivariate-grid-share"
              :x="cell.x + cell.width / 2"
              :y="cell.y + cell.height / 2 + 4"
              text-anchor="middle"
            >{{ formatShare(cell.share) }}</text>
          </g>
        </svg>
      </div>
    </template>
    <p class="bivariate-distribution-note">
      Mode : {{ distribution.modeLabel }}.
      Chaque case indique une part des {{ formatNumber(distribution.totalBuildings, 0) }} bâtiments analysés.
      Les pourcentages sont écrits dans les cases pour ne pas dépendre de la teinte.
    </p>
    <details class="bivariate-distribution-details">
      <summary>Lire les cellules</summary>
      <table>
        <caption>
          Répartition des bâtiments de {{ territoryName }} selon {{ distribution.breadthAxisLabel }} et {{ distribution.depthAxisLabel }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ distribution.breadthAxisLabel }}</th>
            <th scope="col">{{ distribution.depthAxisLabel }}</th>
            <th scope="col">Bâtiments</th>
            <th scope="col">Part</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="cell in renderedCells" :key="`row-${cell.key}`">
            <th scope="row">{{ cell.breadthLabel }}</th>
            <td>{{ cell.depthLabel }}</td>
            <td>{{ cell.buildingCount === null ? 'Aucun bâtiment' : formatNumber(cell.buildingCount, 0) }}</td>
            <td>{{ cell.shareLabel }}</td>
          </tr>
        </tbody>
      </table>
    </details>
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
}

.bivariate-distribution-svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}

.bivariate-grid-cell {
  fill: var(--cahier-mode-foot);
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

.bivariate-distribution-note {
  margin: 10px 0 0;
  color: var(--cahier-default);
  font-size: 13px;
  line-height: 1.45;
}

.bivariate-distribution-details {
  margin-top: 12px;
  color: var(--cahier-default);
  font-size: 13px;
}

.bivariate-distribution-details summary {
  cursor: pointer;
  color: var(--cahier-theme-strong);
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.bivariate-distribution-details summary:focus-visible {
  outline: 2px solid var(--cahier-theme-strong);
  outline-offset: 4px;
}

.bivariate-distribution-details table {
  width: 100%;
  margin-top: 10px;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}

.bivariate-distribution-details th,
.bivariate-distribution-details td {
  padding: 5px 6px;
  border-bottom: 1px solid color-mix(in srgb, var(--cahier-theme) 20%, transparent);
  text-align: left;
}

.bivariate-distribution-details caption {
  margin-bottom: 8px;
  text-align: left;
}

@media (max-width: 640px) {
  .bivariate-grid-labels text {
    font-size: 11px;
  }

  .bivariate-grid-share {
    font-size: 10px !important;
  }
}
</style>
