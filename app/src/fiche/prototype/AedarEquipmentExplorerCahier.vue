<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import type { AedarFact } from '@/fiche/content/aedarApiClient'
import { fetchAedarAggregates } from '@/fiche/content/aedarApiClient'
import { aedarComparisonCell, aedarGroupValue, fetchAedarComparison } from '@/fiche/content/aedarComparisonClient'
import type { AedarComparisonEvidence } from '@/fiche/content/aedarComparisonClient'
import { AEDAR_EQUIPMENT_BUCKET_HORIZONS } from '@/fiche/content/aedarEquipmentBuckets'
import type { AedarEquipmentHorizon } from '@/fiche/content/aedarEquipmentBuckets'
import { AEDAR_DEFAULT_VISIBLE_RAMP_MODES, AEDAR_EXPLORER_DETAIL_MEASURE_KEYS, AEDAR_RAMP_MODE_LABELS, AEDAR_RAMP_MODES, readAedarCountMeasure, toggleAedarRampModeSelection } from '@/fiche/content/aedarTimeRampFacts'
import type { AedarRampMode } from '@/fiche/content/themeContent'
import type { AedarEquipmentExplorerEvidence } from '@/fiche/content/themeContent'
import type { FactAvailability, TimeRampFigureData } from '@/fiche/content/territoryFacts'
import type { FigureLegendEntry } from '@/fiche/cahierFigureGrammaire'
import { AEDAR_TIME_MODE_COLORS } from './aedarTimeModeColors'
import CahierDialog from './CahierDialog.vue'
import CahierEvidenceSource from './CahierEvidenceSource.vue'
import CahierFigureLegend from './CahierFigureLegend.vue'
import CahierProse from './CahierProse.vue'
import AedarTravelTimeSelector from './AedarTravelTimeSelector.vue'
import AccessRampFigureCahier from './AccessRampFigureCahier.vue'
import AedarEquipmentQuantileFigureCahier from './AedarEquipmentQuantileFigureCahier.vue'
import CahierActionButton from './CahierActionButton.vue'

const props = defineProps<{
  evidence: AedarEquipmentExplorerEvidence
  selectedModes?: readonly AedarRampMode[]
  selectedHorizon?: AedarEquipmentHorizon | null
  comparisonVisible?: boolean
}>()
const emit = defineEmits<{
  'update:selectedModes': [modes: readonly AedarRampMode[]]
  'update:selectedHorizon': [horizon: AedarEquipmentHorizon]
  'update:comparisonVisible': [visible: boolean]
}>()

const HORIZONS = AEDAR_EQUIPMENT_BUCKET_HORIZONS

const selectedTypequ = ref(props.evidence.initialTypequ)
const selectedDetail = ref<AedarFact | null>(null)
const detailStatus = ref<'loading' | 'ready' | 'error'>('loading')
const detailRetry = ref(0)
const retryDetail = () => { detailRetry.value += 1 }
let detailRequest = 0
const selectedBaseFact = computed(() => props.evidence.facts.find((fact) => fact.typequ === selectedTypequ.value) ?? null)
const detailComparison = ref<AedarComparisonEvidence | null>(null)
const referenceDetail = ref<AedarFact | null>(null)
const comparisonStatus = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const comparisonError = ref('')
const comparisonIdentity = computed(() => JSON.stringify([selectedTypequ.value, props.evidence.contentVersion,
  props.evidence.referenceContentVersion, props.evidence.comparisonRequest, props.evidence.reference?.territory]))
watch([comparisonIdentity, detailRetry], async (_value, _old, cleanup) => {
  detailComparison.value = null
  referenceDetail.value = null
  comparisonStatus.value = 'idle'
  const request = props.evidence.comparisonRequest
  const reference = props.evidence.reference
  const fact = selectedBaseFact.value
  if (!fact || (!request && !reference)) return
  let cancelled = false
  const abort = new AbortController()
  cleanup(() => { cancelled = true; abort.abort() })
  comparisonStatus.value = 'loading'
  const measures = [...AEDAR_EXPLORER_DETAIL_MEASURE_KEYS, ...HORIZONS.flatMap((horizon) =>
    AEDAR_RAMP_MODES.map((mode) => `count_${horizon}_${mode}_mean`))]
  if (request) {
    const result = await fetchAedarComparison(fact.territory_type, fact.territory_id, { ...request,
      typequ: [selectedTypequ.value], measures, expectedContentVersion: props.evidence.contentVersion,
      expectedReferenceContentVersion: props.evidence.referenceContentVersion, signal: abort.signal })
    if (cancelled) return
    comparisonStatus.value = result.status === 'ready' ? 'ready' : 'error'
    if (result.status === 'ready') detailComparison.value = result.evidence
    else comparisonError.value = result.message
  } else if (reference) {
    const result = await fetchAedarAggregates(reference.territory.type as AedarFact['territory_type'], reference.territory.id, {
      typequ: [selectedTypequ.value], measures: AEDAR_EXPLORER_DETAIL_MEASURE_KEYS, expectedContentVersion: props.evidence.contentVersion,
      expectedReferenceContentVersion: props.evidence.referenceContentVersion })
    if (cancelled) return
    comparisonStatus.value = result.status === 'ready' ? 'ready' : 'error'
    if (result.status === 'ready') {
      const detail = result.facts[0]
      const core = reference.data.facts.find((candidate) => candidate.typequ === selectedTypequ.value)
      referenceDetail.value = detail && core ? { ...detail, measures: { ...core.measures, ...detail.measures } } : null
    }
    else comparisonError.value = result.error.message
  }
}, { immediate: true })
const activeComparison = computed(() => detailComparison.value ?? props.evidence.comparison ?? null)
const comparisonLabel = computed(() => props.evidence.comparisonRequest?.label
  ?? (props.evidence.reference ? `Moyenne de ${props.evidence.reference.label}` : null))
function groupValue(horizon: AedarEquipmentHorizon, mode: AedarRampMode, statistic: string): number | null {
  if (props.evidence.comparisonRequest) return aedarGroupValue(activeComparison.value, selectedBaseFact.value, `count_${horizon}_${mode}_${statistic}`)
  const reference = referenceDetail.value
  const focal = selectedBaseFact.value
  return reference && focal && reference.coverage_status === 'covered'
    && (['source_id', 'vintage_id', 'reference_date', 'publication_date'] as const).every((key) => reference[key] === focal[key])
    ? readAedarCountMeasure(reference, horizon, mode, statistic) : null
}
const detailIdentity = computed(() => {
  const fact = selectedBaseFact.value
  return JSON.stringify([fact?.territory_type, fact?.territory_id, selectedTypequ.value,
    props.evidence.contentVersion, props.evidence.referenceContentVersion,
    fact?.source_id, fact?.vintage_id, fact?.source_url, fact?.licence, fact?.attribution,
    fact?.reference_date, fact?.publication_date, fact?.identity])
})
watch([selectedTypequ, detailRetry, detailIdentity], async ([typequ, , identityAtStart], _old, onCleanup) => {
  const request = ++detailRequest
  let invalidated = false
  onCleanup(() => { invalidated = true })
  selectedDetail.value = null
  detailStatus.value = 'loading'
  const identity = selectedBaseFact.value
  if (!identity) { detailStatus.value = 'error'; return }
  const requestedTerritory = { type: identity.territory_type, id: identity.territory_id }
  const requestedContentVersion = props.evidence.contentVersion
  const requestedReferenceVersion = props.evidence.referenceContentVersion
  const result = await fetchAedarAggregates(requestedTerritory.type, requestedTerritory.id,
    { typequ: [typequ], measures: AEDAR_EXPLORER_DETAIL_MEASURE_KEYS,
      expectedContentVersion: requestedContentVersion, expectedReferenceContentVersion: requestedReferenceVersion })
  if (!invalidated && request === detailRequest && detailIdentity.value === identityAtStart
    && selectedTypequ.value === typequ) {
    if (result.status === 'ready' && result.facts[0]
      && result.facts[0].territory_type === requestedTerritory.type
      && result.facts[0].territory_id === requestedTerritory.id
      && result.contentVersion === requestedContentVersion
      && result.referenceContentVersion === requestedReferenceVersion) {
      selectedDetail.value = result.facts[0]
      detailStatus.value = 'ready'
    }
    else detailStatus.value = 'error'
  }
}, { immediate: true })
const localHorizonMinutes = ref<AedarEquipmentHorizon>(props.evidence.initialHorizonMinutes)
const horizonMinutes = computed(() => props.selectedHorizon ?? localHorizonMinutes.value)
const localSelectedModes = ref<AedarRampMode[]>([...AEDAR_DEFAULT_VISIBLE_RAMP_MODES])
const selectedModes = computed(() => props.selectedModes ?? localSelectedModes.value)
const localComparisonVisible = ref(true)
const comparisonVisible = computed(() => props.comparisonVisible ?? localComparisonVisible.value)
const pickerOpen = ref(false)
const search = ref('')

const selectedFact = computed(() => {
  const base = selectedBaseFact.value
  return base && selectedDetail.value?.typequ === base.typequ
    ? { ...base, measures: { ...base.measures, ...selectedDetail.value.measures } } : base
})
const selectedTypeLabel = computed(() => selectedFact.value
  ? `${selectedFact.value.typequ_label} (${selectedFact.value.typequ})`
  : 'Type d’équipement indisponible')
const selectedTypeFigureLabel = computed(() => selectedFact.value?.typequ_label ?? 'Type indisponible')
const modeEntries = computed<FigureLegendEntry[]>(() => [...AEDAR_RAMP_MODES.map((mode) => ({
  key: mode,
  label: AEDAR_RAMP_MODE_LABELS[mode],
  marker: 'line',
} as const)), { key: 'comparison', label: 'Groupe comparé',
  ariaLabel: `Groupe comparé : ${comparisonLabel.value ?? 'Indisponible'}`, marker: 'dash', tone: 'peer', persistentToggle: true } as const])
const modeColors = Object.fromEntries(AEDAR_RAMP_MODES.map((mode) => [mode, AEDAR_TIME_MODE_COLORS[mode]]))

const filteredFacts = computed(() => {
  const query = search.value.trim().toLocaleLowerCase('fr-FR')
  if (!query) return props.evidence.facts
  return props.evidence.facts.filter((fact) => fact.typequ.toLocaleLowerCase('fr-FR').includes(query)
    || fact.typequ_label.toLocaleLowerCase('fr-FR').includes(query))
})

const volumeRamp = computed<TimeRampFigureData>(() => {
  const series = AEDAR_RAMP_MODES.map((mode) => ({
    key: mode,
    label: AEDAR_RAMP_MODE_LABELS[mode],
    points: HORIZONS.map((horizon) => ({
      xValue: horizon,
      xLabel: `${horizon} min`,
      value: readAedarCountMeasure(selectedFact.value, horizon, mode, 'mean'),
      referenceValue: groupValue(horizon, mode, 'mean'),
      referenceNote: (() => {
        const cell = aedarComparisonCell(activeComparison.value, selectedBaseFact.value?.typequ, `count_${horizon}_${mode}_mean`)
        if (groupValue(horizon, mode, 'mean') === null || !cell?.rank || !cell.rank_size || cell.rank_size < 2) return null
        const rank = `${cell.rank === 1 ? '1er' : `${cell.rank}e`}/${cell.rank_size}`
        const direction = cell.direction === 'low' ? 'moins est mieux' : 'plus est mieux'
        return `Rang du territoire : ${rank}, ${direction}${cell.rank_ties && cell.rank_ties > 1 ? ', ex æquo' : ''}`
      })(),
    })),
  }))
  const values = series.flatMap((item) => item.points.map((point) => point.value))
  const availability: FactAvailability = values.every((value) => value !== null)
    ? 'complete'
    : values.some((value) => value !== null) ? 'incomplete' : 'absent'
  return {
    availability,
    xAxis: { label: 'Temps de trajet', unit: 'minutes' },
    yAxis: { label: props.evidence.volumeYAxisTitle, unit: '' },
    series,
    provenance: null,
    comparisonLabel: comparisonLabel.value,
    comparisonLayerSupported: true,
  }
})

function toggleMode(key: string): void {
  if (key === 'comparison') {
    const next = !comparisonVisible.value
    if (props.comparisonVisible !== undefined) emit('update:comparisonVisible', next)
    else localComparisonVisible.value = next
    return
  }
  const next = toggleAedarRampModeSelection(selectedModes.value, key as AedarRampMode)
  if (props.selectedModes !== undefined) emit('update:selectedModes', next)
  else localSelectedModes.value = next
}

function setHorizonMinutes(horizon: AedarEquipmentHorizon): void {
  localHorizonMinutes.value = horizon
  emit('update:selectedHorizon', horizon)
}

function chooseType(fact: AedarFact): void {
  selectedTypequ.value = fact.typequ
  pickerOpen.value = false
  search.value = ''
}
</script>

<template>
  <div class="aedar-equipment-explorer">
    <CahierProse class="argument-copy aedar-equipment-explorer-introduction" :blocks="evidence.introduction" />
    <CahierEvidenceSource v-if="evidence.source" :source="evidence.source" />

    <div class="aedar-equipment-explorer-selection">
      <div class="aedar-equipment-explorer-type-selection">
        <p class="aedar-equipment-explorer-selection-label">Équipement sélectionné</p>
        <p class="aedar-equipment-explorer-selected" role="status" aria-live="polite">
          <strong>{{ selectedTypeLabel }}</strong>
        </p>
        <CahierActionButton class="aedar-equipment-explorer-change" aria-label="Choisir un autre équipement" @click="pickerOpen = true">
          Choisir un autre équipement
        </CahierActionButton>
      </div>
      <AedarTravelTimeSelector
        class="aedar-equipment-explorer-horizon"
        :model-value="horizonMinutes"
        label="Temps de trajet de la distribution"
        @update:model-value="setHorizonMinutes"
      />
    </div>
    <p v-if="detailStatus === 'loading'" class="aedar-equipment-explorer-load-state" role="status">Chargement des valeurs pour ce type d’équipement…</p>
    <p v-else-if="detailStatus === 'error'" class="aedar-equipment-explorer-load-state" role="alert">
      Valeurs indisponibles pour ce type d’équipement. <button type="button" @click="retryDetail">Réessayer</button>
    </p>
    <p v-if="comparisonStatus === 'loading'" class="aedar-equipment-explorer-load-state" role="status">Chargement du groupe comparé…</p>
    <p v-else-if="comparisonStatus === 'error'" class="aedar-equipment-explorer-load-state" role="alert">
      Groupe comparé indisponible : {{ comparisonError }}. <button type="button" @click="retryDetail">Réessayer</button>
    </p>

    <div class="aedar-equipment-explorer-figures">
      <figure class="aedar-equipment-explorer-figure">
        <figcaption class="cahier-figure-title cahier-baseline-anchor">
          <span>{{ evidence.volumeFigureTitle }}</span>
          <span class="aedar-equipment-explorer-figure-title-type">{{ selectedTypeFigureLabel }}</span>
        </figcaption>
        <AccessRampFigureCahier
          :time-ramp="volumeRamp"
          :territory-name="selectedTypeLabel"
          :selected-modes="selectedModes"
          :show-mode-legend="false"
          :comparison-visible="comparisonVisible"
        />
        </figure>

      <figure class="aedar-equipment-explorer-figure">
        <figcaption class="cahier-figure-title cahier-baseline-anchor">
          <span>{{ evidence.distributionFigureTitle }}</span>
          <span class="aedar-equipment-explorer-figure-title-type">{{ selectedTypeFigureLabel }}</span>
        </figcaption>
        <AedarEquipmentQuantileFigureCahier
          :fact="selectedFact"
          :horizon-minutes="horizonMinutes"
          :selected-modes="selectedModes"
          :evidence="evidence"
          :comparison="activeComparison"
          :reference-fact="referenceDetail"
          :comparison-label="comparisonLabel"
          :comparison-visible="comparisonVisible"
          :comparison-layer-supported="true"
        />
      </figure>
    </div>

    <CahierFigureLegend
      class="aedar-equipment-explorer-modes"
      :entries="modeEntries"
      :mark-colors="modeColors"
      :selected-keys="[...selectedModes, ...(comparisonVisible ? ['comparison'] : [])]"
      :toggle-keys="AEDAR_RAMP_MODES"
      label="Modes de déplacement et groupe comparé"
      @toggle="toggleMode"
    />

    <CahierDialog
      :open="pickerOpen"
      title="Choisir un type d’équipement"
      labelled-by="aedar-equipment-explorer-picker-title"
      @close="pickerOpen = false"
    >
      <template #toolbar>
        <label class="aedar-equipment-explorer-search">
          <span class="type-figure-label">Rechercher un équipement</span>
          <input v-model="search" type="search" aria-label="Nom ou code BPE" placeholder="Nom ou code BPE" autofocus />
        </label>
      </template>
      <div class="aedar-equipment-explorer-options" role="listbox" aria-label="Types d’équipements BPE">
        <button
          v-for="fact in filteredFacts"
          :key="fact.typequ"
          type="button"
          role="option"
          :aria-selected="fact.typequ === selectedTypequ"
          :aria-label="`Choisir ${fact.typequ_label} (${fact.typequ})`"
          @click="chooseType(fact)"
        >
          <span>{{ fact.typequ_label }}</span>
          <code>{{ fact.typequ }}</code>
        </button>
        <p v-if="filteredFacts.length === 0" class="aedar-equipment-explorer-empty" role="status">
          Aucun type ne correspond à cette recherche.
        </p>
      </div>
    </CahierDialog>
  </div>
</template>

<style scoped>
.aedar-equipment-explorer { display: grid; gap: var(--space-5); width: 100%; min-width: 0; }
.aedar-equipment-explorer-selection { display: grid; justify-items: center; gap: var(--space-4); width: 100%; min-width: 0; }
.aedar-equipment-explorer-type-selection { display: grid; justify-items: center; gap: var(--space-2); width: 100%; min-width: 0; }
.aedar-equipment-explorer-selection-label { margin: 0; color: var(--cahier-default); font: var(--type-figure-label); }
.aedar-equipment-explorer-selected { max-width: 100%; margin: 0; color: var(--cahier-default); font: var(--text-h3); letter-spacing: var(--text-h3-tracking); text-align: center; overflow-wrap: anywhere; }
.aedar-equipment-explorer-horizon { justify-self: center; max-width: 100%; }
.aedar-equipment-explorer :deep(button:focus-visible), .aedar-equipment-explorer :deep(input:focus-visible) { outline: 2px solid var(--accent-primary); outline-offset: 2px; }
.aedar-equipment-explorer :deep(.aedar-equipment-explorer-modes) { justify-content: center; margin: 0; }
.aedar-equipment-explorer :deep(.cahier-figure-legend-toggle) { min-height: 36px; }
.aedar-equipment-explorer-figures { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; gap: var(--space-8); }
/* Match the shared Cahier mobile boundary rather than the generic 768px breakpoint. */
@media (max-width: 760px) {
  .aedar-equipment-explorer-figures { grid-template-columns: minmax(0, 1fr); }
}
.aedar-equipment-explorer-figure { display: grid; gap: var(--space-3); min-width: 0; margin: 0; }
.aedar-equipment-explorer-figure > .cahier-figure-title { display: grid; align-content: start; min-height: 2.5em; margin: 0; text-align: center; }
.aedar-equipment-explorer-figure-title-type { display: block; }
.aedar-equipment-explorer-search { display: flex; flex: 1 1 260px; flex-wrap: wrap; align-items: center; gap: var(--space-2); min-width: 0; }
.aedar-equipment-explorer-search span { flex: 0 0 auto; white-space: nowrap; }
.aedar-equipment-explorer-search input { flex: 1 1 auto; min-width: 0; min-height: 36px; padding: var(--space-1) var(--space-2); border: 1px solid color-mix(in oklab, var(--cahier-default) 22%, transparent); border-radius: 0; background: transparent; color: var(--cahier-default); font: var(--text-body-sm); }
.aedar-equipment-explorer-options { display: grid; max-height: min(58dvh, 580px); overflow: auto; border: 1px solid color-mix(in oklab, var(--cahier-default) 24%, transparent); }
.aedar-equipment-explorer-options button { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-4); min-height: 40px; padding: var(--space-2) var(--space-3); border: 0; border-bottom: 1px solid var(--border-subtle); background: transparent; color: var(--text-primary); font: var(--type-figure-label); text-align: left; cursor: pointer; }
.aedar-equipment-explorer-options button:hover, .aedar-equipment-explorer-options button[aria-selected='true'] { background: color-mix(in srgb, var(--cahier-theme) 10%, transparent); }
.aedar-equipment-explorer-options code { color: var(--text-secondary); font-family: var(--font-metadata); font-size: 0.85em; }
.aedar-equipment-explorer-empty { margin: 0; padding: var(--space-4); color: var(--text-secondary); text-align: center; }
</style>
