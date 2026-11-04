<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import { RouterLink } from 'vue-router'

import type { NumericFact, TerritorialScalarReference } from '@/fiche/content/territoryFacts'
import CahierRank from './CahierRank.vue'
import { comparisonRank } from '@/fiche/content/comparisonRank'

const props = withDefaults(
  defineProps<{
    fact?: NumericFact
    /** A named mean (direct territory or selection); its identity stays in the accessible label. */
    namedReference?: Pick<TerritorialScalarReference, 'label' | 'value' | 'unit'> | null
    to?: RouteLocationRaw | null
    maximumFractionDigits?: number
  }>(),
  { to: null, maximumFractionDigits: 1 },
)

function formatNumber(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits }).format(value)
}

function comparisonText(): string | null {
  const value = props.namedReference?.value ?? props.fact?.comparison?.reference?.value
  if (value === undefined) return null
  return (props.namedReference?.unit ?? props.fact?.unit) === '%'
    ? `${formatNumber(value * 100, 0)} %`
    : formatNumber(value, props.maximumFractionDigits)
}

function comparisonAccessibleName(): string {
  const comparison = props.fact?.comparison
  const statistic = comparison?.reference?.kind === 'mean' ? 'Moyenne' : 'Médiane'
  const description = props.namedReference?.label
    ?? (comparison?.scope.label ? `${statistic} des ${comparison.scope.label}` : null)
  const rank = !props.namedReference && props.fact ? comparisonRank(props.fact) : null
  return `Groupe comparé : ${comparisonText()}${rank ? `. Rang ${rank.phrase}` : description ? `. ${description}` : ''}`
}
</script>

<template>
  <p
    v-if="comparisonText() || fact?.comparison?.rank"
    class="cahier-comparison-value cahier-figure-comparison"
    :class="{ 'cahier-comparison-value--named': namedReference }"
  >
    <component v-if="comparisonText()" :is="to ? RouterLink : 'span'" class="cahier-comparison-value__reference" :to="to || undefined" :target="to ? '_blank' : undefined" :rel="to ? 'noopener noreferrer' : undefined" :role="to ? undefined : 'img'" :aria-label="comparisonAccessibleName()">
      Groupe comparé :
      <strong class="region-emphasis">{{ comparisonText() }}</strong>
      <CahierRank
        v-if="fact && !namedReference"
        :fact="fact"
        decorative
      />
    </component>
  </p>
</template>

<style scoped>
.cahier-comparison-value {
  display: flex;
  width: 100%;
  min-width: 0;
  margin: 0;
  color: var(--cahier-default);
  font: var(--type-figure-comparison);
  letter-spacing: normal;
  text-align: center;
  justify-content: center;
  /* Les parents donnent une largeur disponible explicite ; la référence ne doit
     pas élargir les colonnes intrinsèques des scalaires inline. */
  contain: inline-size;
}

.cahier-comparison-value__reference {
  min-width: 0;
  max-width: 100%;
  white-space: normal;
  overflow-wrap: break-word;
}

.cahier-comparison-value__reference :deep(.cahier-rank) {
  margin-inline-start: 0.5em;
}

.cahier-comparison-value .region-emphasis {
  color: var(--color-figure-reference);
  font-weight: 700;
}
</style>
