<script setup lang="ts">
/**
 * IndicatorFigure — the fiche's indicator number (ui-elements.md
 * §Indicator/KPI figure): value + label + unit + rank-in-context chip +
 * vintage stamp. The vintage is the "alive" promise — always present, never
 * optional. A multi-detail key (structure_age = one row per tranche) renders
 * its compact breakdown instead of a single value: a segmented bar + the
 * tranches in tabular form.
 *
 * The block sets the theme ramp as inherited CSS custom props
 * (--couleur-strong / --couleur-soft) — the chip and the breakdown wear the
 * active theme, never the brand ramp.
 */
import { computed } from 'vue'

import PuceRang from '@/components/fiche/PuceRang.vue'
import { detailsRangEnContexte, formaterValeur, formaterVintage } from '@/payload/selectors'
import type { Indicateur, Theme } from '@/payload/types'
import {
  accentPositionRang,
  directionIndicateur,
  puceRangDirection,
} from '@/fiche/figureGrammaire'

const props = defineProps<{
  clef: string
  lignes: Indicateur[]
  libelle: string
  labelsDetail?: Record<string, string>
  signe?: boolean
  large?: boolean
  /** Le thème — porté par OngletTheme, nécessaire à la dérivation du sens du classement (#367). */
  theme: Theme
}>()

const premiere = computed(() => props.lignes[0] ?? null)

const multi = computed(() => props.lignes.length > 1)

/**
 * The segmented bar is only meaningful when the detail rows share one unit —
 * a multi-measure key (the Mobilité reseaux: km AND km/km²) must not sum
 * incommensurable values into one bar. The tranche list always renders.
 */
const barreUnifiee = computed(() => {
  const unites = new Set(
    props.lignes.filter((ligne) => ligne.value !== null).map((ligne) => ligne.unit),
  )
  return unites.size <= 1
})

const valeur = computed(() => {
  if (!premiere.value) return null
  const texte = formaterValeur(premiere.value)
  if (texte === null) return null
  if (props.signe && (premiere.value.value ?? 0) > 0) return `+${texte}`
  return texte
})

const unite = computed(() => premiere.value?.unit ?? '')

const detailsRang = computed(() =>
  premiere.value ? detailsRangEnContexte(premiere.value) : null,
)

/** La direction du classement — dérivée du registre Méthodes, jamais dupliquée
 *  app-side (#367). null = pas de glyphe (un indicateur hors registre). */
const direction = computed(() => directionIndicateur(props.theme, props.clef))

/** La puce de rang directionnelle — glyphe + phrase accessible (#367). */
const puce = computed(() =>
  detailsRang.value && direction.value
    ? puceRangDirection(detailsRang.value.libelle, direction.value)
    : null,
)

/** L'accent discret de position du rang : tiers supérieur « fort », médian
 *  « faible », inférieur muet — encre neutre, sans couleur de statut (#371).
 *  Porté par le bord gauche de la carte (carte-figure--accent-*), jamais par
 *  le chip (qui reste une encre neutre). */
const accent = computed(() =>
  detailsRang.value
    ? accentPositionRang(detailsRang.value.rang, detailsRang.value.taille)
    : null,
)

/** La classe d'accent de position sur la carte — fort (tiers supérieur) /
 *  faible (tiers médian) / aucune (tiers inférieur ou sans rang). */
const accentClasse = computed(() => {
  if (!puce.value || !accent.value) return null
  return accent.value === 'fort' ? 'carte-figure--accent-fort' : 'carte-figure--accent-faible'
})

const vintage = computed(() => (premiere.value ? formaterVintage(premiere.value) : null))

interface Segment {
  libelle: string
  texte: string
  largeur: number
}

const segments = computed<Segment[]>(() => {
  const avecValeur = props.lignes.filter((ligne) => ligne.value !== null)
  const total = avecValeur.reduce((somme, ligne) => somme + (ligne.value ?? 0), 0)
  return avecValeur.map((ligne) => ({
    // Le libellé vient de la métadonnée (labelsDetail) — jamais une clé brute :
    // la parité au load (verifierPariteLibelles) garantit le libellé de chaque
    // (key, detail) publié. Un libellé absent rend la place vide, jamais la clé.
    libelle: props.labelsDetail?.[ligne.detail ?? ''] ?? '',
    texte: formaterValeur(ligne) ?? '—',
    largeur: total > 0 ? ((ligne.value ?? 0) / total) * 100 : 0,
  }))
})
</script>

<template>
  <figure
    class="figure-indicateur carte-figure"
    :class="[large ? 'figure-indicateur--large' : null, accentClasse]"
    :data-clef="clef"
  >
    <div v-if="multi" class="figure-indicateur-decomposition">
      <div
        v-if="barreUnifiee"
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
        <li
          v-for="ligne in lignes"
          :key="ligne.detail ?? ligne.key"
          class="tranche"
        >
          <span class="tranche-libelle">{{ labelsDetail?.[ligne.detail ?? ''] }}</span>
          <span class="tranche-valeur">{{ formaterValeur(ligne) ?? '—' }}</span>
          <span v-if="ligne.unit" class="tranche-unite">{{ ligne.unit }}</span>
        </li>
      </ul>
    </div>

    <div v-else class="figure-indicateur-valeur">
      <span class="valeur-numerique">{{ valeur ?? '—' }}</span>
      <span v-if="unite && valeur" class="valeur-unite">{{ unite }}</span>
    </div>

    <figcaption class="figure-indicateur-libelle">{{ libelle }}</figcaption>
    <PuceRang v-if="puce && !multi" :puce="puce" />
    <p v-if="vintage" class="estampille-vintage">{{ vintage }}</p>
  </figure>
</template>

<style scoped>
.figure-indicateur {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
}

.figure-indicateur--large {
  grid-column: 1 / -1;
}

.figure-indicateur-valeur {
  display: flex;
  align-items: baseline;
  gap: 0.2em;
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

.figure-indicateur-libelle {
  font: var(--text-body-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.estampille-vintage {
  margin: var(--space-1) 0 0;
  color: var(--text-tertiary);
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
}

.figure-indicateur-decomposition {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
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
</style>
