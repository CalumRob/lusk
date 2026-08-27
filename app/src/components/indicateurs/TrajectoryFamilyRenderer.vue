<script setup lang="ts">
import { computed } from 'vue'
import type { FamilyDispatch } from '@/indicateurs/familySeam'
import type { ModeleTrajectoire } from '@/indicateurs/explorationModel'
import { formaterValeur } from '@/payload/selectors'

const props = defineProps<{ dispatch: Extract<FamilyDispatch, { family: 'trajectory' }>; modele?: ModeleTrajectoire | null }>()

// L'échelle des valeurs se dérive du domaine RÉEL du chemin (#438) — jamais
// un bornage brut des valeurs sur une plage de pixels fixe (le défaut du PR
// supplanté : prix_m2 aplati sur une ligne). Points et libellés lisent la
// MÊME coordonnée x proportionnelle au temps (une seule échelle, #438).
const X_GAUCHE = 12
const X_DROITE = 588
const Y_HAUT = 10
const Y_BAS = 116

function xDe(x: number): number { return X_GAUCHE + (x / 100) * (X_DROITE - X_GAUCHE) }
function yDe(valeur: number): number {
  const { min, max } = props.modele?.domaineValeurs ?? { min: null, max: null }
  if (min === null || max === null || max === min) return (Y_HAUT + Y_BAS) / 2
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
const marqueur = computed(() => {
  const marker = props.dispatch.representation.extension.marker
  const etape = marker && props.modele?.etapes.find((candidate) => candidate.detail === marker.detail)
  return marker && etape ? { ...marker, x: etape.x, detailLabel: etape.label } : null
})
const sansValeur = computed(() => props.modele?.etapes.filter((etape) => etape.mediane === null) ?? [])
const libelleActif = computed(() => { const detail = props.dispatch.facet.detail; return detail !== null ? props.dispatch.facet.labels[detail] ?? detail : props.dispatch.facet.label })
const ariaDescription = computed(() => {
  const reference = props.modele?.referenceLabel ? `, comparée à ${props.modele.referenceLabel}` : ''
  const marker = marqueur.value ? `, avec le repère ${marqueur.value.label} à ${marqueur.value.detailLabel}` : ''
  return `Trajectoire complète du périmètre actif${reference}${marker}. Les valeurs manquantes créent une rupture de trait.`
})
</script>
<template>
  <figure class="family-renderer trajectory-renderer" data-renderer="trajectory" :data-state="dispatch.status" aria-label="Repères de trajectoire">
    <svg v-if="modele && modele.etapes.length" viewBox="0 0 600 160" role="img" :aria-label="ariaDescription">
      <title>Trajectoire complète</title>
      <desc>{{ ariaDescription }}</desc>
      <g v-for="etape in modele.etapes" :key="etape.detail" :data-etape="etape.detail" :data-etat="etape.mediane === null ? 'sans-valeur' : 'valeurs'">
        <line v-if="etape.min !== null && etape.max !== null" class="trajectoire-etalement" :x1="xDe(etape.x)" :x2="xDe(etape.x)" :y1="yDe(etape.max)" :y2="yDe(etape.min)" /><circle v-if="etape.mediane !== null" class="trajectoire-mediane-point" :cx="xDe(etape.x)" :cy="yDe(etape.mediane)" r="4"><title>{{ `${etape.label} · médiane ${formaterValeur({ value: etape.mediane, unit: dispatch.facet.unit })} ${dispatch.facet.unit}` }}</title></circle><text :x="xDe(etape.x)" y="142" text-anchor="middle">{{ etape.label }}</text>
      </g>
      <line v-if="marqueur" class="trajectoire-marqueur" :x1="xDe(marqueur.x)" :x2="xDe(marqueur.x)" :y1="Y_HAUT" :y2="Y_BAS" :data-detail="marqueur.detail" :aria-label="marqueur.label"><title>{{ marqueur.label }}</title></line>
      <text v-if="marqueur" class="trajectoire-marqueur-libelle" :x="xDe(marqueur.x) + 4" :y="Y_HAUT + 12">{{ marqueur.label }}</text>
      <path v-if="cheminReference" class="trajectoire-reference" :d="cheminReference" />
      <path v-if="cheminTerritoire" class="trajectoire-territoire" :d="cheminTerritoire" />
    </svg>
    <p v-if="marqueur" class="visually-hidden">Repère : {{ marqueur.label }} à {{ marqueur.detailLabel }}.</p>
    <figcaption>Détail (actif) : {{ libelleActif }} · le détail pilote la carte, les extrêmes et le tableau ; le chemin complet reste visible.<span v-if="modele?.referenceLabel"> · Référence : {{ modele.referenceLabel }}</span><span v-if="sansValeur.length"> · {{ sansValeur.map((etape) => etape.label).join(', ') }} : aucune valeur à ce niveau.</span></figcaption>
    <slot :dispatch="dispatch" />
  </figure>
</template>
<style scoped>
.trajectory-renderer{box-sizing:border-box;margin:0;padding:var(--space-2) 0 0;background:var(--surface-primary);border:1px solid var(--border-default);border-radius:12px}.trajectory-renderer svg{display:block;width:100%;height:150px;max-height:150px;overflow:visible}.trajectoire-reference{fill:none;stroke:var(--text-secondary);stroke-width:2;stroke-dasharray:6 4}.trajectoire-territoire{fill:none;stroke:var(--status-error);stroke-width:2.5;stroke-dasharray:6 4}.trajectoire-etalement{stroke:var(--indicateur-line);stroke-width:10;stroke-linecap:round;opacity:.7}.trajectoire-mediane-point{fill:var(--indicateur-strong)}.trajectoire-marqueur{stroke:var(--indicateur-accent);stroke-width:1.5;stroke-dasharray:3 3}.trajectory-renderer text{font-size:13px;fill:var(--text-secondary)}.trajectoire-marqueur-libelle{font-weight:600}.trajectory-renderer figcaption{margin-top:var(--space-1);color:var(--text-secondary)}.trajectory-renderer .visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
</style>
