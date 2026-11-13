<script setup lang="ts">
/**
 * [PROTOTYPE page 3 — JETABLE] « Couverture du territoire ».
 *
 * Deux barres empilées à 100 % : la ligne « Territoire », puis la ligne du
 * groupe comparé actif de l'en-tête. Chaque barre se partage entre la part
 * publiée « à proximité d'un arrêt » et son complément. Le complément n'est
 * qu'une lecture visuelle du reste de la barre : ce n'est ni une mesure
 * publiée, ni un rang, ni une statistique recalculée dans le navigateur.
 *
 * Le seuil (« à 500 m ») reste porté par le titre publié de la figure ; la
 * légende ne nomme que les deux zones. À 100 %, le complément garde une
 * largeur nulle : aucune largeur factice n'est inventée pour zéro.
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

const SHARE_LABEL = 'À proximité d’un arrêt'
const COMPLEMENT_LABEL = 'Pas d’arrêt à proximité'

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
/** The complement is only the rest of the published share, never a stored fact. */
const complementPercent = computed(() => (value.value === null ? 0 : Math.max(0, 100 - fillPercent.value)))
const referenceComplementPercent = computed(() =>
  reference.value === null ? 0 : Math.max(0, 100 - referencePercent.value))

const comparisonRowLabel = computed(() => props.figure.comparisonLabel ?? GROUPE_COMPARE_LABEL)

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

const splitReading = 'Barre de 0 à 100 % partagée entre « À proximité d’un arrêt » et « Pas d’arrêt à proximité ».'

const territoryAria = computed(() => [
  props.figure.figureTitle,
  `Territoire : ${valueLabel.value}`,
  splitReading,
].join('. '))

const comparisonAria = computed(() => {
  if (props.comparison.status === 'loading') {
    return `${props.figure.figureTitle}. ${comparisonRowLabel.value} : chargement en cours.`
  }
  if (reference.value === null || !comparisonDetail.value) {
    return `${props.figure.figureTitle}. ${comparisonRowLabel.value} : indisponible.`
  }
  const rank = comparisonDetail.value.rank
  const direction = comparisonDetail.value.direction
  return [
    props.figure.figureTitle,
    `${comparisonRowLabel.value} : ${referenceLabel.value}`,
    `${comparisonDetail.value.statistic} du groupe comparé`,
    rank ? `Rang ${rank}` : direction,
    splitReading,
  ].filter(Boolean).join('. ')
})

const legendEntries = computed<readonly FigureLegendEntry[]>(() => [
  {
    key: 'share',
    label: SHARE_LABEL,
    marker: 'square',
    tone: 'theme',
    ariaLabel: `${SHARE_LABEL} : ${valueLabel.value}`,
  },
  {
    key: 'complement',
    label: COMPLEMENT_LABEL,
    marker: 'square',
    tone: 'peer',
    ariaLabel: `${COMPLEMENT_LABEL} : complément de la part publiée, sans mesure distincte`,
  },
])

const legendColors = {
  share: 'var(--cahier-theme-strong, var(--brand-600))',
  complement: 'var(--page3-complement-fill)',
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
  <div class="page3-share-proto">
    <div class="page3-share-proto__scale" aria-hidden="true">
      <span>0 %</span>
      <span>100 %</span>
    </div>

    <div class="page3-share-proto__row" data-row="territory">
      <div class="page3-share-proto__head">
        <span class="page3-share-proto__row-label">Territoire</span>
        <span class="page3-share-proto__row-value" :data-value="value ?? 'absent'">{{ valueLabel }}</span>
      </div>
      <div
        v-if="value !== null"
        class="page3-share-proto__track"
        role="img"
        :aria-label="territoryAria"
      >
        <span
          class="page3-share-proto__segment page3-share-proto__segment--share"
          :style="{ width: `${fillPercent}%` }"
          data-segment="share"
        />
        <span
          v-if="complementPercent > 0"
          class="page3-share-proto__segment page3-share-proto__segment--complement"
          :style="{ width: `${complementPercent}%` }"
          data-segment="complement"
        />
      </div>
      <div v-else class="page3-share-proto__track page3-share-proto__track--empty" data-state="empty">
        <span class="page3-share-proto__empty">Indisponible</span>
      </div>
    </div>

    <div class="page3-share-proto__row" data-row="comparison">
      <div class="page3-share-proto__head">
        <span class="page3-share-proto__row-label page3-share-proto__row-label--comparison">
          {{ comparisonRowLabel }}
        </span>
        <span class="page3-share-proto__row-value page3-share-proto__row-value--comparison">{{ referenceLabel }}</span>
      </div>
      <div
        v-if="reference !== null"
        class="page3-share-proto__track page3-share-proto__track--comparison"
        role="img"
        :aria-label="comparisonAria"
      >
        <span
          class="page3-share-proto__segment page3-share-proto__segment--share-comparison"
          :style="{ width: `${referencePercent}%` }"
          data-segment="share"
        />
        <span
          v-if="referenceComplementPercent > 0"
          class="page3-share-proto__segment page3-share-proto__segment--complement"
          :style="{ width: `${referenceComplementPercent}%` }"
          data-segment="complement"
        />
      </div>
      <div
        v-else
        class="page3-share-proto__track page3-share-proto__track--empty page3-share-proto__track--comparison"
        data-state="empty"
        role="img"
        :aria-label="comparisonAria"
      >
        <span class="page3-share-proto__empty">
          {{ comparison.status === 'loading' ? 'Chargement…' : 'Indisponible' }}
        </span>
      </div>
    </div>

    <CahierFigureLegend
      class="page3-share-proto__legend"
      :entries="legendEntries"
      :mark-colors="legendColors"
      label="Zones de la barre de couverture"
    />

    <p v-for="note in publicationNotes" :key="note" class="page3-share-proto__state" role="note">{{ note }}</p>
    <p v-if="stateMessage" class="page3-share-proto__state" role="status">{{ stateMessage }}</p>
    <button
      v-if="comparison.status === 'error' && comparison.retry"
      type="button"
      class="page3-share-proto__retry"
      @click="comparison.retry()"
    >Réessayer les comparaisons</button>
  </div>
</template>

<style scoped>
.page3-share-proto {
  --page3-complement-fill: color-mix(in srgb, var(--cahier-default, var(--editorial-muted)) 22%, var(--paper));
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}
.page3-share-proto__scale {
  display: flex;
  justify-content: space-between;
  color: var(--cahier-default, var(--editorial-muted));
  font: var(--type-figure-label);
  font-size: var(--type-figure-tick-size);
  font-variant-numeric: tabular-nums;
}
.page3-share-proto__row { display: grid; gap: var(--space-1); min-width: 0; }
.page3-share-proto__head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: baseline;
  column-gap: var(--space-2);
  min-width: 0;
}
.page3-share-proto__row-label {
  color: var(--cahier-theme-strong, var(--brand-600));
  font: var(--type-figure-label);
  letter-spacing: var(--type-figure-label-tracking);
  text-transform: uppercase;
  overflow-wrap: anywhere;
}
.page3-share-proto__row-label--comparison {
  color: var(--cahier-default, var(--editorial-muted));
  text-transform: none;
  letter-spacing: normal;
  font: var(--text-caption);
  font-weight: 600;
}
.page3-share-proto__row-value {
  color: var(--ink, var(--editorial-ink));
  font: var(--type-figure-value);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.page3-share-proto__row-value--comparison {
  color: var(--cahier-default, var(--editorial-muted));
  font: var(--type-figure-comparison);
  font-weight: 600;
}
.page3-share-proto__track {
  display: flex;
  min-width: 0;
  height: 1.75rem;
  border: 1px solid color-mix(in srgb, var(--cahier-theme) 26%, transparent);
  background: var(--page3-complement-fill);
}
.page3-share-proto__track--comparison {
  border-color: color-mix(in srgb, var(--cahier-default, var(--editorial-muted)) 32%, transparent);
}
.page3-share-proto__segment {
  display: block;
  height: 100%;
  flex: 0 0 auto;
}
.page3-share-proto__segment--share { background: var(--cahier-theme-strong, var(--brand-600)); }
.page3-share-proto__segment--share-comparison {
  background: color-mix(in srgb, var(--cahier-theme-strong, var(--brand-600)) 45%, var(--paper));
}
.page3-share-proto__segment--complement { background: transparent; }
.page3-share-proto__track--empty {
  display: flex;
  align-items: center;
  padding: 0 var(--space-2);
  border-style: dashed;
  border-color: color-mix(in srgb, var(--cahier-default, var(--editorial-muted)) 40%, transparent);
  background: transparent;
}
.page3-share-proto__empty {
  color: var(--cahier-default, var(--editorial-muted));
  font: var(--text-caption);
  font-variant-numeric: tabular-nums;
}
.page3-share-proto__legend { flex-wrap: wrap; }
.page3-share-proto__state {
  margin: 0;
  color: var(--cahier-default, var(--editorial-muted));
  font: var(--text-body-sm);
}
.page3-share-proto__retry {
  justify-self: start;
  min-height: 2.75rem;
  padding: 0 var(--space-3);
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  font: var(--text-body-sm);
  text-decoration: underline;
  cursor: pointer;
}
.page3-share-proto__retry:hover { background: var(--surface-tertiary); color: var(--text-primary); }
.page3-share-proto__retry:focus-visible { outline: 2px solid var(--brand-500); outline-offset: 2px; }
@media (max-width: 520px) {
  .page3-share-proto__track { height: 1.5rem; }
}
</style>
