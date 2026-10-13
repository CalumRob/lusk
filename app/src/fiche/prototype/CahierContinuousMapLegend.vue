<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  title: string
  minimum?: number
  maximum?: number
  colors: readonly string[]
  ticks?: readonly number[]
  tickLabels?: readonly string[]
  note: string
  ariaLabel?: string
}>()

const tickFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 })
const labels = computed(() => props.tickLabels ?? props.ticks?.map((tick) => tickFormatter.format(tick)) ?? [])
const accessibleLabel = computed(() => props.ariaLabel ?? [
  props.title.replace(/\*$/, ''),
  props.minimum === undefined || props.maximum === undefined
    ? null
    : `Échelle de ${props.minimum} à ${props.maximum} types d’équipements accessibles`,
  props.note.replace(/^\*\s*/, ''),
].filter(Boolean).join('. '))
</script>

<template>
  <div
    class="cahier-figure-legend cahier-map-legend"
    role="group"
    :aria-label="accessibleLabel"
  >
    <p class="cahier-map-legend__title type-figure-label">{{ props.title }}</p>
    <div class="cahier-map-legend__ramp" aria-hidden="true">
      <span
        v-for="(color, index) in props.colors"
        :key="color"
        class="cahier-map-legend__swatch"
        :class="{ 'cahier-map-legend__swatch--first': index === 0, 'cahier-map-legend__swatch--last': index === props.colors.length - 1 }"
        :style="{ backgroundColor: color }"
      />
    </div>
    <div class="cahier-map-legend__ticks" aria-hidden="true">
      <span
        v-for="(label, index) in labels"
        :key="`${index}-${label}`"
        class="cahier-map-legend__tick"
      >{{ label }}</span>
    </div>
    <p class="cahier-map-legend__note cahier-evidence-source">{{ props.note }}</p>
  </div>
</template>

<style scoped>
.cahier-map-legend { display: grid; gap: 4px; width: 100%; margin: 0; }
.cahier-map-legend__title { margin: 0; text-align: center; }
.cahier-map-legend__ramp { display: flex; height: 8px; overflow: hidden; border-radius: 4px; }
.cahier-map-legend__swatch { flex: 1 1 0; }
.cahier-map-legend__swatch--first { border-radius: 4px 0 0 4px; }
.cahier-map-legend__swatch--last { border-radius: 0 4px 4px 0; }
.cahier-map-legend__ticks { display: flex; justify-content: space-between; font-variant-numeric: tabular-nums; }
.cahier-map-legend__note { text-align: center; }
</style>

<style src="./cahierEvidenceSource.css"></style>
