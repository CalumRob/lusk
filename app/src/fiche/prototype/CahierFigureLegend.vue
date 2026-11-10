<script setup lang="ts">
import type { FigureLegendEntry } from '../cahierFigureGrammaire'
import CahierFigureLegendMark from './CahierFigureLegendMark.vue'
import { AlertTriangle, LoaderCircle } from 'lucide-vue-next'
import { ref, useId } from 'vue'

const props = defineProps<{
  entries: readonly FigureLegendEntry[]
  icons?: Readonly<Record<string, import('vue').Component>>
  markColors?: Readonly<Record<string, string>>
  label?: string
  selectedKeys?: readonly string[]
  toggleKeys?: readonly string[]
  actionKeys?: readonly string[]
  counts?: Readonly<Record<string, number>>
  chipFills?: Readonly<Record<string, string>>
  chipInks?: Readonly<Record<string, string>>
  comparisonStatus?: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'
  comparisonError?: string
}>()
const emit = defineEmits<{ toggle: [key: string]; activate: [key: string] }>()
const explanationOpen = ref(false)
const explanationId = `legend-comparison-help-${useId()}`
function closeExplanation(event: KeyboardEvent): void { if (event.key === 'Escape') explanationOpen.value = false }

function chipStyle(key: string): Record<string, string> | undefined {
  const fill = props.chipFills?.[key]
  if (!fill) return undefined
  return {
    '--cahier-figure-legend-chip-fill': fill,
    '--cahier-figure-legend-chip-ink': props.chipInks?.[key] ?? 'currentColor',
  }
}
</script>

<template>
  <ul class="cahier-figure-legend" :aria-label="props.label">
    <li v-for="entry in props.entries" :key="entry.key" class="cahier-figure-legend-item" :aria-label="entry.ariaLabel">
      <button v-if="['reference', 'comparison'].includes(entry.key) && props.comparisonStatus === 'error'" class="cahier-figure-legend-toggle cahier-figure-legend-comparison-error" type="button" :aria-label="entry.ariaLabel" :aria-expanded="explanationOpen" :aria-describedby="explanationOpen ? explanationId : undefined" @mouseenter="explanationOpen = true" @mouseleave="explanationOpen = false" @focus="explanationOpen = true" @blur="explanationOpen = false" @click="explanationOpen = true" @keydown="closeExplanation">
        <AlertTriangle aria-hidden="true" /><span class="cahier-figure-legend-label">{{ entry.label }}</span>
        <span v-if="explanationOpen" :id="explanationId" class="cahier-figure-legend-explanation" role="tooltip">Comparaison indisponible : {{ props.comparisonError || 'la lecture du groupe comparé a échoué.' }}</span>
      </button>
      <button v-else-if="['reference', 'comparison'].includes(entry.key) && props.comparisonStatus === 'loading'" class="cahier-figure-legend-toggle" type="button" :aria-label="'Chargement du groupe comparé'" disabled>
        <LoaderCircle class="cahier-figure-legend-spinner" aria-hidden="true" /><span class="cahier-figure-legend-label">{{ entry.label }}</span>
      </button>
      <button v-else-if="props.toggleKeys?.includes(entry.key) || entry.persistentToggle" class="cahier-figure-legend-toggle" type="button" :aria-label="entry.ariaLabel" :aria-pressed="props.selectedKeys?.includes(entry.key) ?? false" @click="emit('toggle', entry.key)">
      <CahierFigureLegendMark
        :entry="entry"
        :icons="props.icons"
        :mark-color="props.markColors?.[entry.key]"
      />
      <span class="cahier-figure-legend-label">{{ entry.label }}</span>
      <strong v-if="props.counts && entry.key in props.counts" class="cahier-figure-legend-count">{{ props.counts[entry.key] }}</strong>
      </button>
      <button v-else-if="props.actionKeys?.includes(entry.key)" class="cahier-figure-legend-action" :data-legend-key="entry.key" :aria-label="entry.ariaLabel" :class="{ 'cahier-figure-legend-action--chip': props.chipFills?.[entry.key] }" :style="chipStyle(entry.key)" type="button" @click="emit('activate', entry.key)">
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
  min-height: 2.75rem;
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
.cahier-figure-legend-comparison-error { position: relative; color: var(--status-warning); }
.cahier-figure-legend-explanation { position: absolute; z-index: 3; bottom: calc(100% + .25rem); left: 0; width: max-content; max-width: min(22rem, 80vw); padding: var(--space-2) var(--space-3); color: var(--text-primary); background: var(--surface-elevated); border: 1px solid var(--border-default); border-radius: var(--radius-md); box-shadow: var(--shadow-prominent); font: var(--text-body-sm); text-align: left; pointer-events: none; }
.cahier-figure-legend-spinner { width: 1rem; height: 1rem; animation: legend-comparison-spin .8s linear infinite; }
@keyframes legend-comparison-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .cahier-figure-legend-spinner { animation: none; } }

.cahier-figure-legend-action:hover { background: var(--surface-tertiary); }
.cahier-figure-legend-action:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: 2px; }
@media (max-width: 760px) {
  .cahier-figure-legend-action--chip {
    min-height: 36px;
    border-color: transparent;
    border-radius: var(--radius-full);
    background-color: var(--cahier-figure-legend-chip-fill);
    color: var(--cahier-figure-legend-chip-ink);
  }
  .cahier-figure-legend-action--chip .cahier-figure-legend-icon {
    color: var(--cahier-figure-legend-chip-ink) !important;
  }
  .cahier-figure-legend-action--chip:hover {
    background-color: var(--cahier-figure-legend-chip-fill);
    outline: 2px solid currentColor;
    outline-offset: 2px;
  }
  .cahier-figure-legend-action--chip:active {
    border-color: currentColor;
    transform: scale(0.96);
  }
}
</style>
<style>
@import "./cahierFigure.css";
</style>
