<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

import type { NumericFact } from '@/fiche/content/territoryFacts'
import CahierRank from './CahierRank.vue'

const props = withDefaults(
  defineProps<{
    fact: NumericFact
    comparisonLabel: string | null
    to?: RouteLocationRaw | null
    maximumFractionDigits?: number
  }>(),
  { to: null, maximumFractionDigits: 1 },
)

function formatNumber(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits }).format(value)
}

function comparisonText(fact: NumericFact): string | null {
  const value = fact.comparison?.reference?.value
  if (value === undefined) return null
  return fact.unit === '%'
    ? `${formatNumber(value * 100, 0)} %`
    : formatNumber(value, props.maximumFractionDigits)
}
</script>

<template>
  <p
    v-if="comparisonText(fact) || fact.comparison?.rank"
    class="cahier-comparison-value cahier-figure-comparison"
  >
    <span v-if="comparisonText(fact)" class="cahier-comparison-value__reference">
      {{ comparisonLabel ?? 'Groupe comparé' }} :
      <strong class="region-emphasis">{{ comparisonText(fact) }}</strong>
    </span>
    <span v-if="fact.comparison" class="cahier-comparison-value__rank">
      <CahierRank
        v-if="fact.comparison.rank"
        :fact="fact"
        :to="to"
        placement="access"
      />
    </span>
  </p>
</template>

<style scoped>
.cahier-comparison-value {
  display: grid;
  grid-template-rows: auto minmax(2.5em, auto);
  justify-items: center;
  width: 100%;
  min-width: 0;
  row-gap: 2px;
  margin: 0;
  color: var(--cahier-default);
  font: var(--type-figure-comparison);
  text-align: center;
}

.cahier-comparison-value__reference {
  min-width: 0;
  max-width: 100%;
  white-space: normal;
  overflow-wrap: break-word;
}

.cahier-comparison-value__rank {
  display: flex;
  min-width: 0;
  min-height: 2.5em;
  align-items: center;
  justify-content: center;
  gap: 0.3em;
  width: 100%;
  line-height: 1.2;
}

.cahier-comparison-value .region-emphasis {
  color: var(--cahier-region-emphasis);
  font-weight: 700;
}
</style>
