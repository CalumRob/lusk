<script setup lang="ts">
/**
 * [PROTOTYPE #499 — JETABLE] Le dispatcheur de figure de lecture partagé par
 * les trois variantes : le même branchement que la fiche réelle (OngletTheme)
 * — soldes / distribution / quadrant / liste LQ — rendu dans le conteneur de
 * LA variante. La taille du canevas se règle par héritage de
 * --figure-compact-height (les graphiques lisent cette variable), la taille de
 * la liste LQ par --figure-compact-max-height.
 *
 * Composant de mise en page uniquement : aucune donnée, aucun état.
 */
import type { DescriptionNuage } from '@/payload/selectors'
import GraphiqueDistributionMobilite from '@/components/fiche/GraphiqueDistributionMobilite.vue'
import GraphiqueQuadrantMilieux from '@/components/fiche/GraphiqueQuadrantMilieux.vue'
import GraphiqueSoldes from '@/components/fiche/GraphiqueSoldes.vue'
import FigureListeLQ from '@/components/fiche/FigureListeLQ.vue'
import { RouterLink } from 'vue-router'

import type { LectureMatiere } from './matiere'

defineProps<{
  lecture: LectureMatiere
  nuage: DescriptionNuage | null
  labelsLq: { rang: string; activite: string; lq: string }
}>()
</script>

<template>
  <div class="lecture-figure-proto">
    <p
      v-if="nuage && lecture.figure && (lecture.figure.genre === 'soldes' || lecture.figure.genre === 'distribution')"
      class="figure-contexte"
    >
      {{ nuage.prepositionCourant }}
      <span class="figure-courant">{{ nuage.nomCourant }}</span>
      et {{ nuage.groupe }}
      <RouterLink
        v-if="nuage.conteneur"
        class="figure-conteneur"
        :to="{
          name: 'territoire',
          params: { type: nuage.conteneur.type, id: nuage.conteneur.code },
        }"
      >
        {{ nuage.conteneur.nom }}
      </RouterLink>
    </p>

    <GraphiqueSoldes
      v-if="lecture.figure?.genre === 'soldes'"
      :taux-naturel="lecture.figure.tauxNaturel"
      :taux-migratoire="lecture.figure.tauxMigratoire"
      :classification="lecture.figure.classification"
      :nom="lecture.figure.nom"
      :nuage="lecture.figure.nuage"
    />
    <GraphiqueDistributionMobilite
      v-else-if="lecture.figure?.genre === 'distribution'"
      :distribution="lecture.figure.distribution"
      :mediane="lecture.figure.mediane"
      :mediane-velo="lecture.figure.medianeVelo"
      :modes="lecture.figure.modes"
      :nom="lecture.figure.nom"
      :nuage="lecture.figure.nuage"
    />
    <GraphiqueQuadrantMilieux
      v-else-if="lecture.figure?.genre === 'quadrant'"
      :taux-variation-population="lecture.figure.tauxVariationPopulation"
      :delta-m2-par-habitant="lecture.figure.deltaM2ParHabitant"
      :classification="lecture.figure.classification"
      :nom="lecture.figure.nom"
      :periode-pop="lecture.figure.periodePop"
      :periode-artif="lecture.figure.periodeArtif"
      :nuage="lecture.figure.nuage"
    />
    <FigureListeLQ
      v-else-if="lecture.lignesLQ.length"
      :lignes="lecture.lignesLQ"
      :labels="labelsLq"
    />
  </div>
</template>

<style scoped>
.lecture-figure-proto {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.figure-contexte {
  margin: 0;
  font: var(--text-body-sm);
  color: var(--text-secondary);
}

.figure-courant {
  color: var(--couleur-strong, var(--text-primary));
}

.figure-conteneur {
  color: var(--couleur-nuage, var(--text-primary));
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 3px;
}
</style>
