<script setup lang="ts">
/**
 * FigureCompacte — le renderer partagé de la grammaire des figures (issue #371,
 * parent #367) : UN sélecteur de corps de figure par famille, sans aucune
 * branche par thème. Il consomme `figure.family` déclaré dans la métadonnée du
 * sous-groupe et délègue au corps dédié :
 *
 * - `scalar`      → valeur seule + puce de rang + accent de position
 *                   (IndicatorFigure) ; « L'offre cyclable » garde son corps
 *                   spécialisé (FigureOffreCyclable) ;
 * - `composition` → `distribution_dpe` (couleurs officielles DPE),
 *                   `structure_age` (pyramide des âges), sinon la barre
 *                   segmentée héritée (IndicatorFigure) ;
 * - `trajectory`  → petite ligne sur les millésimes (FigureTrajectoire) ;
 * - les familles sans corps spécialisé → corps hérité (IndicatorFigure).
 *
 * Chaque corps rend sa propre racine `.figure-indicateur[data-clef]` — le
 * contrat de test de la grille (OngletTheme) reste intact.
 */
import { computed } from 'vue'

import type { FamilleFigure, Indicateur, Theme, TrajectoryMetadata } from '@/payload/types'
import FigureOffreCyclable from './FigureOffreCyclable.vue'
import FigureCompositionDpe from './FigureCompositionDpe.vue'
import FigureCompositionPyramide from './FigureCompositionPyramide.vue'
import FigureTrajectoire from './FigureTrajectoire.vue'
import IndicatorFigure from './IndicatorFigure.vue'
import { estPyramideSexuee } from '@/fiche/pyramideAge'

const props = defineProps<{
  famille: FamilleFigure
  clef: string
  lignes: Indicateur[]
  libelle: string
  labelsDetail?: Record<string, string>
  /** Le thème — nécessaire à la dérivation du sens du classement (#367). */
  theme: Theme
  /** Les lignes reseaux du MÊME territoire — le dénominateur de L'offre cyclable. */
  reseaux?: Indicateur[]
  /** Optional metadata-driven comparison series for the trajectory family. */
  reference?: Indicateur[]
  referenceLabel?: string
  trajectory?: TrajectoryMetadata
  nom?: string
  large?: boolean
  signe?: boolean
}>()

type Corps =
  | 'offre-cyclable'
  | 'composition-dpe'
  | 'composition-pyramide'
  | 'trajectoire'
  | 'heritier'

const corps = computed<Corps>(() => {
  if (props.famille === 'scalar' && props.clef === 'offre_cyclable') return 'offre-cyclable'
  if (props.famille === 'composition') {
    if (props.clef === 'distribution_dpe') return 'composition-dpe'
    // structure_age n'est un vrai pyramid hommes/femmes QUE si le payload porte
    // la dimension sexe (issue bloquante #390). Sans elle (les sept lignes
    // totales legacy, sans sexe), on rend la décomposition segmentée/liste
    // honnête (corps hérité) — jamais une pyramide à un seul côté trompeuse.
    if (props.clef === 'structure_age') {
      return estPyramideSexuee(props.lignes) ? 'composition-pyramide' : 'heritier'
    }
  }
  if (props.famille === 'trajectory') return 'trajectoire'
  return 'heritier'
})
</script>

<template>
  <FigureOffreCyclable
    v-if="corps === 'offre-cyclable'"
    :clef="clef"
    :lignes="lignes"
    :reseaux="reseaux ?? []"
    :libelle="libelle"
    :labels-detail="labelsDetail"
    :theme="theme"
  />
  <FigureCompositionDpe
    v-else-if="corps === 'composition-dpe'"
    :clef="clef"
    :lignes="lignes"
    :libelle="libelle"
    :labels-detail="labelsDetail"
    :theme="theme"
  />
  <FigureCompositionPyramide
    v-else-if="corps === 'composition-pyramide'"
    :clef="clef"
    :lignes="lignes"
    :libelle="libelle"
    :labels-detail="labelsDetail"
    :theme="theme"
  />
  <FigureTrajectoire
    v-else-if="corps === 'trajectoire'"
    :clef="clef"
    :lignes="lignes"
    :libelle="libelle"
    :labels-detail="labelsDetail"
    :theme="theme"
    :trajectory="trajectory"
    :reference="reference"
    :reference-label="referenceLabel"
    :nom="nom"
  />
  <IndicatorFigure
    v-else
    :clef="clef"
    :lignes="lignes"
    :libelle="libelle"
    :labels-detail="labelsDetail"
    :large="large"
    :signe="signe"
    :nom-territoire="nom"
    :theme="theme"
  />
</template>
