<script setup lang="ts">
/**
 * OngletTheme — one theme's tab content (ui-elements.md §ThemeBlock). Since
 * issue #314 (parent #308) the block is ONE shared subgroup loop driven by
 * the loaded theme_<theme>.json metadata and the resolved histoires — there
 * are no per-theme branches, no app-side subgroup labels, order, Story copy
 * or reading selection left. Each subgroup renders its metadata place (label
 * + framing), its reading slot (the metadata template with the row's values,
 * the reading's compact figure and its source), its compact figure (famille +
 * indicateur déclarés) and its indicator figures (the metadata key order,
 * the existing IndicatorFigure grammar with ranks and vintages).
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
import FigureListeLQ from '@/components/fiche/FigureListeLQ.vue'
import IndicatorFigure from '@/components/fiche/IndicatorFigure.vue'
import NoeudLecture from '@/components/fiche/NoeudLecture.vue'
import { libelleIndicateur } from '@/fiche/libelles'
import {
  figureLecturePour,
  lignesLQPour,
  sourceLecture,
  sousGroupesPourTerritoire,
} from '@/fiche/sousGroupes'
import type { FigureLecture, SousGroupeRendu } from '@/fiche/sousGroupes'
import { descriptionNuage, estampilleSnapshot, trouverTerritoire } from '@/payload/selectors'
import type { Payload, Theme } from '@/payload/types'

const props = defineProps<{
  theme: Theme
  payload: Payload
  territoire: string
}>()

/** One subgroup plus its reading's figure and source — precomputed for the template. */
interface SousGroupeRenduComplet extends SousGroupeRendu {
  figureLecture: FigureLecture | null
  source: string | null
  lignesLQ: ReturnType<typeof lignesLQPour>
}

// The theme's published label rides in the metadata (theme_<theme>.json) — the
// overline never falls back to an app-side dictionary.
const nomTheme = computed(() => props.payload.themeMetadata?.[props.theme]?.label ?? props.theme)

// Les libellés payload-owned (issue #318) : la fiche lit indicator_labels /
// detail_labels de la métadonnée du thème — jamais une clé brute. Un sous-groupe
// rendu implique la métadonnée (sousGroupesPourTerritoire la lit) : les
// lookups ne retombent jamais, ils échouent fort (le contrat, validé au load).
const metadata = computed(() => props.payload.themeMetadata?.[props.theme] ?? null)

const sousGroupes = computed<SousGroupeRenduComplet[]>(() =>
  sousGroupesPourTerritoire(props.payload, props.theme, props.territoire).map((groupe) => ({
    ...groupe,
    figureLecture: groupe.lecture
      ? figureLecturePour(props.payload, props.territoire, groupe.lecture)
      : null,
    source: groupe.lecture ? sourceLecture(props.payload, groupe.lecture) : null,
    lignesLQ: groupe.lecture ? lignesLQPour(groupe.lecture) : [],
  })),
)

const nomTerritoire = computed(
  () => trouverTerritoire(props.payload, props.territoire)?.nom ?? props.territoire,
)

/** The flagship's snapshot stamp (ADR-0012) — the honest freshness claim. */
const estampille = computed(() => estampilleSnapshot(props.payload))

/** The chart's context subtitle — the current territory vs its same-scale group (ADR-0011). */
const descriptionNuageComputed = computed(() =>
  descriptionNuage(props.payload, props.territoire),
)

/** The grid figures of a subgroup — the compact figure renders first, never twice. */
function figuresGrille(groupe: SousGroupeRenduComplet) {
  return groupe.figures.filter((figure) => figure.key !== groupe.figureCompacte?.clef)
}

/** The detail labels of a multi-detail figure — the metadata's detail_labels
 *  (issue #318), never an app-side map. A scalar key has no detail map —
 *  IndicatorFigure only reads it for detail rows, which never exist there. */
function labelsDetailPour(clef: string): Record<string, string> | undefined {
  return metadata.value?.detail_labels[clef]
}

/** The indicator's French label — the metadata's indicator_labels (never a raw key). */
function libelleIndicateurMetier(clef: string): string {
  if (metadata.value === null) {
    throw new Error(`Métadonnées « ${props.theme} » absentes — la fiche ne rend jamais de clé brute`)
  }
  return libelleIndicateur(metadata.value, clef)
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
    class="onglet-theme"
    :class="`onglet-theme--${theme}`"
    :style="{
      '--couleur-strong': `var(--theme-${theme}-strong)`,
      '--couleur-soft': `var(--theme-${theme}-soft)`,
      '--couleur-line': `var(--theme-${theme}-line)`,
      '--couleur-nuage': `var(--theme-${theme})`,
    }"
  >
    <p class="onglet-theme-overline">{{ nomTheme }}</p>

    <!-- The shared subgroup loop (issue #314) — the metadata order, labels and
         reading linkage drive the anatomy of all five themes, identically. A
         subgroup with neither figures nor reading stays silent (the honest
         absent-data state — never an empty shell). -->
    <template v-for="groupe in sousGroupes" :key="groupe.key">
      <section
        v-if="groupe.figures.length > 0 || groupe.lecture || groupe.lectureIndisponible"
        class="sous-groupe"
        :data-groupe="groupe.key"
      >
        <h3 class="sous-groupe-titre">{{ groupe.label }}</h3>
        <p class="sous-groupe-cadrage">{{ groupe.framing }}</p>

        <!-- The reading slot — the metadata template rendered with the
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

              <FigureListeLQ
                v-if="groupe.lignesLQ.length"
                :lignes="groupe.lignesLQ"
                :labels="{ rang: metadata?.param_labels.rang, activite: metadata?.param_labels.activity_label, lq: metadata?.param_labels.lq }"
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
        </div>

        <!-- The honest absence (the pipeline's declared no-reading states: the
             Milieux M2 = 0, Habitat under the suppression threshold) — never an
             invented reading. A territory WITHOUT its row stays silent. -->
        <div v-else-if="groupe.lectureIndisponible" class="sous-groupe-lecture">
          <p class="lecture-absent" role="note">
            La lecture de ce sous-groupe n’est pas disponible pour ce territoire.
          </p>
        </div>

        <!-- The subgroup's figures: the compact figure first (the metadata's
             famille + indicateur — the subgroup's matter), then the rest of
             the indicator grid (metadata key order, ranks + vintages). -->
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
              :large="figureLarge(groupe.figureCompacte.clef)"
              :signe="figureSigne(groupe.figureCompacte.clef)"
              :theme="theme"
            />
          </div>
          <IndicatorFigure
            v-for="figure in figuresGrille(groupe)"
            :key="figure.key"
            :clef="figure.key"
            :lignes="figure.lignes"
            :libelle="libelleIndicateurMetier(figure.key)"
            :labels-detail="labelsDetailPour(figure.key)"
            :large="figureLarge(figure.key)"
            :signe="figureSigne(figure.key)"
            :theme="theme"
          />
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
  font: 600 1.1875rem/1.4 var(--font-serif);
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
  grid-template-columns: minmax(0, 1fr) minmax(180px, 200px);
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
