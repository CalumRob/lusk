<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

import type { NumericFact } from '@/fiche/content/territoryFacts'
import CahierRank from './CahierRank.vue'

defineProps<{
  fact: NumericFact
  referenceLabel: string | null
  to?: RouteLocationRaw | null
}>()

function formatNumber(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits }).format(value)
}

function referenceText(fact: NumericFact): string | null {
  const value = fact.comparison?.reference?.value
  if (value === undefined) return null
  return fact.unit === '%' ? `${formatNumber(value * 100, 0)} %` : formatNumber(value)
}
</script>

<template>
  <p
    v-if="referenceText(fact) || fact.comparison?.rank"
    class="cahier-reference-note regional-reading"
  >
    <span v-if="referenceText(fact)" class="cahier-reference-value">
      {{ referenceLabel ?? 'Référence' }} :
      <strong class="region-emphasis">{{ referenceText(fact) }}</strong>
    </span>
    <br v-if="referenceText(fact) && fact.comparison?.rank" />
    <CahierRank :fact="fact" :to="to" />
  </p>
</template>

<style scoped>
.cahier-reference-note {
  display: block;
  width: 100%;
  margin: 0;
  color: var(--cahier-default);
  font: var(--type-figure-mode);
  font-size: 11px;
  line-height: 1.25;
  text-align: center;
}

.cahier-reference-value { white-space: nowrap; }
.cahier-reference-note .region-emphasis {
  color: var(--cahier-region-emphasis);
  font-weight: 700;
}
</style>
