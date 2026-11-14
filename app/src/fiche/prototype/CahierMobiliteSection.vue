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
import type { Component } from 'vue'
import { Bike, CarFront, Divide, Fuel, PlugZap } from 'lucide-vue-next'

import { CONTROLE_COMPARAISON_KEY } from '@/fiche/comparisonContext'
import { formatServedRankAria, puceRangDirection } from '@/fiche/figureGrammaire'
import { LIBELLES_DIRECTION } from '@/methodes/indicateurs'
import type {
  AedarEvidenceSource,
  ContentSource,
  MobiliteContentSection,
  MobiliteNetworksEvidence,
  MobiliteRaccordementEvidence,
  MobiliteRatioEvidence,
  MobiliteShareEvidence,
  MobiliteStationnementRavitaillementEvidence,
} from '@/fiche/content/themeContent'
import CahierComparisonValue from './CahierComparisonValue.vue'
import CahierEvidenceSource from './CahierEvidenceSource.vue'
import CahierFigureScalar from './CahierFigureScalar.vue'
import CahierMobiliteComparisonBars from './CahierMobiliteComparisonBars.vue'
import CahierMobiliteRaccordementCurve from './CahierMobiliteRaccordementCurve.vue'
import CahierMobiliteShareTrack from './CahierMobiliteShareTrack.vue'
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

/**
 * #1006 — an explicit « Aucune comparaison » (the header control's empty
 * selection) is not an unavailable comparison: the compared row disappears
 * instead of showing a failure. The state comes from the selection the control
 * already provides; the delegate never widens its props to carry it.
 */
const comparisonNone = computed(() => control.value?.selection.etat === 'vide')

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
const share = computed<MobiliteShareEvidence | null>(() =>
  props.section.evidence?.kind === 'mobilite-share' ? props.section.evidence : null,
)
const curve = computed<MobiliteRaccordementEvidence | null>(() =>
  props.section.evidence?.kind === 'mobilite-raccordement' ? props.section.evidence : null,
)

function stampSource(source: ContentSource): AedarEvidenceSource {
  return {
    label: source.source,
    // The compact stamp uses the app-owned display precision when the served
    // version is an opaque token; the factual version stays in the carnet.
    version: source.displayVersion ?? source.version,
    url: source.url ?? '',
    credit: source.licence ?? null,
  }
}

/**
 * #974 — the ratio's own scale reads as a division in the AEDAR scalar value
 * line. Only shared semantic inks are used: bike, car, and the neutral ink for
 * the operator. A charging point is a car-side equipment, so it wears the car
 * ink like the fuel pump it is divided by.
 */
type RatioPart = { key: string; icon: Component; tone: 'bike' | 'car' | 'divide' }

const RATIO_PARTS: Readonly<Record<'stationnement' | 'ravitaillement', readonly RatioPart[]>> = {
  stationnement: [
    { key: 'bike', icon: Bike, tone: 'bike' },
    { key: 'divide', icon: Divide, tone: 'divide' },
    { key: 'car', icon: CarFront, tone: 'car' },
  ],
  ravitaillement: [
    { key: 'charging', icon: PlugZap, tone: 'car' },
    { key: 'divide', icon: Divide, tone: 'divide' },
    { key: 'fuel', icon: Fuel, tone: 'car' },
  ],
}

function ratioParts(columnKey: 'stationnement' | 'ravitaillement'): readonly RatioPart[] {
  return RATIO_PARTS[columnKey]
}

function formatRatioValue(value: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)
}

/** The producer's own scale, never re-based: the placeholder `%VALUE%` is this number. */
function ratioDisplayValue(ratio: MobiliteRatioEvidence): string {
  const value = ratio.value.fact.value
  return value === null ? '—' : formatRatioValue(value)
}

function ratioValueLabel(ratio: MobiliteRatioEvidence): string {
  const value = ratio.value.fact.value
  return value === null
    ? 'Indisponible'
    : `${formatRatioValue(value)} ${ratio.value.fact.unit}`
}

function ratioAriaLabel(
  ratio: MobiliteRatioEvidence,
  scope: string | null,
  status: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable',
  error?: string,
): string {
  const fact = ratio.value.fact
  const parts = [`${ratio.label} : ${ratioValueLabel(ratio)}`]
  if (fact.value === null) {
    parts.push(ratio.note ?? 'Valeur indisponible')
    return parts.join('. ')
  }
  if (status === 'loading') {
    parts.push('Comparaison en cours de chargement')
    return parts.join('. ')
  }
  if (status === 'error') {
    parts.push(`Comparaison indisponible : ${error ?? 'échec du chargement'}`)
    return parts.join('. ')
  }
  if (status === 'unavailable') {
    parts.push('Comparaison indisponible')
    return parts.join('. ')
  }
  const comparison = fact.comparison
  if (!comparison) {
    parts.push('Comparaison indisponible')
    return parts.join('. ')
  }
  const reference = comparison.reference
  const referenceValue = reference
    ? `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(reference.value)} ${fact.unit}`
    : 'référence indisponible'
  const scopeLabel = scope ?? comparison.scope.label ?? 'portée non précisée'
  parts.push(`Référence ${referenceValue} (${scopeLabel})`)
  const direction = LIBELLES_DIRECTION[comparison.direction] ?? null
  const rank = puceRangDirection(comparison.rank, comparison.direction, scope)?.phraseAria
    ?? formatServedRankAria(comparison.rank)
  if (rank) parts.push(`Rang ${rank}`)
  else if (direction) parts.push(direction)
  return parts.join('. ')
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
            :value="ratioDisplayValue(column.ratio)"
            :label="column.ratio.label"
            label-role="metric"
            color-value
            :aria-label="ratioAriaLabel(column.ratio, column.bars.comparisonLabel, effectiveComparison.status, effectiveComparison.error)"
          >
            <template #value-prefix>
              <component
                :is="part.icon"
                v-for="part in ratioParts(column.key)"
                :key="`${column.key}-${part.key}`"
                class="mobilite-ratio__icon"
                :class="`mobilite-ratio__icon--${part.tone}`"
                :data-ratio-part="part.key"
                :size="15"
                :stroke-width="2.2"
                aria-hidden="true"
              />
            </template>
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

    <div v-else-if="share" class="mobilite-section-spread mobilite-section-spread--centred">
      <div class="mobilite-section-copy">
        <CahierProse class="argument-copy" :blocks="share.prose" />
        <div v-if="share.sources.length" class="mobilite-section-sources">
          <template v-for="source in share.sources" :key="`share-${source.id}-${source.version}`">
            <CahierEvidenceSource v-if="source.url" :source="stampSource(source)" />
            <p v-else class="cahier-evidence-source mobilite-source-stamp" data-source-url-missing>
              {{ source.source }} {{ source.displayVersion ?? source.version }}<span v-if="source.licence"> · {{ source.licence }}</span>
            </p>
          </template>
        </div>
      </div>
      <figure class="mobilite-section-figure">
        <figcaption class="cahier-figure-title">{{ share.figureTitle }}</figcaption>
        <CahierMobiliteShareTrack
          :figure="share"
          :comparison="effectiveComparison"
          :comparison-none="comparisonNone"
        />
      </figure>
    </div>

    <div v-else-if="curve" class="mobilite-section-stack">
      <div class="mobilite-section-copy">
        <CahierProse class="argument-copy" :blocks="curve.prose" />
        <div v-if="curve.sources.length" class="mobilite-section-sources">
          <template v-for="source in curve.sources" :key="`curve-${source.id}-${source.version}`">
            <CahierEvidenceSource v-if="source.url" :source="stampSource(source)" />
            <p v-else class="cahier-evidence-source mobilite-source-stamp" data-source-url-missing>
              {{ source.source }} {{ source.version }}<span v-if="source.licence"> · {{ source.licence }}</span>
            </p>
          </template>
        </div>
      </div>
      <figure class="mobilite-section-figure mobilite-section-figure--wide">
        <figcaption class="cahier-figure-title">{{ curve.figureTitle }}</figcaption>
        <CahierMobiliteRaccordementCurve :figure="curve" :comparison="effectiveComparison" />
      </figure>
    </div>
  </div>
</template>

<style scoped>
.mobilite-section { display: grid; gap: var(--space-6); min-width: 0; }
.mobilite-networks-maps { min-width: 0; }
.mobilite-section-spread { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); gap: clamp(var(--space-4), 3vw, var(--space-8)); align-items: start; }
/* #1006 — the coverage prose column is vertically centred against its figure
 * on desktop; the mobile stack keeps natural sequential reading. */
.mobilite-section-spread--centred { align-items: center; }
.mobilite-section-stack { display: grid; gap: var(--space-4); min-width: 0; }
.mobilite-section-copy { display: grid; gap: var(--space-3); align-content: start; min-width: 0; }
.mobilite-section-copy .argument-copy { margin: 0; }
.mobilite-section-sources { display: grid; gap: var(--space-1); }
.mobilite-source-stamp { margin: 0; }
.mobilite-section-figure { margin: 0; display: grid; gap: var(--space-2); min-width: 0; }
.mobilite-section-figure--wide { width: 100%; }
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
}
/* The ratio keeps the paired row's own rhythm: no rule, no separator margin
 * between the bars and the ratio (issue #974). */
.mobilite-ratio__icon { flex: 0 0 auto; }
.mobilite-ratio__icon--bike { color: var(--cahier-mode-bike, var(--mode-bike)); }
.mobilite-ratio__icon--car { color: var(--cahier-mode-car, var(--mode-car)); }
.mobilite-ratio__icon--divide { color: var(--cahier-default, var(--editorial-muted)); }
.mobilite-ratio__note { margin: 0; color: var(--text-secondary); font: var(--text-caption); }
@media (max-width: 760px) {
  .mobilite-section-spread,
  .mobilite-paired { grid-template-columns: minmax(0, 1fr); }
  /* Single column: centring the cross axis would shrink the stacked boxes, so
   * the coverage spread returns to the natural reading alignment. */
  .mobilite-section-spread--centred { align-items: stretch; }
  .mobilite-paired { grid-template-rows: none; }
  .mobilite-paired-column { grid-row: auto; grid-template-rows: none; display: grid; gap: var(--space-4); }
}
</style>
