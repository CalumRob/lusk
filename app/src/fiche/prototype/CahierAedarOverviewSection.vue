<script setup lang="ts">
import { CarFront } from 'lucide-vue-next'
import { computed } from 'vue'
import type { AedarCarAccessOverviewEvidence } from '@/fiche/content/themeContent'
import {
  aedarOverviewScalarAria,
  aedarOverviewScalarServedRank,
} from './aedarFigureReadings'
import CahierBlankMapSlots from './CahierBlankMapSlots.vue'
import CahierComparisonValue from './CahierComparisonValue.vue'
import CahierEvidenceSource from './CahierEvidenceSource.vue'
import CahierFigureScalar from './CahierFigureScalar.vue'
import CahierProse from './CahierProse.vue'
import { useAedarSectionContext } from './aedarSectionContext'
import { useCahierExportPublication } from './cahierExportVenue'
const props = defineProps<{ evidence: AedarCarAccessOverviewEvidence }>()
const { chapterActive, comparison, comparisonEligible } = useAedarSectionContext()
/** At least one served scalar reference is actually displayed. */
const referenceAvailable = computed(() =>
  props.evidence.scalars.some((scalar) => scalar.reference !== null))
// #1021 — the overview has no toggle; it publishes the reference layer its
// scalars actually draw, which can be a ready direct reference while the
// aggregate comparison status is idle.
useCahierExportPublication(() => ({
  owner: 'aedar-comparison-layer',
  state: {
    toggle: null,
    referenceAvailable: referenceAvailable.value,
    visibleReferenceAvailable: referenceAvailable.value,
    displayed: comparisonEligible.value && referenceAvailable.value,
  },
}), 'comparison')
function formatNumber(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits }).format(value)
}
const scalarServedRank = aedarOverviewScalarServedRank
</script>

<template>
  <CahierBlankMapSlots
    class="evidence-side evidence-figure"
    :territory="evidence.territory"
    :horizon-minutes="evidence.horizonMinutes"
    :title="evidence.mapFigureTitle"
    :mode-keys="evidence.mapModes"
    :active="chapterActive"
  />
  <aside class="argument-side aedar-car-overview-reading">
    <div class="aedar-car-overview-copy">
      <CahierProse class="argument-copy" :blocks="evidence.prose" />
      <CahierEvidenceSource v-if="evidence.source || evidence.sourcePending" :source="evidence.source" :pending="evidence.sourcePending" />
    </div>
    <figure class="aedar-car-overview-scalars">
      <figcaption class="cahier-figure-title">{{ evidence.scalarFigureTitle }}</figcaption>
      <div class="summary-metrics summary-metrics--paired">
        <CahierFigureScalar
          v-for="scalar in evidence.scalars"
          :key="scalar.key"
          :value="scalar.value === null ? '—' : formatNumber(scalar.value)"
          :label="scalar.label"
          label-role="metric"
          :reference-pending="comparisonEligible && scalar.comparisonPending"
          :icon="CarFront"
          tone="c"
          color-value
          :aria-label="aedarOverviewScalarAria(evidence, scalar, comparisonEligible)"
        >
          <template v-if="comparisonEligible && (scalar.reference || scalar.comparisonUnavailableLabel)" #reference>
            <CahierComparisonValue
              v-if="scalar.reference"
              :named-reference="scalar.reference"
              :served-rank="scalarServedRank(scalar)"
              :comparison-status="comparison.status"
              :comparison-error="comparison.error"
            />
            <CahierComparisonValue v-else-if="comparison.status === 'loading' || comparison.status === 'error'" :comparison-status="comparison.status" :comparison-error="comparison.error" />
            <span v-else class="cahier-figure-comparison">{{ scalar.comparisonUnavailableLabel }}</span>
            <span v-if="scalar.rankUnavailableLabel" class="cahier-figure-comparison">{{ scalar.rankUnavailableLabel }}</span>
          </template>
        </CahierFigureScalar>
      </div>
      <div class="aedar-comparison-retry-slot"><button v-if="comparisonEligible && comparison.status === 'error'" class="aedar-comparison-retry" type="button" @click="comparison.retry?.()">Réessayer les comparaisons</button></div>
    </figure>
  </aside>
</template>

<style scoped>
.cahier--indexed-sections .argument-copy { text-align: left; }
.aedar-car-overview-reading { display: grid; align-self: center; gap: var(--space-8); }
.aedar-car-overview-copy { display: grid; gap: var(--space-3); }
.aedar-car-overview-copy .argument-copy { margin: 0; }
.aedar-car-overview-scalars { --cahier-figure-title-gap: var(--space-6); width: 100%; margin: 0; }
.aedar-comparison-retry-slot { min-height: 3.25rem; display: flex; justify-content: flex-end; align-items: center; }
.aedar-comparison-retry { min-height: 2.75rem; padding: 0 var(--space-3); border: 0; border-radius: var(--radius-md); background: transparent; color: var(--text-secondary); font: var(--text-body-sm); text-decoration: underline; cursor: pointer; }
.aedar-comparison-retry:hover { background: var(--surface-tertiary); color: var(--text-primary); }
.aedar-comparison-retry:active { background: var(--border-subtle); }
.aedar-comparison-retry:focus-visible { outline: 2px solid var(--brand-500); outline-offset: 2px; }
.cahier--sans-grille .summary-metrics--paired {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 10%;
  width: min(100%, var(--cahier-figure-width-standard, 760px));
  margin-inline: auto;
}
.summary-metrics { display: grid; gap: 42px; }
@container cahier-page (max-width: 900px) { .summary-metrics { gap: 32px; } }
@container cahier-page (max-width: 620px) {
  .cahier--sans-grille .summary-metrics--paired { grid-template-columns: 1fr; gap: var(--space-6); }
}
</style>
