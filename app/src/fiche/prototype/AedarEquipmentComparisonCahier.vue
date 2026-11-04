<script setup lang="ts">
import { computed } from 'vue'
import type { AedarFact } from '../content/aedarApiClient'
import type { AedarComparisonEvidence } from '../content/aedarComparisonClient'
import { aedarComparisonCell, aedarGroupValue } from '../content/aedarComparisonClient'
import { AEDAR_RAMP_MODE_LABELS, readAedarCountMeasure } from '../content/aedarTimeRampFacts'
import type { AedarRampMode } from '../content/themeContent'
import type { AedarEquipmentHorizon } from '../content/aedarEquipmentBuckets'

const props = defineProps<{ fact: AedarFact | null; comparison: AedarComparisonEvidence | null;
  referenceFact: AedarFact | null; label: string; horizonMinutes: AedarEquipmentHorizon; selectedModes: readonly AedarRampMode[] }>()
const readings = computed(() => props.selectedModes.map((mode) => {
  const measure = `count_${props.horizonMinutes}_${mode}_mean`
  const cell = aedarComparisonCell(props.comparison, props.fact?.typequ, measure)
  const sourceMatches = props.referenceFact && props.fact && props.referenceFact.coverage_status === 'covered'
    && (['source_id', 'vintage_id', 'reference_date', 'publication_date'] as const).every((key) => props.referenceFact![key] === props.fact![key])
  const value = props.comparison ? aedarGroupValue(props.comparison, props.fact, measure)
    : sourceMatches ? readAedarCountMeasure(props.referenceFact, props.horizonMinutes, mode, 'mean') : null
  const rank = value !== null && cell?.rank && cell.rank_size && cell.rank_size >= 2
    ? `${cell.rank === 1 ? '1er' : `${cell.rank}e`}/${cell.rank_size}` : null
  const direction = cell?.direction === 'low' ? 'moins est mieux' : 'plus est mieux'
  const formatted = value === null ? 'Indisponible' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)
  return { mode, modeLabel: AEDAR_RAMP_MODE_LABELS[mode], formatted, rank, glyph: cell?.direction === 'low' ? '↓' : '↑',
    // The visible comparison mark names its role once. Screen-reader context
    // supplies the statistic and resolved scope instead of repeating that role.
    accessibleName: `${AEDAR_RAMP_MODE_LABELS[mode]}, ${props.horizonMinutes} minutes. ${props.label} : ${formatted}.${rank ? ` Rang du territoire : ${rank}, ${direction}${cell?.rank_ties && cell.rank_ties > 1 ? ', ex æquo' : ''}.` : ''}` }
}))
</script>

<template>
  <div class="aedar-equipment-comparison">
    <p v-for="reading in readings" :key="reading.mode" class="cahier-figure-comparison" role="img" :aria-label="reading.accessibleName">
      <span aria-hidden="true">{{ reading.modeLabel }} · {{ horizonMinutes }} min — Groupe comparé : <strong>{{ reading.formatted }}</strong>
        <strong v-if="reading.rank" class="aedar-equipment-comparison-rank"> {{ reading.glyph }} {{ reading.rank }}</strong>
      </span>
    </p>
  </div>
</template>

<style scoped>
.aedar-equipment-comparison { display: grid; gap: var(--space-2); min-width: 0; }
.aedar-equipment-comparison p { margin: 0; text-align: center; overflow-wrap: anywhere; }
.aedar-equipment-comparison strong { color: var(--color-figure-reference); }
.aedar-equipment-comparison-rank { white-space: nowrap; }
</style>
