<script setup lang="ts">
/**
 * Narrow delegate for the Mobilité sections (#954, contract C8).
 *
 * It receives only the discriminated section, the unit identity and the theme
 * comparison state. It may read the shared comparison control through the same
 * injected key VarianteCahierLibre already uses, to turn an explicitly empty
 * selection into an honest inactive state without widening this interface.
 */
import { computed, inject } from 'vue'

import { CONTROLE_COMPARAISON_KEY } from '@/fiche/comparisonContext'
import { formatServedRankAria, puceRangDirection } from '@/fiche/figureGrammaire'
import { LIBELLES_DIRECTION } from '@/methodes/indicateurs'
import type {
  AedarEvidenceSource,
  ContentSource,
  MobiliteContentSection,
  MobiliteNetworksEvidence,
  MobiliteRatioEvidence,
  MobiliteStationnementRavitaillementEvidence,
} from '@/fiche/content/themeContent'
import CahierComparisonValue from './CahierComparisonValue.vue'
import CahierEvidenceSource from './CahierEvidenceSource.vue'
import CahierFigureScalar from './CahierFigureScalar.vue'
import CahierMobiliteComparisonBars from './CahierMobiliteComparisonBars.vue'
import CahierProse from './CahierProse.vue'
import CartographicBreakoutPrototype from './CartographicBreakoutPrototype.vue'

const props = defineProps<{
  section: MobiliteContentSection
  unit: { key: string; label: string }
  comparison: {
    status: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'
    error?: string
    retry?: () => void
  }
}>()

const control = inject(CONTROLE_COMPARAISON_KEY, computed(() => null))

const effectiveComparison = computed(() => {
  if (props.comparison.status !== 'ready') return props.comparison
  const selection = control.value?.selection
  if (!selection) return props.comparison
  if (selection.etat === 'vide' || (selection.etat === 'membres' && selection.membres.length === 0)) {
    return { status: 'unavailable' as const, retry: props.comparison.retry }
  }
  return props.comparison
})

const networks = computed<MobiliteNetworksEvidence | null>(() =>
  props.section.evidence?.kind === 'mobilite-networks' ? props.section.evidence : null,
)
const paired = computed<MobiliteStationnementRavitaillementEvidence | null>(() =>
  props.section.evidence?.kind === 'mobilite-stationnement-ravitaillement' ? props.section.evidence : null,
)

function stampSource(source: ContentSource): AedarEvidenceSource {
  return {
    label: source.source,
    version: source.version,
    url: source.url ?? '',
    credit: source.licence ?? null,
  }
}

function ratioValueLabel(ratio: MobiliteRatioEvidence): string {
  const value = ratio.value.fact.value
  return value === null
    ? 'Indisponible'
    : `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)} ${ratio.value.fact.unit}`
}

function ratioAriaLabel(ratio: MobiliteRatioEvidence, scope: string | null): string {
  const value = ratioValueLabel(ratio)
  const comparison = ratio.value.fact.comparison
  const direction = comparison?.direction ? LIBELLES_DIRECTION[comparison.direction] : null
  const rank = comparison
    ? puceRangDirection(comparison.rank, comparison.direction, scope)?.phraseAria ?? formatServedRankAria(comparison.rank)
    : null
  return `${ratio.label} : ${value}${rank ? `. Rang ${rank}` : direction ? `. ${direction}` : ''}`
}
</script>

<template>
  <div
    class="mobilite-section"
    :class="`mobilite-section--${section.key}`"
    :data-unit-key="unit.key"
  >
    <template v-if="networks">
      <div class="mobilite-networks-maps">
        <CartographicBreakoutPrototype
          :territory="networks.territory"
          :evidence="networks"
        />
      </div>
      <div class="mobilite-section-spread">
        <div class="mobilite-section-copy">
          <CahierProse class="argument-copy" :blocks="networks.prose" />
          <div v-if="networks.sources.length" class="mobilite-section-sources">
            <template v-for="source in networks.sources" :key="`${source.id}-${source.version}`">
              <CahierEvidenceSource v-if="source.url" :source="stampSource(source)" />
              <p v-else class="cahier-evidence-source mobilite-source-stamp" data-source-url-missing>
                {{ source.source }} {{ source.version }}<span v-if="source.licence"> · {{ source.licence }}</span>
              </p>
            </template>
          </div>
        </div>
        <figure class="mobilite-section-figure">
          <figcaption class="cahier-figure-title">{{ networks.figure.figureTitle }}</figcaption>
          <CahierMobiliteComparisonBars
            :figure="networks.figure"
            :comparison="effectiveComparison"
          />
        </figure>
      </div>
    </template>

    <div v-else-if="paired" class="mobilite-paired">
      <section
        v-for="column in paired.columns"
        :key="column.key"
        class="mobilite-paired-column"
        :data-column="column.key"
      >
        <div class="mobilite-section-copy">
          <CahierProse class="argument-copy" :blocks="column.prose" />
          <div v-if="column.sources.length" class="mobilite-section-sources">
            <template v-for="source in column.sources" :key="`${column.key}-${source.id}-${source.version}`">
              <CahierEvidenceSource v-if="source.url" :source="stampSource(source)" />
              <p v-else class="cahier-evidence-source mobilite-source-stamp" data-source-url-missing>
                {{ source.source }} {{ source.version }}<span v-if="source.licence"> · {{ source.licence }}</span>
              </p>
            </template>
          </div>
        </div>
        <figure class="mobilite-section-figure">
          <figcaption class="cahier-figure-title">{{ column.bars.figureTitle }}</figcaption>
          <CahierMobiliteComparisonBars
            :figure="column.bars"
            :comparison="effectiveComparison"
          />
        </figure>
        <figure class="mobilite-ratio-scalar">
          <CahierFigureScalar
            :value="ratioValueLabel(column.ratio)"
            :label="column.ratio.label"
            label-role="metric"
            :aria-label="ratioAriaLabel(column.ratio, column.bars.comparisonLabel)"
          >
            <template #reference>
              <CahierComparisonValue
                v-if="column.ratio.value.fact.comparison?.reference || effectiveComparison.status === 'loading' || effectiveComparison.status === 'error'"
                :fact="column.ratio.value.fact"
                :comparison-status="effectiveComparison.status"
                :comparison-error="effectiveComparison.error"
              />
              <span v-else-if="effectiveComparison.status === 'ready'" class="cahier-figure-comparison">
                Groupe comparé : Indisponible
              </span>
            </template>
          </CahierFigureScalar>
          <p v-if="column.ratio.note" class="mobilite-ratio__note">{{ column.ratio.note }}</p>
        </figure>
      </section>
    </div>
  </div>
</template>

<style scoped>
.mobilite-section { display: grid; gap: var(--space-6); min-width: 0; }
.mobilite-networks-maps { min-width: 0; }
.mobilite-section-spread { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); gap: clamp(var(--space-4), 3vw, var(--space-8)); align-items: start; }
.mobilite-section-copy { display: grid; gap: var(--space-3); align-content: start; min-width: 0; }
.mobilite-section-copy .argument-copy { margin: 0; }
.mobilite-section-sources { display: grid; gap: var(--space-1); }
.mobilite-source-stamp { margin: 0; }
.mobilite-section-figure { margin: 0; display: grid; gap: var(--space-2); min-width: 0; }
.mobilite-paired {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-template-rows: auto auto auto;
  column-gap: clamp(24px, 4vw, 56px);
  row-gap: var(--space-3);
  align-items: start;
}
.mobilite-paired-column {
  display: grid;
  grid-template-rows: subgrid;
  grid-row: 1 / span 3;
  gap: var(--space-3);
  min-width: 0;
}
.mobilite-ratio-scalar {
  margin: 0;
  display: grid;
  gap: var(--space-1);
  border-top: 1px solid color-mix(in srgb, var(--cahier-theme) 22%, var(--paper));
  padding-top: var(--space-3);
}
.mobilite-ratio__note { margin: 0; color: var(--text-secondary); font: var(--text-caption); }
@media (max-width: 760px) {
  .mobilite-section-spread,
  .mobilite-paired { grid-template-columns: minmax(0, 1fr); }
  .mobilite-paired { grid-template-rows: none; }
  .mobilite-paired-column { grid-row: auto; grid-template-rows: none; display: grid; gap: var(--space-4); }
}
</style>
