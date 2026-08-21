<script setup lang="ts">
import type { FamilyDispatch } from '@/indicateurs/familySeam'
import ScalarFamilyRenderer from './ScalarFamilyRenderer.vue'
import TrajectoryFamilyRenderer from './TrajectoryFamilyRenderer.vue'
import CompositionFamilyRenderer from './CompositionFamilyRenderer.vue'
import DistributionFamilyRenderer from './DistributionFamilyRenderer.vue'
import ProfileFamilyRenderer from './ProfileFamilyRenderer.vue'
import ListFamilyRenderer from './ListFamilyRenderer.vue'
import RelationshipFamilyRenderer from './RelationshipFamilyRenderer.vue'
import PyramidFamilyRenderer from './PyramidFamilyRenderer.vue'
import ComparisonBarsFamilyRenderer from './ComparisonBarsFamilyRenderer.vue'
defineProps<{ dispatch: FamilyDispatch }>()
const renderers = { ScalarFamilyRenderer, TrajectoryFamilyRenderer, CompositionFamilyRenderer, DistributionFamilyRenderer, ProfileFamilyRenderer, ListFamilyRenderer, RelationshipFamilyRenderer, PyramidFamilyRenderer, ComparisonBarsFamilyRenderer }
</script>
<template>
  <section class="repere-family-outlet" :data-family="dispatch.family" :data-renderer="dispatch.renderer">
    <p v-if="dispatch.status === 'invalid'" role="alert">La facette de cette famille de Repères est invalide.</p>
    <p v-else-if="dispatch.status === 'unavailable'" role="status">Cette famille de Repères n’est pas disponible pour ce territoire.</p>
    <component v-else :is="renderers[dispatch.rendererIdentity.component as keyof typeof renderers]" :dispatch="dispatch"><slot v-if="dispatch.family === 'scalar'" :dispatch="dispatch" /></component>
    <p v-if="dispatch.status === 'incomplete'" role="status">Repères partiels : certaines valeurs sont indisponibles.</p>
  </section>
</template>
