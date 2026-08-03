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

import { formaterValeur, formaterVintage, rangEnContexte } from '@/payload/selectors'
import type { Indicateur } from '@/payload/types'

const props = defineProps<{
  clef: string
  lignes: Indicateur[]
  libelle: string
  labelsDetail?: Record<string, string>
  signe?: boolean
  large?: boolean
}>()

const premiere = computed(() => props.lignes[0] ?? null)

const multi = computed(() => props.lignes.length > 1)

const valeur = computed(() => {
  if (!premiere.value) return null
  const texte = formaterValeur(premiere.value)
  if (texte === null) return null
  if (props.signe && (premiere.value.value ?? 0) > 0) return `+${texte}`
  return texte
})

const unite = computed(() => premiere.value?.unit ?? '')

const rang = computed(() => (premiere.value ? rangEnContexte(premiere.value) : null))

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
    libelle: props.labelsDetail?.[ligne.detail ?? ''] ?? ligne.detail ?? ligne.key,
    texte: formaterValeur(ligne) ?? '—',
    largeur: total > 0 ? ((ligne.value ?? 0) / total) * 100 : 0,
  }))
})
</script>

<template>
  <figure
    class="figure-indicateur"
    :class="{ 'figure-indicateur--large': large }"
    :data-clef="clef"
  >
    <div v-if="multi" class="figure-indicateur-decomposition">
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
        <li
          v-for="ligne in lignes"
          :key="ligne.detail ?? ligne.key"
          class="tranche"
        >
          <span class="tranche-libelle">{{ labelsDetail?.[ligne.detail ?? ''] ?? ligne.detail }}</span>
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
    <p v-if="rang && !multi" class="puce-rang">{{ rang }}</p>
    <p v-if="vintage" class="estampille-vintage">{{ vintage }}</p>
  </figure>
</template>

<style scoped>
.figure-indicateur {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding-top: var(--space-4);
  border-top: 1px solid var(--border-subtle);
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

.puce-rang {
  align-self: flex-start;
  margin: var(--space-1) 0 0;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-full);
  background: var(--couleur-soft, var(--surface-tertiary));
  color: var(--couleur-strong, var(--brand-700));
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
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
