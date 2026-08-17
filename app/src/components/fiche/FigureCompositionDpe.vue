<script setup lang="ts">
/**
 * FigureCompositionDpe — la figure de composition « distribution_dpe » (Habitat,
 * famille composition, issue #371) : la répartition des étiquettes A→G rendue
 * dans les COULEURS OFFICIELLES du DPE (nouvelle échelle 2021, ADEME), jamais
 * dans la palette du thème (#367 · distribution_dpe.direction = moins-est-mieux).
 * Une barre segmentée unique (les sept parts somment à 100 %) + la légende
 * détaillée (lettre, libellé, part). Figure compacte (≤200px), sans puce de
 * rang : la composition multi-détail porte sa lecture dans la Story, pas dans
 * une seule valeur — comportement hérité conservé (#371).
 */
import { computed } from 'vue'

import { formaterValeur, formaterVintage } from '@/payload/selectors'
import type { Indicateur, Theme } from '@/payload/types'
import { ORDRE_DPE, couleurDpe } from '@/fiche/couleursDpe'

const props = defineProps<{
  clef: string
  lignes: Indicateur[]
  libelle: string
  labelsDetail?: Record<string, string>
  theme: Theme
}>()

interface Part {
  etiquette: string
  libelle: string
  texte: string
  unite: string
  largeur: number
  couleur: string
}

const parts = computed<Part[]>(() => {
  const parEtiquette = new Map<string, Indicateur>()
  for (const ligne of props.lignes) {
    if (ligne.detail && couleurDpe(ligne.detail) !== null) parEtiquette.set(ligne.detail, ligne)
  }
  const total = props.lignes.reduce((somme, l) => somme + (l.value ?? 0), 0)
  return ORDRE_DPE.map((etiquette) => parEtiquette.get(etiquette))
    .filter((ligne): ligne is Indicateur => ligne !== undefined)
    .map((ligne) => ({
      etiquette: ligne.detail ?? '',
      libelle: props.labelsDetail?.[ligne.detail ?? ''] ?? ligne.detail ?? '',
      texte: formaterValeur(ligne) ?? '—',
      unite: ligne.unit,
      largeur: total > 0 ? ((ligne.value ?? 0) / total) * 100 : 0,
      couleur: couleurDpe(ligne.detail ?? '') ?? 'var(--surface-tertiary)',
    }))
})

const aria = computed(() =>
  `${props.libelle} : ${parts.value.map((p) => `${p.etiquette} ${p.texte}${p.unite}`).join(' · ')}`,
)

const premiere = computed(() => props.lignes[0] ?? null)
const vintage = computed(() => (premiere.value ? formaterVintage(premiere.value) : null))
</script>

<template>
  <figure class="figure-indicateur figure-composition-dpe" :data-clef="clef">
    <div
      v-if="parts.length > 0"
      class="barre-segmentee barre-dpe"
      role="img"
      :aria-label="aria"
    >
      <span
        v-for="part in parts"
        :key="part.etiquette"
        class="barre-segment"
        :data-etiquette="part.etiquette"
        :style="{ width: `${part.largeur}%`, background: part.couleur }"
        :title="`${part.etiquette} — ${part.libelle} : ${part.texte}${part.unite}`"
      />
    </div>

    <ul v-if="parts.length > 0" class="liste-dpe">
      <li v-for="part in parts" :key="part.etiquette" class="dpe-part">
        <span class="dpe-lettre" :data-etiquette="part.etiquette" :style="{ background: part.couleur }">{{ part.etiquette }}</span>
        <span class="dpe-libelle">{{ part.libelle }}</span>
        <span class="dpe-valeur">{{ part.texte }}{{ part.unite }}</span>
      </li>
    </ul>

    <figcaption class="figure-indicateur-libelle">{{ libelle }}</figcaption>
    <p v-if="vintage" class="estampille-vintage">{{ vintage }}</p>
  </figure>
</template>

<style scoped>
.barre-dpe {
  height: 14px;
  background: var(--surface-tertiary);
}

.barre-segment + .barre-segment {
  border-left: 1px solid var(--surface-primary);
}

.liste-dpe {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(116px, 1fr));
  gap: var(--space-2) var(--space-4);
  margin: var(--space-3) 0 0;
  padding: 0;
  list-style: none;
}

.dpe-part {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.dpe-lettre {
  flex: none;
  width: 1.4em;
  text-align: center;
  border-radius: var(--radius-sm);
  color: #fff;
  font-family: var(--font-sans);
  font-weight: 700;
  font-size: 0.75rem;
  line-height: 1.4;
}

/* C (jaune) et D (orange) — texte sombre pour le contraste (WCAG 2.2). */
.dpe-part:nth-child(3) .dpe-lettre,
.dpe-part:nth-child(4) .dpe-lettre {
  color: #1a1a1a;
}

.dpe-libelle {
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--text-secondary);
}

.dpe-valeur {
  margin-left: auto;
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
