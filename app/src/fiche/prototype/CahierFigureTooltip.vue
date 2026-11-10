<script setup lang="ts">
import { GROUPE_COMPARE_LABEL, groupeCompareAria } from '@/fiche/content/comparisonWording'
import type {
  CahierFigureTooltipAnchor,
  CahierTooltipComparison,
  CahierTooltipRow,
} from '../cahierFigureGrammaire'

withDefaults(
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

function comparisonAria(comparison: CahierTooltipComparison): string {
  return comparison.ariaLabel ?? groupeCompareAria(comparison.value, comparison.rank)
}

function rowAriaLabel(row: CahierTooltipRow): string {
  const focal = row.ariaLabel ?? `${row.label} : ${row.value}`
  return row.comparison ? `${focal}. ${comparisonAria(row.comparison)}` : focal
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
    <dl v-if="rows.length">
      <div
        v-for="row in rows"
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
            :style="row.markerColor ? { color: row.markerColor } : undefined"
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
        <dd v-if="row.comparison" class="cahier-figure-tooltip-row-comparison">
          <span class="cahier-figure-tooltip-comparison-label">{{ GROUPE_COMPARE_LABEL }}</span>
          <span class="cahier-figure-tooltip-comparison-value">{{ row.comparison.value }}</span>
          <small v-if="row.comparison.rank" class="cahier-figure-tooltip-comparison-rank">{{ row.comparison.rank }}</small>
        </dd>
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
