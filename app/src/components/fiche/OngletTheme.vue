<script setup lang="ts">
/**
 * OngletTheme — one theme's tab content (ui-elements.md §ThemeBlock). Since
 * issue #314 (parent #308) the block is ONE shared subgroup loop driven by
 * app-owned fiche content and the resolved producer readings — there are no
 * per-theme branches. The app grammar owns subgroup order, headings, editorial
 * framing, indicator order, compact figures and reading copy; two fact-bearing
 * framing clauses retain their producer metadata reader. Producer rows own
 * reading identity and values. Theme metadata remains for the theme label,
 * factual labels and indicator-page contracts used by the fiche and other
 * consumers.
 *
 * The block consumes the payload selectors and the shared subgroup mapper —
 * never raw JSON, never a theme branch.
 */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import GraphiqueDistributionMobilite from '@/components/fiche/GraphiqueDistributionMobilite.vue'
import GraphiqueQuadrantMilieux from '@/components/fiche/GraphiqueQuadrantMilieux.vue'
import GraphiqueSoldes from '@/components/fiche/GraphiqueSoldes.vue'
import FigureCompacte from '@/components/fiche/FigureCompacte.vue'
import FigureLectureRenderer from '@/components/fiche/FigureLecture.vue'
import NoeudLecture from '@/components/fiche/NoeudLecture.vue'
import PassarelleExploration from '@/components/fiche/PassarelleExploration.vue'
import { sousGroupesFiche } from '@/fiche/content/ficheGrammar'
import { libelleIndicateur } from '@/fiche/libelles'
import { LIBELLES_DETAILS_APP, LIBELLES_INDICATEURS_APP } from '@/fiche/content/libellesAffichage'
import {
  figureLecturePour,
  lignesLQPour,
  sourceLecture,
  sousGroupesPourTerritoire,
} from '@/fiche/sousGroupes'
import type { FigureLecture, SousGroupeRendu } from '@/fiche/sousGroupes'
import { LIBELLE_HANDOFF, handoffExploration, passarellesLecture } from '@/fiche/explorationHandoff'
import type { PassarelleLecture } from '@/fiche/explorationHandoff'
import { NOMS_THEMES } from '@/fiche/onglets'
import type { DirectionRang } from '@/methodes/indicateurs'
import { descriptionNuage, estampilleSnapshot, trouverTerritoire } from '@/payload/selectors'
import type { FamilleFigure, Indicateur, Payload, Theme, TrajectoryMetadata } from '@/payload/types'

const props = defineProps<{
  theme: Theme
  payload: Payload
  territoire: string
  metadataStatus?: 'loading' | 'ready' | 'error'
  retryMetadata?: () => void
}>()

/** One subgroup plus its reading's figure and source — precomputed for the template. */
interface SousGroupeRenduComplet extends SousGroupeRendu {
  figureLecture: FigureLecture | null
  source: string | null
  lignesLQ: ReturnType<typeof lignesLQPour>
  /** Les passarelles des constituants publiés de la lecture (#473). */
  passarellesDeLecture: PassarelleLecture[]
}

const metadataVerified = computed(() => props.metadataStatus === undefined
  ? Boolean(props.payload.themeMetadata?.[props.theme])
  : props.metadataStatus === 'ready')
// The tab's display name is app-owned content (NOMS_THEMES), never a copy of
// the producer's theme label; the theme identity and its facts stay payload-owned.
const nomTheme = computed(() => NOMS_THEMES[props.theme])

// Resolve factual labels from the verified catalogue or native descriptor;
// never expose an internal indicator key in the fiche.
const metadata = computed(() => props.payload.themeMetadata?.[props.theme] ?? null)

function nativeContract(clef: string) {
  return props.payload.indicateurs.find((row) => row.theme === props.theme && row.key === clef && row.nativeContract)
    ?.nativeContract
}

function directionPour(clef: string): DirectionRang | null | undefined {
  const contract = nativeContract(clef)
  if (!contract) return metadataVerified.value ? undefined : null
  if (contract.direction === 'high') return 'plus-est-mieux'
  if (contract.direction === 'low') return 'moins-est-mieux'
  return null
}

const hasLocalMetadataExplanation = computed(() => sousGroupes.value.some((groupe) => groupe.metadataExplanationPending))

/** La passarelle « Explorer » (#409 ; compacte #468) emporte SON territoire —
 *  le référent partagé des figures de grille ET des grandes lectures (#473). */
const refTerritoire = computed(() => trouverTerritoire(props.payload, props.territoire))

const sousGroupes = computed<SousGroupeRenduComplet[]>(() =>
  sousGroupesPourTerritoire(props.payload, props.theme, props.territoire,
    { metadataVerified: metadataVerified.value }).map((groupe) => ({
    ...groupe,
    figureLecture: groupe.lecture
      ? figureLecturePour(props.payload, props.territoire, groupe.lecture)
      : null,
    source: groupe.lecture ? sourceLecture(props.payload, groupe.lecture) : null,
    lignesLQ: groupe.lecture ? lignesLQPour(groupe.lecture) : [],
    passarellesDeLecture: groupe.lecture && metadataVerified.value
      ? passarellesLecture(metadata.value, groupe.lecture.story_key, refTerritoire.value)
      : [],
  })),
)

const nomTerritoire = computed(
  () => trouverTerritoire(props.payload, props.territoire)?.nom ?? props.territoire,
)

/**
 * The flagship's snapshot stamp (ADR-0012) — the honest freshness claim,
 * Mobilité's ALONE (issue #504): the payload store eagerly loads every theme
 * and the selector reads only Mobilité snapshot facts, so a Démographie or
 * Habitat tab would claim the flagship's slow clock unless the stamp is gated
 * on the tab's own theme.
 */
const estampille = computed(() =>
  props.theme === 'mobilite' ? estampilleSnapshot(props.payload) : null,
)

/** The chart's context subtitle — the current territory vs its same-scale group (ADR-0011). */
const descriptionNuageComputed = computed(() =>
  descriptionNuage(props.payload, props.territoire),
)

/** The grid figures of a subgroup — the compact figure renders first, never twice. */
function figuresGrille(groupe: SousGroupeRenduComplet) {
  return groupe.figures.filter(
    (figure) =>
      figure.key !== groupe.figureCompacte?.clef && !figureEstReference(figure.key),
  )
}

/** Prefer the verified page contract; otherwise use app presentation or native shape. */
function familleFigure(clef: string): FamilleFigure {
  if (metadataVerified.value) return metadata.value?.indicator_pages?.[clef]?.family ?? 'scalar'
  const ficheFigure = sousGroupesFiche(props.theme).find((groupe) => groupe.figure.indicator === clef)?.figure
  if (ficheFigure) return ficheFigure.family
  const shapes = nativeContract(clef)?.shapes ?? []
  if (shapes.includes('ordered_series')) return 'trajectory'
  if (shapes.includes('declared_profile')) return 'composition'
  return 'scalar'
}

/** A trajectory's optional comparison series and marker are data-contract fields. */
function trajectoirePour(clef: string): TrajectoryMetadata | undefined {
  const catalogueTrajectory = metadataVerified.value && metadata.value?.indicator_pages?.[clef]?.family === 'trajectory'
    ? metadata.value.indicator_pages[clef]!.trajectory
    : undefined
  const contract = nativeContract(clef)
  if (!contract?.axisValues?.length) return catalogueTrajectory

  const catalogueTicks = new Map((catalogueTrajectory?.ticks ?? []).map((tick) => [tick.detail, tick]))
  const axisLabels = new Map((contract.axes ?? []).filter((axis) => axis.name === 'detail' && axis.label && axis.label !== axis.key)
    .map((axis) => [axis.key, axis.label as string]))
  const numeric = contract.axisNumericValues
  const numericCoordinates = numeric?.length === contract.axisValues.length &&
    numeric.every((value) => typeof value === 'number' && Number.isFinite(value))
  const declaredDomain = new Set(contract.axisValues)
  const nativeEndpoints = numericCoordinates
    ? contract.axisValues.map((detail, index) => ({ detail, coordinate: numeric![index] as number }))
      .sort((a, b) => a.coordinate - b.coordinate)
      .filter((_, index, values) => index === 0 || index === values.length - 1)
      .map(({ detail }) => detail)
    : [contract.axisValues[0], contract.axisValues.at(-1)].filter((detail): detail is string => detail !== undefined)
  return {
    endpoints: nativeEndpoints,
    ...(catalogueTrajectory?.reference ? { reference: catalogueTrajectory.reference } : {}),
    ...(catalogueTrajectory?.marker && declaredDomain.has(catalogueTrajectory.marker.detail)
      ? { marker: catalogueTrajectory.marker } : {}),
    axis: numericCoordinates ? 'numeric' : 'ordinal',
    ticks: contract.axisValues.map((detail, index) => ({
      detail,
      label: axisLabels.get(detail) ?? catalogueTicks.get(detail)?.label ??
        (numeric?.[index] !== null && numeric?.[index] !== undefined ? String(numeric[index]) : ''),
      ...(numericCoordinates && numeric?.[index] !== null && numeric?.[index] !== undefined
        ? { numericValue: numeric[index] } : {}),
      ...(catalogueTicks.get(detail)?.mobile === undefined ? {} : { mobile: catalogueTicks.get(detail)!.mobile }),
    })),
  }
}

function lignesReferencePour(clef: string): { lignes: Indicateur[]; label?: string } {
  const reference = trajectoirePour(clef)?.reference
  if (!reference) return { lignes: [] }
  return {
    lignes: props.payload.indicateurs.filter(
      (ligne) => ligne.theme === props.theme && ligne.key === reference.indicator && ligne.territoire === reference.territoire,
    ),
    label: reference.label,
  }
}

function figureEstReference(clef: string): boolean {
  if (!metadataVerified.value) return false
  return Object.values(metadata.value?.indicator_pages ?? {}).some(
    (page) => page.family === 'trajectory' && page.trajectory.reference?.indicator === clef,
  )
}

/** Resolve category labels: verified catalogue, then the app-owned display map. */
function labelsDetailPour(clef: string): Record<string, string> | undefined {
  const contract = nativeContract(clef)
  const catalogueLabels = metadataVerified.value ? metadata.value?.detail_labels[clef] ?? {} : {}
  const appLabels = LIBELLES_DETAILS_APP[props.theme]?.[clef] ?? {}
  if (!contract) {
    const labels = { ...appLabels, ...catalogueLabels }
    return Object.keys(labels).length ? labels : undefined
  }
  const labels: Record<string, string> = { ...appLabels, ...catalogueLabels }
  const declaredKeys = new Set(contract.axisValues ?? [])
  for (const axis of contract.axes ?? []) {
    if (axis.name === 'detail' && axis.label && axis.label !== axis.key) {
      labels[axis.key] = axis.label
      declaredKeys.add(axis.key)
    }
  }
  for (const key of Object.keys(labels)) if (!declaredKeys.has(key)) delete labels[key]
  return Object.keys(labels).length ? labels : undefined
}

/** Resolve the indicator label without falling back to its internal key. */
function libelleIndicateurMetier(clef: string): string {
  const nativeLabel = nativeContract(clef)?.label
  if (nativeLabel && nativeLabel !== clef) return nativeLabel
  const appLabel = LIBELLES_INDICATEURS_APP[props.theme]?.[clef]
  if (appLabel) return appLabel
  return metadataVerified.value && metadata.value ? libelleIndicateur(metadata.value, clef) : 'Fait disponible'
}

/**
 * La passarelle « Explorer » (#409 ; compacte #468) — la route de la Page
 * d'indicateur publiée qui emporte le territoire (et son niveau comparable).
 * null pour un indicateur sans page publiée : jamais de lien mort.
 */
function passarelle(clef: string) {
  return metadataVerified.value ? handoffExploration(metadata.value, clef, refTerritoire.value) : null
}

function labelsLectureActivite(key: string) {
  const appLabels = sousGroupesFiche(props.theme).find((subgroup) => subgroup.key === key)?.reading?.paramLabels
  const catalogueLabels = metadataVerified.value ? metadata.value?.param_labels : undefined
  return {
    rang: appLabels?.rang ?? catalogueLabels?.rang ?? 'Rang',
    activity_label: appLabels?.activity_label ?? catalogueLabels?.activity_label ?? 'Activité dominante',
    lq: appLabels?.lq ?? catalogueLabels?.lq ?? 'Location quotient (LQ)',
  }
}

/** The wide figures of the grid (the multi-detail groups). */
function figureLarge(clef: string): boolean {
  return clef === 'structure_age' || clef === 'reseaux'
}

/** The signed figure (the population evolution since 1968). */
function figureSigne(clef: string): boolean {
  return clef === 'evolution_1968'
}

/** The rows reseaux of the SAME territory — the « dans l'EPCI : X % » denominator of L'offre cyclable. */
const lignesReseaux = computed(
  () =>
    sousGroupes.value.flatMap((groupe) => groupe.figures).find((figure) => figure.key === 'reseaux')
      ?.lignes ?? [],
)

</script>

<template>
  <article
    class="onglet-theme presentation-editorial"
    :class="`onglet-theme--${theme}`"
    :style="{
      '--couleur-strong': `var(--theme-${theme}-strong)`,
      '--couleur-soft': `var(--theme-${theme}-soft)`,
      '--couleur-line': `var(--theme-${theme}-line)`,
      '--couleur-nuage': `var(--theme-${theme})`,
    }"
  >
    <p class="onglet-theme-overline">{{ nomTheme }}</p>
    <p v-if="!hasLocalMetadataExplanation && metadataStatus === 'loading'" class="lecture-absent" role="status">
      Explications complémentaires en cours de chargement.
    </p>
    <p v-if="!hasLocalMetadataExplanation && metadataStatus === 'error'" class="lecture-absent" role="status">
      Les explications complémentaires ne sont pas disponibles.
      <button type="button" @click="retryMetadata?.()">Réessayer l’explication</button>
    </p>

    <!-- The shared subgroup loop (issue #314) — app-owned grammar drives the
         anatomy of all six themes, identically. A
         subgroup with neither figures nor reading stays silent (the honest
         absent-data state — never an empty shell). -->
    <template v-for="groupe in sousGroupes" :key="groupe.key">
      <section
        v-if="groupe.figures.length > 0 || groupe.lecture || groupe.lectureIndisponible || groupe.metadataExplanationPending"
        class="sous-groupe"
        :data-groupe="groupe.key"
      >
        <h3 class="sous-groupe-titre">{{ groupe.label }}</h3>
        <p v-if="groupe.framing" class="sous-groupe-cadrage">{{ groupe.framing }}</p>
        <p v-if="groupe.metadataExplanationPending" class="lecture-absent" role="status">
          {{ metadataStatus === 'error' ? 'Cette explication n’est pas disponible.' : 'Explication en cours de chargement.' }}
          <button v-if="metadataStatus === 'error'" type="button" @click="retryMetadata?.()">Réessayer l’explication</button>
        </p>

        <!-- The reading slot — the app-owned template rendered with the
             resolved row's values, the reading's compact figure and its
             exhaustive source. -->
        <div v-if="groupe.lecture" class="sous-groupe-lecture">
          <div class="lecture-ligne">
            <p class="lecture-texte voix-recit">
              <template v-for="(noeud, i) in groupe.lecture.template" :key="i">
                <NoeudLecture
                  :noeud="noeud"
                  :parametres="groupe.lecture.parametres"
                  :nom-territoire="nomTerritoire"
                />
              </template>
            </p>

            <div class="lecture-figure">
              <p
                v-if="
                  descriptionNuageComputed &&
                  (groupe.figureLecture?.genre === 'soldes' ||
                    groupe.figureLecture?.genre === 'distribution')
                "
                class="lecture-contexte"
              >
                {{ descriptionNuageComputed.prepositionCourant }}
                <span class="lecture-courant">{{ descriptionNuageComputed.nomCourant }}</span>
                et {{ descriptionNuageComputed.groupe }}
                <RouterLink
                  v-if="descriptionNuageComputed.conteneur"
                  class="lecture-conteneur"
                  :to="{
                    name: 'territoire',
                    params: {
                      type: descriptionNuageComputed.conteneur.type,
                      id: descriptionNuageComputed.conteneur.code,
                    },
                  }"
                >
                  {{ descriptionNuageComputed.conteneur.nom }}
                </RouterLink>
              </p>

              <GraphiqueSoldes
                v-if="groupe.figureLecture?.genre === 'soldes'"
                :taux-naturel="groupe.figureLecture.tauxNaturel"
                :taux-migratoire="groupe.figureLecture.tauxMigratoire"
                :classification="groupe.figureLecture.classification"
                :nom="groupe.figureLecture.nom"
                :nuage="groupe.figureLecture.nuage"
              />
              <GraphiqueDistributionMobilite
                v-else-if="groupe.figureLecture?.genre === 'distribution'"
                :distribution="groupe.figureLecture.distribution"
                :mediane="groupe.figureLecture.mediane"
                :mediane-velo="groupe.figureLecture.medianeVelo"
                :modes="groupe.figureLecture.modes"
                :nom="groupe.figureLecture.nom"
                :nuage="groupe.figureLecture.nuage"
              />

              <FigureLectureRenderer
                v-if="groupe.lignesLQ.length"
                :famille="groupe.lecture?.figure?.family ?? 'list'"
                :lignes="groupe.lignesLQ"
                :labels="{ rang: labelsLectureActivite(groupe.key).rang, activite: labelsLectureActivite(groupe.key).activity_label, lq: labelsLectureActivite(groupe.key).lq }"
              />
              <GraphiqueQuadrantMilieux
                v-if="groupe.figureLecture?.genre === 'quadrant'"
                :taux-variation-population="groupe.figureLecture.tauxVariationPopulation"
                :delta-m2-par-habitant="groupe.figureLecture.deltaM2ParHabitant"
                :classification="groupe.figureLecture.classification"
                :nom="groupe.figureLecture.nom"
                :periode-pop="groupe.figureLecture.periodePop"
                :periode-artif="groupe.figureLecture.periodeArtif"
                :nuage="groupe.figureLecture.nuage"
              />
            </div>
          </div>

          <p v-if="groupe.source" class="lecture-source">
            <span class="lecture-etiquette">Source</span>
            {{ groupe.source }}
          </p>

          <!-- #473 : les passarelles des constituants PUBLIÉS de la lecture —
               l'affordance compacte partagée (#468), en fermeture de carte pour
               ne jamais concurrencer le récit. Un constituant sans page publiée
               ne rend RIEN (passarellesLecture le laisse tomber). -->
          <nav
            v-if="groupe.passarellesDeLecture.length > 0"
            class="lecture-passarelles"
            aria-label="Explorer les indicateurs de cette lecture"
          >
            <span class="lecture-passarelles-etiquette">{{ LIBELLE_HANDOFF }}</span>
            <PassarelleExploration
              v-for="passarelleLecture in groupe.passarellesDeLecture"
              :key="passarelleLecture.clef"
              :to="passarelleLecture.to"
              :libelle="passarelleLecture.libelle"
            />
          </nav>
        </div>

        <!-- The honest absence (the pipeline's declared no-reading states: the
             Milieux M2 = 0, Habitat under the suppression threshold) — never an
             invented reading. A territory WITHOUT its row stays silent. -->
        <div v-else-if="groupe.lectureIndisponible" class="sous-groupe-lecture">
          <p class="lecture-absent" role="note">
            La lecture de ce sous-groupe n’est pas disponible pour ce territoire.
          </p>
        </div>

        <!-- The subgroup's figures: the app-owned compact family + indicator
             first, then the remaining producer rows in app presentation order
             (with factual labels, ranks and vintages from their contracts). -->
        <div class="grille-indicateurs">
          <div
            v-if="groupe.figureCompacte"
            class="figure-compacte"
            :data-famille="groupe.figureCompacte.famille"
          >
            <!-- Le renderer partagé de la grammaire (#371) : un seul sélecteur
                 de corps par famille, sans branche par thème. -->
            <FigureCompacte
              :famille="groupe.figureCompacte.famille"
              :clef="groupe.figureCompacte.clef"
              :lignes="groupe.figureCompacte.lignes"
              :libelle="libelleIndicateurMetier(groupe.figureCompacte.clef)"
              :labels-detail="labelsDetailPour(groupe.figureCompacte.clef)"
              :reseaux="lignesReseaux"
              :trajectory="trajectoirePour(groupe.figureCompacte.clef)"
              :reference="lignesReferencePour(groupe.figureCompacte.clef).lignes"
              :reference-label="lignesReferencePour(groupe.figureCompacte.clef).label"
              :nom="nomTerritoire"
              :large="figureLarge(groupe.figureCompacte.clef)"
              :signe="figureSigne(groupe.figureCompacte.clef)"
              :theme="theme"
              :direction="directionPour(groupe.figureCompacte.clef)"
            />
            <!-- #409/#468 : la passarelle compacte partagée vers la Page
                 d'indicateur publiée — nouvelle fenêtre, vraie ancre. -->
            <PassarelleExploration
              v-if="groupe.figureCompacte && passarelle(groupe.figureCompacte.clef)"
              :to="passarelle(groupe.figureCompacte.clef)!"
            />
          </div>
          <div
            v-for="figure in figuresGrille(groupe)"
            :key="figure.key"
            class="figure-cellule"
          >
            <FigureCompacte
              :famille="familleFigure(figure.key)"
              :clef="figure.key"
              :lignes="figure.lignes"
              :libelle="libelleIndicateurMetier(figure.key)"
              :labels-detail="labelsDetailPour(figure.key)"
              :trajectory="trajectoirePour(figure.key)"
              :reference="lignesReferencePour(figure.key).lignes"
              :reference-label="lignesReferencePour(figure.key).label"
              :nom="nomTerritoire"
              :large="figureLarge(figure.key)"
              :signe="figureSigne(figure.key)"
              :theme="theme"
              :direction="directionPour(figure.key)"
            />
            <PassarelleExploration v-if="passarelle(figure.key)" :to="passarelle(figure.key)!" />
          </div>
        </div>
      </section>
    </template>

    <p v-if="estampille" class="estampille-snapshot">{{ estampille }}</p>
  </article>
</template>

<style scoped>
.onglet-theme {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  animation: entree-bloc 450ms cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes entree-bloc {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .onglet-theme {
    animation: none;
  }
}

.onglet-theme-overline {
  margin: 0;
  font: var(--text-overline);
  letter-spacing: var(--text-overline-tracking);
  text-transform: uppercase;
  color: var(--couleur-strong);
}

/* One subgroup — the shared anatomy of all five themes (issue #314). */
.sous-groupe {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.sous-groupe-titre {
  margin: 0;
  font: 600 1.1875rem/1.4 var(--font-subsection-title);
  color: var(--couleur-strong);
}

.sous-groupe-cadrage {
  margin: 0;
  font: var(--text-body-sm);
  color: var(--text-secondary);
}

/* The reading slot — the payload-owned reading, its figure and its source. */
.sous-groupe-lecture {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-6);
  border: 1px solid var(--couleur-line);
  border-radius: var(--radius-lg);
  background: var(--surface-primary);
  box-shadow: var(--shadow-subtle);
}

.lecture-ligne {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(var(--figure-compact-width-min), var(--figure-compact-width-max));
  gap: var(--space-4);
  align-items: start;
}

.lecture-figure { min-width: 0; }

/* La phrase de lecture porte la voix récit (serif) — la classe utilitaire
   globale `.voix-recit` pose la famille, jamais la voix corps Manrope
   (DESIGN.md §9). On ne pose PAS font-family ici pour ne pas écraser
   `.voix-recit` (qui doit l'emporter). */
.lecture-texte {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 400;
  line-height: 1.6;
  color: var(--text-primary);
}

@media (max-width: 640px) { .lecture-ligne { grid-template-columns: 1fr; } }

.lecture-texte .noeud-gras {
  color: var(--couleur-strong);
}

.lecture-texte .noeud-lien {
  color: var(--couleur-strong);
  font-weight: 600;
  text-underline-offset: 3px;
}

/* The comparison subtitle — the current territory wears the strong color, the
   container the cloud's (ADR-0011). */
.lecture-contexte {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--space-1);
  margin: 0;
  font: var(--text-body-sm);
  color: var(--text-secondary);
}

.lecture-courant {
  color: var(--couleur-strong);
}

.lecture-conteneur {
  color: var(--couleur-nuage);
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.lecture-conteneur:hover {
  color: var(--couleur-strong);
}

/* The honest absence note — the reading the pipeline declared unreadable. */
.lecture-absent {
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border-subtle);
  border-left: 3px solid var(--couleur-line);
  border-radius: var(--radius-sm);
  background: var(--surface-tertiary);
  font: var(--text-body-sm);
  color: var(--text-secondary);
}

.lecture-source {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--text-tertiary);
}

.lecture-etiquette {
  font: var(--text-overline);
  letter-spacing: var(--text-overline-tracking);
  text-transform: uppercase;
  color: var(--couleur-strong);
}

/* The compact figure of the subgroup — the metadata's famille + indicateur,
   the subgroup's matter rendered first in the grid. */
.figure-compacte {
  grid-column: span 2;
}

/* La passarelle « Explorer » (#409, #468) — le composant partagé
   PassarelleExploration porte le balisage et la typographie ; la rampe du
   thème (posée par l'article) porte sa couleur via les variables du
   composant. */
.passarelle-exploration {
  --passarelle-couleur: var(--couleur-strong);
  --passarelle-survol: var(--couleur-nuage);
}

/* La rangée des passarelles d'une grande lecture (#473) — la même voix
   caption discrète que la source : elle ferme la carte, sous le récit et sa
   figure, sans jamais rivaliser avec eux. */
.lecture-passarelles {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2) var(--space-5);
  margin: 0;
}

.lecture-passarelles-etiquette {
  font: var(--text-overline);
  letter-spacing: var(--text-overline-tracking);
  text-transform: uppercase;
  color: var(--couleur-strong);
}

@media (max-width: 1024px) {
  .figure-compacte {
    grid-column: span 2;
  }
}

@media (max-width: 640px) {
  .figure-compacte {
    grid-column: 1;
  }
}

.grille-indicateurs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-6) var(--space-8);
}

@media (max-width: 1024px) {
  .grille-indicateurs {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .grille-indicateurs {
    grid-template-columns: 1fr;
  }
}

/* The flagship's snapshot stamp (ADR-0012) — the honest freshness claim,
   visually distinct from the light themes' weekly vintage chips. */
.estampille-snapshot {
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border: 1px dashed var(--couleur-line);
  border-radius: var(--radius-lg);
  background: var(--couleur-soft);
  color: var(--couleur-strong);
  font: var(--text-body-sm);
  font-weight: 600;
}
</style>
