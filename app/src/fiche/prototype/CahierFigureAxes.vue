<script setup lang="ts">
import {
  CAHIER_FIGURE_AXIS,
  CAHIER_FIGURE_GEOMETRY,
} from '../cahierFigureGrammaire'
import type { CahierFigureAxisTick, CahierFigureGeometry } from '../cahierFigureGrammaire'

const props = defineProps<{
  xTicks: readonly CahierFigureAxisTick[]
  yTicks: readonly CahierFigureAxisTick[]
  geometry?: CahierFigureGeometry
}>()

const { width, height, margin } = props.geometry ?? CAHIER_FIGURE_GEOMETRY
const axeBas = height - margin.bottom
const axeDroite = width - margin.right
const axisStyle = { '--cahier-figure-axis-width': `${CAHIER_FIGURE_AXIS.width}` }
</script>

<template>
  <g class="cahier-figure-axes" :style="axisStyle">
    <line class="cahier-figure-axis" :x1="margin.left" :x2="axeDroite" :y1="axeBas" :y2="axeBas" />
    <line class="cahier-figure-axis" :x1="margin.left" :x2="margin.left" :y1="margin.top" :y2="axeBas" />

    <g v-for="tick in xTicks" :key="`x-${tick.key}`">
      <line class="cahier-figure-tick" :x1="tick.position" :x2="tick.position" :y1="axeBas" :y2="axeBas + CAHIER_FIGURE_AXIS.tickLength" />
      <text
        v-if="tick.label !== null"
        class="cahier-figure-tick-label"
        :x="tick.position"
        :y="axeBas + CAHIER_FIGURE_AXIS.xLabelOffset"
        text-anchor="middle"
      >{{ tick.label }}</text>
    </g>

    <g v-for="tick in yTicks" :key="`y-${tick.key}`">
      <line class="cahier-figure-tick" :x1="margin.left - CAHIER_FIGURE_AXIS.tickLength" :x2="margin.left" :y1="tick.position" :y2="tick.position" />
      <text
        v-if="tick.label !== null"
        class="cahier-figure-tick-label"
        :x="margin.left - CAHIER_FIGURE_AXIS.yLabelOffset"
        :y="tick.position + CAHIER_FIGURE_AXIS.yLabelBaseline"
        text-anchor="end"
      >{{ tick.label }}</text>
    </g>
  </g>
</template>
