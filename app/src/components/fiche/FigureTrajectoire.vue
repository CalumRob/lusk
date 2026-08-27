<script setup lang="ts">
/**
 * The shared trajectory-family body (#371). Metadata owns the curve grid,
 * human tick labels, reference and marker; this component only projects those
 * published facts. Missing values split paths instead of being treated as 0.
 */
import { computed } from 'vue'

import { formaterNombreFR, formaterValeur, formaterVintage } from '@/payload/selectors'
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

interface Tick {
  detail: string
  label: string
  mobile?: boolean
}

const SVG_WIDTH = 640
const SVG_HEIGHT = 220
const PLOT_LEFT = 58
const PLOT_RIGHT = 620
const PLOT_TOP = 30
const PLOT_BOTTOM = 168

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
const premiere = computed(() => props.lignes[0] ?? props.reference?.[0] ?? null)
const numerique = computed(() => props.trajectory?.axis === 'numeric')
const estPourcentage = computed(() => premiere.value?.unit === '%')
const nomAffiche = computed(() => props.nom ?? 'le territoire sélectionné')
const referenceText = computed(() => props.referenceLabel ?? 'la médiane Bretonne')

/** The shared x positions include metadata ticks and both published series. */
const detailsAxe = computed(() => {
  const ticks = props.trajectory?.ticks?.map((tick) => tick.detail) ?? []
  const details = [...ticks, ...points.value, ...pointsReference.value].map((point) => typeof point === 'string' ? point : point.detail)
  return [...new Set(details)]
})

const borneX = computed(() => {
  const valeurs = [...points.value, ...pointsReference.value]
    .map((point) => point.abscisse)
    .filter((value) => Number.isFinite(value))
  const endpoints = props.trajectory?.endpoints
    ?.map(abscisseDetail)
    .filter((value): value is number => value !== null) ?? []
  const marker = props.trajectory?.marker ? abscisseDetail(props.trajectory.marker.detail) : null
  return Math.max(...valeurs, ...endpoints, marker ?? 0, 1)
})

const valeurs = computed(() => [...points.value, ...pointsReference.value]
  .map((point) => point.valeur)
  .filter((value): value is number => value !== null))

const domaineY = computed(() => {
  if (estPourcentage.value) return { min: 0, max: 1 }
  if (!valeurs.value.length) return { min: 0, max: 1 }
  const min = Math.min(...valeurs.value)
  const max = Math.max(...valeurs.value)
  if (min === max) return { min: min - 1, max: max + 1 }
  return { min, max }
})

function xPourcent(point: Point): number {
  if (numerique.value) return point.abscisse / borneX.value
  const index = detailsAxe.value.indexOf(point.detail)
  return detailsAxe.value.length <= 1 ? 0.5 : index / (detailsAxe.value.length - 1)
}

function x(point: Point): number {
  return PLOT_LEFT + xPourcent(point) * (PLOT_RIGHT - PLOT_LEFT)
}

function xMarker(detail: string): number | null {
  const abscisse = abscisseDetail(detail)
  if (numerique.value && abscisse !== null) return PLOT_LEFT + (abscisse / borneX.value) * (PLOT_RIGHT - PLOT_LEFT)
  const index = detailsAxe.value.indexOf(detail)
  return index < 0 ? null : PLOT_LEFT + (detailsAxe.value.length <= 1 ? 0.5 : index / (detailsAxe.value.length - 1)) * (PLOT_RIGHT - PLOT_LEFT)
}

function y(value: number): number {
  const etendue = domaineY.value.max - domaineY.value.min || 1
  return PLOT_TOP + (1 - (value - domaineY.value.min) / etendue) * (PLOT_BOTTOM - PLOT_TOP)
}

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
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(point).toFixed(1)} ${y(point.valeur as number).toFixed(1)}`)
    .join(' ')
}

const chemins = computed(() => segments(points.value).map(chemin).filter((value): value is string => value !== null))
const cheminsReference = computed(() => segments(pointsReference.value).map(chemin).filter((value): value is string => value !== null))
const pointsValides = computed(() => points.value.filter((point) => point.valeur !== null))
const pointsReferenceValides = computed(() => pointsReference.value.filter((point) => point.valeur !== null))
const disponible = computed(() => pointsValides.value.length > 0)

const ticks = computed<Tick[]>(() => {
  if (props.trajectory?.ticks?.length) return props.trajectory.ticks
  return detailsAxe.value.map((detail) => ({ detail, label: props.labelsDetail?.[detail] ?? '' }))
})

const ticksY = computed(() => {
  const values = estPourcentage.value
    ? [0, 0.25, 0.5, 0.75, 1]
    : Array.from({ length: 5 }, (_, index) => domaineY.value.min + ((domaineY.value.max - domaineY.value.min) * index) / 4)
  return values.map((value) => ({ value, label: estPourcentage.value ? `${value * 100}%` : formaterNombreFR(value, 2) }))
})

const axisLabels = computed(() => ({
  x: props.trajectory?.axisLabels?.x ?? (numerique.value ? 'Temps de trajet (minutes)' : 'Temps'),
  y: props.trajectory?.axisLabels?.y ?? (estPourcentage.value ? 'Part de population (%)' : premiere.value?.unit ?? 'Valeur'),
}))

const markerPosition = computed(() => {
  const detail = props.trajectory?.marker?.detail
  return detail ? xMarker(detail) : null
})
const markerLabel = computed(() => props.trajectory?.marker?.label ?? '')
const markerAnchor = computed(() => markerPosition.value !== null && markerPosition.value > PLOT_RIGHT - 110 ? 'end' : 'start')
const markerLabelX = computed(() => markerPosition.value === null ? 0 : markerAnchor.value === 'end' ? markerPosition.value - 5 : markerPosition.value + 5)
const endpointDetail = computed(() => props.trajectory?.endpoints.at(-1) ?? ticks.value.at(-1)?.detail ?? null)
const endpointTick = computed(() => ticks.value.find((tick) => tick.detail === endpointDetail.value) ?? null)

function texteValeur(point: Point | undefined): string {
  if (!point || point.valeur === null) return 'valeur indisponible'
  return `${point.texte ?? '—'} ${premiere.value?.unit ?? ''}`.trim()
}

const pointMarqueur = computed(() => points.value.find((point) => point.detail === props.trajectory?.marker?.detail))
const referenceMarqueur = computed(() => pointsReference.value.find((point) => point.detail === props.trajectory?.marker?.detail))
const pointInitial = computed(() => points.value.find((point) => point.valeur !== null))
const pointFinal = computed(() => points.value.find((point) => point.detail === endpointDetail.value))
const referenceFinal = computed(() => pointsReference.value.find((point) => point.detail === endpointDetail.value))
const ariaDescription = computed(() => {
  const reference = pointsReference.value.length
    ? `Trait plein : ${nomAffiche.value}. Trait tireté : ${referenceText.value}.`
    : `Trait plein : ${nomAffiche.value}. Aucune référence publiée.`
  const marker = markerLabel.value
    ? ` À ${markerLabel.value}, ${nomAffiche.value} : ${texteValeur(pointMarqueur.value)}${referenceMarqueur.value ? ` ; ${referenceText.value} : ${texteValeur(referenceMarqueur.value)}` : ''}.`
    : ''
  const endpoint = endpointTick.value
    ? ` À ${endpointTick.value.label}, ${nomAffiche.value} : ${texteValeur(pointFinal.value)}${referenceFinal.value ? ` ; ${referenceText.value} : ${texteValeur(referenceFinal.value)}` : ''}.`
    : ''
  const debut = pointInitial.value && pointInitial.value.detail !== endpointDetail.value
    ? ` Départ (${ticks.value.find((tick) => tick.detail === pointInitial.value?.detail)?.label ?? pointInitial.value.detail}) : ${texteValeur(pointInitial.value)}.`
    : ''
  return `${props.libelle}. ${reference} Axe horizontal : ${axisLabels.value.x}. Axe vertical : ${axisLabels.value.y}.${debut}${marker}${endpoint} Les valeurs manquantes interrompent la courbe.`
})
const vintage = computed(() => (premiere.value ? formaterVintage(premiere.value) : null))
</script>

<template>
  <figure class="figure-indicateur figure-trajectoire carte-figure" :data-clef="clef">
    <div v-if="disponible" class="trajectoire-legende" aria-label="Légende de la trajectoire">
      <span class="trajectoire-legende-item">
        <span class="trajectoire-legende-trait trajectoire-legende-trait--courant" aria-hidden="true" />
        Trait plein : {{ nomAffiche }}
      </span>
      <span v-if="pointsReference.length" class="trajectoire-legende-item">
        <span class="trajectoire-legende-trait trajectoire-legende-trait--reference" aria-hidden="true" />
        Trait tireté : {{ referenceText }}
      </span>
    </div>

    <svg
      v-if="disponible"
      class="trajectoire-ligne"
      :viewBox="`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`"
      preserveAspectRatio="none"
      role="img"
      :aria-label="ariaDescription"
      :aria-describedby="`${clef}-resume`"
    >
      <title>{{ libelle }}</title>
      <desc>{{ ariaDescription }}</desc>
      <g class="trajectoire-grille" aria-hidden="true">
        <line v-for="tick in ticksY" :key="tick.label" :x1="PLOT_LEFT" :x2="PLOT_RIGHT" :y1="y(tick.value)" :y2="y(tick.value)" />
      </g>
      <g class="trajectoire-axes" aria-hidden="true">
        <text class="trajectoire-axe-y-label" :x="PLOT_LEFT" y="16">{{ axisLabels.y }}</text>
        <text v-for="tick in ticksY" :key="`label-${tick.label}`" class="trajectoire-axe-y-tick" :x="PLOT_LEFT - 8" :y="y(tick.value) + 4" text-anchor="end">{{ tick.label }}</text>
        <line class="trajectoire-axe-vertical" :x1="PLOT_LEFT" :x2="PLOT_LEFT" :y1="PLOT_TOP" :y2="PLOT_BOTTOM" />
        <line class="trajectoire-axe-base" :x1="PLOT_LEFT" :x2="PLOT_RIGHT" :y1="PLOT_BOTTOM" :y2="PLOT_BOTTOM" />
        <g v-for="tick in ticks" :key="tick.detail" class="trajectoire-tick" :class="{ 'trajectoire-tick--wide': tick.mobile === false }" :data-detail="tick.detail">
          <line class="trajectoire-tick-marque" :x1="xMarker(tick.detail) ?? 0" :x2="xMarker(tick.detail) ?? 0" :y1="PLOT_BOTTOM" :y2="PLOT_BOTTOM + 5" />
          <text class="trajectoire-axe-x-tick point-annee" :x="xMarker(tick.detail) ?? 0" y="188" text-anchor="middle">{{ tick.label }}</text>
        </g>
        <text class="trajectoire-axe-x-label" :x="(PLOT_LEFT + PLOT_RIGHT) / 2" y="211" text-anchor="middle">{{ axisLabels.x }}</text>
      </g>
      <g aria-hidden="true">
        <path v-for="(path, index) in cheminsReference" :key="`reference-${index}`" class="trajectoire-reference" :d="path" />
        <path v-for="(path, index) in chemins" :key="`courant-${index}`" class="trajectoire-courante" :d="path" />
        <circle v-for="point in pointsReferenceValides" :key="`reference-point-${point.detail}`" class="trajectoire-point point point--reference trajectoire-point--reference" :cx="x(point)" :cy="y(point.valeur as number)" r="2.5" />
        <circle v-for="point in pointsValides" :key="`courant-point-${point.detail}`" class="trajectoire-point point trajectoire-point--courant" :class="{ 'point--courant': point.detail === pointsValides.at(-1)?.detail }" :cx="x(point)" :cy="y(point.valeur as number)" r="2.5" />
        <line
          v-if="markerPosition !== null"
          class="trajectoire-marqueur"
          :x1="markerPosition"
          :x2="markerPosition"
          :y1="PLOT_TOP"
          :y2="PLOT_BOTTOM"
          :data-detail="trajectory?.marker?.detail"
        />
        <text v-if="markerPosition !== null" class="trajectoire-marqueur-libelle" :x="markerLabelX" y="27" :text-anchor="markerAnchor">{{ markerLabel }}</text>
      </g>
    </svg>

    <p v-if="disponible" :id="`${clef}-resume`" class="trajectoire-resume">{{ ariaDescription }}</p>
    <p v-else class="trajectoire-indisponible" role="status">
      La trajectoire est indisponible pour {{ nomAffiche }} : aucune valeur mesurable n’est publiée.
    </p>

    <figcaption class="figure-indicateur-libelle">{{ libelle }}</figcaption>
    <p v-if="vintage" class="estampille-vintage">{{ vintage }}</p>
  </figure>
</template>

<style scoped>
.trajectoire-ligne {
  display: block;
  width: 100%;
  height: 180px;
  max-height: 180px;
  overflow: visible;
}

.trajectoire-grille line {
  stroke: var(--border-default);
  stroke-width: 0.75;
}

.trajectoire-axes line {
  stroke: var(--text-tertiary);
  stroke-width: 1;
}

.trajectoire-axe-y-label,
.trajectoire-axe-y-tick,
.trajectoire-axe-x-tick,
.trajectoire-axe-x-label {
  font: var(--text-caption);
  fill: var(--text-secondary);
}

.trajectoire-axe-y-label {
  font-weight: 600;
}

.trajectoire-courante,
.trajectoire-reference {
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}

.trajectoire-courante {
  stroke: var(--couleur-strong, var(--brand-700));
  stroke-width: 2.5;
}

.trajectoire-reference {
  stroke: var(--text-secondary);
  stroke-width: 1.75;
  stroke-dasharray: 5 4;
}

.trajectoire-point--courant {
  fill: var(--couleur-strong, var(--brand-700));
}

.trajectoire-point--reference {
  fill: var(--text-secondary);
}

.trajectoire-marqueur {
  stroke: var(--couleur-line, var(--border-default));
  stroke-width: 1;
  stroke-dasharray: 3 3;
  vector-effect: non-scaling-stroke;
}

.trajectoire-marqueur-libelle {
  font: var(--text-caption);
  font-weight: 600;
  fill: var(--text-primary);
}

.trajectoire-legende {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  margin: 0 0 var(--space-2);
  color: var(--text-secondary);
  font: var(--text-caption);
}

.trajectoire-legende-item {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

.trajectoire-legende-trait {
  display: inline-block;
  width: 1.5rem;
  border-top: 2px solid var(--couleur-strong, var(--brand-700));
}

.trajectoire-legende-trait--reference {
  border-top: 2px dashed var(--text-secondary);
}

.trajectoire-resume {
  margin: var(--space-2) 0 0;
  color: var(--text-secondary);
  font: var(--text-caption);
}

.trajectoire-indisponible {
  margin: 0;
  color: var(--text-secondary);
  font: var(--text-body-sm);
}

.figure-indicateur-libelle {
  margin: var(--space-2) 0 0;
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

@media (max-width: 480px) {
  .trajectoire-tick--wide {
    display: none;
  }
}
</style>
