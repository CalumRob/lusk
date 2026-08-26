<script setup lang="ts">
/**
 * #501 — PROTOTYPE JETABLE (dev uniquement) — racine des trois shells
 * Repères. Reçoit d'IndicateurPage la matière résolue (modèles, dispatch,
 * payload carte, sources, mutateurs d'URL) et la redistribue à la variante
 * demandée par ?variant=A|B|C, avec la barre de commutation partagée.
 *
 * Aucun état propre : tout ce qui se modifie passe par l'URL de la page
 * hôte (?niveau, ?departement, ?epci, ?territoire, ?detail, ?tri, ?vue…).
 */
import type { ProtocoleProps } from './protocole-types'
import BarreVariantes from './BarreVariantes.vue'
import VarianteRecit from './VarianteRecit.vue'
import VarianteConsole from './VarianteConsole.vue'
import VarianteAtlas from './VarianteAtlas.vue'

defineProps<ProtocoleProps>()
</script>

<template>
  <div class="prototype-racine" :data-proto="variante">
    <VarianteRecit v-if="variante === 'A'" v-bind="$props" />
    <VarianteConsole v-else-if="variante === 'B'" v-bind="$props" />
    <VarianteAtlas v-else v-bind="$props" />
    <BarreVariantes :variante="variante" />
  </div>
</template>

<style scoped>
.prototype-racine{min-height:100%}
</style>
