<script setup lang="ts">
/**
 * FigureTrajectoire — la figure de famille « trajectory » (Milieux ·
 * artif_par_habitant, issue #371) : une petite ligne sur les millésimes (la
 * trajectoire de l'état artificialisé par habitant) + la liste accessible des
 * points (année, valeur, unité). Compacte (≤200px). Le trait porte la couleur
 * forte du thème ; la valeur courante (dernier millésime, à droite) est
 * soulignée. Le payload porte les états par millésime (détail = année, ou
 * M2/M3 pour la région) — la figure les trace tels quels, sans moyenne de
 * groupe superposée (hors périmètre du payload, #371).
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

interface Point {
  annee: string
  texte: string
  valeur: number
}

const points = computed<Point[]>(() => {
  const avecValeur = props.lignes.filter((l) => l.value !== null && l.detail !== null && l.detail !== undefined)
  const numeriques = avecValeur
    .map((l) => ({ ligne: l, an: Number(l.detail) }))
    .filter((p) => Number.isFinite(p.an))
    .sort((a, b) => a.an - b.an)
    .map((p) => p.ligne)
  const autres = avecValeur.filter((l) => !Number.isFinite(Number(l.detail)))
  return [...numeriques, ...autres].map((ligne) => ({
    annee: props.labelsDetail?.[ligne.detail ?? ''] ?? (ligne.detail as string),
    texte: formaterValeur(ligne) ?? '—',
    valeur: ligne.value ?? 0,
  }))
})

const valeurs = computed(() => points.value.map((p) => p.valeur))
const max = computed(() => (valeurs.value.length ? Math.max(...valeurs.value, 1) : 1))
const min = computed(() => (valeurs.value.length ? Math.min(...valeurs.value, 0) : 0))

/** Le chemin SVG (viewBox 0×40) — null si moins de deux points (pas de ligne). */
const chemin = computed(() => {
  const n = points.value.length
  if (n < 2) return null
  const H = 40
  const etendue = max.value - min.value || 1
  return points.value
    .map((p, i) => {
      const x = n === 1 ? 50 : (i / (n - 1)) * 100
      const y = H - ((p.valeur - min.value) / etendue) * H
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
})

const premiere = computed(() => props.lignes[0] ?? null)
const vintage = computed(() => (premiere.value ? formaterVintage(premiere.value) : null))
</script>

<template>
  <figure class="figure-indicateur figure-trajectoire" :data-clef="clef">
    <svg
      v-if="chemin"
      class="trajectoire-ligne"
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      role="img"
      :aria-label="`Évolution de ${libelle} sur ${points.length} millésimes`"
    >
      <path
        :d="chemin"
        fill="none"
        stroke="var(--couleur-strong, var(--brand-700))"
        stroke-width="2"
        vector-effect="non-scaling-stroke"
      />
    </svg>

    <ul class="liste-points">
      <li
        v-for="(point, i) in points"
        :key="point.annee"
        class="point"
        :class="i === points.length - 1 ? 'point--courant' : null"
      >
        <span class="point-annee">{{ point.annee }}</span>
        <span class="point-valeur">{{ point.texte }}</span>
        <span class="point-unite">{{ premiere?.unit }}</span>
      </li>
    </ul>

    <figcaption class="figure-indicateur-libelle">{{ libelle }}</figcaption>
    <p v-if="vintage" class="estampille-vintage">{{ vintage }}</p>
  </figure>
</template>

<style scoped>
.trajectoire-ligne {
  display: block;
  width: 100%;
  height: 40px;
}

.liste-points {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-4);
  margin: var(--space-3) 0 0;
  padding: 0;
  list-style: none;
}

.point {
  display: flex;
  align-items: baseline;
  gap: 0.25em;
}

.point-annee {
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
  color: var(--text-secondary);
}

.point-valeur {
  font-family: var(--font-sans);
  font-weight: var(--text-numeric-weight);
  font-variant-numeric: var(--text-numeric-variant);
  color: var(--text-primary);
}

.point-unite {
  font: var(--text-caption);
  color: var(--text-tertiary);
}

/* la valeur courante (dernier millésime) se détache, sans couleur de statut */
.point--courant .point-valeur {
  font-weight: 700;
}

.estampille-vintage {
  margin: var(--space-1) 0 0;
  color: var(--text-tertiary);
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
}
</style>
