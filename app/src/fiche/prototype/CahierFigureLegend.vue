<script setup lang="ts">
import type { FigureLegendEntry } from '../cahierFigureGrammaire'
import CahierFigureLegendMark from './CahierFigureLegendMark.vue'

const props = defineProps<{
  entries: readonly FigureLegendEntry[]
  icons?: Readonly<Record<string, import('vue').Component>>
  markColors?: Readonly<Record<string, string>>
  label?: string
  selectedKeys?: readonly string[]
  toggleKeys?: readonly string[]
}>()
const emit = defineEmits<{ toggle: [key: string] }>()
</script>

<template>
  <ul class="cahier-figure-legend" :aria-label="props.label">
    <li v-for="entry in props.entries" :key="entry.key" class="cahier-figure-legend-item">
      <button v-if="props.toggleKeys?.includes(entry.key)" class="cahier-figure-legend-toggle" type="button" :aria-pressed="props.selectedKeys?.includes(entry.key) ?? false" @click="emit('toggle', entry.key)">
      <CahierFigureLegendMark
        :entry="entry"
        :icons="props.icons"
        :mark-color="props.markColors?.[entry.key]"
      />
      <span class="cahier-figure-legend-label">{{ entry.label }}</span>
      </button>
      <template v-else><CahierFigureLegendMark :entry="entry" :icons="props.icons" :mark-color="props.markColors?.[entry.key]" /><span class="cahier-figure-legend-label">{{ entry.label }}</span></template>
    </li>
  </ul>
</template>

<style scoped>
.cahier-figure-legend-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
}

.cahier-figure-legend-toggle:hover,
.cahier-figure-legend-toggle[aria-pressed="true"]:hover {
  background: var(--surface-tertiary);
}

.cahier-figure-legend-toggle[aria-pressed="false"] {
  opacity: 0.58;
}

.cahier-figure-legend-toggle:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}
</style>
<style src="./cahierFigure.css"></style>
