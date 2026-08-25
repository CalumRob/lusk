<script setup lang="ts">
import { computed } from 'vue'
import type { Territoire } from '@/payload/types'
import type { NiveauIndicateur } from '@/indicateurs/explorationModel'
import { situationContexte } from '@/indicateurs/explorationModel'

/**
 * La note de contexte permanente des Pages d'indicateur (#472) : UNE ligne
 * discrète, partagée par TOUTES les familles — le territoire mis en avant
 * (ou son absence), le niveau en effet et l'univers comparé, dérivés de
 * l'état résolu de l'URL. Elle vit avec les changements d'état (?territoire,
 * ?niveau, ?departement) parce qu'elle ne lit QUE cet état résolu.
 */
const props = defineProps<{ etat: { niveau: NiveauIndicateur; departement?: string; epci?: string; territoire?: string }; territoires: readonly Territoire[] }>()

const situation = computed(() => situationContexte(props.territoires, props.etat))
const miseEnAvant = computed(() => {
  if (situation.value.introuvable) return 'Territoire mis en avant introuvable'
  if (!situation.value.nom) return 'Aucun territoire mis en avant'
  return situation.value.horsPerimetre ? `Votre territoire : ${situation.value.nom} (hors périmètre comparé)` : `Votre territoire : ${situation.value.nom}`
})
const ligne = computed(() => `${miseEnAvant.value} — comparaison sur ${situation.value.univers}.`)
</script>
<template>
  <p class="note-contexte" data-testid="note-contexte">{{ ligne }}</p>
</template>
<style scoped>
.note-contexte{margin:0;max-width:760px;color:var(--text-secondary);font-size:.85rem}
</style>
