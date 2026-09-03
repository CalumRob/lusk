<script setup lang="ts">
import { CircleSlash2 } from 'lucide-vue-next'
import type { Component } from 'vue'

import type { FigureLegendEntry } from '../cahierFigureGrammaire'

const props = defineProps<{
  entry: FigureLegendEntry
  icons?: Readonly<Record<string, Component>>
  markColor?: string
}>()

function iconFor(): Component | null {
  return props.entry.iconKey ? props.icons?.[props.entry.iconKey] ?? null : null
}

function markStyle(): Record<string, string> | undefined {
  return props.markColor ? { color: props.markColor } : undefined
}
</script>

<template>
  <CircleSlash2
    v-if="entry.marker === 'slash'"
    class="cahier-figure-legend-icon cahier-figure-legend-mark--slash"
    :style="markStyle()"
    :size="16"
    :stroke-width="2.1"
    aria-hidden="true"
  />
  <component
    :is="iconFor()"
    v-else-if="entry.marker === 'icon' && iconFor()"
    class="cahier-figure-legend-icon"
    :class="`cahier-figure-legend-mark--${entry.tone ?? 'neutral'}`"
    :style="markStyle()"
    :size="16"
    :stroke-width="2.5"
    aria-hidden="true"
  />
  <i
    v-else
    class="cahier-figure-legend-mark"
    :class="[
      `cahier-figure-legend-mark--${entry.marker}`,
      `cahier-figure-legend-mark--${entry.tone ?? 'neutral'}`,
    ]"
    :style="markStyle()"
    aria-hidden="true"
  />
</template>

<style src="./cahierFigure.css"></style>
