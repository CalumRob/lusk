<script setup lang="ts">
/**
 * Marginal access ramp for the three modes.
 *
 * The pipeline sends eleven quantiles per mode rather than individual
 * buildings. Each curve is therefore a separately ranked building population;
 * equal x positions do not identify the same building across modes.
 */
import { computed } from 'vue'

import type { MobiliteAccessMode, MobiliteAccessRamp } from '@/fiche/content/territoryFacts'
import { CAHIER_FIGURE_STYLE } from '@/fiche/cahierFigureGrammaire'
import CahierFigureFrame from './CahierFigureFrame.vue'

const props = defineProps<{
  ramp: MobiliteAccessRamp
  territoryName: string
}>()

const MODE_ORDER: readonly MobiliteAccessMode[] = ['car', 'bike', 'walkTransit']
const WIDTH = 640
const HEIGHT = 300
const MARGIN = { top: 22, right: 24, bottom: 62, left: 64 }
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom

function formatNumber(value: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)
}

const curves = computed(() => MODE_ORDER.map((mode) => props.ramp.curves[mode]))

const maximum = computed(() => Math.max(
  1,
  ...curves.value.flatMap((curve) => curve.points.map((point) => point.accessibleTypes)),
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

const tablePoints = computed(() => curves.value.flatMap((curve) => curve.points.map((point) => ({
  modeLabel: curve.modeLabel,
  mode: curve.mode,
  ...point,
}))))

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
            <text
              class="access-ramp-median-label"
              :x="xFor(0.5) + 7"
              :y="MARGIN.top - 7"
            >médiane</text>
          </g>
          <path
            v-for="curve in curves"
            :key="curve.mode"
            class="access-ramp-line"
            :class="`access-ramp-line--${curve.mode}`"
            :d="pathFor(curve.points)"
            aria-hidden="true"
          />
        </svg>
      </div>
    </template>
    <ul class="access-ramp-legend" aria-label="Modes d’accès">
      <li v-for="curve in curves" :key="`legend-${curve.mode}`">
        <span class="access-ramp-legend-line" :class="`access-ramp-legend-line--${curve.mode}`" aria-hidden="true" />
        {{ curve.modeLabel }}
      </li>
    </ul>
    <p class="access-ramp-note">
      Chaque courbe classe séparément les {{ formatNumber(ramp.totalBuildings) }} bâtiments selon le nombre de {{ ramp.yAxisLabel }} atteignables.
      La médiane ne désigne pas nécessairement le même bâtiment d’un mode à l’autre.
    </p>
    <details class="access-ramp-details">
      <summary>Lire les points de la courbe</summary>
      <table>
        <caption>
          Points de la rampe d’accès de {{ territoryName }}
        </caption>
        <thead>
          <tr>
            <th scope="col">Mode</th>
            <th scope="col">Part cumulée</th>
            <th scope="col">Types accessibles</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="point in tablePoints" :key="`${point.mode}-${point.quantile}`">
            <th scope="row">{{ point.modeLabel }}</th>
            <td>{{ point.quantileLabel }}</td>
            <td>{{ formatNumber(point.accessibleTypes) }}</td>
          </tr>
        </tbody>
      </table>
    </details>
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

.access-ramp-median-label {
  font-weight: 700;
}

.access-ramp-line {
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2.5;
}

.access-ramp-line--car,
.access-ramp-legend-line--car {
  stroke: var(--cahier-mode-car);
  color: var(--cahier-mode-car);
}

.access-ramp-line--bike,
.access-ramp-legend-line--bike {
  stroke: var(--cahier-mode-bike);
  color: var(--cahier-mode-bike);
}

.access-ramp-line--walkTransit,
.access-ramp-legend-line--walkTransit {
  stroke: var(--cahier-mode-foot);
  color: var(--cahier-mode-foot);
}

.access-ramp-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  margin: 8px 0 0;
  padding: 0;
  color: var(--cahier-default);
  font-size: 13px;
  list-style: none;
}

.access-ramp-legend li {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.access-ramp-legend-line {
  display: inline-block;
  width: 20px;
  border-top: 3px solid currentColor;
}

.access-ramp-note {
  margin: 10px 0 0;
  color: var(--cahier-default);
  font-size: 13px;
  line-height: 1.45;
}

.access-ramp-details {
  margin-top: 12px;
  color: var(--cahier-default);
  font-size: 13px;
}

.access-ramp-details summary {
  cursor: pointer;
  color: var(--cahier-theme-strong);
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.access-ramp-details summary:focus-visible {
  outline: 2px solid var(--cahier-theme-strong);
  outline-offset: 4px;
}

.access-ramp-details table {
  width: 100%;
  margin-top: 10px;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}

.access-ramp-details th,
.access-ramp-details td {
  padding: 5px 6px;
  border-bottom: 1px solid color-mix(in srgb, var(--cahier-theme) 20%, transparent);
  text-align: left;
}

.access-ramp-details caption {
  margin-bottom: 8px;
  text-align: left;
}

@media (max-width: 640px) {
  .access-ramp-labels text {
    font-size: 10px;
  }
}
</style>
