<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import VarianteCahierLibre from '../prototype/VarianteCahierLibre.vue'
import { aedarPrototypeSections } from '@/fiche/content/aedarAccessSection'
import { aedarDiversityLossSection } from '@/fiche/content/aedarDiversityLossMaps'
import { fetchAedarDiversityLossMapLegend } from '@/fiche/content/aedarDiversityLossMaps'
import type { AedarDiversityLossMapMetadata } from '@/fiche/content/aedarDiversityLossMaps'
import type { AedarFetchResult, AedarTerritoryType } from '@/fiche/content/aedarApiClient'
import type { ContentSource, ThemeContent } from '@/fiche/content/themeContent'
import type { CahierPagination } from '../prototype/cahierPagination'
import type { OptionContexteComparaison } from '@/fiche/comparisonContext'

const props = defineProps<{
  content: ThemeContent
  pagination: CahierPagination
  comparisonOptions: readonly OptionContexteComparaison[]
  aedarData: AedarFetchResult | null
  aedarStatus: 'loading' | 'ready' | 'error'
  retryAedar: () => void
  /** Single published reference territory behind the comparison lines (never a cohort). */
  aedarReferenceTerritoire?: { type: AedarTerritoryType; id: string; nom: string } | null
  aedarReferenceData?: AedarFetchResult | null
  aedarReferenceStatus?: 'unavailable' | 'loading' | 'ready' | 'error'
  accessStatus?: 'loading' | 'ready' | 'error'
  retryAccess?: () => void
  buildingStatus?: 'loading' | 'ready' | 'error'
  retryBuilding?: () => void
}>()

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
  if (!props.aedarData || props.aedarData.status !== 'ready') {
    // The published map legend is independently available from aggregate facts.
    // Keep the map/editorial page in place while numeric sections hydrate.
    const first = props.content.units[0]
    if (!first || !props.content.territory) return props.content
    const map = aedarDiversityLossSection(lossMapMetadata.value, props.content.territory)
    const sections = first.sections.filter((section) => String(section.key) !== map.key)
    const units = [{ ...first, sections: [...sections.slice(0, 1), map, ...sections.slice(1)] }, ...props.content.units.slice(1)]
    return { ...props.content, units } as unknown as ThemeContent
  }
  const focal = props.aedarData
  const referenceTerritoire = props.aedarReferenceTerritoire ?? null
  const referenceData = props.aedarReferenceData ?? null
  // The semantic builder checks both publication tokens before drawing reference lines.
  const reference = referenceTerritoire && referenceData && referenceData.status === 'ready'
    ? { data: referenceData, territory: { type: referenceTerritoire.type, id: referenceTerritoire.id }, label: referenceTerritoire.nom }
    : null
  const sections = aedarPrototypeSections(focal, props.content.territory, {
    reference,
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
  for (const source of focal.provenance.sources) {
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
  <div v-if="props.aedarStatus === 'error'" class="aedar-state" role="alert">
    <p>Les données AEDAR ne sont pas disponibles.</p>
    <button type="button" @click="props.retryAedar">Réessayer</button>
  </div>
  <VarianteCahierLibre
    :content="transformed"
    :pagination="props.pagination"
    :comparison-options="props.comparisonOptions"
    :access-status="props.accessStatus"
    :retry-access="props.retryAccess"
    :building-status="props.buildingStatus"
    :retry-building="props.retryBuilding"
    :aedar-status="props.aedarStatus"
    show-all-units
    presentation="plain"
    layout-variant="indexed-sections"
    network-figure-variant="traces"
    aedar-access-enabled
  />
</template>

<style scoped>
.aedar-state { padding: var(--space-8); text-align: center; color: var(--muted); }
.aedar-state button { margin-top: var(--space-4); padding: var(--space-2) var(--space-4); border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--surface-primary); cursor: pointer; }
.aedar-state button:hover { background: var(--surface-tertiary); }
</style>
