<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { AlertTriangle, LoaderCircle } from 'lucide-vue-next'
import type { Indicateur } from '@/payload/types'
import { detailsRangEnContexte, formaterValeur } from '@/payload/selectors'
import { puceRangDirection } from '@/fiche/figureGrammaire'
import PuceRang from './PuceRang.vue'

const props = withDefaults(defineProps<{ ligne: Pick<Indicateur, 'comparaisonApi' | 'unit'>;
  status?: 'idle' | 'loading' | 'ready' | 'error'; error?: string }>(), { status: 'idle' })
const explanationOpen = ref(false)
const explanationId = `comparison-error-${useId()}`
const comparison = computed(() => props.ligne.comparaisonApi)
const referenceText = computed(() => comparison.value?.reference
  ? `${formaterValeur({ value: comparison.value.reference.value, unit: props.ligne.unit })}${props.ligne.unit ? ` ${props.ligne.unit}` : ''}` : null)
const description = computed(() => {
  const evidence = comparison.value
  const statistic = evidence?.reference?.kind === 'mean' ? 'Moyenne' : 'Médiane'
  return `${statistic}${evidence?.portee ? ` des ${evidence.portee}` : ''}`
})
const chip = computed(() => {
  const details = detailsRangEnContexte(props.ligne)
  const direction = comparison.value?.direction
  if (!details || (direction !== 'high' && direction !== 'low')) return null
  const puce = puceRangDirection(details.libelleCourt, direction === 'high' ? 'plus-est-mieux' : 'moins-est-mieux')
  return { ...puce, phrase: `${puce.phrase}. ${description.value}.` }
})
const accessibleName = computed(() => `Groupe comparé : ${referenceText.value}. ${chip.value ? `Rang ${chip.value.phrase}` : description.value}`)
</script>

<template>
  <span v-if="referenceText !== null || status === 'loading' || status === 'error'" class="figure-indicateur-comparaison">
    <span v-if="referenceText !== null" role="img" :aria-label="accessibleName">Groupe comparé : <strong>{{ referenceText }}</strong><PuceRang v-if="chip" :puce="chip" decorative /></span>
    <PuceRang v-if="referenceText === null && chip" :puce="chip" decorative />
    <span v-if="referenceText === null && status === 'loading'" class="comparison-state" role="status" aria-label="Chargement du groupe comparé"><LoaderCircle class="comparison-spinner" aria-hidden="true" /></span>
    <span v-if="referenceText === null && status === 'error'" class="comparison-state">
      <button type="button" class="comparison-warning" aria-label="Groupe comparé indisponible. Afficher l’explication" :aria-expanded="explanationOpen" :aria-describedby="explanationOpen ? explanationId : undefined" @mouseenter="explanationOpen = true" @mouseleave="explanationOpen = false" @focus="explanationOpen = true" @blur="explanationOpen = false" @click="explanationOpen = true" @keydown.esc="explanationOpen = false"><AlertTriangle aria-hidden="true" /></button>
      <span v-if="explanationOpen" :id="explanationId" class="comparison-explanation" role="tooltip">Comparaison indisponible : {{ error || 'la lecture du groupe comparé a échoué.' }}</span>
    </span>
  </span>
</template>

<style scoped>
.figure-indicateur-comparaison {
  display: flex;
  min-height: 2.75rem;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1);
  font: var(--type-figure-comparison);
  color: var(--color-figure-reference);
}
.comparison-state { position: relative; width: 2.75rem; height: 2.75rem; display: inline-grid; flex: 0 0 2.75rem; place-items: center; }
.comparison-spinner { width: 1rem; height: 1rem; animation: comparison-spin .8s linear infinite; }
.comparison-warning { width: 2.75rem; height: 2.75rem; display: grid; place-items: center; padding: 0; border: 0; border-radius: 50%; color: var(--status-warning); background: transparent; cursor: help; }
.comparison-warning:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.comparison-explanation { position: absolute; z-index: 3; bottom: calc(100% + .25rem); left: 50%; width: max-content; max-width: min(22rem, 80vw); padding: var(--space-2) var(--space-3); transform: translateX(-50%); color: var(--text-primary); background: var(--surface-elevated); border: 1px solid var(--border-default); border-radius: var(--radius-md); box-shadow: var(--shadow-prominent); font: var(--text-body-sm); text-align: left; pointer-events: none; }
@keyframes comparison-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .comparison-spinner { animation: none; } }
</style>
