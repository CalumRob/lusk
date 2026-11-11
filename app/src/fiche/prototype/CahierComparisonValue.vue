<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import { RouterLink } from 'vue-router'

import type { NumericFact, TerritorialScalarReference } from '@/fiche/content/territoryFacts'
import CahierRank from './CahierRank.vue'
import { comparisonRank } from '@/fiche/content/comparisonRank'
import { formatServedRankAria, puceRangDirection } from '@/fiche/figureGrammaire'
import { AlertTriangle, LoaderCircle } from 'lucide-vue-next'
import { ref, useId } from 'vue'

const props = withDefaults(
  defineProps<{
    fact?: NumericFact
    /** A named mean (direct territory or selection); its identity stays in the accessible label. */
    namedReference?: Pick<TerritorialScalarReference, 'label' | 'value' | 'unit'> | null
    servedRank?: { position: number; size: number; ties?: number | null; direction: import('@/methodes/indicateurs').DirectionRang; key: string } | null
    to?: RouteLocationRaw | null
    maximumFractionDigits?: number
    comparisonStatus?: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'
    comparisonError?: string
  }>(),
  { to: null, maximumFractionDigits: 1, comparisonStatus: 'idle' },
)
const explanationOpen = ref(false)
const explanationId = `comparison-help-${useId()}`
function closeExplanation(event: KeyboardEvent): void {
  if (event.key === 'Escape') explanationOpen.value = false
}

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
  const served = props.servedRank && props.servedRank.size >= 2 && props.servedRank.position > 0
  const rank = served
    ? puceRangDirection(formatServedRankAria(props.servedRank!)!, props.servedRank!.direction).phrase
    : !props.namedReference && props.fact ? comparisonRank(props.fact)?.phrase : null
  return `Groupe comparé : ${comparisonText()}${rank ? `. Rang ${rank}` : ''}${description ? `. ${description}` : ''}`
}
</script>

<template>
  <p
    v-if="comparisonText() || fact?.comparison?.rank || servedRank?.position || comparisonStatus === 'loading' || comparisonStatus === 'error'"
    class="cahier-comparison-value cahier-figure-comparison"
    :class="{ 'cahier-comparison-value--named': namedReference }"
  >
    <component v-if="comparisonText()" :is="to ? RouterLink : 'span'" class="cahier-comparison-value__reference" :to="to || undefined" :target="to ? '_blank' : undefined" :rel="to ? 'noopener noreferrer' : undefined" :role="to ? undefined : 'img'" :aria-label="comparisonAccessibleName()">
      Groupe comparé :
      <strong class="region-emphasis">{{ comparisonText() }}</strong>
      <CahierRank v-if="(namedReference && servedRank) || (!namedReference && fact)" :fact="fact" :served-rank="servedRank" placement="comparison" decorative />
    </component>
    <span v-if="comparisonStatus === 'loading'" class="cahier-comparison-value__state" aria-hidden="true"><LoaderCircle class="cahier-comparison-value__spinner" /></span>
    <span v-if="comparisonStatus === 'error'" class="cahier-comparison-value__state">
      <button class="cahier-comparison-value__warning" type="button" aria-label="Groupe comparé indisponible. Afficher l’explication" :aria-expanded="explanationOpen" :aria-describedby="explanationOpen ? explanationId : undefined" @mouseenter="explanationOpen = true" @mouseleave="explanationOpen = false" @focus="explanationOpen = true" @blur="explanationOpen = false" @click="explanationOpen = true" @keydown="closeExplanation"><AlertTriangle aria-hidden="true" /></button>
      <span v-if="explanationOpen" :id="explanationId" class="cahier-comparison-value__explanation" role="tooltip">Comparaison indisponible : {{ comparisonError || 'la lecture du groupe comparé a échoué.' }}</span>
    </span>
  </p>
</template>

<style scoped>
.cahier-comparison-value {
  display: flex;
  min-height: 2.75rem;
  width: 100%;
  min-width: 0;
  margin: 0;
  color: var(--cahier-default);
  font: var(--type-figure-comparison);
  letter-spacing: normal;
  text-align: center;
  justify-content: center;
  align-items: center;
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

.cahier-comparison-value .region-emphasis {
  color: var(--brand-200);
  font-weight: 700;
}
.cahier-comparison-value__state { position: relative; width: 2.75rem; height: 2.75rem; display: inline-grid; flex: 0 0 2.75rem; place-items: center; }
.cahier-comparison-value__spinner { width: 1rem; height: 1rem; animation: comparison-spin .8s linear infinite; }
.cahier-comparison-value__warning { width: 2.75rem; height: 2.75rem; display: grid; place-items: center; padding: 0; border: 0; border-radius: 50%; color: var(--status-warning); background: transparent; cursor: help; }
.cahier-comparison-value__warning:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.cahier-comparison-value__explanation { position: absolute; z-index: 3; bottom: calc(100% + .25rem); left: 50%; width: max-content; max-width: min(22rem, 80vw); padding: var(--space-2) var(--space-3); transform: translateX(-50%); color: var(--text-primary); background: var(--surface-elevated); border: 1px solid var(--border-default); border-radius: var(--radius-md); box-shadow: var(--shadow-prominent); font: var(--text-body-sm); text-align: left; pointer-events: none; }
@keyframes comparison-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .cahier-comparison-value__spinner { animation: none; } }
</style>
