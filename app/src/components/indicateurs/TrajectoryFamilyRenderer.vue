<script setup lang="ts">
import { computed } from 'vue'
import type { FamilyDispatch } from '@/indicateurs/familySeam'
import type { ModeleTrajectoire } from '@/indicateurs/explorationModel'
import { formaterNombreFR } from '@/payload/selectors'

const props = defineProps<{ dispatch: Extract<FamilyDispatch, { family: 'trajectory' }>; modele?: ModeleTrajectoire | null }>()

// L'échelle des valeurs se dérive du domaine RÉEL du chemin (#438) — jamais
// un bornage brut des valeurs sur une plage de pixels fixe (le défaut du PR
// supplanté : prix_m2 aplati sur une ligne). Points et libellés lisent la
// MÊME coordonnée x proportionnelle au temps (une seule échelle, #438).
const X_GAUCHE = 12
const X_DROITE = 588
const Y_HAUT = 14
const Y_BAS = 204

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

const cheminMediane = computed(() => props.modele ? cheminDe(props.modele.etapes.map((etape) => ({ x: etape.x, valeur: etape.mediane ?? NaN }))) : '')
const cheminTerritoire = computed(() => props.modele?.serieTerritoire ? cheminDe(props.modele.serieTerritoire.map((point) => ({ x: point.x, valeur: point.value ?? NaN }))) : '')
const sansValeur = computed(() => props.modele?.etapes.filter((etape) => etape.mediane === null) ?? [])
const libelleActif = computed(() => { const detail = props.dispatch.facet.detail; return detail !== null ? props.dispatch.facet.labels[detail] ?? detail : props.dispatch.facet.label })
</script>
<template>
  <figure class="family-renderer trajectory-renderer" data-renderer="trajectory" :data-state="dispatch.status" aria-label="Repères de trajectoire">
    <svg v-if="modele && modele.etapes.length" viewBox="0 0 600 240" role="img" aria-label="Trajectoire complète du périmètre actif">
      <title>Trajectoire complète</title>
      <desc>Les détails sont positionnés à leur place réelle dans la fenêtre ; les valeurs manquantes créent une rupture de trait.</desc>
      <g v-for="etape in modele.etapes" :key="etape.detail" :data-etape="etape.detail" :data-etat="etape.mediane === null ? 'sans-valeur' : 'valeurs'">
        <line v-if="etape.min !== null && etape.max !== null" class="trajectoire-etalement" :x1="xDe(etape.x)" :x2="xDe(etape.x)" :y1="yDe(etape.max)" :y2="yDe(etape.min)" /><circle v-if="etape.mediane !== null" class="trajectoire-mediane-point" :cx="xDe(etape.x)" :cy="yDe(etape.mediane)" r="4"><title>{{ `${etape.label} · médiane ${formaterNombreFR(etape.mediane, 2)} ${dispatch.facet.unit}` }}</title></circle><text :x="xDe(etape.x)" y="228" text-anchor="middle">{{ etape.label }}</text>
      </g>
      <path v-if="cheminMediane" class="trajectoire-mediane" :d="cheminMediane" />
      <path v-if="cheminTerritoire" class="trajectoire-territoire" :d="cheminTerritoire" />
    </svg>
    <figcaption>Détail (actif) : {{ libelleActif }} · le détail pilote la carte, les extrêmes et le tableau ; le chemin complet reste visible.<span v-if="sansValeur.length"> · {{ sansValeur.map((etape) => etape.label).join(', ') }} : aucune valeur à ce niveau.</span></figcaption>
    <slot :dispatch="dispatch" />
  </figure>
</template>
<style scoped>
.trajectory-renderer{padding:24px;background:var(--surface-primary);border:1px solid var(--border-default);border-radius:12px}.trajectory-renderer svg{width:100%;height:auto}.trajectoire-mediane{fill:none;stroke:var(--indicateur-accent);stroke-width:3}.trajectoire-territoire{fill:none;stroke:var(--status-error);stroke-width:2.5;stroke-dasharray:6 4}.trajectoire-etalement{stroke:var(--indicateur-line);stroke-width:10;stroke-linecap:round;opacity:.7}.trajectoire-mediane-point{fill:var(--indicateur-strong)}.trajectory-renderer text{font-size:13px;fill:var(--text-secondary)}.trajectory-renderer figcaption{margin-top:12px;color:var(--text-secondary)}
</style>
