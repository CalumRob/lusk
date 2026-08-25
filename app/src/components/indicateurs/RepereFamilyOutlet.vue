<script setup lang="ts">
import type { FamilyDispatch } from '@/indicateurs/familySeam'
import type { ModeleComposition, ModeleProfil, ModeleRelation, ModeleSignature, ModeleTrajectoire } from '@/indicateurs/explorationModel'
import ScalarFamilyRenderer from './ScalarFamilyRenderer.vue'
import TrajectoryFamilyRenderer from './TrajectoryFamilyRenderer.vue'
import CompositionFamilyRenderer from './CompositionFamilyRenderer.vue'
import DistributionFamilyRenderer from './DistributionFamilyRenderer.vue'
import ListFamilyRenderer from './ListFamilyRenderer.vue'
import RelationshipFamilyRenderer from './RelationshipFamilyRenderer.vue'
import PyramidFamilyRenderer from './PyramidFamilyRenderer.vue'
import ComparisonBarsFamilyRenderer from './ComparisonBarsFamilyRenderer.vue'
defineProps<{ dispatch: FamilyDispatch; modele?: ModeleTrajectoire | null; signature?: ModeleSignature | null; profil?: ModeleProfil | null; relation?: ModeleRelation | null; composition?: ModeleComposition | null }>()
</script>
<template>
  <section class="repere-family-outlet" :data-family="dispatch.family" :data-renderer="dispatch.renderer">
    <p v-if="dispatch.status === 'invalid'" role="alert">La facette de cette famille de Repères est invalide.</p>
    <p v-else-if="dispatch.status === 'unavailable'" role="status">Cette famille de Repères n’est pas disponible pour ce territoire.</p>
    <ScalarFamilyRenderer v-else-if="dispatch.family === 'scalar'" :dispatch="dispatch"><slot :dispatch="dispatch" /></ScalarFamilyRenderer>
    <TrajectoryFamilyRenderer v-else-if="dispatch.family === 'trajectory'" :dispatch="dispatch" :modele="modele"><slot :dispatch="dispatch" /></TrajectoryFamilyRenderer>
    <CompositionFamilyRenderer v-else-if="dispatch.family === 'composition'" :dispatch="dispatch" :composition="composition" />
    <DistributionFamilyRenderer v-else-if="dispatch.family === 'distribution'" :dispatch="dispatch" :signature="signature"><slot :dispatch="dispatch" /></DistributionFamilyRenderer>
    <ListFamilyRenderer v-else-if="dispatch.family === 'list'" :dispatch="dispatch" :profil="profil"><slot :dispatch="dispatch" /></ListFamilyRenderer>
    <RelationshipFamilyRenderer v-else-if="dispatch.family === 'relationship'" :dispatch="dispatch" :relation="relation"><slot :dispatch="dispatch" /></RelationshipFamilyRenderer>
    <PyramidFamilyRenderer v-else-if="dispatch.family === 'pyramid'" :dispatch="dispatch" />
    <ComparisonBarsFamilyRenderer v-else-if="dispatch.family === 'comparison-bars'" :dispatch="dispatch" />
    <p v-if="dispatch.status === 'incomplete'" role="status">Repères partiels : certaines valeurs sont indisponibles.</p>
  </section>
</template>
