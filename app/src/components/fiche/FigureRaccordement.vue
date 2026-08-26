<script setup lang="ts">
/**
 * The cumulative raccordement figure (#487): one territory curve, the
 * median-Breton-commune reference curve and the 90-minute publication mark.
 * It deliberately sits beside the shared figure-family renderer because the
 * pipeline publishes two coordinated indicator keys (curve + reference), not
 * a generic single-series family.
 *
 * The SVG is accompanied by a text alternative containing every published
 * point. Null-only curves keep the honest unavailable state and never become a
 * zero line. Axes are scaled from the published details; no map-like threshold
 * or value scale is hand-authored here.
 */
import { computed } from 'vue'

import { formaterNombreFR, formaterValeur, formaterVintage } from '@/payload/selectors'
import type { Indicateur } from '@/payload/types'

const props = defineProps<{
  lignes: Indicateur[]
  reference?: Indicateur[]
  nom: string
  libelle: string
}>()

const LARGEUR = 600
const HAUTEUR = 220
const MARGE_X = 28
const MARGE_Y = 18
const SEUIL_MINUTES = 90

interface Point {
  minute: number
  value: number
  texte: string
}

function pointsDepuis(lignes: Indicateur[]): Point[] {
  return lignes
    .filter((ligne) => ligne.value !== null && ligne.detail !== null)
    .map((ligne) => ({
      minute: Number(String(ligne.detail).replace(/^t/, '')),
      value: ligne.value as number,
      texte: formaterValeur(ligne) ?? '—',
    }))
    .filter((point) => Number.isFinite(point.minute) && Number.isFinite(point.value))
    .sort((a, b) => a.minute - b.minute)
}

const points = computed(() => pointsDepuis(props.lignes))
const pointsReference = computed(() => pointsDepuis(props.reference ?? []))
const disponible = computed(() => points.value.length > 0)
const xMax = computed(() => {
  const minutes = [...points.value, ...pointsReference.value].map((point) => point.minute)
  return Math.max(...minutes, SEUIL_MINUTES)
})
const yMax = computed(() => Math.max(...[...points.value, ...pointsReference.value].map((point) => point.value), 1))

function x(minute: number): number {
  return MARGE_X + (minute / xMax.value) * (LARGEUR - MARGE_X * 2)
}

function y(value: number): number {
  return HAUTEUR - MARGE_Y - (value / yMax.value) * (HAUTEUR - MARGE_Y * 2)
}

function cheminDe(pointsATracer: Point[]): string | null {
  if (pointsATracer.length < 2) return null
  return pointsATracer
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.minute).toFixed(1)},${y(point.value).toFixed(1)}`)
    .join(' ')
}

const chemin = computed(() => cheminDe(points.value))
const cheminReference = computed(() => cheminDe(pointsReference.value))
const positionSeuil = computed(() => x(SEUIL_MINUTES))
const vintage = computed(() => {
  const ligne = props.lignes[0] ?? props.reference?.[0]
  return ligne ? formaterVintage(ligne) : null
})

function textePoint(point: Point): string {
  return `${formaterNombreFR(point.minute, 0)} min : ${point.texte} %`
}
</script>

<template>
  <figure class="figure-indicateur figure-raccordement" data-clef="raccordement_courbe">
    <svg
      v-if="disponible"
      class="raccordement-graphique"
      :viewBox="`0 0 ${LARGEUR} ${HAUTEUR}`"
      role="img"
      :aria-label="`Courbe cumulative de la population bretonne joignable en TC pour ${nom}, comparée à la commune bretonne médiane`"
    >
      <title>Population bretonne joignable selon le temps de trajet</title>
      <desc>La ligne pleine représente {{ nom }}. La ligne en tirets représente la commune bretonne médiane.</desc>
      <path
        v-if="chemin"
        class="raccordement-courbe"
        :d="chemin"
        fill="none"
        stroke="var(--couleur-strong, var(--brand-700))"
        stroke-width="3"
        vector-effect="non-scaling-stroke"
        role="img"
        :aria-label="`Courbe de ${nom}`"
      />
      <path
        v-if="cheminReference"
        class="raccordement-reference"
        :d="cheminReference"
        fill="none"
        stroke="var(--text-secondary)"
        stroke-width="2"
        stroke-dasharray="6 5"
        vector-effect="non-scaling-stroke"
        role="img"
        aria-label="Référence médiane de la commune bretonne"
      />
      <line
        class="raccordement-axe raccordement-axe-x"
        :x1="MARGE_X"
        :x2="LARGEUR - MARGE_X"
        :y1="HAUTEUR - MARGE_Y"
        :y2="HAUTEUR - MARGE_Y"
        aria-hidden="true"
      />
      <text
        class="raccordement-axe-libelle raccordement-axe-x-libelle"
        :x="LARGEUR / 2"
        :y="HAUTEUR - 2"
        text-anchor="middle"
      >Temps de trajet (minutes)</text>
      <text
        class="raccordement-axe-libelle raccordement-axe-y-libelle"
        x="8"
        :y="HAUTEUR / 2"
        text-anchor="middle"
        transform="rotate(-90 8 110)"
      >Part de population (%)</text>
      <line
        class="raccordement-seuil"
        :x1="positionSeuil"
        :x2="positionSeuil"
        :y1="MARGE_Y"
        :y2="HAUTEUR - MARGE_Y"
        stroke="var(--couleur-line, var(--border-default))"
        stroke-width="1.5"
        stroke-dasharray="3 4"
        role="img"
        aria-label="Seuil de 90 minutes"
        data-minute="90"
      />
      <text
        class="raccordement-seuil-libelle"
        :x="positionSeuil + 5"
        :y="MARGE_Y + 12"
        data-minute="90"
      >90 min</text>
    </svg>

    <p v-else class="raccordement-indisponible" role="status">
      La courbe de raccordement est indisponible pour {{ nom }} : ce territoire n’est pas routé.
    </p>

    <ol class="raccordement-points-accessibles visually-hidden" aria-label="Valeurs de la courbe cumulative">
      <li v-for="point in points" :key="`territoire-${point.minute}`">{{ nom }} — {{ textePoint(point) }}</li>
      <li v-for="point in pointsReference" :key="`reference-${point.minute}`">Commune bretonne médiane — {{ textePoint(point) }}</li>
    </ol>

    <figcaption class="figure-indicateur-libelle">{{ libelle }}</figcaption>
    <p v-if="vintage" class="estampille-vintage">{{ vintage }}</p>
  </figure>
</template>

<style scoped>
.figure-raccordement {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
  margin: 0;
}

.raccordement-graphique {
  display: block;
  width: 100%;
  min-height: 180px;
  overflow: visible;
}

.raccordement-courbe {
  stroke-linecap: round;
  stroke-linejoin: round;
}

.raccordement-reference {
  stroke-linecap: round;
  stroke-linejoin: round;
}

.raccordement-axe {
  stroke: var(--border-default);
  stroke-width: 1;
}

.raccordement-axe-libelle {
  font: var(--text-caption);
  fill: var(--text-secondary);
}

.raccordement-seuil-libelle {
  font: var(--text-caption);
  fill: var(--text-secondary);
}

.raccordement-indisponible {
  margin: 0;
  color: var(--text-secondary);
  font: var(--text-body-sm);
}

.figure-indicateur-libelle {
  margin: 0;
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
</style>
