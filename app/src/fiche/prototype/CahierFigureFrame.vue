<script setup lang="ts">
import { ref } from 'vue'

import { CAHIER_FIGURE_STYLE } from '../cahierFigureGrammaire'

const props = defineProps<{
  xTitle?: string
  yTitle?: string
}>()

const rootElement = ref<HTMLElement | null>(null)

defineExpose({ rootElement })
</script>

<template>
  <div ref="rootElement" class="cahier-figure-frame" :style="CAHIER_FIGURE_STYLE">
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

<style src="./cahierFigure.css"></style>
