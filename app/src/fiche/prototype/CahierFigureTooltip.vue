<script setup lang="ts">
import type { CahierTooltipRow } from '../cahierFigureGrammaire'

withDefaults(
  defineProps<{
    title: string
    rows: readonly CahierTooltipRow[]
    popover?: boolean
    compact?: boolean
  }>(),
  {
    popover: false,
    compact: false,
  },
)
</script>

<template>
  <div
    class="cahier-figure-tooltip"
    :class="{
      'cahier-figure-tooltip--popover': popover,
      'cahier-figure-tooltip--compact': compact,
    }"
    role="tooltip"
  >
    <strong>{{ title }}</strong>
    <dl>
      <div
        v-for="row in rows"
        :key="`${row.label}-${row.value}-${row.note ?? ''}`"
        class="cahier-figure-tooltip-row"
        :class="`cahier-figure-tooltip-row--${row.tone ?? 'neutral'}`"
      >
        <dt>
          <i
            class="cahier-figure-tooltip-marker"
            :class="row.marker ? `cahier-figure-tooltip-marker--${row.marker}` : undefined"
            :style="row.markerColor ? { background: row.markerColor } : undefined"
            aria-hidden="true"
          />
          {{ row.label }}
        </dt>
        <dd>{{ row.value }}</dd>
        <small v-if="row.note">{{ row.note }}</small>
      </div>
    </dl>
    <div v-if="$slots.actions" class="cahier-figure-tooltip-actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<style src="./cahierFigure.css"></style>
