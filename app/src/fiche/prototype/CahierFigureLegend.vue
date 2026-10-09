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
  actionKeys?: readonly string[]
  counts?: Readonly<Record<string, number>>
}>()
const emit = defineEmits<{ toggle: [key: string]; activate: [key: string] }>()
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
      <strong v-if="props.counts && entry.key in props.counts" class="cahier-figure-legend-count">{{ props.counts[entry.key] }}</strong>
      </button>
      <button v-else-if="props.actionKeys?.includes(entry.key)" class="cahier-figure-legend-action" type="button" @click="emit('activate', entry.key)">
        <CahierFigureLegendMark :entry="entry" :icons="props.icons" :mark-color="props.markColors?.[entry.key]" />
        <span class="cahier-figure-legend-label">{{ entry.label }}</span>
        <strong v-if="props.counts && entry.key in props.counts" class="cahier-figure-legend-count">{{ props.counts[entry.key] }}</strong>
      </button>
      <template v-else><CahierFigureLegendMark :entry="entry" :icons="props.icons" :mark-color="props.markColors?.[entry.key]" /><span class="cahier-figure-legend-label">{{ entry.label }}</span><strong v-if="props.counts && entry.key in props.counts" class="cahier-figure-legend-count">{{ props.counts[entry.key] }}</strong></template>
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

.cahier-figure-legend-action {
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

.cahier-figure-legend-count { font-variant-numeric: tabular-nums; }

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

.cahier-figure-legend-action:hover { background: var(--surface-tertiary); }
.cahier-figure-legend-action:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: 2px; }
</style>
<style>
@import "./cahierFigure.css";
</style>
