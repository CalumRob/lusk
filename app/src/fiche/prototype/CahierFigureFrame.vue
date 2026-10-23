<script setup lang="ts">
import { computed, ref } from 'vue'

import { cahierFigureStyle, CAHIER_FIGURE_GEOMETRY } from '../cahierFigureGrammaire'
import type { CahierFigureGeometry } from '../cahierFigureGrammaire'

const props = defineProps<{
  xTitle?: string
  yTitle?: string
  size?: 'compact' | 'standard' | 'wide'
  geometry?: CahierFigureGeometry
}>()

const rootElement = ref<HTMLElement | null>(null)
const frameStyle = computed(() => cahierFigureStyle(props.geometry ?? CAHIER_FIGURE_GEOMETRY))

defineExpose({ rootElement })
</script>

<template>
  <div
    ref="rootElement"
    class="cahier-figure-frame"
    :class="props.size ? `cahier-figure-frame--${props.size}` : 'cahier-figure-frame--standard'"
    :style="frameStyle"
  >
    <div v-if="$slots.plot" class="cahier-figure-frame__plot">
      <slot name="plot" />
      <span v-if="props.xTitle" class="cahier-figure-axis-title cahier-figure-axis-title--x type-figure-label">
        {{ props.xTitle }}
      </span>
      <span v-if="props.yTitle" class="cahier-figure-axis-title cahier-figure-axis-title--y type-figure-label">
        {{ props.yTitle }}
      </span>
    </div>
    <slot />
  </div>
</template>

<style>
@import "./cahierFigure.css";
</style>
