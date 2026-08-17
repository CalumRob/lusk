<script setup lang="ts">
/**
 * FigureCompositionPyramide — la figure de composition « structure_age »
 * (Démographie, famille composition, issue #371) : la structure par âge rendue
 * en bandes horizontales empilées sur l'axe d'âge (jeune en bas), la lecture
 * « pyramide ». Le payload Démographie ne porte PAS de dimension sexe — une
 * série unique par tranche — donc la figure est une pyramide à un seul côté,
 * honnête sur les données (#371 : « un vrai pyramid à deux côtés homme/femme
 * si les lignes le permettent »). Une série homme/femme exigerait un champ
 * payload absent — documenté, jamais inventé. Sans puce de rang (composition
 * multi-détail, comportement hérité conservé).
 */
import { computed } from 'vue'

import { formaterValeur, formaterVintage } from '@/payload/selectors'
import type { Indicateur, Theme } from '@/payload/types'

const props = defineProps<{
  clef: string
  lignes: Indicateur[]
  libelle: string
  labelsDetail?: Record<string, string>
  theme: Theme
}>()

/** L'ordre d'âge canonique du contrat — jeune en premier, pour empiler jeune-en-bas. */
const ORDRE_AGE = ['<15', '15-24', '25-39', '40-54', '55-64', '65-79', '80+']

interface Bande {
  tranche: string
  libelle: string
  texte: string
  largeur: number
}

const bandes = computed<Bande[]>(() => {
  const parTranche = new Map<string, Indicateur>()
  for (const ligne of props.lignes) {
    if (ligne.detail) parTranche.set(ligne.detail, ligne)
  }
  const connues = ORDRE_AGE.map((tranche) => parTranche.get(tranche)).filter(
    (l): l is Indicateur => l !== undefined,
  )
  const max = Math.max(1, ...connues.map((l) => l.value ?? 0))
  return connues.map((ligne) => ({
    tranche: ligne.detail ?? '',
    libelle: props.labelsDetail?.[ligne.detail ?? ''] ?? ligne.detail ?? '',
    texte: formaterValeur(ligne) ?? '—',
    largeur: ((ligne.value ?? 0) / max) * 100,
  }))
})

const aria = computed(() =>
  `${props.libelle} : ${bandes.value.map((b) => `${b.libelle} ${b.texte}`).join(' · ')}`,
)

const premiere = computed(() => props.lignes[0] ?? null)
const vintage = computed(() => (premiere.value ? formaterVintage(premiere.value) : null))
</script>

<template>
  <figure class="figure-indicateur figure-pyramide-age" :data-clef="clef">
    <div class="pyramide-age" role="img" :aria-label="aria">
      <div v-for="bande in bandes" :key="bande.tranche" class="bande-age">
        <span class="bande-age-libelle">{{ bande.libelle }}</span>
        <span class="bande-age-barre" :style="{ width: `${bande.largeur}%` }" />
        <span class="bande-age-valeur">{{ bande.texte }}</span>
      </div>
    </div>

    <figcaption class="figure-indicateur-libelle">{{ libelle }}</figcaption>
    <p v-if="vintage" class="estampille-vintage">{{ vintage }}</p>
  </figure>
</template>

<style scoped>
.pyramide-age {
  display: flex;
  flex-direction: column-reverse; /* jeune en bas, comme une pyramide des âges */
  gap: 3px;
}

.bande-age {
  display: grid;
  grid-template-columns: 7.5em 1fr auto;
  align-items: center;
  gap: var(--space-2);
}

.bande-age-libelle {
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--text-secondary);
}

.bande-age-barre {
  height: 10px;
  border-radius: var(--radius-full);
  background: var(--couleur-strong, var(--brand-500));
}

.bande-age-valeur {
  font-family: var(--font-sans);
  font-weight: var(--text-numeric-weight);
  font-variant-numeric: var(--text-numeric-variant);
  color: var(--text-primary);
}

.estampille-vintage {
  margin: var(--space-1) 0 0;
  color: var(--text-tertiary);
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
}
</style>
