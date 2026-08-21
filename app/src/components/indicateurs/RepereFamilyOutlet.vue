<script setup lang="ts">
import type { FamilyDispatch } from '@/indicateurs/familySeam'
import ScalarFamilyRenderer from './ScalarFamilyRenderer.vue'
import TrajectoryFamilyRenderer from './TrajectoryFamilyRenderer.vue'
import CompositionFamilyRenderer from './CompositionFamilyRenderer.vue'
import DistributionFamilyRenderer from './DistributionFamilyRenderer.vue'
import ListFamilyRenderer from './ListFamilyRenderer.vue'
import RelationshipFamilyRenderer from './RelationshipFamilyRenderer.vue'
import PyramidFamilyRenderer from './PyramidFamilyRenderer.vue'
import ComparisonBarsFamilyRenderer from './ComparisonBarsFamilyRenderer.vue'
defineProps<{ dispatch: FamilyDispatch }>()
</script>
<template>
  <section class="repere-family-outlet" :data-family="dispatch.family" :data-renderer="dispatch.renderer">
    <p v-if="dispatch.status === 'invalid'" role="alert">La facette de cette famille de Repères est invalide.</p>
    <p v-else-if="dispatch.status === 'unavailable'" role="status">Cette famille de Repères n’est pas disponible pour ce territoire.</p>
    <ScalarFamilyRenderer v-else-if="dispatch.family === 'scalar'" :dispatch="dispatch"><slot :dispatch="dispatch" /></ScalarFamilyRenderer>
    <TrajectoryFamilyRenderer v-else-if="dispatch.family === 'trajectory'" :dispatch="dispatch" />
    <CompositionFamilyRenderer v-else-if="dispatch.family === 'composition'" :dispatch="dispatch" />
    <DistributionFamilyRenderer v-else-if="dispatch.family === 'distribution'" :dispatch="dispatch" />
    <ListFamilyRenderer v-else-if="dispatch.family === 'list'" :dispatch="dispatch" />
    <RelationshipFamilyRenderer v-else-if="dispatch.family === 'relationship'" :dispatch="dispatch" />
    <PyramidFamilyRenderer v-else-if="dispatch.family === 'pyramid'" :dispatch="dispatch" />
    <ComparisonBarsFamilyRenderer v-else-if="dispatch.family === 'comparison-bars'" :dispatch="dispatch" />
    <p v-if="dispatch.status === 'incomplete'" role="status">Repères partiels : certaines valeurs sont indisponibles.</p>
  </section>
</template>
