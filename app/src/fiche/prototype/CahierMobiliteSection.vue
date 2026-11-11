<script setup lang="ts">
/**
 * Narrow delegate for the Mobilité sections (#954, contract C8).
 *
 * It receives only the discriminated section, the unit identity and the theme
 * comparison state. No AEDAR prop, mode or horizon state, and no pagination is
 * forwarded here.
 */
import { computed } from 'vue'

import type {
  AedarEvidenceSource,
  ContentSource,
  MobiliteContentSection,
  MobiliteNetworksEvidence,
  MobiliteStationnementRavitaillementEvidence,
} from '@/fiche/content/themeContent'
import CahierEvidenceSource from './CahierEvidenceSource.vue'
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

const networks = computed<MobiliteNetworksEvidence | null>(() =>
  props.section.evidence?.kind === 'mobilite-networks' ? props.section.evidence : null,
)
const paired = computed<MobiliteStationnementRavitaillementEvidence | null>(() =>
  props.section.evidence?.kind === 'mobilite-stationnement-ravitaillement' ? props.section.evidence : null,
)

function stamps(sources: readonly ContentSource[]): readonly AedarEvidenceSource[] {
  return sources.flatMap((source) => source.url
    ? [{
      label: source.source,
      version: source.version,
      url: source.url,
      credit: source.licence ?? null,
    }]
    : [])
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
          <div v-if="stamps(networks.sources).length" class="mobilite-section-sources">
            <CahierEvidenceSource
              v-for="source in stamps(networks.sources)"
              :key="`${source.label}-${source.version}`"
              :source="source"
            />
          </div>
        </div>
        <figure class="mobilite-section-figure">
          <figcaption class="cahier-figure-title">{{ networks.figure.figureTitle }}</figcaption>
          <CahierMobiliteComparisonBars
            :figure="networks.figure"
            :comparison="comparison"
          />
        </figure>
      </div>
    </template>

    <div v-else-if="paired" class="figure-spread figure-spread--paired mobilite-paired">
      <section
        v-for="column in paired.columns"
        :key="column.key"
        class="mobilite-paired-column"
        :data-column="column.key"
      >
        <div class="mobilite-section-copy">
          <CahierProse class="argument-copy" :blocks="column.prose" />
          <div v-if="stamps(column.sources).length" class="mobilite-section-sources">
            <CahierEvidenceSource
              v-for="source in stamps(column.sources)"
              :key="`${column.key}-${source.label}-${source.version}`"
              :source="source"
            />
          </div>
        </div>
        <figure class="mobilite-section-figure">
          <figcaption class="cahier-figure-title">{{ column.bars.figureTitle }}</figcaption>
          <CahierMobiliteComparisonBars
            :figure="column.bars"
            :comparison="comparison"
            :ratio="column.ratio"
          />
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
.mobilite-section-figure { margin: 0; display: grid; gap: var(--space-2); min-width: 0; }
.mobilite-paired {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: clamp(24px, 4vw, 56px);
  row-gap: var(--space-6);
  align-items: start;
}
.mobilite-paired-column { display: grid; gap: var(--space-4); min-width: 0; }
@media (max-width: 760px) {
  .mobilite-section-spread,
  .mobilite-paired { grid-template-columns: minmax(0, 1fr); }
}
</style>
