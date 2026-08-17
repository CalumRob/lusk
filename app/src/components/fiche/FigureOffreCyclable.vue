<script setup lang="ts">
/**
 * FigureOffreCyclable — the « L'offre cyclable » figure of the Mobilité
 * sub-block (issue #232, PRD #226) : the headline « X % de l'infrastructure
 * routière » (the total cyclable ÷ the territory's OWN c network, computed
 * app-side from payload rows — the ADR-0015 « dans l'EPCI : X % » seam, never
 * a second published measure) + the protégé/partagé bars in km/1 000 hab
 * (precomputed in the payload). The figure is NEVER suppressed: a commune at
 * 0 km shows 0 (the payload carries the zero as a fact — never an absent
 * figure, never « à venir »). Each measure keeps its vintage stamp (osm_reseaux
 * — the slow clock of the ratio) and its rank as a plain label (ADR-0015:
 * « label, pas merge » — the per-detail ranks stay labels, never merged).
 */
import { computed } from 'vue'

import PuceRang from '@/components/fiche/PuceRang.vue'
import {
  detailsRangEnContexte,
  formaterNombreFR,
  formaterValeur,
  formaterVintage,
  ratioOffreCyclable,
} from '@/payload/selectors'
import type { Indicateur, Theme } from '@/payload/types'
import {
  directionIndicateur,
  puceRangDirection,
} from '@/fiche/figureGrammaire'
import type { PuceRangDirection } from '@/fiche/figureGrammaire'

const props = defineProps<{
  clef: string
  /** Les 5 lignes offre_cyclable du territoire (protégé/partagé/total × km et km/1 000 hab). */
  lignes: Indicateur[]
  /** Les lignes reseaux du MÊME territoire — la source de c_longueur (le dénominateur du ratio). */
  reseaux: Indicateur[]
  libelle: string
  labelsDetail?: Record<string, string>
  /** Le thème — porté par OngletTheme, nécessaire à la dérivation du sens du classement (#367). */
  theme: Theme
}>()

/** Le headline — le ratio total ÷ réseau c, app-side depuis les lignes du payload. */
const ratio = computed(() => ratioOffreCyclable(props.lignes, props.reseaux))

const pourcentage = computed(() =>
  ratio.value === null ? null : `${formaterNombreFR(ratio.value * 100, 1)} %`,
)

const protege = computed(() => props.lignes.find((l) => l.detail === 'protege_km_1000') ?? null)
const partage = computed(() => props.lignes.find((l) => l.detail === 'partage_km_1000') ?? null)

interface Segment {
  libelle: string
  texte: string
  largeur: number
}

const segments = computed<Segment[]>(() => {
  const avecValeur = [protege.value, partage.value].filter(
    (l): l is Indicateur => l !== null && l.value !== null,
  )
  const total = avecValeur.reduce((somme, l) => somme + (l.value ?? 0), 0)
  return avecValeur.map((l) => ({
    // Le libellé vient de la métadonnée (labelsDetail) — jamais une clé brute :
    // la parité au load garantit le libellé de chaque détail publié. Un libellé
    // absent rend la place vide, jamais la clé.
    libelle: props.labelsDetail?.[l.detail ?? ''] ?? '',
    texte: formaterValeur(l) ?? '—',
    largeur: total > 0 ? ((l.value ?? 0) / total) * 100 : 0,
  }))
})

const vintage = computed(() => (props.lignes[0] ? formaterVintage(props.lignes[0]) : null))

/** La direction du classement — dérivée du registre Méthodes (#367). */
const direction = computed(() => directionIndicateur(props.theme, props.clef))

/** La puce de rang directionnelle d'une ligne — glyphe + phrase accessible. */
function pucePour(ligne: Indicateur | null): PuceRangDirection | null {
  if (!ligne || !direction.value) return null
  const details = detailsRangEnContexte(ligne)
  if (!details) return null
  return puceRangDirection(details.libelle, direction.value)
}

const puceProtege = computed(() => pucePour(protege.value))
const pucePartage = computed(() => pucePour(partage.value))
</script>

<template>
  <figure class="figure-indicateur figure-offre-cyclable carte-figure" :data-clef="clef">
    <div class="figure-offre-cyclable-tete">
      <span class="valeur-numerique">{{ pourcentage ?? '—' }}</span>
      <span class="valeur-unite">de l’infrastructure routière</span>
    </div>

    <div
      class="barre-segmentee"
      role="img"
      :aria-label="`${libelle} : ${segments.map((s) => `${s.libelle} ${s.texte}`).join(' · ')}`"
    >
      <span
        v-for="segment in segments"
        :key="segment.libelle"
        class="barre-segment"
        :style="{ width: `${segment.largeur}%` }"
        :title="`${segment.libelle} : ${segment.texte}`"
      />
    </div>

    <ul class="liste-tranches">
      <li v-if="protege" class="tranche">
        <span class="tranche-libelle">
          {{ labelsDetail?.[protege.detail ?? ''] }}
        </span>
        <span class="tranche-valeur">{{ formaterValeur(protege) ?? '—' }}</span>
        <span class="tranche-unite">{{ protege.unit }}</span>
        <PuceRang v-if="puceProtege" :puce="puceProtege" />
      </li>
      <li v-if="partage" class="tranche">
        <span class="tranche-libelle">
          {{ labelsDetail?.[partage.detail ?? ''] }}
        </span>
        <span class="tranche-valeur">{{ formaterValeur(partage) ?? '—' }}</span>
        <span class="tranche-unite">{{ partage.unit }}</span>
        <PuceRang v-if="pucePartage" :puce="pucePartage" />
      </li>
    </ul>

    <figcaption class="figure-indicateur-libelle">{{ libelle }}</figcaption>
    <p v-if="vintage" class="estampille-vintage">{{ vintage }}</p>
  </figure>
</template>

<style scoped>
.figure-offre-cyclable {
  grid-column: 1 / -1;
}

.figure-offre-cyclable-tete {
  display: flex;
  align-items: baseline;
  gap: 0.3em;
}

.valeur-numerique {
  font-family: var(--font-sans);
  font-size: 2rem;
  font-weight: var(--text-numeric-weight);
  font-variant-numeric: var(--text-numeric-variant);
  line-height: 1.1;
  letter-spacing: -0.01em;
  color: var(--text-primary);
}

.valeur-unite {
  font: var(--text-body-sm);
  color: var(--text-secondary);
}

.barre-segmentee {
  display: flex;
  width: 100%;
  height: 10px;
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--couleur-soft, var(--surface-tertiary));
}

.barre-segment {
  height: 100%;
  background: var(--couleur-strong, var(--brand-500));
}

.barre-segment + .barre-segment {
  border-left: 1px solid var(--surface-primary);
}

.liste-tranches {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
  gap: var(--space-3) var(--space-4);
  margin: 0;
  padding: 0;
  list-style: none;
}

.tranche {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
}

.tranche-libelle {
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--text-secondary);
}

.tranche-valeur {
  font-family: var(--font-sans);
  font-weight: var(--text-numeric-weight);
  font-variant-numeric: var(--text-numeric-variant);
  color: var(--text-primary);
}

.tranche-unite {
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--text-tertiary);
}

.estampille-vintage {
  margin: var(--space-1) 0 0;
  color: var(--text-tertiary);
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
}
</style>
