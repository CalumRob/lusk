<script setup lang="ts">
/**
 * [PROTOTYPE page 3 — JETABLE, v3] « Couverture du territoire ».
 *
 * Deux barres empilées à 100 % : le nom du territoire, puis le « Groupe
 * comparé » de l'en-tête. Chaque barre porte la part publiée, puis son reste —
 * laissé neutre et sans étiquette. Ce reste n'est qu'une lecture visuelle du
 * complément de la part publiée : ce n'est ni une mesure publiée, ni un rang,
 * ni une statistique recalculée dans le navigateur.
 *
 * Le seuil (« à 500 m ») reste porté par le titre publié de la figure ; les
 * pourcentages restent dans l'ARIA et les unités servies. Aucune graduation
 * visible : la barre de 0 à 100 % est portée par le cadre fin. À 100 %, le
 * reste garde une largeur nulle : aucune largeur factice pour zéro.
 *
 * « Aucune comparaison » explicite (sélection vide du contrôle d'en-tête)
 * n'est pas une comparaison indisponible : la ligne entière disparaît.
 */
import { computed } from 'vue'

import { GROUPE_COMPARE_LABEL } from '@/fiche/content/comparisonWording'
import type { MobiliteShareEvidence } from '@/fiche/content/themeContent'
import { formatServedRankAria } from '@/fiche/figureGrammaire'
import { LIBELLES_DIRECTION } from '@/methodes/indicateurs'
import CahierRank from './CahierRank.vue'

type ComparisonState = {
  status: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'
  error?: string
  retry?: () => void
}

const props = defineProps<{
  figure: MobiliteShareEvidence
  comparison: ComparisonState
  /** Published territory display name (the fiche's validated identity). */
  territoryName?: string
  /** Explicit « Aucune comparaison »: the whole compared row is absent. */
  comparisonNone?: boolean
}>()

function formatNumber(value: number, maximumFractionDigits: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits }).format(value)
}

function scaledValue(value: number, unit: string): number {
  return unit.trim() === '%' ? value * 100 : value
}

/**
 * Visible label: one decimal. The served 0,9957355… reads 99,6 %, never a
 * synthetic 100 %, and the bar keeps its true 99,57 % width.
 */
function visibleLabel(value: number | null): string {
  return value === null ? 'Indisponible' : `${formatNumber(scaledValue(value, props.figure.unit), 1)} %`
}

/** Accessible reading keeps the served value's actual precision, same % unit. */
function preciseLabel(value: number | null): string {
  return value === null ? 'Indisponible' : `${formatNumber(scaledValue(value, props.figure.unit), 4)} %`
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

const valueLabel = computed(() => visibleLabel(value.value))
const referenceLabel = computed(() => visibleLabel(reference.value))
const valueAriaLabel = computed(() => preciseLabel(value.value))
const referenceAriaLabel = computed(() => preciseLabel(reference.value))

function percentPosition(candidate: number | null): number {
  if (candidate === null) return 0
  return Math.max(0, Math.min(100, candidate * 100))
}

const fillPercent = computed(() => percentPosition(value.value))
const referencePercent = computed(() => percentPosition(reference.value))
/** The remainder is only the rest of the published share, never a stored fact. */
const complementPercent = computed(() => (value.value === null ? 0 : Math.max(0, 100 - fillPercent.value)))
const referenceComplementPercent = computed(() =>
  reference.value === null ? 0 : Math.max(0, 100 - referencePercent.value))

const territoryLabel = computed(() => props.territoryName ?? 'Territoire')

const comparisonScope = computed(() => props.figure.comparisonLabel)

const comparisonDetail = computed(() => {
  const comparison = props.figure.value.fact.comparison
  if (!comparison) return null
  return {
    statistic: comparison.reference?.kind === 'mean' ? 'Moyenne' : 'Médiane',
    rank: formatServedRankAria(comparison.rank),
    direction: LIBELLES_DIRECTION[comparison.direction] ?? null,
  }
})

const publicationNotes = computed(() => [
  ...(props.figure.unavailableResources ?? []).map((label) => `Publication indisponible : ${label}`),
  ...(props.comparisonNone
    ? []
    : (props.figure.unavailableComparisons ?? []).map((label) => `Comparaison indisponible : ${label}`)),
])

const remainderReading = 'Barre de 0 à 100 % ; le reste de la barre est le complément de la part publiée.'

const territoryAria = computed(() => [
  props.figure.figureTitle,
  `${territoryLabel.value} : ${valueAriaLabel.value}`,
  remainderReading,
].join('. '))

const comparisonAria = computed(() => {
  if (props.comparison.status === 'loading') {
    return `${props.figure.figureTitle}. ${GROUPE_COMPARE_LABEL} : chargement en cours.`
  }
  if (reference.value === null || !comparisonDetail.value) {
    return `${props.figure.figureTitle}. ${GROUPE_COMPARE_LABEL} : indisponible.`
  }
  const scope = comparisonScope.value
  const rank = comparisonDetail.value.rank
  const direction = comparisonDetail.value.direction
  return [
    props.figure.figureTitle,
    `${GROUPE_COMPARE_LABEL} : ${referenceAriaLabel.value}`,
    scope ?? `${comparisonDetail.value.statistic} du groupe comparé`,
    rank ? `Rang ${rank}` : direction,
    remainderReading,
  ].filter(Boolean).join('. ')
})

const stateMessage = computed(() => {
  if (props.comparisonNone) return null
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
    <div class="page3-share-proto__row" data-row="territory">
      <div class="page3-share-proto__head">
        <span class="page3-share-proto__row-label">{{ territoryLabel }}</span>
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

    <div v-if="!comparisonNone" class="page3-share-proto__row" data-row="comparison">
      <div class="page3-share-proto__head">
        <span class="page3-share-proto__row-label">{{ GROUPE_COMPARE_LABEL }}</span>
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
      <!-- The shared rank primitive: served rank, ties, extreme circle, 1/1 hidden. -->
      <CahierRank
        v-if="reference !== null"
        :fact="figure.value.fact"
        placement="comparison"
      />
    </div>

    <p v-for="note in publicationNotes" :key="note" class="page3-share-proto__state" role="note">{{ note }}</p>
    <p v-if="stateMessage" class="page3-share-proto__state" role="status">{{ stateMessage }}</p>
    <button
      v-if="!comparisonNone && comparison.status === 'error' && comparison.retry"
      type="button"
      class="page3-share-proto__retry"
      @click="comparison.retry()"
    >Réessayer les comparaisons</button>
  </div>
</template>

<style scoped>
.page3-share-proto {
  --page3-complement-fill: color-mix(in srgb, var(--cahier-default, var(--editorial-muted)) 18%, var(--paper));
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}
.page3-share-proto__row { display: grid; gap: var(--space-1); min-width: 0; }
.page3-share-proto__head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: baseline;
  column-gap: var(--space-2);
  min-width: 0;
}
/* Axis-label typography, shared with the Cahier figures' own axis titles. */
.page3-share-proto__row-label {
  color: var(--cahier-default, var(--editorial-muted));
  font: var(--type-figure-label);
  letter-spacing: var(--type-figure-label-tracking);
  text-transform: uppercase;
  overflow-wrap: anywhere;
}
.page3-share-proto__row-value {
  color: var(--ink, var(--editorial-ink));
  font: var(--type-figure-value);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.page3-share-proto__row-value--comparison {
  color: var(--cahier-default, var(--editorial-muted));
  font: var(--type-figure-legend);
  font-weight: 600;
}
.page3-share-proto__track {
  display: flex;
  min-width: 0;
  height: 0.875rem;
  border: 1px solid color-mix(in srgb, var(--cahier-default, var(--editorial-muted)) 22%, transparent);
  background: var(--page3-complement-fill);
}
.page3-share-proto__segment {
  display: block;
  height: 100%;
  flex: 0 0 auto;
}
.page3-share-proto__segment--share { background: var(--brand-500); }
.page3-share-proto__segment--share-comparison { background: var(--brand-200); }
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
</style>
