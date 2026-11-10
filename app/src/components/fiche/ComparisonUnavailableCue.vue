<script setup lang="ts">
import { ref, useId } from 'vue'
import { AlertTriangle } from 'lucide-vue-next'
import { COMPARAISON_INDISPONIBLE_RAISON, COMPARAISON_INDISPONIBLE_TITRE } from '@/fiche/content/comparisonWording'

/**
 * Compact, non-retryable comparison cue: an alert icon whose explanation is
 * available on hover, keyboard focus and tap. It never adds a paragraph above
 * the owning figure; callers place it in their existing slot or data area.
 */
const props = withDefaults(defineProps<{
  titre?: string
  raison?: string
  align?: 'center' | 'end'
  placement?: 'above' | 'below'
}>(), {
  titre: COMPARAISON_INDISPONIBLE_TITRE,
  raison: COMPARAISON_INDISPONIBLE_RAISON,
  align: 'center',
  placement: 'above',
})
const explanationOpen = ref(false)
const explanationId = `comparison-unavailable-${useId()}`
function closeExplanation(event: KeyboardEvent): void {
  if (event.key === 'Escape') explanationOpen.value = false
}
</script>

<template>
  <span class="comparison-unavailable-cue" :class="{
    'comparison-unavailable-cue--end': props.align === 'end',
    'comparison-unavailable-cue--below': props.placement === 'below',
  }">
    <button
      class="comparison-unavailable-cue__trigger"
      type="button"
      :aria-label="`${props.titre}. Afficher l’explication`"
      :aria-expanded="explanationOpen"
      :aria-describedby="explanationOpen ? explanationId : undefined"
      @mouseenter="explanationOpen = true"
      @mouseleave="explanationOpen = false"
      @focus="explanationOpen = true"
      @blur="explanationOpen = false"
      @click="explanationOpen = true"
      @keydown="closeExplanation"
    >
      <AlertTriangle aria-hidden="true" />
    </button>
    <span v-if="explanationOpen" :id="explanationId" class="comparison-unavailable-cue__explanation" role="tooltip">
      {{ props.titre }} : {{ props.raison }}
    </span>
  </span>
</template>

<style scoped>
.comparison-unavailable-cue {
  position: relative;
  display: inline-grid;
  place-items: center;
  flex: 0 0 2.75rem;
  width: 2.75rem;
  height: 2.75rem;
}
.comparison-unavailable-cue__trigger {
  width: 2.75rem;
  height: 2.75rem;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: var(--status-warning);
  background: transparent;
  cursor: help;
}
.comparison-unavailable-cue__trigger:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.comparison-unavailable-cue__explanation {
  position: absolute;
  z-index: 3;
  bottom: calc(100% + .25rem);
  left: 50%;
  width: max-content;
  max-width: min(22rem, 80vw);
  padding: var(--space-2) var(--space-3);
  transform: translateX(-50%);
  color: var(--text-primary);
  background: var(--surface-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-prominent);
  font: var(--text-body-sm);
  text-align: left;
  pointer-events: none;
}
.comparison-unavailable-cue--end .comparison-unavailable-cue__explanation {
  left: auto;
  right: 0;
  transform: none;
}
.comparison-unavailable-cue--below .comparison-unavailable-cue__explanation {
  bottom: auto;
  top: calc(100% + .25rem);
}
</style>
