<script setup lang="ts">
/**
 * [PROTOTYPE #511 — JETABLE] Variante D — « Cahier libre ».
 *
 * This surface is deliberately content-only. ThemeContent owns the semantic
 * claims, evidence, availability, provenance, wording, and exploration
 * targets. CahierPagination owns the presentation sequence. This component
 * only lays those two inputs out as the existing Cahier exploration.
 */
import { SlidersHorizontal } from 'lucide-vue-next'
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import BoutonComparaison from '@/components/fiche/BoutonComparaison.vue'
import ConstructeurComparaison from '@/components/fiche/ConstructeurComparaison.vue'
import PassarelleExploration from '@/components/fiche/PassarelleExploration.vue'
import {
  CONTROLE_COMPARAISON_KEY,
} from '@/fiche/comparisonContext'
import type {
  ContentSection,
  ExplorationTarget,
  SingleUnitThemeContent,
  ThemeContent,
} from '@/fiche/content/themeContent'
import {
  routePourCibleExploration,
  routePourSectionExploration,
} from '@/fiche/explorationHandoff'
import type { ChapitreDemandStatus } from '@/fiche/content/demandInventory'
import type { CahierPagination } from './cahierPagination'
import CahierProse from './CahierProse.vue'
import { CahierSectionBody, cahierSectionRendererFor } from './cahierSectionRenderers'
import { provideAedarSectionContext } from './aedarSectionContext'
import { useCahierBaselineGrid } from './useCahierBaselineGrid'

const props = withDefaults(defineProps<{
  content: ThemeContent | SingleUnitThemeContent
  pagination: CahierPagination
  presentation?: 'ruled' | 'plain'
  layoutVariant?: 'standard' | 'indexed-sections'
  showAllUnits?: boolean
  networkFigureVariant?: 'traces'
  showMapPrototype?: boolean
  aedarAccessEnabled?: boolean
  /** #986 — the AEDAR (page-1) chapter is the requested one: its own reads may start. */
  aedarChapterActive?: boolean
  aedarStatus?: 'loading' | 'ready' | 'error'
  comparisonStatus?: 'idle' | 'loading' | 'ready' | 'error'
  comparisonError?: string
  retryComparison?: () => void
  nativeComparisonStatus?: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'
  nativeComparisonError?: string
  retryNativeComparison?: () => void
  /** #1008 — the visible chapter's admission state, owned by the demand planner. */
  chapitresStatut?: Readonly<Record<string, ChapitreDemandStatus>>
  /** The page-level data state already owns this failure and renders its retry. */
  erreurPage?: boolean
}>(), { aedarChapterActive: true })
const emit = defineEmits<{ 'chapitre-visible': [anchor: string]; 'chapitre-reessayer': [chapter: string] }>()
const route = useRoute()

/** #860 (ruling 2026-11-03) — le contrôle de comparaison fourni par la fiche
 *  s'assied dans le page-heading collant, à gauche du titre thème·territoire.
 *  `null` (prototype hors fiche, Région) : aucun bouton. */
const controleComparaison = inject(CONTROLE_COMPARAISON_KEY, computed(() => null))
const demandeConstructeur = ref(0)
const focusRetourConstructeur = ref<HTMLElement | null>(null)
const constructeurOuvert = ref(false)
function ouvrirConstructeur(source: HTMLButtonElement | MouseEvent | null): void {
  if (!source) return
  const target = source instanceof MouseEvent ? source.currentTarget : source
  if (target instanceof HTMLElement) focusRetourConstructeur.value = target
  demandeConstructeur.value++
}

const rootRef = ref<HTMLElement | null>(null)
const activeFigure = ref('')
let observer: IntersectionObserver | null = null
/** Every spine anchor that can carry `aria-current`, including the sources entry. */
const pageAnchors = computed(() => new Set(props.pagination.entries.map((entry) => entry.anchor)))
/** Chapter anchors only: the sources entry is not a demand chapter. */
const chapterAnchors = computed(() => new Set(props.pagination.entries
  .filter((entry) => entry.page !== null)
  .map((entry) => entry.anchor)))
const pageElements = new Map<string, HTMLElement>()
const pageVisibility = new Map<string, boolean>()
let emittedChapitre: string | null = null

const units = computed(() => props.showAllUnits ? props.content.units : props.content.units.slice(0, 1))
const unit = computed(() => units.value[0] ?? null)
provideAedarSectionContext(props.content,
  computed(() => props.aedarChapterActive !== false),
  computed(() => ({ status: props.comparisonStatus ?? 'idle', error: props.comparisonError, retry: props.retryComparison })),
)
function rendererFor(section: ContentSection) {
  return cahierSectionRendererFor(section.evidence, props.aedarAccessEnabled === true)
}

const pageEntry = computed(
  () => props.pagination.entries.find((entry) => entry.key === unit.value?.key) ?? null,
)
const sourceEntry = computed(
  () => props.pagination.entries.find((entry) => entry.key === 'sources') ?? null,
)

function pageEntryFor(key: string) {
  return props.pagination.entries.find((entry) => entry.key === key) ?? null
}

function pageAnchorFor(key: string): string {
  return pageEntryFor(key)?.anchor ?? `figure-${key}`
}

function formatDate(value: string | null): string | null {
  if (!value) return null
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(date)
}

function explorationLinks(section: ContentSection): readonly {
  target: ExplorationTarget
  to: NonNullable<ReturnType<typeof routePourCibleExploration>>
}[] {
  return section.explorationTargets.flatMap((target) => {
    const to = routePourCibleExploration(target)
    return to ? [{ target, to }] : []
  })
}

function sectionExploration(section: ContentSection) {
  const destination = explorationLinks(section)[0]?.to ?? routePourSectionExploration(section, {
    territoire: props.content.territory.code,
    type: props.content.territory.type,
  })
  if (destination) return destination
  if (aedarEquipmentProfileEvidenceFor(section) || aedarEquipmentExplorerEvidenceFor(section)) {
    return {
      path: route.path,
      query: route.query,
      hash: `#${sourceEntry.value?.anchor ?? 'figure-sources'}`,
    }
  }
  return null
}

function anchorForEntry(key: string): string {
  return props.pagination.entries.find((entry) => entry.key === key)?.anchor ?? `figure-${key}`
}

function sectionIsLoading(unitKey: string): boolean {
  return props.aedarStatus === 'loading' && unitKey === 'acces-aux-services'
}

/**
 * #1008 — a chapter the demand planner has not admitted yet is pending, not
 * factually absent. The state is only known when the route provides the
 * planner's map; standalone prototype mounts keep their historical absence
 * rendering.
 */
function sectionIsPending(unitKey: string): boolean {
  if (unitKey === 'acces-aux-services') return sectionIsLoading(unitKey)
  if (props.chapitresStatut === undefined) return false
  const statut = props.chapitresStatut[unitKey]
  return statut === undefined || statut === 'idle' || statut === 'loading'
}

/**
 * #1012 — only a chapter whose own demand read actually failed (never a settled
 * publication absence, a pending chapter or an unrequested one) exposes its
 * retry action. AEDAR owns its own retry, so page 1 is excluded here, and while
 * the page-level state owns the same failure its single retry is authoritative:
 * no second alert repeats it.
 */
function chapitreEnEchec(unitKey: string): boolean {
  if (props.erreurPage === true) return false
  return unitKey !== 'acces-aux-services' && props.chapitresStatut?.[unitKey] === 'error'
}

function sectionState(section: ContentSection, unitKey: string): string {
  if (sectionIsLoading(unitKey)) return 'Chargement des données AEDAR…'
  if (unitKey !== 'acces-aux-services' && props.chapitresStatut?.[unitKey] === 'error') {
    return 'Lecture indisponible avec les données disponibles.'
  }
  if (sectionIsPending(unitKey)) return 'Chargement des données…'
  return section.availability === 'absent'
    ? 'Contenu indisponible pour ce territoire.'
    : 'Lecture indisponible avec les données disponibles.'
}

/** Return AedarAccessEvidence when the section carries it and the prototype opt-in is enabled. */
function aedarAccessEvidenceFor(section: ContentSection) {
  if (!props.aedarAccessEnabled) return null
  if (section.evidence?.kind !== 'aedar-access') return null
  return section.evidence
}

function aedarEquipmentProfileEvidenceFor(section: ContentSection) {
  if (!props.aedarAccessEnabled || section.evidence?.kind !== 'aedar-equipment-profile') return null
  return section.evidence
}

function aedarEquipmentExplorerEvidenceFor(section: ContentSection) {
  if (!props.aedarAccessEnabled || section.evidence?.kind !== 'aedar-equipment-explorer') return null
  return section.evidence
}

function aedarCarAccessOverviewEvidenceFor(section: ContentSection) {
  if (!props.aedarAccessEnabled || section.evidence?.kind !== 'aedar-car-overview') return null
  return section.evidence
}

function isAedarAccessSection(section: ContentSection): boolean {
  return section.evidence?.kind === 'aedar-access'
}

function sourceLabel(source: { source: string; version: string }): string {
  const separator = source.source.indexOf(' — ')
  const shortSource = separator < 0 ? source.source : source.source.slice(0, separator)
  return `${shortSource} · ${source.version}`
}

const sourceLabels = computed(() => props.content.sourceRegister.map(sourceLabel))

useCahierBaselineGrid(rootRef, () => props.presentation !== 'plain')

onMounted(() => {
  activeFigure.value = pageEntry.value?.anchor ?? anchorForEntry('acces-aux-services')
  if (!rootRef.value || !('IntersectionObserver' in window)) return
  const figures = [...rootRef.value.querySelectorAll<HTMLElement>('[data-figure]')]
  for (const figure of figures) {
    const key = figure.getAttribute('data-figure')
    if (key && pageAnchors.value.has(key)) pageElements.set(key, figure)
  }
  observer = new IntersectionObserver(
    (entries) => {
      // Keep the page-level visibility of every observed page, not only the
      // entries that changed in this callback: an intermediate page can leave
      // while the next page enters, and the reader's page is the first one
      // actually in the existing reading band.
      for (const entry of entries) {
        const key = entry.target.getAttribute('data-figure')
        if (key && pageAnchors.value.has(key)) pageVisibility.set(key, entry.isIntersecting)
      }
      const active = [...pageVisibility.entries()]
        .filter(([, visible]) => visible)
        .map(([anchor]) => ({
          anchor,
          top: pageElements.get(anchor)?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
        }))
        .sort((left, right) => left.top - right.top)[0]?.anchor
      if (!active) return
      activeFigure.value = active
      if (chapterAnchors.value.has(active) && active !== emittedChapitre) {
        emittedChapitre = active
        emit('chapitre-visible', active)
      }
    },
    { rootMargin: '-14% 0px -66% 0px', threshold: [0, 0.25, 0.75] },
  )
  figures.forEach((figure) => observer?.observe(figure))
})

onBeforeUnmount(() => {
  observer?.disconnect()
})
</script>

<template>
  <article
    ref="rootRef"
    class="cahier presentation-editorial"
    :class="{
      'cahier--sans-grille': props.presentation === 'plain',
      'cahier--indexed-sections': props.layoutVariant === 'indexed-sections',
    }"
    :style="{
      '--cahier-theme': 'var(--theme-mobilite-line)',
      '--cahier-theme-strong': 'var(--theme-mobilite-strong)',
      '--cahier-ground': 'var(--theme-mobilite-soft)',
      '--cahier-theme-emphasis': 'var(--theme-mobilite)',
      '--cahier-region-emphasis': 'var(--brand-200)',
      '--cahier-mode-foot': 'var(--mode-transit)',
      '--cahier-mode-bike': 'var(--mode-bike)',
      '--cahier-mode-car': 'var(--mode-car)',
      '--cahier-cycle-protected': 'var(--cahier-mode-bike)',
      '--cahier-cycle-shared': '#8c4c9e',
    }"
  >
      <div class="cahier-reader">
      <aside class="cahier-spine" aria-label="Sommaire du cahier">
        <p class="spine-title">Sommaire</p>
        <ol>
          <li v-for="entry in pagination.entries" :key="entry.key">
            <a
              :href="`#${entry.anchor}`"
              :aria-current="activeFigure === entry.anchor ? 'location' : undefined"
            >
              <span class="spine-number">{{ entry.page === null ? '—' : String(entry.page).padStart(2, '0') }}</span>
              <span>{{ entry.label }}</span>
            </a>
          </li>
        </ol>
      </aside>

      <details class="mobile-index">
        <summary>Sommaire du cahier</summary>
        <nav aria-label="Sommaire du cahier">
          <a v-for="entry in pagination.entries" :key="entry.key" :href="`#${entry.anchor}`">
            <span class="spine-number">{{ entry.page === null ? '—' : String(entry.page).padStart(2, '0') }}</span>
            <span>{{ entry.label }}</span>
          </a>
        </nav>
      </details>

      <main class="cahier-pages">
        <section
          v-for="currentUnit in units"
          :key="currentUnit.key"
          :id="pageAnchorFor(currentUnit.key)"
          class="cahier-page"
          :data-figure="pageAnchorFor(currentUnit.key)"
          :aria-labelledby="`${pageAnchorFor(currentUnit.key)}-title`"
        >
          <div
            class="page-layout"
            :class="{ 'page-layout--sticky': props.presentation === 'plain' }"
          >
            <div class="page-main">
              <header class="page-heading">
                <span
                  v-if="props.layoutVariant === 'indexed-sections'"
                  class="page-heading-index"
                >
                  <span class="page-heading-sr-only">Page </span>
                  <span>{{ String(pageEntryFor(currentUnit.key)?.page ?? pagination.currentPage).padStart(2, '0') }}</span>
                  <small>/{{ String(pagination.totalPages).padStart(2, '0') }}</small>
                </span>
                <h2
                  class="cahier-baseline-anchor"
                  :id="`${pageAnchorFor(currentUnit.key)}-title`"
                >{{ currentUnit.label }}</h2>
                <span
                  v-if="props.layoutVariant === 'indexed-sections'"
                  class="page-heading-context"
                >
                  <!-- #860 : les contrôles précèdent le titre de contexte aligné à droite. -->
                  <span v-if="controleComparaison" class="page-heading-comparaison-controls">
                    <BoutonComparaison
                      class="page-heading-comparaison"
                      :selection="controleComparaison.selection"
                      :libelle-actif="controleComparaison.libelleActif"
                      :preset-defaut="controleComparaison.presetDefaut"
                      :presets="controleComparaison.presets"
                      @choisir="controleComparaison.choisir"
                      @construire="ouvrirConstructeur"
                    />
                    <button type="button" class="page-heading-builder-trigger"
                      aria-label="Construire un groupe de comparaison" aria-haspopup="dialog"
                      :aria-expanded="constructeurOuvert"
                      @click="ouvrirConstructeur">
                      <SlidersHorizontal :size="15" aria-hidden="true" />
                    </button>
                  </span>
                  <span class="page-heading-context-title">
                    <span class="page-heading-theme">{{ props.content.label }}</span>
                    <span class="page-heading-context-separator" aria-hidden="true">·</span>
                    <span class="page-heading-territory" :title="props.content.territory.name">{{ props.content.territory.name }}</span>
                  </span>
                </span>
              </header>

              <div class="page-copy">
                <CahierProse class="page-subtitle" :blocks="currentUnit.introduction" />
                <CahierProse v-if="currentUnit.rundown" class="page-subtitle page-rundown" :blocks="currentUnit.rundown" />
              </div>

              <!-- #1012 — the failed requested chapter keeps its own explicit
                   retry: the reader does not have to scroll away and back, and
                   the other settled chapters are never reset. -->
              <p
                v-if="chapitreEnEchec(currentUnit.key)"
                class="cahier-chapitre-erreur"
                role="alert"
              >
                <span>Cette page n’a pas pu être chargée.</span>
                <button
                  type="button"
                  class="cahier-chapitre-erreur__action"
                  @click="emit('chapitre-reessayer', currentUnit.key)"
                >Réessayer</button>
              </p>

              <div class="figure-stack">
                <section
              v-for="(section, sectionIndex) in currentUnit.sections"
              :key="section.key"
              class="concept-group"
              :data-section="section.key"
              :class="`cahier-section--${section.availability}`"
            >
              <div class="concept-group-heading cahier-baseline-group">
                <span v-if="props.layoutVariant !== 'indexed-sections'">{{ String(sectionIndex + 1).padStart(2, '0') }}</span>
                <div
                  v-if="props.presentation === 'plain' && section.lecture"
                  class="concept-group-heading-copy"
                >
                  <span class="concept-group-label">{{ section.label }}</span>
                  <h3 class="concept-group-narrative">{{ section.lecture.marelle }}</h3>
                </div>
                <h3 v-else>{{ section.label }}</h3>
              </div>

              <section
                :class="[rendererFor(section).classes, { 'figure-spread--flip': rendererFor(section).flip && sectionIndex % 2 === 1 }]"
                :id="`section-${section.key}`"
                :data-figure="`section-${section.key}`"
              >
                <div
                  v-if="rendererFor(section).argument && (props.presentation !== 'plain' || section.lecture?.prose.length || (!isAedarAccessSection(section) && !section.lecture && section.availability !== 'complete'))"
                  class="argument-side"
                >
                  <template v-if="section.lecture">
                    <h4
                      v-if="props.presentation !== 'plain'"
                      class="cahier-baseline-anchor cahier-marelle-anchor"
                    >{{ section.lecture.marelle }}</h4>
                    <CahierProse v-if="section.lecture?.prose.length" class="argument-copy" :blocks="section.lecture?.prose ?? []" />
                  </template>
                  <div
                    v-if="props.presentation !== 'plain' && section.explorationTargets.length > 0 && sectionExploration(section)"
                    class="cahier-section-exploration"
                    aria-label="Explorer les indicateurs de cette section"
                  >
                    <PassarelleExploration
                      :to="sectionExploration(section)!"
                      libelle="En savoir plus"
                      sans-soulignement
                      class="cahier-baseline-anchor"
                    />
                  </div>
                  <p v-if="!isAedarAccessSection(section) && !section.lecture && section.availability !== 'complete'" class="cahier-section-state" :role="sectionIsPending(currentUnit.key) ? 'status' : 'note'">{{ sectionState(section, currentUnit.key) }}</p>

                </div>

                <CahierSectionBody
                  v-if="rendererFor(section).body"
                  :section="section"
                  :unit="{ key: currentUnit.key, label: currentUnit.label }"
                  :comparison="{ status: props.nativeComparisonStatus ?? 'idle', error: props.nativeComparisonError, retry: props.retryNativeComparison }"
                  :enabled="props.aedarAccessEnabled === true"
                />
                <div v-else class="evidence-side evidence-placeholder" :role="sectionIsLoading(currentUnit.key) ? 'status' : 'note'">
                  <span>{{ sectionState(section, currentUnit.key) }}</span>
                </div>
              </section>
              <div
                v-if="props.presentation === 'plain' && (sectionExploration(section) || aedarCarAccessOverviewEvidenceFor(section) || aedarAccessEvidenceFor(section))"
                class="cahier-section-footer"
              >
                <div
                  v-if="props.presentation === 'plain' && (sectionExploration(section) || aedarCarAccessOverviewEvidenceFor(section) || aedarAccessEvidenceFor(section))"
                  class="cahier-section-exploration cahier-section-exploration--unit-footer"
                  :aria-label="aedarEquipmentProfileEvidenceFor(section) ? 'Consulter les sources de cette section' : 'Explorer les indicateurs de cette section'"
                >
                  <PassarelleExploration
                    :to="sectionExploration(section)"
                    :title="(aedarCarAccessOverviewEvidenceFor(section) || aedarAccessEvidenceFor(section)) && !sectionExploration(section) ? 'Exploration AEDAR à venir' : undefined"
                    libelle="En savoir plus"
                    sans-soulignement
                    nouvel-onglet
                    class="cahier-baseline-anchor"
                  />
                </div>
              </div>
                </section>
              </div>
            </div>

            <aside v-if="props.layoutVariant !== 'indexed-sections'" class="page-margin" aria-label="Informations marginales">
              <div class="page-number">
                <span>page</span>
                {{ String(pageEntryFor(currentUnit.key)?.page ?? pagination.currentPage).padStart(2, '0') }}<small>/{{ String(pagination.totalPages).padStart(2, '0') }}</small>
              </div>
              <div v-if="sourceLabels.length > 0" class="margin-sources">
                <span class="margin-label">Sources</span>
                <RouterLink v-for="source in sourceLabels" :key="source" to="/sources">{{ source }}</RouterLink>
              </div>
            </aside>
          </div>
        </section>

        <section
          :id="sourceEntry?.anchor ?? 'figure-sources'"
          class="sources-page"
          :data-figure="sourceEntry?.anchor ?? 'figure-sources'"
          aria-labelledby="sources-title"
        >
          <div v-if="props.layoutVariant !== 'indexed-sections'" class="page-margin" aria-hidden="true"><div class="page-number"><span>fin</span> ·</div></div>
          <header class="page-heading"><h2 id="sources-title">Carnet des sources</h2></header>
          <dl class="sources-list">
            <div v-for="source in content.sourceRegister" :key="source.id">
              <dt><RouterLink to="/sources">{{ source.source }}</RouterLink></dt>
              <dd>
                <span>Version {{ source.version }}</span>
                <span v-if="formatDate(source.referenceDate)"> · Référence {{ formatDate(source.referenceDate) }}</span>
                <span v-if="formatDate(source.publicationDate)"> · Publication {{ formatDate(source.publicationDate) }}</span>
              </dd>
            </div>
          </dl>
          <RouterLink class="sources-link" to="/sources">Voir toutes les sources</RouterLink>
        </section>
      </main>
      <ConstructeurComparaison v-if="controleComparaison"
        :selection="controleComparaison.selection"
        :focal="controleComparaison.focal"
        :territoires="controleComparaison.territoires"
        :presets="controleComparaison.presets"
        :preset-defaut="controleComparaison.presetDefaut"
        :demande-ouverture="demandeConstructeur"
        :masquer-declencheur="true"
        :focus-retour="focusRetourConstructeur"
        @ouverte="constructeurOuvert = $event"
        @choisir="controleComparaison.choisir"
      />
    </div>
    <p v-if="props.comparisonStatus === 'loading'" class="comparison-sr-only" role="status">Chargement des comparaisons AEDAR.</p>
    <p v-if="props.nativeComparisonStatus === 'loading'" class="comparison-sr-only" role="status">Chargement des comparaisons de mobilité.</p>
  </article>
</template>

<style scoped>
@font-face {
  font-family: 'Marelle';
  src: url('/fonts/Marelle-Regular.woff2') format('woff2');
  font-display: swap;
  font-weight: 400;
}

.cahier {
  --z-page-header: calc(var(--z-sticky) - 1);
  /* ThemeTabs is bounded to .fiche-en-tete-surface; only AppHeader stays pinned over the reading surface. */
  --cahier-sticky-top: var(--header-height);
  --paper: var(--editorial-paper);
  --paper-deep: var(--editorial-paper-deep);
  --ink: var(--editorial-ink);
  --muted: var(--editorial-muted);
  --red: var(--editorial-margin);
  --red-soft: var(--editorial-margin-soft);
  --cahier-default: var(--muted);
  --cahier-profile-inaccessible: color-mix(in srgb, var(--cahier-default) 42%, var(--paper));
  --margin-line: var(--editorial-margin-offset);
  --rule: color-mix(in srgb, var(--cahier-theme) 19%, transparent);
  --fine-rule: color-mix(in srgb, var(--cahier-theme) 8%, transparent);
  min-height: 0;
  color: var(--ink);
  background: transparent;
  font-family: var(--font-body);
}

.cahier--sans-grille .cahier-page,
.cahier--sans-grille .sources-page {
  background-image: linear-gradient(
    to left,
    transparent 0,
    transparent var(--margin-line),
    var(--red-soft) var(--margin-line),
    var(--red-soft) calc(var(--margin-line) + 1px),
    transparent calc(var(--margin-line) + 1px)
  );
}

.cahier--sans-grille {
  --cahier-grid-jump: 24px;
  --cahier-prose-line-height: 1.45;
  --cahier-prose-paragraph-gap: var(--space-3);
  --cahier-group-gap: var(--space-6);
  --cahier-figure-title-gap: var(--space-3);
  --cahier-figure-title-min-height: 0px;
  --cahier-page-left-inset: 64px;
  --cahier-page-right-inset: 148px;
  --cahier-spread-gap: var(--space-5);
  --cahier-spread-padding: 0px;
  --cahier-unit-padding: var(--space-3);
}

.cahier-page,
.sources-page {
  background-color: var(--paper);
  background-image:
    linear-gradient(to right, transparent 0, transparent var(--margin-line), var(--red-soft) var(--margin-line), var(--red-soft) calc(var(--margin-line) + 1px), transparent calc(var(--margin-line) + 1px)),
    repeating-linear-gradient(to bottom, transparent 0 7px, var(--fine-rule) 7px 8px, transparent 8px 15px, var(--fine-rule) 15px 16px, transparent 16px 23px, var(--fine-rule) 23px 24px, transparent 24px 30px, var(--rule) 30px 32px);
}

.cahier-reader { display: grid; grid-template-columns: minmax(160px, 210px) minmax(0, 1fr); gap: clamp(28px, 4vw, 68px); max-width: 1640px; margin: 0 auto; padding: 0 0 64px; }
.cahier-spine { position: sticky; top: 24px; align-self: start; padding-top: 4px; }
.spine-title, .margin-label { margin: 0; color: var(--cahier-theme-strong); font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
.cahier-spine ol { display: grid; gap: 6px; margin: 18px 0 0; padding: 0; list-style: none; }
.cahier-spine a { display: grid; grid-template-columns: 28px 1fr; gap: 8px; padding: 7px 0; color: var(--muted); font-size: 13px; line-height: 1.3; text-decoration: none; }
.cahier-spine a > span:last-child { min-width: 0; overflow-wrap: anywhere; }
.cahier-spine a:hover, .cahier-spine a[aria-current='location'] { color: var(--ink); }
.cahier-spine a[aria-current='location'] .spine-number { color: var(--red); }
.spine-number { color: var(--cahier-theme-strong); font-variant-numeric: tabular-nums; }
.mobile-index { display: none; }
.cahier-pages { display: grid; gap: 96px; min-width: 0; }
.cahier-page, .sources-page { container: cahier-page / inline-size; position: relative; min-width: 0; --page-left-inset: var(--cahier-page-left-inset, 148px); --page-right-inset: var(--cahier-page-right-inset, 64px); padding: 48px var(--page-right-inset) 56px var(--page-left-inset); border: 1px solid rgb(35 42 42 / 15%); box-shadow: 0 14px 30px rgb(67 57 42 / 11%); scroll-margin-top: 28px; }
.cahier--sans-grille .cahier-page,
.cahier--sans-grille .sources-page { scroll-margin-top: var(--cahier-sticky-top); }
.page-margin { position: absolute; top: 48px; left: 18px; display: grid; width: 72px; gap: 30px; align-content: start; text-align: center; }
.cahier--sans-grille .page-margin { right: 18px; left: auto; }
@media (min-width: 761px) {
  .cahier--sans-grille .cahier-page { padding-top: 0; }
  .page-layout--sticky { display: grid; grid-template-columns: minmax(0, 1fr) var(--page-right-inset); margin-right: calc(0px - var(--page-right-inset)); }
  .page-layout--sticky .page-heading { position: sticky; top: var(--cahier-sticky-top); z-index: var(--z-page-header); padding-top: var(--space-12); background-color: var(--paper); }
  .page-layout--sticky > .page-margin { position: sticky; top: var(--cahier-sticky-top); grid-column: 2; grid-row: 1; align-self: start; width: 72px; margin-right: 18px; margin-left: auto; padding-top: var(--space-12); right: auto; left: auto; }
}
.page-number { display: grid; gap: 3px; color: var(--red); font-family: var(--font-ui); font-size: 29px; line-height: .9; }
.page-number span, .page-number small { color: var(--muted); font: var(--text-overline); letter-spacing: var(--text-overline-tracking); }
.page-number span { text-transform: uppercase; }
.margin-sources { display: grid; gap: 10px; justify-items: center; overflow-wrap: anywhere; }
.margin-sources a { color: var(--cahier-theme-strong); font: 500 var(--text-source-stamp-size)/1.4 var(--font-metadata); letter-spacing: var(--text-caption-tracking); text-decoration-thickness: 1px; text-underline-offset: 3px; word-break: break-word; }
.page-heading { padding-right: calc(var(--page-left-inset) - var(--page-right-inset)); }
.page-copy { padding-right: calc(var(--page-left-inset) - var(--page-right-inset)); padding-bottom: 18px; }
.page-layout--sticky .page-main { min-width: 0; }
.page-layout--sticky .page-heading { padding-right: 0; padding-left: 0; padding-bottom: var(--space-2); border-bottom: 1px solid var(--red-soft); }
.page-layout--sticky .page-copy { padding-right: 0; padding-left: 0; }
.page-heading h2 { max-width: none; margin: 0; color: var(--ink); font: var(--text-page-heading); letter-spacing: var(--text-page-heading-tracking); text-align: center; }
.cahier--indexed-sections {
  --cahier-indexed-heading-index-column: 72px;
  --cahier-indexed-heading-column-gap: var(--space-6);
  --cahier-indexed-heading-margin-block-end: calc(var(--space-6) + var(--space-1));
  --cahier-indexed-heading-padding-block-start: var(--space-4);
  --cahier-indexed-heading-padding-block-end: 14px;
  --cahier-page-right-inset: var(--cahier-page-left-inset);
}
.cahier--indexed-sections .cahier-page,
.cahier--indexed-sections .sources-page { background-image: none; --page-left-inset: var(--cahier-page-left-inset, 64px); }
.cahier--indexed-sections .page-layout--sticky { display: grid; grid-template-columns: minmax(0, 1fr); margin-right: 0; }
.cahier--indexed-sections .page-layout--sticky .page-heading {
  position: sticky;
  top: var(--cahier-sticky-top);
  z-index: var(--z-page-header);
  display: grid;
  grid-template-columns: var(--cahier-indexed-heading-index-column) minmax(0, 1fr) auto;
  align-items: baseline;
  column-gap: var(--cahier-indexed-heading-column-gap);
  margin-bottom: var(--cahier-indexed-heading-margin-block-end);
  padding: var(--cahier-indexed-heading-padding-block-start) 0 var(--cahier-indexed-heading-padding-block-end);
  border-bottom: 1px solid var(--red-soft);
  background-color: var(--paper);
}
.cahier--indexed-sections .page-heading-index { color: var(--red); font: 500 12px/1.3 var(--font-ui); font-variant-numeric: tabular-nums; }
.cahier--indexed-sections .page-heading-index small { margin-left: 3px; color: var(--muted); font: var(--text-overline); letter-spacing: var(--text-overline-tracking); }
.cahier--indexed-sections .page-heading-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.cahier--indexed-sections .page-heading-context { display: flex; align-items: center; justify-self: end; justify-content: space-between; gap: 6px; max-width: min(42vw, 24rem); min-width: 0; font-family: var(--font-ui); font-size: var(--text-cahier-min-size); line-height: 1.3; white-space: nowrap; }
.cahier--indexed-sections .page-heading-context-title { display: flex; align-items: center; justify-content: flex-end; gap: 6px; min-width: 0; margin-inline-start: auto; text-align: right; }
.cahier--indexed-sections .page-heading-theme { flex: none; color: var(--cahier-theme-strong); font-weight: 600; }
.cahier--indexed-sections .page-heading-context-separator { flex: none; color: var(--muted); }
.cahier--indexed-sections .page-heading-territory { min-width: 0; overflow: hidden; color: var(--accent-primary); font-weight: 600; text-align: right; text-overflow: ellipsis; }
/* #860 — le bouton « Comparaison » reste centré dans la rangée du heading
   (align-items: baseline) sans l'épaissir ; le territoire tronque à sa droite. */
.cahier--indexed-sections .page-heading-comparaison { position: static; align-self: center; flex: none; margin-inline-end: var(--space-2); }
.cahier--indexed-sections .page-heading-comparaison-controls { display: flex; align-items: center; flex: 0 0 auto; }
.page-heading-builder-trigger { display: grid; place-items: center; flex: 0 0 auto; inline-size: 1.8em; block-size: 1.3em; padding: 0; border: 0; border-radius: 0; background: transparent; color: var(--cahier-theme-strong); cursor: pointer; }
.page-heading-builder-trigger:hover { background: color-mix(in srgb, var(--cahier-theme) 8%, transparent); }
.page-heading-builder-trigger:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
/* Réserver la colonne de contexte indépendamment du contrôle : son apparition
   ne doit pas réduire le titre et lui ajouter une ligne sur ordinateur. */
.cahier--indexed-sections .page-heading-context { position: relative; inline-size: min(42vw, 24rem); }
.cahier--indexed-sections .page-heading-comparaison-controls .constructeur-comparaison { margin-inline-end: var(--space-6); }
.cahier--indexed-sections .page-heading h2 {
  max-width: none;
  text-align: left;
}
.cahier--indexed-sections .page-copy { padding-right: 0; padding-left: 0; }
.cahier--indexed-sections .page-subtitle,
.cahier--indexed-sections .argument-copy { text-align: left; }
.page-subtitle { max-width: none; margin: 14px 0 0; color: var(--cahier-default); font-size: 15px; text-align: justify; }
.figure-stack {
  position: static;
  min-width: 0;
}

.comparison-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
.concept-group {
  container: subgroup / inline-size;
  margin: 0 0 var(--cahier-group-gap, var(--space-8));
}
.cahier--sans-grille .concept-group {
  padding: var(--cahier-unit-padding);
  border: 1px solid color-mix(in srgb, var(--cahier-theme) 24%, var(--paper));
  background: transparent;
}
.concept-group { width: 100%; }
.mobilite-delegate { width: 100%; min-width: 0; }
.concept-group-heading { display: flex; align-items: baseline; justify-content: center; gap: 14px; padding: var(--cahier-unit-heading-padding, 8px 0 14px); }
.cahier--sans-grille .concept-group-heading { --cahier-unit-heading-padding: 0 0 var(--space-4); }
.concept-group-heading-copy { display: grid; gap: 4px; min-width: 0; text-align: center; }
.concept-group-label { color: var(--cahier-theme-strong); font: var(--text-overline); letter-spacing: var(--text-overline-tracking); text-transform: uppercase; }
.concept-group-heading > span { color: var(--red); font-size: 13px; font-variant-numeric: tabular-nums; letter-spacing: .08em; }
.concept-group-heading h3 { margin: 0; color: var(--ink); font: var(--text-cahier-section); }
.cahier--sans-grille .concept-group-narrative { font-size: clamp(1.05rem, 1.4vw, 1.35rem); font-style: italic; font-weight: 400; line-height: 1.15; text-wrap: balance; }
.figure-spread { display: grid; grid-template-columns: minmax(280px, 1fr) minmax(420px, 1.2fr); column-gap: clamp(40px, 5vw, 76px); row-gap: var(--cahier-spread-gap, 34px); align-items: start; padding: var(--cahier-spread-padding, 22px) 0; }
.figure-spread--stack { grid-template-columns: minmax(0, 1fr); }
.cahier--sans-grille .figure-spread { grid-template-columns: 1fr; column-gap: 0; }
.cahier--sans-grille .figure-spread--paired {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: clamp(24px, 4vw, 56px);
}
.cahier--sans-grille .figure-spread--paired :deep(.evidence-figure) { width: min(100%, 560px); margin-inline: auto; }
.figure-spread--flip :deep(.argument-side) { order: 2; }
.figure-spread--flip :deep(.evidence-side) { order: 1; }
:deep(.argument-side), :deep(.evidence-side) { min-width: 0; }
:deep(.argument-side) { --mode-scalar-width: 160px; }
.argument-side h4 { margin: 0; color: var(--cahier-theme-emphasis); font-family: 'Marelle', var(--font-section-title); font-size: clamp(calc(1rem + 2px), calc(1.35vw + 2px), calc(1.25rem + 2px)); font-weight: 500; line-height: var(--cahier-grid-jump); }
.cahier-section-state, .evidence-placeholder { color: var(--cahier-default); font-size: 14px; line-height: 1.5; }
.cahier-section-state { margin: 0; padding: 20px 0; }
.cahier-chapitre-erreur {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px var(--space-3, 12px);
  margin: 0 0 10px;
  padding: 8px 0;
  border-top: 1px solid color-mix(in srgb, var(--cahier-theme) 30%, transparent);
  color: var(--cahier-default);
  font-size: 14px;
  line-height: 1.5;
}
.cahier-chapitre-erreur__action {
  padding: 4px 10px;
  border: 1px solid color-mix(in srgb, var(--cahier-theme) 55%, transparent);
  border-radius: 4px;
  background: transparent;
  color: var(--cahier-default);
  font: inherit;
  cursor: pointer;
}
.cahier-chapitre-erreur__action:hover {
  background: color-mix(in srgb, var(--cahier-theme) 10%, transparent);
}
.cahier-chapitre-erreur__action:focus-visible {
  outline: 2px solid var(--cahier-theme);
  outline-offset: 2px;
}
.evidence-placeholder { display: grid; place-items: center; min-height: 180px; border: 1px dashed color-mix(in srgb, var(--cahier-theme) 35%, transparent); text-align: center; }
:deep(.evidence-figure) { margin: 0; padding: 12px 0 0; }
.cahier--sans-grille :deep(.evidence-figure) { padding-top: 0; }
.summary-evidence { display: grid; gap: 10px; }
.summary-evidence .cahier-figure-title { margin-bottom: 0; }
.cahier--sans-grille .summary-bar-metrics {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}
.cahier--sans-grille .summary-metric-title {
  color: var(--cahier-default);
  font: var(--type-figure-label);
  font-family: var(--font-figure-label);
  letter-spacing: var(--type-figure-label-tracking);
  line-height: 1.2;
  text-align: center;
  text-transform: uppercase;
}
.cahier-tooltip-trigger { cursor: help; }
.summary-stack[tabindex]:focus-visible { outline: 2px solid var(--cahier-region-emphasis); outline-offset: 4px; }
 .summary-mode-key { --cahier-figure-legend-margin: var(--space-4) 0 0; }
.summary-bar-metrics { gap: var(--space-3); }
.summary-loss-metrics { margin-top: var(--space-3); }
.summary-metric { min-width: 0; }
.summary-metric-title { margin: 0; color: var(--brand-700); font: var(--type-figure-title); }
.summary-metric-title span { color: var(--cahier-default); font: var(--text-caption); white-space: nowrap; }
.summary-stack { position: relative; height: 14px; margin: 24px 0 20px; background: var(--paper-deep); }
.summary-stack-segment { position: absolute; top: 0; height: 100%; }
.summary-stack-segment--t { background: var(--cahier-mode-foot); }
.summary-stack-segment--b { background: var(--cahier-mode-bike); }
.summary-stack-segment--c { background: var(--cahier-mode-car); }
.summary-stack-segment--inaccessible {
  border-left: 1px solid color-mix(in srgb, var(--cahier-default) 54%, transparent);
  background: repeating-linear-gradient(-45deg, color-mix(in srgb, var(--cahier-default) 32%, transparent) 0 1px, transparent 1px 5px);
}
.summary-values { display: grid; gap: 14px; margin: 0; }
.summary-value { display: grid; grid-template-columns: minmax(140px, .8fr) minmax(0, 1.2fr); gap: 14px; align-items: start; padding-top: 12px; border-top: 1px solid var(--fine-rule); }
.summary-value dt { display: flex; align-items: center; gap: 7px; color: var(--cahier-default); font: var(--type-figure-mode); line-height: 1.25; }
.summary-value dd { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 10px; align-items: baseline; margin: 0; }
.summary-value dd strong { font: var(--type-figure-value); font-variant-numeric: tabular-nums; }
.summary-value dd small { color: var(--cahier-default); font: var(--text-caption); }
.summary-value dd .cahier-comparison-value { grid-column: 1 / -1; text-align: left; }
.cahier--sans-grille .summary-value dd .cahier-comparison-value { text-align: center; }
 .cahier--sans-grille .summary-metric > .summary-loss { margin-top: var(--space-4); padding-top: var(--space-3); }
.summary-loss { min-width: 0; }
.summary-loss-title { display: block; color: var(--cahier-default); font: var(--text-caption); text-align: center; }
.summary-loss-readings { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
.summary-value--t dt, .summary-value--t dd strong { color: var(--color-figure-mode-foot); }
.summary-value--b dt, .summary-value--b dd strong { color: var(--color-figure-mode-bike); }
.summary-value--c dt, .summary-value--c dd strong { color: var(--color-figure-mode-car); }
.mode-figures { display: grid; gap: 0; margin: 16px 0 0; }
.mode-figures-heading { display: grid; grid-template-columns: minmax(0, 1fr) var(--mode-scalar-width); gap: 12px; color: var(--cahier-default); text-align: center; }
.mode-figure { padding: 14px 0 34px; }
.mode-figure-scalar { width: 100%; }

.regional-reading { font: var(--text-caption); line-height: 1.25; }

.access-figure-collection { margin: 0; padding: 12px 0 0; }
.cahier--sans-grille .access-figure-collection { width: min(100%, var(--cahier-figure-width-standard, 760px)); margin-inline: auto; }
.access-figures { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 28px 18px; align-items: start; }
.access-figure { position: relative; display: grid; min-width: 0; gap: 8px; justify-items: center; margin: 0; }
.access-service-label { min-height: 1.4em; color: var(--cahier-default); font: var(--type-figure-mode); line-height: 1.4; text-align: center; }
.access-legend { display: grid; gap: 7px; justify-items: center; margin-top: var(--space-5); color: var(--cahier-default); font: var(--text-caption); text-align: center; }
.access-legend p { margin: 0 0 3px; }

.bpe-evidence { min-width: 0; }
.bpe-profile-total { margin: 0; color: var(--cahier-default); font: var(--type-figure-label); text-align: center; }

.sources-page { padding-bottom: 72px; }
.sources-list { display: grid; gap: 18px; margin: 48px 0 0; }
.sources-list dt { color: var(--ink); font-size: 14px; font-weight: 700; }
.sources-list dt a { color: inherit; }
.sources-list dd { margin: 4px 0 0; color: var(--muted); font-size: 12px; line-height: 1.4; }
.sources-link { display: inline-block; margin-top: 48px; color: var(--cahier-theme-strong); font-size: 13px; text-underline-offset: 4px; }
.cahier--sans-grille .cahier-section-exploration--unit-footer { margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--fine-rule); }
.cahier-section-footer { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-4); margin-top: var(--space-3); }
.cahier--sans-grille .cahier-section-footer { padding-top: var(--space-3); border-top: 1px solid var(--fine-rule); }
.cahier--sans-grille .cahier-section-exploration--unit-footer { margin-top: 0; padding-top: 0; border-top: 0; }

/* A subgroup's figure spread collapses when the content rail cannot hold both
   sides without overflow. */
@container subgroup (max-width: 760px) {
  .figure-spread { grid-template-columns: 1fr; column-gap: 0; row-gap: var(--cahier-spread-gap, 24px); }
  .figure-spread--flip :deep(.argument-side), .figure-spread--flip :deep(.evidence-side) { order: initial; }
}

@container cahier-page (max-width: 900px) {
  .figure-spread { grid-template-columns: 1fr; gap: var(--cahier-spread-gap, 32px); }
  .figure-spread--flip :deep(.argument-side), .figure-spread--flip :deep(.evidence-side) { order: initial; }
}
@container cahier-page (max-width: 620px) {
  .access-figures { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .cahier--sans-grille .figure-spread--paired { grid-template-columns: 1fr; row-gap: var(--cahier-spread-gap, 24px); }
}
@container cahier-page (max-width: 480px) {
  .summary-value { grid-template-columns: 1fr; gap: 5px; }
   .summary-value dd .cahier-comparison-value { text-align: left; }
   .cahier--sans-grille .summary-value dd .cahier-comparison-value { text-align: center; }
}

@media (max-width: 760px) {
  .cahier--sans-grille { --cahier-page-left-inset: 28px; --cahier-page-right-inset: 116px; }
  .cahier--indexed-sections { --cahier-page-right-inset: var(--cahier-page-left-inset); }
  .cahier { --margin-line: 82px; }
  .cahier-page,
  .sources-page { border: 0; box-shadow: none; }
  .cahier-reader {
    width: calc(100% + 2 * var(--grid-margin-mobile));
    margin-inline: calc(0px - var(--grid-margin-mobile));
    grid-template-columns: 1fr;
    padding: 0 0 64px;
  }
  .cahier-page,
  .sources-page {
    --page-left-inset: var(--space-4);
    --page-right-inset: var(--space-4);
    padding-inline: var(--space-4);
  }
  .cahier-spine { display: none; }
  .mobile-index { display: block; padding: 0 24px; border-bottom: 1px solid var(--red-soft); background: var(--paper); }
  .mobile-index summary { padding: 17px 0; color: var(--cahier-theme-strong); cursor: pointer; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  .mobile-index nav { display: grid; gap: 2px; padding: 0 0 18px 18px; }
  .mobile-index a { display: flex; gap: 12px; padding: 8px 0; color: var(--muted); font-size: 14px; text-decoration: none; }
  .page-margin { position: static; display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 12px; width: auto; margin: 0 0 var(--space-5); text-align: left; }
  .margin-sources { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: flex-end; gap: 6px 12px; }
  .margin-sources .margin-label { flex-basis: 100%; text-align: right; }
  .page-number { font-size: 24px; }
}
@media (max-width: 600px) {
  .cahier--sans-grille { --cahier-page-left-inset: 18px; --cahier-page-right-inset: 96px; }
  .cahier--indexed-sections { --cahier-page-right-inset: var(--cahier-page-left-inset); }
  .cahier { --margin-line: 12px; }
  .cahier-home-link { display: none; }
  .cahier-reader { padding: 0 0 88px; }
  .cahier-pages { gap: 64px; }
  .cahier-page, .sources-page { --page-left-inset: var(--space-4); --page-right-inset: var(--space-4); padding: 36px var(--space-4) 40px; }
  .cahier--indexed-sections {
    --cahier-indexed-heading-index-column: 36px;
    --cahier-indexed-heading-column-gap: var(--space-2);
    --cahier-indexed-heading-margin-block-end: var(--space-5);
    --cahier-indexed-heading-padding-block-start: var(--space-3);
    --cahier-indexed-heading-padding-block-end: 10px;
  }
  .cahier--indexed-sections .page-layout--sticky .page-heading {
    grid-template-columns: var(--cahier-indexed-heading-index-column) minmax(0, 1fr);
  }
  .cahier--indexed-sections .page-heading-index { grid-column: 1; grid-row: 1; }
  .cahier--indexed-sections .page-heading h2 { grid-column: 1 / -1; grid-row: 2; }
  .cahier--indexed-sections .page-heading-context {
    grid-column: 2;
    grid-row: 1;
    gap: 0;
    max-width: 100%;
    inline-size: 100%;
  }
  .cahier--indexed-sections .page-heading-theme { margin-inline-start: 4px; }
  .figure-spread { padding: var(--cahier-spread-padding, 28px) 0; }
  .access-figures { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px 10px; }
}
@media (max-width: 639px) {
  .cahier--indexed-sections .page-heading-context-separator { display: none; }
  .cahier--indexed-sections .page-heading-context-title { flex: 1 1 auto; min-width: 0; }
  .cahier--indexed-sections .page-heading-theme { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .cahier--indexed-sections .page-heading-comparaison-controls .constructeur-comparaison { margin-inline-end: var(--space-2); }
  .page-heading-builder-trigger { inline-size: 44px; block-size: 44px; }
}
@media (prefers-reduced-motion: reduce) {
  .cahier * { scroll-behavior: auto !important; }
}
</style>
