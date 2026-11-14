<script setup lang="ts">
/**
 * « Couverture du territoire » — the approved two-row share figure of Mobilité
 * page 3 (#1006).
 *
 * Two thin, crisp horizontal bars at the full 0–100 % extent: the validated
 * territory name first, then the header's « Groupe comparé ». Each row draws
 * the published share and leaves its remainder as a quiet, unlabelled neutral
 * ground — a visual reading of the complement, never a newly published metric
 * and never a rank computed here. There is no category legend and no 0 %/100 %
 * endpoint label: the bar frame carries the scale.
 *
 * The visible percentage keeps one decimal; the geometry keeps the served
 * value, so Rennes' published 0,9957355… reads 99,6 % without the bar being
 * filled to 100 %. The accessible name keeps the served precision.
 *
 * An explicit « Aucune comparaison » (the header control's empty selection) is
 * not an unavailable comparison: the whole compared row, its bar and its rank
 * disappear. A requested comparison that is loading, failed or unpublished
 * stays an honest state with its retry.
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
  /** Explicit « Aucune comparaison »: the whole compared row is absent. */
  comparisonNone?: boolean
}>()

function formatNumber(value: number, maximumFractionDigits: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits }).format(value)
}

function scaledValue(value: number): number {
  return props.figure.unit.trim() === '%' ? value * 100 : value
}

/** The served unit, never an invented percentage. */
function displayUnit(): string {
  return props.figure.unit.trim() || '%'
}

/** Visible label: one decimal, the same precision for both rows. */
function visibleLabel(value: number | null): string {
  return value === null
    ? 'Indisponible'
    : `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
      .format(scaledValue(value))} ${displayUnit()}`
}

/** Accessible reading keeps the served value's actual precision. */
function preciseLabel(value: number | null): string {
  return value === null ? 'Indisponible' : `${formatNumber(scaledValue(value), 4)} ${displayUnit()}`
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

/** The published share's position, clamped to the bar frame, never re-based. */
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
  `${props.figure.territoryName} : ${valueAriaLabel.value}`,
  remainderReading,
  ...(props.figure.unavailableResources ?? []).map((label) => `Publication indisponible : ${label}`),
].join('. '))

const comparisonAria = computed(() => {
  if (props.comparison.status === 'loading') {
    return `${props.figure.figureTitle}. ${GROUPE_COMPARE_LABEL} : chargement en cours.`
  }
  if (reference.value === null || !comparisonDetail.value) {
    return [
      props.figure.figureTitle,
      `${GROUPE_COMPARE_LABEL} : indisponible`,
      ...(props.comparisonNone
        ? []
        : (props.figure.unavailableComparisons ?? []).map((label) => `Comparaison indisponible : ${label}`)),
    ].join('. ')
  }
  return [
    props.figure.figureTitle,
    `${GROUPE_COMPARE_LABEL} : ${referenceAriaLabel.value}`,
    props.figure.comparisonLabel ?? `${comparisonDetail.value.statistic} du groupe comparé`,
    comparisonDetail.value.rank ? `Rang ${comparisonDetail.value.rank}` : comparisonDetail.value.direction,
    remainderReading,
    ...(props.comparisonNone
      ? []
      : (props.figure.unavailableComparisons ?? []).map((label) => `Comparaison indisponible : ${label}`)),
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
  <div class="mobilite-share-track">
    <div class="mobilite-share-track__row" data-row="territory">
      <div class="mobilite-share-track__head">
        <span class="mobilite-share-track__label">{{ figure.territoryName }}</span>
        <span class="mobilite-share-track__value" :data-value="value ?? 'absent'">{{ valueLabel }}</span>
      </div>
      <div
        v-if="value !== null"
        class="mobilite-share-track__track"
        role="img"
        :aria-label="territoryAria"
      >
        <span
          class="mobilite-share-track__segment mobilite-share-track__segment--share"
          :style="{ width: `${fillPercent}%` }"
          data-segment="share"
        />
        <span
          v-if="complementPercent > 0"
          class="mobilite-share-track__segment mobilite-share-track__segment--complement"
          :style="{ width: `${complementPercent}%` }"
          data-segment="complement"
        />
      </div>
      <div
        v-else
        class="mobilite-share-track__track mobilite-share-track__track--empty"
        data-state="empty"
        role="img"
        :aria-label="territoryAria"
      >
        <span class="mobilite-share-track__empty">Indisponible</span>
      </div>
    </div>

    <div v-if="!comparisonNone" class="mobilite-share-track__row" data-row="comparison">
      <div class="mobilite-share-track__head">
        <span class="mobilite-share-track__label">{{ GROUPE_COMPARE_LABEL }}</span>
        <span class="mobilite-share-track__value mobilite-share-track__value--comparison" :data-value="reference ?? 'absent'">{{ referenceLabel }}</span>
      </div>
      <div
        v-if="reference !== null"
        class="mobilite-share-track__track mobilite-share-track__track--comparison"
        role="img"
        :aria-label="comparisonAria"
      >
        <span
          class="mobilite-share-track__segment mobilite-share-track__segment--share-comparison"
          :style="{ width: `${referencePercent}%` }"
          data-segment="share"
        />
        <span
          v-if="referenceComplementPercent > 0"
          class="mobilite-share-track__segment mobilite-share-track__segment--complement"
          :style="{ width: `${referenceComplementPercent}%` }"
          data-segment="complement"
        />
      </div>
      <div
        v-else
        class="mobilite-share-track__track mobilite-share-track__track--empty mobilite-share-track__track--comparison"
        data-state="empty"
        role="img"
        :aria-label="comparisonAria"
      >
        <span class="mobilite-share-track__empty">
          {{ comparison.status === 'loading' ? 'Chargement…' : 'Indisponible' }}
        </span>
      </div>
      <!-- The shared rank primitive: served rank, usual ties, extreme outline,
           singleton suppression. The figure never computes a rank locally. -->
      <CahierRank
        v-if="reference !== null"
        :fact="figure.value.fact"
        placement="comparison"
      />
    </div>

    <p v-for="note in publicationNotes" :key="note" class="mobilite-share-track__state" role="note">{{ note }}</p>
    <p v-if="stateMessage" class="mobilite-share-track__state" role="status">{{ stateMessage }}</p>
    <button
      v-if="!comparisonNone && comparison.status === 'error' && comparison.retry"
      type="button"
      class="mobilite-share-track__retry"
      @click="comparison.retry()"
    >Réessayer les comparaisons</button>
  </div>
</template>

<style scoped>
.mobilite-share-track {
  --mobilite-share-complement: color-mix(in srgb, var(--cahier-default, var(--editorial-muted)) 18%, var(--paper));
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}
.mobilite-share-track__row { display: grid; gap: var(--space-1); min-width: 0; }
.mobilite-share-track__head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: baseline;
  column-gap: var(--space-2);
  min-width: 0;
}
/* The axis-label typography of the shared Cahier figures. */
.mobilite-share-track__label {
  color: var(--cahier-default, var(--editorial-muted));
  font: var(--type-figure-label);
  letter-spacing: var(--type-figure-label-tracking);
  text-transform: uppercase;
  overflow-wrap: anywhere;
}
.mobilite-share-track__value {
  color: var(--ink, var(--editorial-ink));
  font: var(--type-figure-value);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.mobilite-share-track__value--comparison {
  color: var(--cahier-default, var(--editorial-muted));
  font: var(--type-figure-legend);
  font-weight: 600;
}
.mobilite-share-track__track {
  display: flex;
  min-width: 0;
  height: 0.875rem;
  border: 1px solid color-mix(in srgb, var(--cahier-default, var(--editorial-muted)) 22%, transparent);
  background: var(--mobilite-share-complement);
}
.mobilite-share-track__segment {
  display: block;
  height: 100%;
  flex: 0 0 auto;
}
.mobilite-share-track__segment--share { background: var(--brand-500); }
.mobilite-share-track__segment--share-comparison { background: var(--brand-200); }
.mobilite-share-track__segment--complement { background: transparent; }
.mobilite-share-track__track--empty {
  display: flex;
  align-items: center;
  padding: 0 var(--space-2);
  border-style: dashed;
  border-color: color-mix(in srgb, var(--cahier-default, var(--editorial-muted)) 40%, transparent);
  background: transparent;
}
.mobilite-share-track__empty {
  color: var(--cahier-default, var(--editorial-muted));
  font: var(--text-caption);
  font-variant-numeric: tabular-nums;
}
.mobilite-share-track__state {
  margin: 0;
  color: var(--cahier-default, var(--editorial-muted));
  font: var(--text-body-sm);
}
.mobilite-share-track__retry {
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
.mobilite-share-track__retry:hover { background: var(--surface-tertiary); color: var(--text-primary); }
.mobilite-share-track__retry:focus-visible { outline: 2px solid var(--brand-500); outline-offset: 2px; }
</style>
