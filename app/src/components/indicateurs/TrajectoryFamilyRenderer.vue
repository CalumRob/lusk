<script setup lang="ts">
import { computed } from 'vue'
import type { FamilyDispatch } from '@/indicateurs/familySeam'
import type { ModeleTrajectoire } from '@/indicateurs/explorationModel'
import { formaterNombreFR, formaterValeur } from '@/payload/selectors'
import type { TrajectoryTickMetadata } from '@/payload/types'

const props = defineProps<{ dispatch: Extract<FamilyDispatch, { family: 'trajectory' }>; modele?: ModeleTrajectoire | null }>()

// L'échelle des valeurs se dérive du domaine RÉEL du chemin (#438) — jamais
// un bornage brut des valeurs sur une plage de pixels fixe (le défaut du PR
// supplanté : prix_m2 aplati sur une ligne). Points et libellés lisent la
// MÊME coordonnée x proportionnelle au temps (une seule échelle, #438).
const X_GAUCHE = 60
const X_DROITE = 588
const Y_HAUT = 24
const Y_BAS = 112

function xDe(x: number): number { return X_GAUCHE + (x / 100) * (X_DROITE - X_GAUCHE) }
const estPourcentage = computed(() => props.dispatch.facet.unit === '%')
const domaineY = computed<{ min: number; max: number }>(() => {
  if (estPourcentage.value) return { min: 0, max: 1 }
  const domaine = props.modele?.domaineValeurs ?? { min: null, max: null }
  const { min, max } = domaine
  if (min === null || max === null) return { min: 0, max: 1 }
  if (min === max) return { min: min - 1, max: max + 1 }
  return { min, max }
})
function yDe(valeur: number): number {
  const { min, max } = domaineY.value
  return Y_HAUT + (1 - (valeur - min) / (max - min)) * (Y_BAS - Y_HAUT)
}

/** Un chemin interrompu à chaque valeur manquante — jamais un trait inventé sur un trou. */
function cheminDe(points: readonly { x: number; valeur: number }[]): string {
  const segments: string[] = []
  let courant: string[] = []
  for (const point of points) {
    if (!Number.isFinite(point.valeur)) {
      if (courant.length) segments.push(`M ${courant.join(' L ')}`)
      courant = []
      continue
    }
    courant.push(`${xDe(point.x)},${yDe(point.valeur)}`)
  }
  if (courant.length) segments.push(`M ${courant.join(' L ')}`)
  return segments.join(' ')
}

const cheminReference = computed(() => props.modele?.serieReference ? cheminDe(props.modele.serieReference.map((point) => ({ x: point.x, valeur: point.value ?? NaN }))) : '')
const cheminTerritoire = computed(() => props.modele?.serieTerritoire ? cheminDe(props.modele.serieTerritoire.map((point) => ({ x: point.x, valeur: point.value ?? NaN }))) : '')
const ticks = computed<TrajectoryTickMetadata[]>(() => {
  const declared = props.dispatch.representation.extension.ticks
  if (declared?.length) return declared
  return props.modele?.etapes.map((etape) => ({ detail: etape.detail, label: etape.label })) ?? []
})
const ticksY = computed(() => {
  const values = estPourcentage.value
    ? [0, 0.25, 0.5, 0.75, 1]
    : Array.from({ length: 5 }, (_, index) => domaineY.value.min + ((domaineY.value.max - domaineY.value.min) * index) / 4)
  return values.map((value) => ({ value, label: estPourcentage.value ? `${value * 100}%` : formaterNombreFR(value, 2) }))
})
const axisLabels = computed(() => ({
  x: props.dispatch.representation.extension.axisLabels?.x ?? (props.dispatch.representation.extension.axis === 'numeric' ? 'Temps de trajet (minutes)' : 'Temps'),
  y: props.dispatch.representation.extension.axisLabels?.y ?? (estPourcentage.value ? 'Part de population (%)' : props.dispatch.facet.unit || 'Valeur'),
}))
function xDuDetail(detail: string): number | null {
  return props.modele?.etapes.find((etape) => etape.detail === detail)?.x ?? null
}
const marqueur = computed(() => {
  const marker = props.dispatch.representation.extension.marker
  const etape = marker && props.modele?.etapes.find((candidate) => candidate.detail === marker.detail)
  return marker && etape ? { ...marker, x: etape.x, detailLabel: etape.label } : null
})
const sansValeur = computed(() => props.modele?.etapes.filter((etape) => etape.mediane === null) ?? [])
const libelleActif = computed(() => {
  const detail = props.dispatch.facet.detail
  if (detail === null) return props.dispatch.facet.label
  return props.modele?.etapes.find((etape) => etape.detail === detail)?.label ?? 'Détail actif'
})
const ariaDescription = computed(() => {
  const territoire = props.modele?.territoireLabel ? ` du territoire ${props.modele.territoireLabel}` : ' du périmètre actif'
  const reference = props.modele?.referenceLabel ? ` Référence : ${props.modele.referenceLabel}.` : ' Aucune référence publiée.'
  const marker = marqueur.value ? `, avec le repère ${marqueur.value.label} à ${marqueur.value.detailLabel}` : ''
  return `Trajectoire complète${territoire}.${reference} Axe horizontal : ${axisLabels.value.x}. Axe vertical : ${axisLabels.value.y}${marker}. Les valeurs manquantes créent une rupture de trait.`
})
</script>
<template>
  <figure class="family-renderer trajectory-renderer" data-renderer="trajectory" :data-state="dispatch.status" aria-label="Repères de trajectoire">
    <svg v-if="modele && modele.etapes.length" viewBox="0 0 600 160" role="img" :aria-label="ariaDescription">
      <title>Trajectoire complète</title>
      <desc>{{ ariaDescription }}</desc>
      <g class="trajectoire-grille" aria-hidden="true">
        <line v-for="tick in ticksY" :key="`grid-${tick.label}`" :x1="X_GAUCHE" :x2="X_DROITE" :y1="yDe(tick.value)" :y2="yDe(tick.value)" />
      </g>
      <g class="trajectoire-axes" aria-hidden="true">
        <text class="trajectoire-axe-y-label" :x="X_GAUCHE" y="14">{{ axisLabels.y }}</text>
        <text v-for="tick in ticksY" :key="`y-label-${tick.label}`" class="trajectoire-axe-y-tick" :x="X_GAUCHE - 8" :y="yDe(tick.value) + 4" text-anchor="end">{{ tick.label }}</text>
        <line class="trajectoire-axe-vertical" :x1="X_GAUCHE" :x2="X_GAUCHE" :y1="Y_HAUT" :y2="Y_BAS" />
        <line class="trajectoire-axe-base" :x1="X_GAUCHE" :x2="X_DROITE" :y1="Y_BAS" :y2="Y_BAS" />
        <g v-for="tick in ticks" :key="tick.detail" class="trajectoire-tick" :class="{ 'trajectoire-tick--wide': tick.mobile === false }" :data-detail="tick.detail">
          <line class="trajectoire-tick-marque" :x1="xDuDetail(tick.detail) ?? 0" :x2="xDuDetail(tick.detail) ?? 0" :y1="Y_BAS" :y2="Y_BAS + 5" />
          <text class="trajectoire-axe-x-tick" :x="xDuDetail(tick.detail) ?? 0" y="130" text-anchor="middle">{{ tick.label }}</text>
        </g>
        <text class="trajectoire-axe-x-label" :x="(X_GAUCHE + X_DROITE) / 2" y="151" text-anchor="middle">{{ axisLabels.x }}</text>
      </g>
      <g v-for="etape in modele.etapes" :key="etape.detail" :data-etape="etape.detail" :data-etat="etape.mediane === null ? 'sans-valeur' : 'valeurs'">
        <line v-if="etape.min !== null && etape.max !== null" class="trajectoire-etalement" :x1="xDe(etape.x)" :x2="xDe(etape.x)" :y1="yDe(etape.max)" :y2="yDe(etape.min)" /><circle v-if="etape.mediane !== null" class="trajectoire-mediane-point" :cx="xDe(etape.x)" :cy="yDe(etape.mediane)" r="4"><title>{{ `${etape.label} · médiane ${formaterValeur({ value: etape.mediane, unit: dispatch.facet.unit })} ${dispatch.facet.unit}` }}</title></circle>
      </g>
      <line v-if="marqueur" class="trajectoire-marqueur" :x1="xDe(marqueur.x)" :x2="xDe(marqueur.x)" :y1="Y_HAUT" :y2="Y_BAS" :data-detail="marqueur.detail" :aria-label="marqueur.label"><title>{{ marqueur.label }}</title></line>
      <text v-if="marqueur" class="trajectoire-marqueur-libelle" :x="xDe(marqueur.x) + 4" :y="Y_HAUT + 12">{{ marqueur.label }}</text>
      <path v-if="cheminReference" class="trajectoire-reference" :d="cheminReference" />
      <path v-if="cheminTerritoire" class="trajectoire-territoire" :d="cheminTerritoire" />
    </svg>
    <div v-if="modele && modele.etapes.length" class="trajectoire-legende" aria-label="Légende de la trajectoire">
      <span class="trajectoire-legende-item">
        <span class="trajectoire-legende-trait trajectoire-legende-trait--courant" :class="{ 'trajectoire-legende-trait--median': !modele.territoireLabel }" aria-hidden="true" />
        <template v-if="modele.territoireLabel">Trait plein : {{ modele.territoireLabel }}</template>
        <template v-else>Points : médiane du périmètre actif</template>
      </span>
      <span v-if="modele.referenceLabel" class="trajectoire-legende-item">
        <span class="trajectoire-legende-trait trajectoire-legende-trait--reference" aria-hidden="true" />
        Trait tireté : {{ modele.referenceLabel }}
      </span>
    </div>
    <p v-if="marqueur" class="visually-hidden">Repère : {{ marqueur.label }} à {{ marqueur.detailLabel }}.</p>
    <figcaption>Détail (actif) : {{ libelleActif }} · le détail pilote la carte, les extrêmes et le tableau ; le chemin complet reste visible.<span v-if="modele?.referenceLabel"> · Référence : {{ modele.referenceLabel }}</span><span v-if="sansValeur.length"> · {{ sansValeur.map((etape) => etape.label).join(', ') }} : aucune valeur à ce niveau.</span></figcaption>
    <slot :dispatch="dispatch" />
  </figure>
</template>
<style scoped>
.trajectory-renderer {
  box-sizing: border-box;
  margin: 0;
  padding: var(--space-2) 0 0;
  background: var(--surface-primary);
  border: 1px solid var(--border-default);
  border-radius: 12px;
}

.trajectory-renderer svg {
  display: block;
  width: 100%;
  height: 150px;
  max-height: 150px;
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

.trajectory-renderer text {
  font-size: 12px;
  fill: var(--text-secondary);
}

.trajectoire-axe-y-label,
.trajectoire-axe-y-tick,
.trajectoire-axe-x-tick,
.trajectoire-axe-x-label {
  fill: var(--text-secondary);
}

.trajectoire-axe-y-label,
.trajectoire-axe-x-label {
  font-weight: 600;
}

.trajectoire-reference,
.trajectoire-territoire {
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.trajectoire-reference {
  stroke: var(--text-secondary);
  stroke-width: 2;
  stroke-dasharray: 6 4;
}

.trajectoire-territoire {
  stroke: var(--status-error);
  stroke-width: 2.5;
}

.trajectoire-etalement {
  stroke: var(--indicateur-line);
  stroke-width: 10;
  stroke-linecap: round;
  opacity: .7;
}

.trajectoire-mediane-point {
  fill: var(--indicateur-strong);
}

.trajectoire-marqueur {
  stroke: var(--indicateur-accent);
  stroke-width: 1.5;
  stroke-dasharray: 3 3;
}

.trajectoire-marqueur-libelle {
  font-weight: 600;
}

.trajectoire-legende {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  margin: 0 0 var(--space-1);
  color: var(--text-secondary);
  font-size: 12px;
}

.trajectoire-legende-item {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

.trajectoire-legende-trait {
  display: inline-block;
  width: 1.5rem;
  border-top: 2px solid var(--status-error);
}

.trajectoire-legende-trait--reference {
  border-top-style: dashed;
  border-top-color: var(--text-secondary);
}

.trajectoire-legende-trait--median {
  width: .5rem;
  height: .5rem;
  border: 0;
  border-radius: 50%;
  background: var(--indicateur-strong);
}

.trajectory-renderer figcaption {
  margin-top: var(--space-1);
  color: var(--text-secondary);
}

.trajectory-renderer .visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 480px) {
  .trajectoire-tick--wide {
    display: none;
  }
}
</style>
