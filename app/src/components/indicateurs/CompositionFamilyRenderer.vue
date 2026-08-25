<script setup lang="ts">
import { computed } from 'vue'
import type { FamilyDispatch } from '@/indicateurs/familySeam'
import type { ModeleComposition, PartieComposition } from '@/indicateurs/explorationModel'
import { couleurDpe } from '@/fiche/couleursDpe'
import { formaterValeur } from '@/payload/selectors'

const props = defineProps<{ dispatch: Extract<FamilyDispatch, { family: 'composition' }>; composition?: ModeleComposition | null }>()

// Le territoire rendu est LE territoire mis en avant par l'URL (#472) — plus
// jamais un repli silencieux sur le premier venu (le highlight mystère).
// Sans mise en avant : rien n'affirme, l'invite parle ; hors niveau : l'état
// « absent » est dit ; des parts sans valeur publiée sont nommées, jamais
// effacées ni inventées.
const partiesAffichees = computed(() => (props.composition?.parties ?? []).filter((partie) => partie.valeur !== null))
const manquantes = computed(() => props.composition?.etat === 'incomplet' ? props.composition.parties.filter((partie) => partie.valeur === null).map((partie) => partie.label) : [])
const total = computed(() => partiesAffichees.value.reduce((sum, partie) => sum + (partie.valeur ?? 0), 0))
const palette = computed(() => props.dispatch.facet.labels)
function colour(detail: string | null) { return detail && couleurDpe(detail) ? couleurDpe(detail) : undefined }
// La valeur affichée lit LE formatage partagé (#466) — l'échelle % est la
// sienne (×100 une fois, unité « % » collée à la convention du bloc), jamais
// une multiplication locale de plus. La référence du périmètre lit LE MÊME
// formatage (#472) : médiane d'un côté, part de l'autre, une seule échelle.
function value(value: number | null) {
  const unite = props.composition?.unite ?? ''
  return value === null ? '—' : `${formaterValeur({ value, unit: unite || null })}${unite}`
}
function label(detail: string | null) { return detail === null ? 'Valeur totale' : palette.value[detail] ?? detail }
function barStyle(partie: PartieComposition): Record<string, string> {
  const style: Record<string, string> = { width: `${total.value > 0 && partie.valeur !== null ? (partie.valeur ?? 0) / total.value * 100 : 0}%` }
  const background = colour(partie.detail)
  if (background) style.background = background
  return style
}
</script>
<template>
  <figure class="family-renderer composition-renderer" data-renderer="composition" :data-state="dispatch.status" aria-label="Repères de composition">
    <div class="composition-bloc" data-testid="composition-contextualisee">
      <h2 class="composition-titre" data-testid="composition-provenance"><template v-if="composition?.nom">Votre territoire : {{ composition.nom }}</template><template v-else>Aucun territoire mis en avant</template></h2>
      <p v-if="!composition || composition.etat === null" class="composition-vide">Sélectionnez un territoire pour lire sa composition face au périmètre comparé.</p>
      <p v-else-if="composition.etat === 'absent'" role="status">{{ composition.message }}</p>
      <template v-else>
        <div v-if="partiesAffichees.length" class="composition-bar" role="img" :aria-label="partiesAffichees.map((partie) => `${label(partie.detail)} ${value(partie.valeur)}`).join(' · ')">
          <span v-for="partie in partiesAffichees" :key="partie.detail" :class="{ active: partie.detail === dispatch.facet.detail }" :style="barStyle(partie)" :title="`${label(partie.detail)} : ${value(partie.valeur)}`" />
        </div>
        <ul v-if="partiesAffichees.length" class="composition-legend">
          <li v-for="partie in partiesAffichees" :key="`legend-${partie.detail}`" :class="{ active: partie.detail === dispatch.facet.detail }"><span>{{ label(partie.detail) }} <small v-if="partie.reference !== null">médiane : {{ value(partie.reference) }}</small></span><strong>{{ value(partie.valeur) }}</strong></li>
        </ul>
        <p v-if="manquantes.length" class="composition-note" role="note">Composition incomplète — sans valeur publiée à ce niveau : {{ manquantes.join(', ') }}.</p>
      </template>
    </div>
    <figcaption><template v-if="composition?.nom">Les segments portent la composition de {{ composition.nom }} — votre territoire, mis en avant depuis l’URL.</template> Chaque segment se lit face à la médiane du périmètre comparé ({{ composition?.univers ?? '' }}). La comparaison entre territoires reste pilotée par « {{ dispatch.facet.label }} »<span v-if="dispatch.facet.detail"> · détail {{ label(dispatch.facet.detail) }}</span>.</figcaption>
  </figure>
</template>
<style scoped>
.composition-renderer{padding:24px;background:var(--surface-primary);border:1px solid var(--border-default);border-radius:12px}
.composition-titre{font:var(--text-h3);margin:0 0 12px}
.composition-bar{display:flex;height:20px;overflow:hidden;border-radius:999px;background:var(--surface-tertiary)}
.composition-bar span{min-width:1px;opacity:.55;border-right:1px solid var(--surface-primary);background:var(--indicateur-accent)}
.composition-bar span.active{opacity:1;outline:3px solid var(--text-primary);outline-offset:-3px}
.composition-legend{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px 16px;list-style:none;margin:16px 0 0;padding:0}
.composition-legend li{display:flex;justify-content:space-between;gap:8px;padding:6px 8px;border-left:3px solid transparent}
.composition-legend li.active{border-left-color:var(--indicateur-accent);background:var(--indicateur-soft)}
.composition-legend li small{color:var(--text-secondary);font-size:.78rem;font-weight:400}
.composition-note,.composition-vide{margin:12px 0 0;color:var(--text-secondary)}
.composition-note{padding:8px 12px;border-left:3px solid var(--indicateur-accent);background:var(--indicateur-soft)}
figcaption{margin-top:16px;color:var(--text-secondary);font-weight:400}
</style>
