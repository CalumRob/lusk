<script setup lang="ts">
/**
 * The shared `trajectory` figure family (#371): one ordered or numeric series,
 * optionally accompanied by a metadata-declared reference series and marker.
 * Raccordement is therefore data in the family contract, not a theme/key
 * branch or a bespoke component.
 *
 * A null fact is a gap, not zero. Paths are built from contiguous known points
 * so missing routing observations cannot be silently joined across.
 */
import { computed } from 'vue'

import { formaterValeur, formaterVintage } from '@/payload/selectors'
import type { Indicateur, Theme, TrajectoryMetadata } from '@/payload/types'

const props = defineProps<{
  clef: string
  lignes: Indicateur[]
  libelle: string
  labelsDetail?: Record<string, string>
  theme: Theme
  trajectory?: TrajectoryMetadata
  reference?: Indicateur[]
  referenceLabel?: string
  nom?: string
}>()

interface Point {
  detail: string
  abscisse: number
  texte: string | null
  valeur: number | null
  libelle: string
}

function abscisseDetail(detail: string): number | null {
  const match = detail.match(/^t?(\d+)$/)
  if (!match) return null
  const valeur = Number(match[1])
  return Number.isFinite(valeur) ? valeur : null
}

function pointsDepuis(lignes: Indicateur[]): Point[] {
  const points = lignes
    .filter((ligne): ligne is Indicateur & { detail: string } => ligne.detail !== null && ligne.detail !== undefined)
    .map((ligne) => ({
      detail: ligne.detail,
      abscisse: abscisseDetail(ligne.detail) ?? 0,
      texte: formaterValeur(ligne),
      valeur: ligne.value,
      libelle: props.labelsDetail?.[ligne.detail] ?? '',
    }))

  if (props.trajectory?.axis !== 'numeric') {
    const numeriques = points.filter((point) => abscisseDetail(point.detail) !== null)
    const autres = points.filter((point) => abscisseDetail(point.detail) === null)
    return [...numeriques.sort((a, b) => a.abscisse - b.abscisse), ...autres]
  }
  return points.sort((a, b) => a.abscisse - b.abscisse)
}

const points = computed(() => pointsDepuis(props.lignes))
const pointsReference = computed(() => pointsDepuis(props.reference ?? []))
const pointsAvecValeur = computed(() => [...points.value, ...pointsReference.value].filter((point) => point.valeur !== null))
const disponible = computed(() => points.value.some((point) => point.valeur !== null))

/** The shared ordinal x positions keep a reference curve aligned to the current one. */
const detailsAxe = computed(() => {
  const details = [...points.value, ...pointsReference.value].map((point) => point.detail)
  return [...new Set(details)]
})

const borneX = computed(() => {
  const valeurs = [...points.value, ...pointsReference.value]
    .map((point) => point.abscisse)
    .filter((value) => Number.isFinite(value))
  const marker = props.trajectory?.marker ? abscisseDetail(props.trajectory.marker.detail) : null
  return Math.max(...valeurs, marker ?? 0, 1)
})

const min = computed(() => Math.min(...pointsAvecValeur.value.map((point) => point.valeur as number), 0))
const max = computed(() => Math.max(...pointsAvecValeur.value.map((point) => point.valeur as number), 1))

function x(point: Point): number {
  if (props.trajectory?.axis === 'numeric') return (point.abscisse / borneX.value) * 100
  const index = detailsAxe.value.indexOf(point.detail)
  return detailsAxe.value.length <= 1 ? 50 : (index / (detailsAxe.value.length - 1)) * 100
}

function xMarker(detail: string): number | null {
  const abscisse = abscisseDetail(detail)
  if (abscisse === null) return null
  if (props.trajectory?.axis === 'numeric') return (abscisse / borneX.value) * 100
  const index = detailsAxe.value.indexOf(detail)
  return index < 0 ? null : detailsAxe.value.length <= 1 ? 50 : (index / (detailsAxe.value.length - 1)) * 100
}

function y(value: number): number {
  const etendue = max.value - min.value || 1
  return 40 - ((value - min.value) / etendue) * 40
}

/** Split at nulls so an absent observation remains visibly absent. */
function segments(pointsATracer: Point[]): Point[][] {
  const resultat: Point[][] = []
  let segment: Point[] = []
  for (const point of pointsATracer) {
    if (point.valeur === null) {
      if (segment.length) resultat.push(segment)
      segment = []
    } else {
      segment.push(point)
    }
  }
  if (segment.length) resultat.push(segment)
  return resultat
}

function chemin(pointsATracer: Point[]): string | null {
  if (pointsATracer.length < 2) return null
  return pointsATracer
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point).toFixed(1)},${y(point.valeur as number).toFixed(1)}`)
    .join(' ')
}

const chemins = computed(() => segments(points.value).map(chemin).filter((value): value is string => value !== null))
const cheminsReference = computed(() => segments(pointsReference.value).map(chemin).filter((value): value is string => value !== null))
const markerPosition = computed(() => {
  const detail = props.trajectory?.marker?.detail
  return detail ? xMarker(detail) : null
})
const markerLabel = computed(() => props.trajectory?.marker?.label ?? '')
const referenceText = computed(() => props.referenceLabel ?? 'Référence')
const nomAffiche = computed(() => props.nom ?? props.libelle)
const ariaDescription = computed(() => {
  const reference = cheminsReference.value.length > 0 ? `, comparée à ${referenceText.value}` : ''
  const marker = markerLabel.value ? `, avec le repère ${markerLabel.value}` : ''
  return `${props.libelle} pour ${nomAffiche.value}${reference}${marker}. Les valeurs manquantes restent des interruptions de courbe.`
})
const premiere = computed(() => props.lignes[0] ?? props.reference?.[0] ?? null)
const vintage = computed(() => (premiere.value ? formaterVintage(premiere.value) : null))
const numerique = computed(() => props.trajectory?.axis === 'numeric')
const indexDernierPoint = computed(() => {
  for (let index = points.value.length - 1; index >= 0; index -= 1) {
    if (points.value[index].valeur !== null) return index
  }
  return -1
})

function textePoint(point: Point): string {
  const abscisse = numerique.value ? `${point.abscisse} min` : point.libelle
  return `${abscisse || '—'} : ${point.texte ?? '—'}${premiere.value?.unit ? ` ${premiere.value.unit}` : ''}`
}
</script>

<template>
  <figure class="figure-indicateur figure-trajectoire carte-figure" :data-clef="clef">
    <svg
      v-if="disponible"
      class="trajectoire-ligne"
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      role="img"
      :aria-label="ariaDescription"
    >
      <title>{{ libelle }}</title>
      <desc>{{ ariaDescription }}</desc>
      <g aria-hidden="true">
        <path
          v-for="(path, index) in chemins"
          :key="`courant-${index}`"
          class="trajectoire-courante"
          :d="path"
          fill="none"
          stroke="var(--couleur-strong, var(--brand-700))"
          stroke-width="2"
          vector-effect="non-scaling-stroke"
        />
        <path
          v-for="(path, index) in cheminsReference"
          :key="`reference-${index}`"
          class="trajectoire-reference"
          :d="path"
          fill="none"
          stroke="var(--text-secondary)"
          stroke-width="1.5"
          stroke-dasharray="4 3"
          vector-effect="non-scaling-stroke"
        />
        <line
          v-if="markerPosition !== null"
          class="trajectoire-marqueur"
          :x1="markerPosition"
          :x2="markerPosition"
          y1="0"
          y2="40"
          stroke="var(--couleur-line, var(--border-default))"
          stroke-width="1"
          stroke-dasharray="2 3"
          :data-detail="trajectory?.marker?.detail"
        />
      </g>
      <template v-if="numerique">
        <text class="trajectoire-axe trajectoire-axe-x" x="50" y="39" text-anchor="middle">Temps de trajet (minutes)</text>
        <text class="trajectoire-axe trajectoire-axe-y" x="2" y="20" text-anchor="middle" transform="rotate(-90 2 20)">Part de population (%)</text>
      </template>
      <text v-if="markerPosition !== null" class="trajectoire-marqueur-libelle" :x="markerPosition + 1" y="6">{{ markerLabel }}</text>
    </svg>

    <p v-else class="trajectoire-indisponible" role="status">
      La trajectoire est indisponible pour {{ nomAffiche }} : aucune valeur mesurable n’est publiée.
    </p>

    <ol class="liste-points" :class="numerique ? 'liste-points--compacte visually-hidden' : null" aria-label="Valeurs de la trajectoire">
      <li v-for="(point, index) in points" :key="`courant-${point.detail}`" class="point" :class="{ 'point--courant': index === indexDernierPoint }">
        <span class="point-annee">{{ point.libelle }}</span>
        <span class="point-valeur">{{ textePoint(point) }}</span>
      </li>
      <li v-for="point in pointsReference" :key="`reference-${point.detail}`" class="point point--reference">
        <span class="point-annee">{{ referenceText }}</span>
        <span class="point-valeur">{{ textePoint(point) }}</span>
      </li>
    </ol>

    <figcaption class="figure-indicateur-libelle">{{ libelle }}</figcaption>
    <p v-if="vintage" class="estampille-vintage">{{ vintage }}</p>
  </figure>
</template>

<style scoped>
.trajectoire-ligne {
  display: block;
  width: 100%;
  height: 100px;
  overflow: visible;
}

.trajectoire-courante,
.trajectoire-reference {
  stroke-linecap: round;
  stroke-linejoin: round;
}

.trajectoire-axe {
  font: var(--text-caption);
  fill: var(--text-secondary);
}

.trajectoire-marqueur-libelle {
  font: var(--text-caption);
  fill: var(--text-secondary);
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

.estampille-vintage {
  margin: var(--space-1) 0 0;
  color: var(--text-tertiary);
  font: var(--text-caption);
  letter-spacing: var(--text-caption-tracking);
}

.trajectoire-indisponible {
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
</style>
