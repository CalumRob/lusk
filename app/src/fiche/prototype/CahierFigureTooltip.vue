<script setup lang="ts">
import { computed } from 'vue'

import type {
  CahierFigureTooltipAnchor,
  CahierTooltipRow,
} from '../cahierFigureGrammaire'

const props = withDefaults(
  defineProps<{
    title: string
    rows: readonly CahierTooltipRow[]
    unit?: string
    anchor?: CahierFigureTooltipAnchor
    popover?: boolean
    compact?: boolean
  }>(),
  {
    popover: false,
    compact: false,
  },
)

const focalRows = computed(() => props.rows.filter((row) => !row.comparison))
const comparisonRows = computed(() => props.rows.filter((row) => row.comparison))

function rowAriaLabel(row: CahierTooltipRow): string {
  if (row.ariaLabel) return row.ariaLabel
  return `${row.label} : ${row.value}${row.rank ? `, rang ${row.rank}` : ''}`
}
</script>

<template>
  <div
    class="cahier-figure-tooltip"
    :class="{
      'cahier-figure-tooltip--popover': popover,
      'cahier-figure-tooltip--compact': compact,
    }"
    :style="anchor ? {
      '--cahier-figure-tooltip-anchor-x': anchor.x,
      '--cahier-figure-tooltip-anchor-y': anchor.y ?? '8px',
    } : undefined"
    role="tooltip"
  >
    <strong>{{ title }}</strong>
    <small v-if="unit" class="cahier-figure-tooltip-unit">{{ unit }}</small>
    <dl v-if="focalRows.length">
      <div
        v-for="row in focalRows"
        :key="`${row.label}-${row.value}`"
        class="cahier-figure-tooltip-row"
        :class="`cahier-figure-tooltip-row--${row.tone ?? 'neutral'}`"
        role="group"
        :aria-label="rowAriaLabel(row)"
      >
        <dt>
          <component
            :is="row.icon"
            v-if="row.icon"
            class="cahier-figure-tooltip-icon"
            :class="`cahier-figure-tooltip-icon--${row.tone ?? 'neutral'}`"
            :size="16"
            :stroke-width="1.8"
            aria-hidden="true"
          />
          <i
            v-else
            class="cahier-figure-tooltip-marker"
            :class="row.marker ? `cahier-figure-tooltip-marker--${row.marker}` : undefined"
            :style="row.markerColor ? { background: row.markerColor } : undefined"
            aria-hidden="true"
          />
          {{ row.label }}
        </dt>
        <dd>{{ row.value }}</dd>
      </div>
    </dl>
    <dl v-if="comparisonRows.length" class="cahier-figure-tooltip-comparison">
      <div
        v-for="row in comparisonRows"
        :key="`${row.label}-${row.value}-${row.rank ?? ''}`"
        class="cahier-figure-tooltip-row cahier-figure-tooltip-row--comparison"
        role="group"
        :aria-label="rowAriaLabel(row)"
      >
        <dt>{{ row.label }}</dt>
        <dd>{{ row.value }}</dd>
        <small v-if="row.rank" class="cahier-figure-tooltip-rank">{{ row.rank }}</small>
      </div>
    </dl>
    <div v-if="$slots.actions" class="cahier-figure-tooltip-actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<style>
@import "./cahierFigure.css";
</style>
