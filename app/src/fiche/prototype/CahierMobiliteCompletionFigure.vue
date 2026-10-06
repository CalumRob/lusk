<script setup lang="ts">
import { computed } from 'vue'
import type { ContentFact } from '../content/themeContent'
import CahierFigureScalar from './CahierFigureScalar.vue'

const props = defineProps<{ kind: 'motorisation' | 'public-transport'; facts: readonly ContentFact[] }>()
const visibleFacts = computed(() => props.facts.filter((item): item is ContentFact => Boolean(item?.fact)))
function affichage(fact: ContentFact): string {
  return fact.fact.value === null ? 'Indisponible' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(fact.fact.value)
}
</script>

<template>
  <div class="cahier-figure-frame completion-figure" :data-family="kind">
    <CahierFigureScalar
      v-for="item in visibleFacts"
      :key="`${item.fact.key}:${item.fact.detail ?? ''}`"
      :value="affichage(item)"
      :label="item.label"
      :aria-label="`${item.label} : ${affichage(item)} ${item.fact.unit}`"
    />
  </div>
</template>

<style src="./cahierFigure.css"></style>
<style scoped>
.completion-figure { display: flex; flex-wrap: wrap; align-items: stretch; gap: var(--space-4); }
</style>
