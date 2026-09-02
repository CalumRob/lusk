<script setup lang="ts">
import type { FigureLegendEntry } from '../cahierFigureGrammaire'
import CahierFigureLegendMark from './CahierFigureLegendMark.vue'

const props = defineProps<{
  entries: readonly FigureLegendEntry[]
  icons?: Readonly<Record<string, import('vue').Component>>
  markColors?: Readonly<Record<string, string>>
  label?: string
}>()
</script>

<template>
  <ul class="cahier-figure-legend" :aria-label="props.label">
    <li v-for="entry in props.entries" :key="entry.key" class="cahier-figure-legend-item">
      <CahierFigureLegendMark
        :entry="entry"
        :icons="props.icons"
        :mark-color="props.markColors?.[entry.key]"
      />
      <span class="cahier-figure-legend-label">{{ entry.label }}</span>
    </li>
  </ul>
</template>

<style src="./cahierFigure.css"></style>
