<script setup lang="ts">
/**
 * « Couverture du territoire » — the 0–100 % share track of Mobilité page 3
 * (#955). A compact focal fill with an explicit « Groupe comparé » tick, never
 * a second bar chart and never the `nb_buildings` denominator.
 */
import { computed } from 'vue'

import type { FigureLegendEntry } from '@/fiche/cahierFigureGrammaire'
import { GROUPE_COMPARE_LABEL } from '@/fiche/content/comparisonWording'
import type { MobiliteShareEvidence } from '@/fiche/content/themeContent'
import { formatServedRankAria } from '@/fiche/figureGrammaire'
import { LIBELLES_DIRECTION } from '@/methodes/indicateurs'
import CahierFigureLegend from './CahierFigureLegend.vue'

type ComparisonState = {
  status: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'
  error?: string
  retry?: () => void
}

const props = defineProps<{
  figure: MobiliteShareEvidence
  comparison: ComparisonState
}>()

function formatNumber(value: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits }).format(value)
}

function displayed(value: number, unit: string): string {
  const scaled = unit.trim() === '%' ? value * 100 : value
  return formatNumber(scaled)
}

const value = computed(() => {
  const fact = props.figure.value.fact
  return fact.availability === 'complete' && fact.value !== null && Number.isFinite(fact.value)
    ? fact.value : null
})
const reference = computed(() => {
  if (props.comparison.status !== 'ready') return null
  const fact = props.figure.value.fact.comparison
  if (!fact?.reference || !Number.isFinite(fact.reference.value)) return null
  return fact.reference.value
})

const valueLabel = computed(() => value.value === null
  ? 'Indisponible'
  : `${displayed(value.value, props.figure.unit)} %`)
const referenceLabel = computed(() => reference.value === null
  ? 'Indisponible'
  : `${displayed(reference.value, props.figure.unit)} %`)

function percentPosition(candidate: number | null): number {
  if (candidate === null) return 0
  return Math.max(0, Math.min(100, candidate * 100))
}

const fillPercent = computed(() => percentPosition(value.value))
const referencePercent = computed(() => percentPosition(reference.value))
const valueOnFill = computed(() => value.value !== null && fillPercent.value >= 92)
const valueStyle = computed(() => ({
  left: `${fillPercent.value}%`,
  transform: valueOnFill.value ? 'translateX(-100%)' : 'translateX(0.35rem)',
}))
const referenceStyle = computed(() => {
  const percent = referencePercent.value
  if (percent <= 4) return { left: '0%' }
  if (percent >= 96) return { left: '100%', transform: 'translateX(-100%)' }
  return { left: `${percent}%`, transform: 'translateX(-50%)' }
})

const comparisonDetail = computed(() => {
  const comparison = props.figure.value.fact.comparison
  if (!comparison) return null
  const statistic = comparison.reference?.kind === 'mean' ? 'Moyenne' : 'Médiane'
  return {
    statistic,
    label: props.figure.comparisonLabel ?? `${statistic} du groupe comparé`,
    rank: formatServedRankAria(comparison.rank),
    direction: LIBELLES_DIRECTION[comparison.direction] ?? null,
  }
})

const publicationNotes = computed(() => [
  ...(props.figure.unavailableResources ?? []).map((label) => `Publication indisponible : ${label}`),
  ...(props.figure.unavailableComparisons ?? []).map((label) => `Comparaison indisponible : ${label}`),
])

const accessibleLabel = computed(() => {
  const parts = [props.figure.figureTitle, 'Jauge de 0 à 100 %.',
    `Territoire : ${valueLabel.value}`]
  if (props.comparison.status === 'loading') {
    parts.push('Groupe comparé en cours de chargement')
  } else if (props.comparison.status === 'error') {
    parts.push(props.figure.unavailableComparisons?.length
      ? `Comparaison indisponible : ${props.figure.unavailableComparisons.join(', ')}`
      : `Groupe comparé indisponible : ${props.comparison.error ?? 'échec du chargement'}`)
  } else if (props.comparison.status === 'unavailable') {
    parts.push('Groupe comparé indisponible')
  } else if (reference.value !== null && comparisonDetail.value) {
    parts.push(`Groupe comparé : ${referenceLabel.value} (${comparisonDetail.value.label})`)
    if (comparisonDetail.value.rank) parts.push(`Rang ${comparisonDetail.value.rank}`)
    else if (comparisonDetail.value.direction) parts.push(comparisonDetail.value.direction)
  } else {
    parts.push('Groupe comparé indisponible')
  }
  parts.push(...publicationNotes.value)
  return parts.join('. ')
})

const legendEntries = computed<readonly FigureLegendEntry[]>(() => [
  {
    key: 'territory',
    label: 'Territoire',
    marker: 'line',
    tone: 'theme',
    ariaLabel: `Territoire : ${valueLabel.value}`,
  },
  {
    key: 'comparison',
    label: GROUPE_COMPARE_LABEL,
    marker: 'tick',
    tone: 'peer',
    ariaLabel: `${GROUPE_COMPARE_LABEL} : ${comparisonDetail.value?.label ?? 'Indisponible'}`,
  },
])

const legendColors = {
  territory: 'var(--cahier-theme-strong, var(--brand-600))',
  comparison: 'var(--cahier-default, var(--editorial-muted))',
}

const stateMessage = computed(() => {
  if (props.comparison.status === 'loading') return 'Chargement du groupe comparé…'
  if (props.comparison.status === 'error') {
    return props.figure.unavailableComparisons?.length ? null : props.comparison.error ?? 'Groupe comparé indisponible.'
  }
  if (props.comparison.status === 'unavailable') return 'Groupe comparé indisponible pour cette sélection.'
  if (props.comparison.status === 'idle') return 'Aucune comparaison active : aucun repère de groupe comparé n’est affiché.'
  if (reference.value === null && (props.figure.unavailableComparisons?.length ?? 0) === 0) {
    return 'Aucun repère de groupe comparé disponible pour cette sélection.'
  }
  return null
})
</script>

<template>
  <div class="mobilite-share-track">
    <div
      class="mobilite-share-track__graphic"
      role="img"
      :aria-label="accessibleLabel"
    >
      <div class="mobilite-share-track__scale" aria-hidden="true">
        <span>0 %</span>
        <span>100 %</span>
      </div>
      <div v-if="value !== null" class="mobilite-share-track__rail">
        <div
          class="mobilite-share-track__fill"
          :data-value="value"
          :style="{ width: `${fillPercent}%` }"
        />
        <span
          class="mobilite-share-track__value"
          :class="{ 'mobilite-share-track__value--on-fill': valueOnFill }"
          :style="valueStyle"
        >{{ valueLabel }}</span>
        <template v-if="reference !== null">
          <span
            class="mobilite-share-track__reference"
            :data-value="reference"
            :style="{ left: `${referencePercent}%` }"
            aria-hidden="true"
          />
          <span
            class="mobilite-share-track__reference-value"
            :style="referenceStyle"
          >{{ referenceLabel }}</span>
        </template>
      </div>
      <p v-else class="mobilite-share-track__unavailable">Indisponible</p>
    </div>

    <CahierFigureLegend
      class="mobilite-share-track__legend"
      :entries="legendEntries"
      :mark-colors="legendColors"
      :comparison-status="comparison.status"
      :comparison-error="comparison.error"
      label="Territoire et groupe comparé"
    />

    <p v-for="note in publicationNotes" :key="note" class="mobilite-share-track__state" role="note">{{ note }}</p>
    <p v-if="stateMessage" class="mobilite-share-track__state" role="status">{{ stateMessage }}</p>
    <button
      v-if="comparison.status === 'error' && comparison.retry"
      type="button"
      class="mobilite-share-track__retry"
      @click="comparison.retry()"
    >Réessayer les comparaisons</button>
  </div>
</template>

<style scoped>
.mobilite-share-track { display: grid; gap: var(--space-3); min-width: 0; }
.mobilite-share-track__graphic { display: grid; gap: var(--space-2); min-width: 0; }
.mobilite-share-track__scale {
  display: flex; justify-content: space-between;
  color: var(--cahier-default, var(--editorial-muted));
  font: var(--text-caption); font-variant-numeric: tabular-nums;
}
.mobilite-share-track__rail {
  position: relative;
  min-height: 4.5rem;
  padding-top: 1.9rem;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--cahier-theme) 12%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--cahier-theme) 22%, transparent);
}
.mobilite-share-track__fill {
  position: absolute;
  inset-block: 1.9rem 0.35rem;
  inset-inline-start: 0;
  min-width: 0;
  border-radius: var(--radius-sm) 2px 2px var(--radius-sm);
  background-color: var(--cahier-theme-strong, var(--brand-600));
  background-image: none;
}
.mobilite-share-track__value {
  position: absolute;
  bottom: 0.55rem;
  color: var(--text-primary);
  font: var(--text-body-sm);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.mobilite-share-track__value--on-fill { color: var(--paper); }
.mobilite-share-track__reference {
  position: absolute;
  top: 1.35rem;
  bottom: 0;
  width: 0;
  border-inline-start: 2px solid currentColor;
  color: var(--cahier-default, var(--editorial-muted));
  transform: translateX(-1px);
}
.mobilite-share-track__reference::before {
  content: '';
  position: absolute;
  top: -0.45rem;
  left: -0.32rem;
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  background: currentColor;
}
.mobilite-share-track__reference-value {
  position: absolute;
  top: 0;
  color: var(--cahier-default, var(--editorial-muted));
  font: var(--text-caption);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.mobilite-share-track__unavailable { margin: 0; color: var(--cahier-default, var(--editorial-muted)); font: var(--text-body-sm); }
.mobilite-share-track__legend { flex-wrap: wrap; }
.mobilite-share-track__state { margin: 0; color: var(--cahier-default, var(--editorial-muted)); font: var(--text-body-sm); }
.mobilite-share-track__retry {
  justify-self: start; min-height: 2.75rem; padding: 0 var(--space-3);
  border: 0; border-radius: var(--radius-md); background: transparent;
  color: var(--text-secondary); font: var(--text-body-sm); text-decoration: underline; cursor: pointer;
}
.mobilite-share-track__retry:hover { background: var(--surface-tertiary); color: var(--text-primary); }
.mobilite-share-track__retry:focus-visible { outline: 2px solid var(--brand-500); outline-offset: 2px; }
</style>
