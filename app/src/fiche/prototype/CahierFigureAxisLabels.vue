<script setup lang="ts">
import {
  CAHIER_FIGURE_AXIS,
  CAHIER_FIGURE_GEOMETRY,
} from '../cahierFigureGrammaire'
import type { CahierFigureAxisTick, CahierFigureGeometry } from '../cahierFigureGrammaire'

const props = withDefaults(defineProps<{
  xTicks: readonly CahierFigureAxisTick[]
  yTicks: readonly CahierFigureAxisTick[]
  geometry?: CahierFigureGeometry
  xLabelOffset?: number
  yLabelOffset?: number
  yLabelBaseline?: number
}>(), {
  geometry: () => CAHIER_FIGURE_GEOMETRY,
  xLabelOffset: CAHIER_FIGURE_AXIS.xLabelOffset,
  yLabelOffset: CAHIER_FIGURE_AXIS.yLabelOffset,
  yLabelBaseline: CAHIER_FIGURE_AXIS.yLabelBaseline,
})

function xLabelStyle(tick: CahierFigureAxisTick): Record<string, string> {
  return {
    left: `${(tick.position / props.geometry.width) * 100}%`,
    top: `${((props.geometry.height - props.geometry.margin.bottom + props.xLabelOffset) / props.geometry.height) * 100}%`,
  }
}

function yLabelStyle(tick: CahierFigureAxisTick): Record<string, string> {
  return {
    left: `${((props.geometry.margin.left - props.yLabelOffset) / props.geometry.width) * 100}%`,
    top: `${((tick.position + props.yLabelBaseline) / props.geometry.height) * 100}%`,
  }
}
</script>

<template>
  <div class="cahier-figure-axis-labels" aria-hidden="true">
    <template v-for="tick in props.xTicks" :key="`x-${tick.key}`">
      <span
        v-if="tick.label !== null"
        class="cahier-figure-tick-label cahier-figure-tick-label--x"
        :style="xLabelStyle(tick)"
      >{{ tick.label }}</span>
    </template>
    <template v-for="tick in props.yTicks" :key="`y-${tick.key}`">
      <span
        v-if="tick.label !== null"
        class="cahier-figure-tick-label cahier-figure-tick-label--y"
        :style="yLabelStyle(tick)"
      >{{ tick.label }}</span>
    </template>
  </div>
</template>
