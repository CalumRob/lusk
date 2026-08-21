<script setup lang="ts">
import type { FamilyDispatch } from '@/indicateurs/familySeam'
defineProps<{ dispatch: FamilyDispatch }>()
</script>
<template>
  <section class="repere-family-outlet" :data-family="dispatch.family" :data-renderer="dispatch.renderer">
    <slot :dispatch="dispatch">
      <p v-if="dispatch.status === 'missing'" role="status">Cette famille de Repères n’est pas disponible pour ce territoire.</p>
      <p v-else-if="dispatch.status === 'partial'" role="status">Repères partiels : certaines valeurs sont indisponibles.</p>
    </slot>
  </section>
</template>
