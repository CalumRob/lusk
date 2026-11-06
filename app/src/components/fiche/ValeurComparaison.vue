<script setup lang="ts">
import { computed } from 'vue'
import type { Indicateur } from '@/payload/types'
import { detailsRangEnContexte, formaterValeur } from '@/payload/selectors'
import { puceRangDirection } from '@/fiche/figureGrammaire'
import PuceRang from './PuceRang.vue'

const props = defineProps<{ ligne: Pick<Indicateur, 'comparaisonApi' | 'unit'> }>()
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
  <span v-if="referenceText !== null" class="figure-indicateur-comparaison" role="img" :aria-label="accessibleName">
    Groupe comparé : <strong>{{ referenceText }}</strong>
    <PuceRang v-if="chip" :puce="chip" decorative />
  </span>
</template>

<style scoped>
.figure-indicateur-comparaison {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1);
  font: var(--type-figure-comparison);
  color: var(--color-figure-reference);
}
</style>
