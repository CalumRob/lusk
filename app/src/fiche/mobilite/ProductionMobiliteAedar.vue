<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import { CONTROLE_COMPARAISON_KEY } from '../comparisonContext'
import { aedarComparisonIntent, fetchAedarComparison } from '../content/aedarComparisonClient'
import type { AedarComparisonEvidence, AedarComparisonRequest } from '../content/aedarComparisonClient'
import { AEDAR_AGGREGATE_READING_KEYS } from '../content/aedarTimeRampFacts'
import VarianteCahierLibre from '../prototype/VarianteCahierLibre.vue'
import { AEDAR_DETAIL_UNAVAILABLE_MESSAGE, AEDAR_SUMMARY_UNAVAILABLE_MESSAGE,
  aedarPendingPrototypeSections, aedarPrototypeSections } from '@/fiche/content/aedarAccessSection'
import { fetchAedarDiversityLossMapLegend } from '@/fiche/content/aedarDiversityLossMaps'
import type { AedarDiversityLossMapMetadata } from '@/fiche/content/aedarDiversityLossMaps'
import type { AedarFetchResult, AedarSummaryFetchResult, AedarTerritoryType } from '@/fiche/content/aedarApiClient'
import type { ContentSource, ThemeContent } from '@/fiche/content/themeContent'
import type { CahierPagination } from '../prototype/cahierPagination'

const props = defineProps<{
  content: ThemeContent
  pagination: CahierPagination
  aedarData: AedarFetchResult | null
  aedarStatus: 'loading' | 'ready' | 'error'
  retryAedar: () => void
  aedarSummaryData?: AedarSummaryFetchResult | null
  aedarSummaryStatus?: 'loading' | 'ready' | 'error'
  retryAedarSummary?: () => void
  /** Single published reference territory behind the comparison lines (never a cohort). */
  aedarReferenceTerritoire?: { type: AedarTerritoryType; id: string; nom: string } | null
  aedarReferenceData?: AedarSummaryFetchResult | null
  aedarReferenceStatus?: 'unavailable' | 'loading' | 'ready' | 'error'
  retryAedarReference?: () => void
  nativeComparisonStatus?: 'idle' | 'loading' | 'ready' | 'error'
  nativeComparisonError?: string
  retryNativeComparison?: () => void
}>()

const control = inject(CONTROLE_COMPARAISON_KEY, computed(() => null))
const comparisonRequest = computed<AedarComparisonRequest | null>(() => {
  if (!control.value) return null
  const intent = aedarComparisonIntent({ territoryType: props.content.territory.type as AedarTerritoryType,
    selection: control.value.selection, presetDefaut: control.value.presetDefaut })
  if (!intent) return null
  if (intent.kind === 'fixed_comparison' && !control.value.libelleActif) return null
  const label = intent.kind === 'selected_comparison'
    ? 'Moyenne de la sélection' : `Moyenne — ${control.value.libelleActif}`
  return { intent, label }
})
const comparison = ref<AedarComparisonEvidence | null>(null)
const comparisonState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const comparisonError = ref('')
const comparisonRetry = ref(0)
const directReferenceExpected = computed(() => Boolean(props.aedarReferenceTerritoire &&
  control.value?.selection.etat !== 'vide' && control.value?.selection.etat !== 'membres' &&
  (comparisonRequest.value?.intent.kind !== 'fixed_comparison' || comparisonRequest.value.intent.context !== 'density_class')))
const displayedComparisonStatus = computed<'idle' | 'loading' | 'ready' | 'error'>(() => {
  if (comparisonState.value === 'error' || (directReferenceExpected.value && props.aedarReferenceStatus === 'error')) return 'error'
  if (comparisonState.value === 'loading' || (directReferenceExpected.value && props.aedarReferenceStatus === 'loading')) return 'loading'
  return comparisonState.value
})
const displayedComparisonError = computed(() => comparisonState.value === 'error'
  ? comparisonError.value : 'La référence territoriale du groupe comparé est indisponible.')
function retryFailedComparisons(): void {
  if (comparisonState.value === 'error') comparisonRetry.value++
  if (directReferenceExpected.value && props.aedarReferenceStatus === 'error') props.retryAedarReference?.()
}
const comparisonFocalIdentity = computed(() => props.aedarSummaryData?.status === 'ready'
  ? JSON.stringify([props.content.territory.type, props.content.territory.code,
    props.aedarSummaryData.summary.summaryContentVersion, props.aedarSummaryData.summary.aedarContentVersion,
    props.aedarSummaryData.summary.referenceContentVersion]) : null)
watch([comparisonRequest, comparisonFocalIdentity, comparisonRetry], async ([request], _old, cleanup) => {
  const focal = props.aedarSummaryData?.status === 'ready' ? props.aedarSummaryData.summary : null
  comparison.value = null
  comparisonState.value = 'idle'
  comparisonError.value = ''
  if (!request || !focal) return
  const abort = new AbortController()
  cleanup(() => abort.abort())
  comparisonState.value = 'loading'
  const result = await fetchAedarComparison(props.content.territory.type as AedarTerritoryType, props.content.territory.code, {
      ...request, typequ: [], measures: AEDAR_AGGREGATE_READING_KEYS,
      rankMeasures: ['meanDiversity', 'meanVolume'],
      expectedContentVersion: focal.aedarContentVersion,
      expectedSummaryContentVersion: focal.summaryContentVersion,
      expectedReferenceContentVersion: focal.referenceContentVersion, signal: abort.signal,
  })
  if (abort.signal.aborted) return
  if (!result) {
    comparisonState.value = 'error'
    comparisonError.value = 'Comparaison AEDAR indisponible'
    return
  }
  comparisonState.value = result.status === 'ready' ? 'ready' : 'error'
  if (result.status === 'ready') comparison.value = result.evidence
  else comparisonError.value = result.message
}, { immediate: true })

const lossMapMetadata = ref<AedarDiversityLossMapMetadata>({ status: 'loading', legend: null })
let lossMapMetadataRequest = 0

watch(() => `${props.content.territory.type}/${props.content.territory.code}`, async () => {
  const request = ++lossMapMetadataRequest
  const territory = props.content.territory
  lossMapMetadata.value = { status: 'loading', legend: null }
  try {
    const legend = await fetchAedarDiversityLossMapLegend(territory)
    if (request === lossMapMetadataRequest) lossMapMetadata.value = { status: 'ready', legend }
  } catch {
    if (request === lossMapMetadataRequest) lossMapMetadata.value = { status: 'unavailable', legend: null }
  }
}, { immediate: true })

const transformed = computed(() => {
  const summary = props.aedarSummaryData?.status === 'ready' ? props.aedarSummaryData.summary : null
  const detail = props.aedarData?.status === 'ready' ? props.aedarData : null
  if (!summary && !detail) {
    // The published map legend is independently available from aggregate facts.
    // Keep the map/editorial page in place while numeric sections hydrate.
    // #769: render the pending skeleton in the EXACT hydrated order (prose ->
    // car overview -> loss maps -> ...) so resolving the aggregates replaces
    // sections in place instead of inserting content above the reader's
    // current position and jumping « Et sans voiture alors ? » down.
    const first = props.content.units[0]
    if (!first || !props.content.territory) return props.content
    const pending = aedarPendingPrototypeSections(props.content.territory, { lossMapMetadata: lossMapMetadata.value })
    const carOverview = pending[0]
    const introduction = carOverview.evidence?.kind === 'aedar-car-overview'
      ? carOverview.evidence.unitIntroduction
      : first.introduction
    const units = [{ ...first, introduction, sections: pending }, ...props.content.units.slice(1)]
    return { ...props.content, units } as unknown as ThemeContent
  }
  const referenceTerritoire = props.aedarReferenceTerritoire ?? null
  const referenceData = props.aedarReferenceData?.status === 'ready' ? props.aedarReferenceData.summary : null
  // The semantic builder checks both publication tokens before drawing reference lines.
  const allowDirectReference = !control.value || (control.value.selection.etat !== 'vide'
    && control.value.selection.etat !== 'membres'
    && (comparisonRequest.value?.intent.kind !== 'fixed_comparison' || comparisonRequest.value.intent.context !== 'density_class'))
  const reference = allowDirectReference && referenceTerritoire && referenceData
    ? { data: referenceData, territory: { type: referenceTerritoire.type, id: referenceTerritoire.id }, label: referenceTerritoire.nom }
    : null
  const directReferenceExpected = Boolean(allowDirectReference && referenceTerritoire)
  const directReferenceReady = referenceData !== null && props.aedarReferenceStatus !== 'error'
  const sections = aedarPrototypeSections(summary, detail, props.content.territory, {
    reference,
    comparison: comparison.value,
    comparisonRequest: comparisonRequest.value,
    comparisonPending: directReferenceExpected && !directReferenceReady,
    comparisonAccessibleLabel: comparisonRequest.value?.intent.kind === 'fixed_comparison'
      && comparisonRequest.value.intent.context !== 'density_class' && referenceTerritoire
      ? `Moyenne de ${referenceTerritoire.nom}` : referenceTerritoire ? `Moyenne de ${referenceTerritoire.nom}` : null,
    lossMapMetadata: lossMapMetadata.value,
  })
  const carOverview = sections.find((section) => section.key === 'aedar-car-overview')
  const introduction = carOverview?.evidence?.kind === 'aedar-car-overview'
    ? carOverview.evidence.unitIntroduction
    : []
  const first = props.content.units[0]
  const units = [{ ...first, introduction, rundown: [], sections }, ...props.content.units.slice(1)]
  const usedSourceIds = new Set(units.flatMap((unit) => unit.sections.flatMap((section) => section.provenance)))
  const sourceIdentity = (source: ContentSource) => [source.id, source.version, source.referenceDate, source.publicationDate].join('\u0000')
  const sourceRegister = new Map(
    props.content.sourceRegister
      .filter((source) => usedSourceIds.has(source.id))
      .map((source) => [sourceIdentity(source), source]),
  )
  for (const source of [...(summary?.provenance.sources ?? []), ...(detail?.provenance.sources ?? [])]) {
    if (!usedSourceIds.has(source.source_id)) continue
    const entry: ContentSource = {
      id: source.source_id,
      source: source.attribution || 'Source',
      version: source.vintage_id,
      referenceDate: source.reference_date,
      publicationDate: source.publication_date,
    }
    sourceRegister.set(sourceIdentity(entry), entry)
  }
  return { ...props.content, sourceRegister: [...sourceRegister.values()], units } as unknown as ThemeContent
})
</script>

<template>
  <div v-if="props.aedarSummaryStatus === 'error'" class="aedar-state" role="alert">
    <p>{{ AEDAR_SUMMARY_UNAVAILABLE_MESSAGE }}</p>
    <button type="button" @click="props.retryAedarSummary?.()">Réessayer</button>
  </div>
  <p v-else-if="aedarReferenceStatus === 'error' && !comparisonRequest && control?.selection.etat !== 'vide' && control?.selection.etat !== 'membres'" class="aedar-comparison-state" role="status">Groupe comparé indisponible.</p>
  <div v-if="props.aedarStatus === 'error'" class="aedar-state" role="alert">
    <p>{{ AEDAR_DETAIL_UNAVAILABLE_MESSAGE }}</p>
    <button type="button" @click="props.retryAedar">Réessayer</button>
  </div>
  <VarianteCahierLibre
    :content="transformed"
    :pagination="props.pagination"
    :aedar-status="props.aedarStatus"
    :comparison-status="displayedComparisonStatus"
    :comparison-error="displayedComparisonError"
    :retry-comparison="retryFailedComparisons"
    :native-comparison-status="props.nativeComparisonStatus"
    :native-comparison-error="props.nativeComparisonError"
    :retry-native-comparison="props.retryNativeComparison"
    show-all-units
    presentation="plain"
    layout-variant="indexed-sections"
    network-figure-variant="traces"
    aedar-access-enabled
  />
</template>

<style scoped>
.aedar-comparison-state { margin: var(--space-4) 0; color: var(--text-secondary); font: var(--text-body-sm); }
.aedar-state { padding: var(--space-8); text-align: center; color: var(--muted); }
.aedar-state button { margin-top: var(--space-4); padding: var(--space-2) var(--space-4); border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--surface-primary); cursor: pointer; }
.aedar-state button:hover { background: var(--surface-tertiary); }
</style>
