<script setup lang="ts">
import { computed } from 'vue'
import type { FamilyDispatch } from '@/indicateurs/familySeam'
import type { AxeRelation, ModeleRelation } from '@/indicateurs/explorationModel'
import { formaterValeur } from '@/payload/selectors'

const props = defineProps<{ dispatch: Extract<FamilyDispatch, { family: 'relationship' }>; relation?: ModeleRelation | null }>()

// La position d'une valeur sur son axe se dérive du domaine RÉEL des valeurs
// tracées (#441) — jamais une plage de pixels fixe (le défaut du PR supplanté,
// qui supposait des plages 0–11). Un domaine dégénéré (une seule valeur)
// siège au centre.
function positionDe(valeur: number, axe: AxeRelation): number {
  if (axe.min === null || axe.max === null) return 50
  if (axe.min === axe.max) return 50
  return ((valeur - axe.min) / (axe.max - axe.min)) * 100
}
/** Les paires complètes seulement — un point sans coordonnée ne trace pas. */
const traces = computed(() => {
  const relation = props.relation
  if (!relation) return []
  return relation.points.filter((point) => point.x !== null && point.y !== null).map((point) => ({
    id: point.territoire.territoire,
    selection: point.highlighted,
    cx: positionDe(point.x!, relation.axeX),
    cy: 100 - positionDe(point.y!, relation.axeY),
    titre: `${point.territoire.nom} · ${formaterValeur({ value: point.x!, unit: relation.axeX.unit })} ${relation.axeX.unit} · ${formaterValeur({ value: point.y!, unit: relation.axeY.unit })} ${relation.axeY.unit}`,
  }))
})
const libelleNuage = computed(() => props.relation ? `Nuage de ${traces.value.length} territoires : ${props.relation.axeX.label} (${props.relation.axeX.unit}) et ${props.relation.axeY.label} (${props.relation.axeY.unit})` : '')
const nomsIncomplets = computed(() => (props.relation?.incomplets ?? []).map((point) => point.territoire.nom).join(', '))
</script>
<template>
  <figure class="family-renderer relationship-renderer" data-renderer="relationship" :data-state="dispatch.status" aria-label="Repères de relation">
    <div class="relation-bloc" data-testid="relation-nuage">
      <h2>La relation croisée du territoire sélectionné</h2>
      <svg v-if="traces.length" class="relation-nuage" viewBox="0 0 100 100" role="img" :aria-label="libelleNuage">
        <line class="relation-axe" x1="2" y1="98" x2="98" y2="98" />
        <line class="relation-axe" x1="2" y1="2" x2="2" y2="98" />
        <circle v-for="point in traces" :key="point.id" class="relation-point" :class="{ selection: point.selection }" :data-point-relation="point.id" :cx="point.cx" :cy="point.cy" r="3"><title>{{ point.titre }}</title></circle>
      </svg>
      <p v-if="relation && relation.etat === 'incomplet'" class="relation-note" role="note">{{ relation.message }}</p>
      <p v-else-if="relation && relation.etat === 'absent'" role="status">{{ relation.message }}</p>
      <p v-else-if="!relation || relation.etat === null" role="status">Sélectionnez un territoire pour le situer dans la relation.</p>
      <p v-if="nomsIncomplets" role="note">Territoires sans coordonnée complète — non tracés : {{ nomsIncomplets }}.</p>
    </div>
    <figcaption>Le nuage croise « {{ relation?.axeX.label ?? '' }} » ({{ relation?.axeX.unit ?? '' }}) et « {{ relation?.axeY.label ?? '' }} » ({{ relation?.axeY.unit ?? '' }}) ; la comparaison entre territoires ci-dessous est pilotée par « {{ dispatch.facet.label }} » ({{ dispatch.facet.unit }}) — la relation n’est jamais réduite à un score unique.</figcaption>
    <slot :dispatch="dispatch" />
  </figure>
</template>
<style scoped>
.relationship-renderer{padding:24px;background:var(--surface-primary);border:1px solid var(--border-default);border-radius:12px}
.relation-bloc h2{font:var(--text-h3);margin:0 0 12px}
.relation-nuage{width:100%;max-width:520px;aspect-ratio:1;border-left:2px solid var(--indicateur-line);border-bottom:2px solid var(--indicateur-line)}
.relation-axe{stroke:var(--indicateur-line);stroke-width:.5}
.relation-point{fill:var(--indicateur-accent)}
.relation-point.selection{fill:var(--status-error)}
.relation-note{margin:12px 0 0;padding:8px 12px;border-left:3px solid var(--indicateur-accent);background:var(--indicateur-soft);color:var(--text-secondary)}
.relationship-renderer figcaption{margin-top:12px;color:var(--text-secondary)}
</style>
