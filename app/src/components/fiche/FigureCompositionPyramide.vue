<script setup lang="ts">
/**
 * FigureCompositionPyramide — la figure de composition « structure_age »
 * (Démographie, famille composition, issue #371) : la VRAIE pyramide des âges
 * à DEUX côtés, hommes à gauche / femmes à droite, empilée sur l'axe d'âge
 * (jeune en bas).
 *
 * Cette figure n'est atteinte QUE lorsque le payload porte la forme sexuée
 * complète (sept tranches × F et M, chaque ligne avec un `sex` explicite) —
 * c'est le contrat ajouté par l'issue bloquante #390. Avant #390, le payload
 * legacy ne porte PAS de dimension sexe (une série totale par tranche) : la
 * grammaire fait alors repli sur la décomposition segmentée/liste honnête
 * (corps hérité, IndicatorFigure) et INTERDIT de présenter un chart à un seul
 * côté comme une pyramide. Une série homme/femme exigerait un champ payload
 * absent avant #390 — documenté ici, jamais inventé.
 *
 * Sans puce de rang (composition multi-détail, comportement hérité conservé).
 */
import { computed } from 'vue'

import { formaterVintage } from '@/payload/selectors'
import type { Indicateur, Theme } from '@/payload/types'
import { bandesPyramideSexuee } from '@/fiche/pyramideAge'

const props = defineProps<{
  clef: string
  lignes: Indicateur[]
  libelle: string
  labelsDetail?: Record<string, string>
  theme: Theme
}>()

const bandes = computed(() => bandesPyramideSexuee(props.lignes, props.labelsDetail))

const aria = computed(() =>
  `${props.libelle} (Hommes / Femmes) : ${bandes.value
    .map((b) => `${b.libelle} ${b.texteHommes} · ${b.texteFemmes}`)
    .join(' · ')}`,
)

const premiere = computed(() => props.lignes[0] ?? null)
const vintage = computed(() => (premiere.value ? formaterVintage(premiere.value) : null))
</script>

<template>
  <figure class="figure-indicateur figure-pyramide-age carte-figure" :data-clef="clef">
    <div class="legende-pyramide" aria-hidden="true">
      <span class="legende-pyramide-hommes">Hommes</span>
      <span class="legende-pyramide-femmes">Femmes</span>
    </div>

    <div class="pyramide-age" role="img" :aria-label="aria">
      <div v-for="bande in bandes" :key="bande.tranche" class="bande-age">
        <span
          class="bande-age-barre bande-age-barre--hommes"
          :style="{ width: `${bande.largeurHommes}%` }"
          :title="`Hommes — ${bande.libelle} : ${bande.texteHommes}`"
        />
        <span class="bande-age-libelle">{{ bande.libelle }}</span>
        <span
          class="bande-age-barre bande-age-barre--femmes"
          :style="{ width: `${bande.largeurFemmes}%` }"
          :title="`Femmes — ${bande.libelle} : ${bande.texteFemmes}`"
        />
      </div>
    </div>

    <figcaption class="figure-indicateur-libelle">{{ libelle }}</figcaption>
    <p v-if="vintage" class="estampille-vintage">{{ vintage }}</p>
  </figure>
</template>

<style scoped>
/* La forme sexuée n'existe qu'après l'issue #390 ; ces teintes distinctes et
   accessibles séparent les deux côtés sans emprunter la rampe de thème. */
.pyramide-age {
  --couleur-hommes: #3e7c8c;
  --couleur-femmes: #b5567f;
}

.legende-pyramide {
  display: flex;
  justify-content: space-between;
  margin-bottom: var(--space-2);
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--text-secondary);
}

.legende-pyramide-hommes::before,
.legende-pyramide-femmes::after {
  content: '';
  display: inline-block;
  width: 0.7em;
  height: 0.7em;
  margin: 0 0.35em;
  border-radius: 2px;
  vertical-align: baseline;
}

.legende-pyramide-hommes::before {
  background: var(--couleur-hommes);
}

.legende-pyramide-femmes::after {
  background: var(--couleur-femmes);
}

.pyramide-age {
  display: flex;
  flex-direction: column-reverse; /* jeune en bas, comme une pyramide des âges */
  gap: 3px;
}

.bande-age {
  display: grid;
  grid-template-columns: 1fr auto 1fr; /* hommes | âge | femmes */
  align-items: center;
  gap: var(--space-2);
}

.bande-age-libelle {
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--text-secondary);
  text-align: center;
}

.bande-age-barre {
  height: 10px;
  border-radius: var(--radius-full);
}

.bande-age-barre--hommes {
  justify-self: end; /* s'étire vers l'axe central depuis la gauche */
  background: var(--couleur-hommes);
}

.bande-age-barre--femmes {
  justify-self: start; /* s'étire vers l'axe central depuis la droite */
  background: var(--couleur-femmes);
}

.estampille-vintage {
  margin: var(--space-1) 0 0;
  color: var(--text-tertiary);
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
}
</style>
