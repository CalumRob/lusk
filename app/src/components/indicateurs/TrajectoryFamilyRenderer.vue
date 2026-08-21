<script setup lang="ts">import type { FamilyDispatch } from '@/indicateurs/familySeam'; defineProps<{ dispatch: FamilyDispatch }>()</script>
<template><div class="family-renderer" data-renderer="trajectory" :data-state="dispatch.status" aria-label="Repères de trajectoire"><p>Trajectoire · {{ dispatch.representation.rows.length }} valeurs · {{ dispatch.facet.unit }}</p></div></template>
