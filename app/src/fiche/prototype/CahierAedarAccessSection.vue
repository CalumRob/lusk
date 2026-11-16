<script setup lang="ts">
import { computed } from 'vue'
import type { AedarAccessEvidence, AedarRampMode, AedarTimeRampEvidence } from '@/fiche/content/themeContent'
import type { TimeRampFigureData, TimeRampSeries } from '@/fiche/content/territoryFacts'
import type { FigureLegendEntry } from '@/fiche/cahierFigureGrammaire'
import { AEDAR_RAMP_MODE_LABELS, AEDAR_RAMP_MODES, toggleAedarRampModeSelection } from '@/fiche/content/aedarTimeRampFacts'
import { AEDAR_TIME_MODE_COLORS } from './aedarTimeModeColors'
import AccessRampFigureCahier from './AccessRampFigureCahier.vue'
import CahierFigureLegend from './CahierFigureLegend.vue'
import CahierEvidenceSource from './CahierEvidenceSource.vue'
import CahierProse from './CahierProse.vue'
import { useAedarSectionContext } from './aedarSectionContext'
import { useCahierExportPublication } from './cahierExportVenue'
const props = defineProps<{ evidence: AedarAccessEvidence }>()
const { selectedModes, comparisonVisible, comparisonEligible } = useAedarSectionContext()
const modeColors = Object.fromEntries(AEDAR_RAMP_MODES.map((mode) => [mode, AEDAR_TIME_MODE_COLORS[mode]]))

/** A served reference exists for at least one of the modes the reader can see. */
function referencesFor(modes: readonly AedarRampMode[]): boolean {
  return props.evidence.ramps.some((ramp) => ramp.reference !== null
    && modes.some((mode) => ramp.reference![mode].some((value) => value !== null)))
}
const referenceAvailable = computed(() => referencesFor(AEDAR_RAMP_MODES))
const visibleReferenceAvailable = computed(() => referencesFor(selectedModes.value))
// #1021 — the shared AEDAR reference layer is displayed only when the visible
// selected modes actually carry a served reference.
useCahierExportPublication(() => ({
  owner: 'aedar-comparison-layer',
  state: {
    toggle: comparisonVisible.value,
    referenceAvailable: referenceAvailable.value,
    visibleReferenceAvailable: visibleReferenceAvailable.value,
    displayed: comparisonEligible.value && comparisonVisible.value && visibleReferenceAvailable.value,
  },
}), 'comparison')

function modeLegendEntries(evidence: AedarAccessEvidence): readonly FigureLegendEntry[] {
  const referenceLabel = evidence.comparisonLabel ?? evidence.ramps.find((ramp) => ramp.referenceLabel)?.referenceLabel ?? null
  return [
    ...AEDAR_RAMP_MODES.map((mode) => ({ key: mode, label: AEDAR_RAMP_MODE_LABELS[mode], marker: 'line' as const })),
    ...(comparisonEligible.value ? [{ key: 'reference', label: 'Groupe comparé', ariaLabel: `Groupe comparé : ${referenceLabel ?? 'Indisponible'}`,
      marker: 'dash', tone: 'peer', persistentToggle: true } as const] : []),
  ]
}
function toggleMode(key: string): void {
  if (key === 'reference') { comparisonVisible.value = !comparisonVisible.value; return }
  selectedModes.value = toggleAedarRampModeSelection(selectedModes.value, key as AedarRampMode)
}
/** Mechanical conversion to the existing reusable ramp figure contract. */
function rampToTimeRampFigureData(ramp: AedarTimeRampEvidence): TimeRampFigureData {
  const series: readonly TimeRampSeries[] = AEDAR_RAMP_MODES.map((mode) => ({
    key: mode,
    label: AEDAR_RAMP_MODE_LABELS[mode],
    points: ramp.xAxis.values.map((xValue, index) => ({
      xValue, xLabel: ramp.xAxis.labels[index] ?? `${xValue}`,
      value: ramp.territory[mode][index] ?? null,
      referenceValue: ramp.reference?.[mode][index] ?? null,
      referenceRank: ramp.referenceRanks?.[mode][index] ?? null,
    })),
  }))
  return { availability: ramp.availability,
    xAxis: { label: ramp.xAxis.label, unit: ramp.xAxis.unit },
    yAxis: { label: ramp.yAxis.label, unit: ramp.yAxis.unit },
    series, provenance: ramp.provenance, comparisonLabel: ramp.referenceLabel, comparisonLayerSupported: comparisonEligible.value }
}
</script>

<template>
  <div class="evidence-side evidence-figure aedar-access-evidence">
    <aside class="aedar-reading">
      <CahierProse class="argument-copy" :blocks="evidence.sectionProse" />
      <CahierEvidenceSource v-if="evidence.source" :source="evidence.source" />
    </aside>
    <div class="aedar-analysis">
      <figure v-for="ramp in evidence.ramps" :key="ramp.rampKey" class="aedar-ramp">
        <figcaption class="cahier-figure-title cahier-baseline-anchor">{{ ramp.figureTitle }}</figcaption>
        <AccessRampFigureCahier
          :time-ramp="rampToTimeRampFigureData(ramp)"
          :territory-name="evidence.territory.name"
          v-model:selected-modes="selectedModes"
          :show-mode-legend="false"
          :comparison-visible="comparisonVisible"
        />
      </figure>
    </div>
    <CahierFigureLegend
      class="aedar-access-mode-selector"
      :entries="modeLegendEntries(evidence)"
      :mark-colors="modeColors"
      :selected-keys="[...selectedModes, ...(comparisonVisible ? ['reference'] : [])]"
      :toggle-keys="AEDAR_RAMP_MODES"
      :label="comparisonEligible ? 'Modes de déplacement et groupe comparé pour les deux rampes' : 'Modes de déplacement pour les deux rampes'"
      @toggle="toggleMode"
    />
  </div>
</template>

<style scoped>
.cahier--indexed-sections .argument-copy { text-align: left; }
.aedar-access-evidence { display: grid; grid-column: 1 / -1; width: 100%; gap: var(--space-6); }
.aedar-analysis { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; justify-content: center; gap: var(--space-8); }
.aedar-access-mode-selector { justify-content: center; margin: 0; }
.aedar-access-mode-selector :deep(.cahier-figure-legend-toggle) { min-height: 36px; }
.aedar-ramp { width: min(100%, var(--cahier-figure-width-compact, 560px)); justify-self: center; margin: 0; display: grid; gap: var(--space-3); }
.aedar-reading { display: grid; align-content: center; gap: var(--space-4); min-width: 0; }
.aedar-reading .argument-copy { margin: 0; }
@media (max-width: 760px) { .aedar-analysis { grid-template-columns: minmax(0, 1fr); } }
</style>
